import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
const searchPostings = vi.hoisted(() => vi.fn());
vi.mock("./index", () => ({ searchPostings, postingDetails: vi.fn() }));

import type { JobSearchConfig } from "./config";
import { jobSearchError } from "./errors";
import { decodeCursors, encodeCursors, searchAllSources, searchWithFallback } from "./find";
import { clearSourceHealth } from "./health";
import { EMPTY_QUERY, type FoundPosting, type JobSource, type SearchQuery } from "./search";

const query: SearchQuery = { ...EMPTY_QUERY, keywords: "Senior Data Engineer", country: "in" };
const now = new Date("2026-10-28T12:00:00Z");

const config: JobSearchConfig = {
  source: "JSEARCH",
  saved: true,
  jsearch: { key: "js", host: "openwebninja", keyState: "set" },
  adzuna: { appId: "app", key: "adz", keyState: "set" },
  firecrawl: { key: "fc", keyState: "set" },
  blockedCompanies: [],
  mode: "all",
  targetRoles: [],
  salaryFloorLpa: 40,
  requireIndia: true,
  arbeitsagentur: { offered: true, acceptedAt: null },
};

const posting = (source: JobSource, id: string, fields: Partial<FoundPosting> = {}): FoundPosting => ({
  source,
  externalId: id,
  title: "Senior Data Engineer",
  company: `Company ${id}`,
  place: "",
  remote: null,
  salary: "",
  postedAt: null,
  url: `https://example.com/${id}`,
  via: "",
  description: "",
  complete: false,
  ...fields,
});

beforeEach(() => {
  searchPostings.mockReset();
  clearSourceHealth();
});

describe("searchAllSources", () => {
  it("asks every source with a key at once, merges them, and shows a job found twice once", async () => {
    searchPostings.mockImplementation(async (source: JobSource) => {
      if (source === "JSEARCH") return { postings: [posting("JSEARCH", "1", { company: "Acme Pvt Ltd", place: "Pune" })], next: "2" };
      if (source === "ADZUNA") return { postings: [posting("ADZUNA", "2")], next: null };
      return { postings: [posting("FIRECRAWL", "3", { company: "Acme" }), posting("FIRECRAWL", "4")], next: null, notes: ["Left out 3 pages that list many jobs rather than one posting."] };
    });
    const answer = await searchAllSources(config, "JSEARCH", query, { now });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.postings.map((entry) => entry.externalId)).toEqual(["1", "2", "4"]);
    expect(answer.next).toBe('multi:{"JSEARCH":"2"}');
    expect(answer.report).toEqual([
      { source: "JSEARCH", status: "ok", found: 1, message: "1 job was found by more than one source and shows once." },
      { source: "ADZUNA", status: "ok", found: 1, message: "" },
      { source: "FIRECRAWL", status: "ok", found: 2, message: "Left out 3 pages that list many jobs rather than one posting." },
      { source: "ARBEITSAGENTUR", status: "not-configured", found: 0, message: expect.stringContaining("I understand") },
    ]);
  });

  it("keeps what answered when one source fails, and says which failed", async () => {
    searchPostings.mockImplementation(async (source: JobSource) => {
      if (source === "JSEARCH") throw jobSearchError("quota", "JSEARCH");
      return { postings: [posting(source, source)], next: null };
    });
    const answer = await searchAllSources(config, "JSEARCH", query, { now, exclude: ["ARBEITSAGENTUR"] });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.postings).toHaveLength(2);
    expect(answer.report[0]).toMatchObject({ source: "JSEARCH", status: "failed", message: expect.stringContaining("used up your JSearch searches") });
  });

  it("rests a source that just failed instead of asking it again, until the rest is over", async () => {
    searchPostings.mockImplementation(async (source: JobSource) => {
      if (source === "JSEARCH") throw jobSearchError("unavailable", "JSEARCH");
      return { postings: [], next: null };
    });
    await searchAllSources(config, "JSEARCH", query, { now, exclude: ["ARBEITSAGENTUR"] });
    searchPostings.mockClear();
    const again = await searchAllSources(config, "JSEARCH", query, { now: new Date(now.getTime() + 60_000), exclude: ["ARBEITSAGENTUR"] });
    expect(searchPostings.mock.calls.map(([source]) => source)).toEqual(["ADZUNA", "FIRECRAWL"]);
    expect(again.report?.[0]).toMatchObject({ source: "JSEARCH", status: "resting", message: expect.stringMatching(/^Not asked: it failed recently .* rests until 12:10 UTC\.$/) });

    searchPostings.mockClear();
    await searchAllSources(config, "JSEARCH", query, { now: new Date(now.getTime() + 11 * 60_000), exclude: ["ARBEITSAGENTUR"] });
    expect(searchPostings.mock.calls.map(([source]) => source)).toContain("JSEARCH");
  });

  it("asks a source with a refused key again once the key changes", async () => {
    searchPostings.mockRejectedValueOnce(jobSearchError("key", "JSEARCH")).mockResolvedValue({ postings: [], next: null });
    await searchAllSources(config, "JSEARCH", query, { now, exclude: ["ADZUNA", "FIRECRAWL", "ARBEITSAGENTUR"] });
    const resting = await searchAllSources(config, "JSEARCH", query, { now, exclude: ["ADZUNA", "FIRECRAWL", "ARBEITSAGENTUR"] });
    expect(resting.ok).toBe(false);
    const newKey = { ...config, jsearch: { ...config.jsearch, key: "js-new" } };
    const answer = await searchAllSources(newKey, "JSEARCH", query, { now, exclude: ["ADZUNA", "FIRECRAWL", "ARBEITSAGENTUR"] });
    expect(answer.ok).toBe(true);
  });

  it("goes on with only the sources that had another page", async () => {
    searchPostings.mockResolvedValue({ postings: [], next: null });
    await searchAllSources(config, "JSEARCH", query, { now, cursors: { ADZUNA: "3" } });
    expect(searchPostings).toHaveBeenCalledTimes(1);
    expect(searchPostings).toHaveBeenCalledWith("ADZUNA", expect.anything(), query, "3", expect.anything());
  });

  it("says every source's problem when none answers", async () => {
    searchPostings.mockImplementation(async (source: JobSource) => {
      throw jobSearchError("unavailable", source);
    });
    const answer = await searchAllSources(config, "JSEARCH", query, { now, exclude: ["ARBEITSAGENTUR"] });
    expect(answer).toMatchObject({ ok: false, message: expect.stringMatching(/^None of your job sources could answer\. JSearch: .* Adzuna: .* Firecrawl: /) });
  });
});

describe("searchWithFallback", () => {
  it("stops at the first source that answers, with a report of what was tried", async () => {
    searchPostings.mockRejectedValueOnce(jobSearchError("quota", "JSEARCH")).mockResolvedValue({ postings: [posting("ADZUNA", "1")], next: null });
    const answer = await searchWithFallback(config, "JSEARCH", query, null, { now });
    expect(answer).toMatchObject({ ok: true, source: "ADZUNA" });
    expect(answer.report?.map((entry) => [entry.source, entry.status])).toEqual([
      ["JSEARCH", "failed"],
      ["ADZUNA", "ok"],
    ]);
  });

  it("gives the primary's own message when nothing else is set up", async () => {
    const answer = await searchWithFallback({ ...config, jsearch: { ...config.jsearch, key: null, keyState: "none" }, adzuna: { ...config.adzuna, key: null }, firecrawl: { key: null, keyState: "none" } }, "JSEARCH", query, null, { now });
    expect(answer).toMatchObject({ ok: false, problem: "no-key" });
  });
});

describe("cursors", () => {
  it("round-trips, and ignores what isn't a source", () => {
    expect(decodeCursors(encodeCursors({ JSEARCH: "2", ADZUNA: "3" })!)).toEqual({ JSEARCH: "2", ADZUNA: "3" });
    expect(decodeCursors('multi:{"NOPE":"1","FIRECRAWL":5}')).toEqual({});
    expect(decodeCursors("2")).toBeNull();
    expect(encodeCursors({})).toBeNull();
  });
});
