// Whether a posting can be done from India (this fork): what the posting's
// own words say, never a guess. Firecrawl gives only a title and a snippet,
// JSearch and Adzuna a place and sometimes a remote flag, so the answer is
// often "unclear" — said as such, with the words it rests on, rather than
// filled in.

import type { FoundPosting } from "./search";

export type Eligibility =
  /** India is named as where the job is, or where a remote hire may live. */
  | "india"
  /** Remote from anywhere: worldwide, global, any country. */
  | "anywhere"
  /** Remote, but only from another country or region ("Remote - US", "EMEA only"). */
  | "restricted"
  /** On site, or hybrid, in another country. */
  | "elsewhere"
  /** The posting doesn't say clearly enough. */
  | "unclear";

export type EligibilityVerdict = { status: Eligibility; evidence: string };

/** Indian cities as postings write them, aliases included (from where-to-apply's list). */
const INDIAN_PLACES = [
  "india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "bombay", "delhi", "new delhi", "ncr", "gurugram", "gurgaon",
  "noida", "chennai", "kolkata", "ahmedabad", "kochi", "cochin", "jaipur", "chandigarh", "indore", "coimbatore",
  "thiruvananthapuram", "trivandrum", "mysore", "mysuru", "vadodara", "nagpur", "bhubaneswar", "visakhapatnam",
];
const INDIA = new RegExp(`\\b(${INDIAN_PLACES.join("|")})\\b`, "i");

/** Whether text is only place names: "Pune", "Jaipur,Indore", "India". */
export const isPlaceList = (text: string) =>
  text.split(/[,/]/).every((part) => new RegExp(`^\\s*(${INDIAN_PLACES.join("|")}|remote)\\s*$`, "i").test(part));

/** Other countries and regions a remote posting is limited to. */
const REGION_NAMES =
  /\b(united states|america|canada|united kingdom|england|ireland|germany|deutschland|france|spain|portugal|netherlands|poland|romania|europe|european union|latin america|brazil|mexico|argentina|colombia|australia|new zealand|singapore|philippines|japan|dubai|israel|south africa|nigeria|kenya)\b/i;
/** Abbreviations, in capitals only: "US", not the "us" of "join us". */
const REGION_CODES = /\b(US|USA|U\.S\.A?\.?|UK|U\.K\.|EU|EMEA|LATAM|APAC|UAE|CET|EST|PST)\b/;
const otherRegion = (text: string) => REGION_NAMES.exec(text) ?? REGION_CODES.exec(text);
/** "New York, NY", "Austin, TX": a US city with its state. */
const US_CITY = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

const ANYWHERE = /\b(work\s+from\s+anywhere|remote\s*[-–(:,]?\s*(worldwide|global|anywhere)|anywhere\s+in\s+the\s+world|fully\s+distributed|globally\s+remote|worldwide)\b/i;
/** "US only", "must be based in the UK", "authorized to work in the United States", "Remote - US". */
const ONLY =
  /\b(only|must\s+(be\s+)?(based|located|reside|live)|authori[sz]ed\s+to\s+work\s+in|eligible\s+to\s+work\s+in|residents?\s+of|located\s+in)\b/i;
const REMOTE = /\b(remote|work\s+from\s+home|wfh|distributed)\b/i;

/** The words around the first match, for the evidence line. */
function around(text: string, match: RegExpExecArray | null): string {
  if (!match) return "";
  const start = Math.max(0, match.index - 30);
  return text.slice(start, match.index + match[0].length + 30).replace(/\s+/g, " ").trim();
}

/**
 * Where the posting may be done from, for someone in India. The title and
 * place are read first: they say where the job is. The description only
 * counts for phrases that place the job ("Location: Pune", "Remote - India",
 * "must be based in the US"), not for an office it merely mentions.
 */
export function indiaEligibility(posting: Pick<FoundPosting, "title" | "place" | "remote" | "description">): EligibilityVerdict {
  const head = `${posting.title} · ${posting.place}`;
  const body = posting.description.slice(0, 4000);
  const remote = posting.remote === true || REMOTE.test(head) || /\blocation\s*type[.:]?\s*remote\b/i.test(body);

  const indiaInHead = INDIA.exec(head);
  if (indiaInHead) return { status: "india", evidence: around(head, indiaInHead) };
  const located = /\b(location|based\s+in|located\s+in|office)[.:]?\s+([^.\n]{0,60})/i.exec(body);
  if (located && INDIA.test(located[2])) return { status: "india", evidence: around(body, located) };
  const remoteIndia = /\bremote\s*[-–(:,]?\s*(india|in\s+india)\b|\bindia\s*[-–(,]?\s*remote\b|\bpan[\s-]india\b/i.exec(body);
  if (remoteIndia) return { status: "india", evidence: around(body, remoteIndia) };

  const anywhere = ANYWHERE.exec(head) ?? ANYWHERE.exec(body);
  if (anywhere) return { status: "anywhere", evidence: around(anywhere.input, anywhere) };

  const otherInHead = otherRegion(head) ?? US_CITY.exec(head);
  const restriction = ONLY.exec(body);
  const otherNearRestriction = restriction ? otherRegion(body.slice(restriction.index, restriction.index + 80)) : null;
  if (remote) {
    if (otherInHead) return { status: "restricted", evidence: around(head, otherInHead) };
    if (otherNearRestriction) return { status: "restricted", evidence: around(body, restriction) };
    return { status: "unclear", evidence: "Remote, but the posting doesn't say from which countries." };
  }
  if (otherInHead) return { status: "elsewhere", evidence: around(head, otherInHead) };
  const locatedElsewhere = located && (otherRegion(located[2]) ?? US_CITY.exec(located[2]));
  if (locatedElsewhere) return { status: "elsewhere", evidence: around(body, located) };
  return { status: "unclear", evidence: "The posting doesn't say where the job is." };
}

/** "India", "Remote, anywhere", "Remote, other country only", "Elsewhere", "Location unclear". */
export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  india: "India",
  anywhere: "Remote, anywhere",
  restricted: "Remote, other country only",
  elsewhere: "Outside India",
  unclear: "Location unclear",
};
