// How relevant a found posting is to the master resume (this fork): a score
// out of 100 from facts that can be checked in code, each with a line that
// says why, so a ranking can be audited rather than trusted. It runs on every
// result at no cost; the AI score (#208) stays for a closer look at the few
// worth it. The weights are in WEIGHTS; nothing here is a model's guess.
//
// A posting is excluded only for what its own words settle: a job outside
// India or remote only from another country (when India is required), pay
// stated below the floor, or a title and text with nothing in common with
// the target roles and skills. Excluded postings are kept with the reason,
// for the screen to show on request — never dropped silently.

import { isDirectEmployerLink, platformOf } from "./ats";
import { ELIGIBILITY_LABELS, indiaEligibility, type EligibilityVerdict } from "./eligibility";
import { meetsFloor, readSalary, salaryLabel, type SalaryVerdict } from "./salary";
import type { FoundPosting } from "./search";

/** What relevance is measured against: the master resume, and the preferences in Settings → Job search. */
export type RelevanceProfile = {
  /** The profile's skills, as written there. */
  skills: readonly string[];
  /** Roles to look for: the target roles in Settings, else the search's keywords and the latest role. */
  roles: readonly string[];
  /** Years since the first role started; null without dates. */
  years: number | null;
  /** Lakhs a year; 0 turns the floor off. */
  salaryFloorLpa: number;
  /** Whether a posting must be doable from India. */
  requireIndia: boolean;
};

export type Relevance = {
  score: number;
  /** Why it scores what it does, best first. */
  reasons: string[];
  /** What counts against it. */
  concerns: string[];
  /** The profile's skills the posting names. */
  matchedSkills: string[];
  /** Skills the posting names that the profile doesn't have. */
  missingSkills: string[];
  eligibility: EligibilityVerdict;
  salary: SalaryVerdict;
  salaryLabel: string;
  /** Whether the link applies on the employer's own system. */
  direct: boolean;
  /** Why it's left out of results by default; null when it isn't. */
  excluded: string | null;
};

export const WEIGHTS = { skills: 35, title: 20, seniority: 10, eligibility: 15, salary: 10, freshness: 5, link: 5 } as const;

/** Tools and platforms data and software postings ask for, to name what the profile lacks. */
const KNOWN_SKILLS = [
  "Python", "SQL", "Scala", "Java", "Go", "TypeScript", "Spark", "PySpark", "Kafka", "Flink", "Airflow", "dbt", "Snowflake",
  "BigQuery", "Databricks", "Redshift", "Delta Lake", "Iceberg", "Hadoop", "Hive", "AWS", "GCP", "Azure", "Kubernetes", "Docker",
  "Terraform", "Looker", "Tableau", "Power BI", "Dataflow", "Pub/Sub", "Synapse", "Data Factory", "Glue", "EMR", "Kinesis",
  "PostgreSQL", "MongoDB", "Cassandra", "Elasticsearch", "MLflow", "LangChain", "Vertex AI", "SageMaker",
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A skill as a whole word: "Go" in "Go developer" but not in "good"; "C++" and "Node.js" as written. */
const wordPattern = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(term.trim())}(?![\\p{L}\\p{N}+#])`, "iu");
const mentions = (text: string, term: string) => term.trim().length > 0 && wordPattern(term).test(text);

const LEVELS: { level: number; pattern: RegExp; name: string }[] = [
  { level: 0, pattern: /\b(intern|internship|trainee|fresher|graduate)\b/i, name: "entry level" },
  { level: 1, pattern: /\b(junior|jr\.?|associate|engineer i)\b/i, name: "junior" },
  { level: 3, pattern: /\b(senior|sr\.?|engineer iii|sde[\s-]?3)\b/i, name: "senior" },
  { level: 4, pattern: /\b(lead|staff|principal|architect|head|manager|director)\b/i, name: "lead or staff" },
];

/** The level a title asks for; 2 (mid) when it doesn't say. */
const titleLevel = (title: string) => LEVELS.findLast((entry) => entry.pattern.test(title)) ?? null;
/** The level that fits these years. */
const levelForYears = (years: number) => (years >= 10 ? 4 : years >= 5 ? 3 : years >= 2 ? 2 : years >= 1 ? 1 : 0);

/** The words that make a role a role: "Senior Data Engineer" → ["data", "engineer"]. */
const ROLE_NOISE = new Set(["senior", "sr", "junior", "jr", "lead", "staff", "principal", "head", "of", "and", "the", "a", "ii", "iii", "i", "remote", "india"]);
const roleWords = (role: string) =>
  role
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((word) => word.length > 1 && !ROLE_NOISE.has(word));

function freshness(postedAt: string | null, now: Date): { points: number; line: string } {
  if (!postedAt) return { points: 2, line: "Posting date unknown" };
  const hours = (now.getTime() - Date.parse(postedAt)) / 3_600_000;
  if (hours <= 24) return { points: 5, line: "Posted in the last 24 hours" };
  if (hours <= 48) return { points: 4, line: "Posted in the last 48 hours" };
  if (hours <= 24 * 7) return { points: 3, line: "Posted in the last 7 days" };
  return { points: 1, line: `Posted ${Math.floor(hours / 24)} days ago` };
}

/** How relevant `posting` is to `profile`, with the reasons. */
export function scoreRelevance(posting: FoundPosting, profile: RelevanceProfile, now = new Date()): Relevance {
  const text = `${posting.title}\n${posting.description}`;
  const reasons: string[] = [];
  const concerns: string[] = [];

  // Skills: the profile's own, named in the posting.
  const matchedSkills = [...new Set(profile.skills.filter((skill) => mentions(text, skill)))];
  const missingSkills = KNOWN_SKILLS.filter((skill) => mentions(text, skill) && !profile.skills.some((own) => own.toLowerCase() === skill.toLowerCase()));
  const skillPoints = Math.round(Math.min(1, matchedSkills.length / 6) * WEIGHTS.skills);
  if (matchedSkills.length > 0) reasons.push(`Matches ${matchedSkills.length} of your skills: ${matchedSkills.slice(0, 6).join(", ")}`);
  else concerns.push("Names none of your skills (the search may have shown only a snippet)");
  if (missingSkills.length > 0) concerns.push(`Asks for ${missingSkills.slice(0, 4).join(", ")}, not in your resume`);

  // Title: a target role's own words in the title.
  const title = posting.title.toLowerCase();
  const best = Math.max(0, ...profile.roles.map((role) => {
    const words = roleWords(role);
    if (words.length === 0) return 0;
    if (title.includes(words.join(" "))) return 1;
    return words.filter((word) => title.includes(word)).length / words.length;
  }));
  const titlePoints = Math.round(best * WEIGHTS.title);
  if (best === 1) reasons.push("Title matches a target role");
  else if (best >= 0.5) reasons.push("Title is close to a target role");
  else concerns.push("Title doesn't match your target roles");

  // Seniority: what the title asks for against the years in the resume.
  const asked = titleLevel(posting.title);
  let seniorityPoints = Math.round(WEIGHTS.seniority / 2);
  if (asked && profile.years !== null) {
    const gap = levelForYears(profile.years) - asked.level;
    if (Math.abs(gap) <= 1) {
      seniorityPoints = WEIGHTS.seniority;
      reasons.push(`Seniority fits (${asked.name}, ${profile.years} years in your resume)`);
    } else {
      seniorityPoints = 0;
      concerns.push(gap > 0 ? `Asks for ${asked.name}; you have ${profile.years} years` : `Asks for ${asked.name}, above your ${profile.years} years`);
    }
  }

  // Where it can be done from.
  const eligibility = indiaEligibility(posting);
  const eligibilityPoints = { india: 15, anywhere: 15, unclear: 7, restricted: 0, elsewhere: 0 }[eligibility.status];
  const where = `${ELIGIBILITY_LABELS[eligibility.status]}${eligibility.evidence ? ` (“${eligibility.evidence}”)` : ""}`;
  if (eligibilityPoints === 15) reasons.push(where);
  else concerns.push(where);

  // Pay against the floor.
  const salary = readSalary(posting);
  const meets = profile.salaryFloorLpa > 0 ? meetsFloor(salary, profile.salaryFloorLpa) : null;
  const salaryPoints = meets === true ? WEIGHTS.salary : meets === false ? 0 : Math.round(WEIGHTS.salary / 2);
  if (meets === true) reasons.push(`Pays at least your ₹${profile.salaryFloorLpa} LPA: ${salaryLabel(salary)}`);
  else if (meets === false) concerns.push(`Below your ₹${profile.salaryFloorLpa} LPA: ${salaryLabel(salary)}`);
  else concerns.push(salaryLabel(salary));

  const fresh = freshness(posting.postedAt, now);
  (fresh.points >= 4 ? reasons : concerns).push(fresh.line);

  const direct = isDirectEmployerLink(posting.url);
  const platform = platformOf(posting.url);
  const linkPoints = direct ? WEIGHTS.link : platform ? 2 : 3;
  if (direct) reasons.push(`Apply link goes to the employer${platform ? ` (${platform})` : ""}`);
  else if (platform) concerns.push(`Apply link is on ${platform}, not the employer's own site`);

  const score = Math.max(0, Math.min(100, skillPoints + titlePoints + seniorityPoints + eligibilityPoints + salaryPoints + fresh.points + linkPoints));

  let excluded: string | null = null;
  if (profile.requireIndia && (eligibility.status === "restricted" || eligibility.status === "elsewhere")) excluded = `Not open to India: ${where}`;
  else if (meets === false && salary.status === "stated") excluded = `Pay stated below ₹${profile.salaryFloorLpa} LPA`;
  else if (best === 0 && matchedSkills.length < 2) excluded = "Unrelated: no target-role words in the title and fewer than two of your skills";

  return { score, reasons, concerns, matchedSkills, missingSkills, eligibility, salary, salaryLabel: salaryLabel(salary), direct, excluded };
}

type Span = { startYear: number | null; startMonth: number | null; current: boolean; endYear: number | null; endMonth: number | null };

/** Whole years from the first role's start to now: what the resume shows, not more. Null without any start date. */
export function yearsOfExperience(experience: readonly Span[], now = new Date()): number | null {
  const starts = experience.filter((entry) => entry.startYear !== null).map((entry) => entry.startYear! * 12 + (entry.startMonth ?? 1) - 1);
  if (starts.length === 0) return null;
  const months = now.getUTCFullYear() * 12 + now.getUTCMonth() - Math.min(...starts);
  return Math.max(0, Math.floor(months / 12));
}
