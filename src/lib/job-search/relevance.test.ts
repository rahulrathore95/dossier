import { describe, expect, it } from "vitest";

import { scoreRelevance, WEIGHTS, yearsOfExperience, type RelevanceProfile } from "./relevance";
import type { FoundPosting } from "./search";

const now = new Date("2026-10-28T12:00:00Z");

const profile: RelevanceProfile = {
  skills: ["Python", "SQL", "GCP", "BigQuery", "PySpark", "Databricks", "Airflow", "Azure"],
  roles: ["Senior Data Engineer", "Data Platform Engineer"],
  years: 8,
  salaryFloorLpa: 40,
  requireIndia: true,
};

const posting = (fields: Partial<FoundPosting>): FoundPosting => ({
  source: "FIRECRAWL",
  externalId: "x",
  title: "Senior Data Engineer",
  company: "Acme",
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: "https://jobs.lever.co/acme/02b45afd-5a49-41b2-a244-b0ca76306692",
  via: "",
  description: "",
  complete: false,
  ...fields,
});

describe("scoreRelevance", () => {
  it("weights add up to 100", () => {
    expect(Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it("scores a strong match high and says why", () => {
    const result = scoreRelevance(
      posting({
        title: "Senior Data Engineer (India)",
        description: "Build pipelines on GCP with BigQuery, PySpark, Airflow and SQL in Python. ₹45-60 LPA.",
        postedAt: "2026-10-28T02:00:00Z",
      }),
      profile,
      now,
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.excluded).toBeNull();
    expect(result.matchedSkills).toEqual(expect.arrayContaining(["GCP", "BigQuery", "PySpark", "Airflow", "SQL", "Python"]));
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Matches 6 of your skills/),
        "Title matches a target role",
        expect.stringMatching(/^Seniority fits/),
        expect.stringMatching(/^India/),
        expect.stringMatching(/^Pays at least your ₹40 LPA/),
        "Posted in the last 24 hours",
        "Apply link goes to the employer (Lever)",
      ]),
    );
  });

  it("names skills the posting asks for that the resume doesn't have", () => {
    const result = scoreRelevance(posting({ description: "Snowflake, dbt and Kafka; SQL." }), profile, now);
    expect(result.missingSkills).toEqual(["Kafka", "dbt", "Snowflake"]);
  });

  it("excludes a remote role limited to another country, with the reason", () => {
    const result = scoreRelevance(posting({ title: "Senior Data Engineer II - Remote - US" }), profile, now);
    expect(result.eligibility.status).toBe("restricted");
    expect(result.excluded).toMatch(/^Not open to India/);
  });

  it("keeps it when India isn't required", () => {
    const result = scoreRelevance(posting({ title: "Senior Data Engineer II - Remote - US" }), { ...profile, requireIndia: false }, now);
    expect(result.excluded).toBeNull();
  });

  it("excludes pay stated below the floor, but not undisclosed pay", () => {
    expect(scoreRelevance(posting({ title: "Senior Data Engineer, Pune", salary: "₹18-24 LPA" }), profile, now).excluded).toBe("Pay stated below ₹40 LPA");
    const undisclosed = scoreRelevance(posting({ title: "Senior Data Engineer, Pune" }), profile, now);
    expect(undisclosed.excluded).toBeNull();
    expect(undisclosed.concerns).toContain("Salary not disclosed");
  });

  it("excludes an unrelated posting", () => {
    const result = scoreRelevance(posting({ title: "Sales Development Representative, Pune", description: "Cold calls." }), profile, now);
    expect(result.excluded).toMatch(/^Unrelated/);
  });

  it("flags a junior title for eight years of experience", () => {
    const result = scoreRelevance(posting({ title: "Junior Data Engineer, Pune" }), profile, now);
    expect(result.concerns).toContain("Asks for junior; you have 8 years");
  });

  it("says the date is unknown instead of guessing it", () => {
    expect(scoreRelevance(posting({}), profile, now).concerns).toContain("Posting date unknown");
  });

  it("counts a board link as less direct than the employer's", () => {
    const result = scoreRelevance(posting({ url: "https://www.naukri.com/job-listings-senior-data-engineer-acme-pune-5-to-8-years-1" }), profile, now);
    expect(result.direct).toBe(false);
    expect(result.concerns).toContain("Apply link is on Naukri, not the employer's own site");
  });
});

describe("yearsOfExperience", () => {
  it("counts from the first role's start", () => {
    expect(yearsOfExperience([{ startYear: 2018, startMonth: 3, current: true, endYear: null, endMonth: null }], now)).toBe(8);
    expect(yearsOfExperience([{ startYear: null, startMonth: null, current: false, endYear: null, endMonth: null }], now)).toBeNull();
  });
});

describe("outside India (this fork)", () => {
  it("neither judges nor excludes by India when the candidate isn't there", () => {
    const rotterdam = scoreRelevance(posting({ title: "Senior Data Engineer, Rotterdam" }), { ...profile, inIndia: false }, now);
    expect(rotterdam.excluded).toBeNull();
    expect(rotterdam.inIndia).toBe(false);
    expect([...rotterdam.reasons, ...rotterdam.concerns].some((line) => /India|Outside India/.test(line))).toBe(false);
  });
});
