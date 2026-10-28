import { describe, expect, it } from "vitest";

import { sameJob, withoutRepeats } from "./dedupe";
import type { FoundPosting } from "./search";

const posting = (fields: Partial<FoundPosting>): FoundPosting => ({
  source: "JSEARCH",
  externalId: "x",
  title: "Senior Data Engineer",
  company: "Acme",
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: "",
  via: "",
  description: "",
  complete: false,
  ...fields,
});

describe("sameJob", () => {
  it("matches the same link without tracking parameters, across sources", () => {
    expect(
      sameJob(
        posting({ source: "JSEARCH", url: "https://jobs.lever.co/acme/1?lever-source=LinkedIn", company: "A" }),
        posting({ source: "FIRECRAWL", url: "https://jobs.lever.co/acme/1", company: "B" }),
      ),
    ).toBe(true);
  });

  it("matches the same company and title, ignoring legal suffixes and a missing place", () => {
    expect(sameJob(posting({ company: "Acme Technologies Pvt. Ltd.", place: "Pune" }), posting({ company: "acme", place: "" }))).toBe(true);
  });

  it("keeps the same role in two cities apart", () => {
    expect(sameJob(posting({ place: "Pune" }), posting({ place: "Austin" }))).toBe(false);
  });

  it("never matches on an empty company", () => {
    expect(sameJob(posting({ company: "" }), posting({ company: "" }))).toBe(false);
  });
});

describe("withoutRepeats", () => {
  it("keeps the first of each and counts the rest", () => {
    const { postings, repeats } = withoutRepeats([posting({ externalId: "1" }), posting({ externalId: "2" }), posting({ externalId: "3", company: "Other" })]);
    expect(postings.map((entry) => entry.externalId)).toEqual(["1", "3"]);
    expect(repeats).toBe(1);
  });
});
