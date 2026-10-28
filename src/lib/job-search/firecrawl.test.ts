import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, refused, stubFetch } from "@/lib/ai/test-http";

const fetchPosting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting }));

import { JobSearchError } from "./errors";
import { companyFromAtsUrl, firecrawl, indexedAtOf, parseResultTitle, postingFromResult } from "./firecrawl";
import { plannedQueries } from "./queries";
import { EMPTY_QUERY, type SearchQuery } from "./search";

const query: SearchQuery = { ...EMPTY_QUERY, keywords: "data engineer", place: "Bengaluru", country: "in", postedWithin: "week" };
const creds = { key: "fc_test" };

beforeEach(() => {
  vi.unstubAllGlobals();
  fetchPosting.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const answer = (web: unknown[]) => json({ success: true, data: { web } });

type SearchBody = { query: string; country?: string; location?: string; tbs?: string };
const bodyOf = (request: { body: unknown }) => request.body as SearchBody;

describe("Firecrawl search", () => {
  it("POSTs every planned query (queries.ts) to /v2/search, with the key, country and location", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.search(query, creds, null);
    expect(requests).toHaveLength(plannedQueries(query).length);
    expect(requests.map((request) => bodyOf(request).query)).toEqual(plannedQueries(query).map((entry) => entry.text));
    for (const request of requests) {
      expect(request.method).toBe("POST");
      expect(`${request.url.origin}${request.url.pathname}`).toBe("https://api.firecrawl.dev/v2/search");
      expect(request.headers.get("authorization")).toBe("Bearer fc_test");
      expect(bodyOf(request)).toMatchObject({ country: "IN", location: "Bengaluru", tbs: "qdr:w" });
    }
  });

  it("widens a 3-day search to a week, since Google has no 3-day unit", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.search({ ...query, postedWithin: "3days" }, creds, null);
    for (const request of requests) expect(bodyOf(request)).toMatchObject({ tbs: "qdr:w" });
  });

  it("asks for no date range at all, and defaults the location to the whole country", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.search({ ...query, place: "", postedWithin: "any" }, creds, null);
    for (const request of requests) {
      expect(bodyOf(request)).not.toHaveProperty("tbs");
      expect(bodyOf(request)).toMatchObject({ location: "India" });
    }
  });

  it("never offers a next page: Firecrawl's search has no cursor", async () => {
    stubFetch(() => answer([{ url: "https://example.com/1", title: "Data Engineer" }]));
    const page = await firecrawl.search(query, creds, null);
    expect(page.next).toBeNull();
  });

  it("drops results with no usable link or title, and de-duplicates by link across queries", async () => {
    stubFetch(() =>
      answer([
        { url: "https://example.com/a", title: "Data Engineer" },
        { url: "javascript:alert(1)", title: "Data Engineer" },
        { url: "https://example.com/a", title: "Data Engineer (duplicate)" },
        { url: "https://example.com/b", title: "" },
      ]),
    );
    const page = await firecrawl.search(query, creds, null);
    expect(page.postings).toHaveLength(1);
    expect(page.postings[0].url).toBe("https://example.com/a");
  });

  it("leaves out pages that list many jobs, and says how many", async () => {
    stubFetch(() =>
      answer([
        { url: "https://in.linkedin.com/jobs/remote-data-engineer-jobs", title: "Remote Data Engineer Jobs in India (2,000+ Open Roles) | LinkedIn" },
        { url: "https://jobs.lever.co/netomi/02b45afd-5a49-41b2-a244-b0ca76306692", title: "Data Engineer I - Netomi - Lever", description: "Data Engineer I. Remote - India." },
      ]),
    );
    const page = await firecrawl.search(query, creds, null);
    expect(page.postings.map((posting) => posting.url)).toEqual(["https://jobs.lever.co/netomi/02b45afd-5a49-41b2-a244-b0ca76306692"]);
    expect(page.postings[0]).toMatchObject({ company: "Netomi", via: "Lever", remote: true });
    expect(page.notes?.[0]).toMatch(/^Left out \d+ pages that list many jobs/);
  });

  it("keeps what the other queries found when some hit the rate limit, and says so", async () => {
    let call = 0;
    stubFetch(() => (call++ % 2 === 0 ? answer([{ url: `https://example.com/${call}`, title: "Data Engineer" }]) : json({ success: false }, { status: 429 })));
    const page = await firecrawl.search(query, creds, null);
    expect(page.postings.length).toBeGreaterThan(0);
    expect(page.notes?.at(-1)).toMatch(/Firecrawl searches didn't answer \(Firecrawl's rate limit\); these results may be incomplete\.$/);
  });

  it("says the source isn't answering when it can't be reached", async () => {
    stubFetch(refused);
    await expect(firecrawl.search(query, creds, null)).rejects.toMatchObject({ problem: "unavailable" });
  });

  it("says the key was refused on 401", async () => {
    stubFetch(() => json({ success: false }, { status: 401 }));
    await expect(firecrawl.search(query, creds, null)).rejects.toMatchObject({ problem: "key" });
  });

  it("says the source changed when success is false with a 200", async () => {
    stubFetch(() => json({ success: false, data: { web: [] } }));
    const error = await firecrawl.search(query, creds, null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobSearchError);
    expect(error).toMatchObject({ problem: "changed" });
  });
});

describe("companyFromAtsUrl", () => {
  it("reads the company from the path on each applicant-tracking system", () => {
    expect(companyFromAtsUrl("https://job-boards.greenhouse.io/acmecorp/jobs/1234")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://jobs.lever.co/acme-corp/abc-123")).toBe("Acme Corp");
    expect(companyFromAtsUrl("https://jobs.ashbyhq.com/acmecorp/posting")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://jobs.smartrecruiters.com/Acmecorp/job")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://acmecorp.wd1.myworkdayjobs.com/en-US/careers/job/123")).toBe("Acmecorp");
    expect(companyFromAtsUrl("https://apply.workable.com/v4c/j/BA848A8DD3/")).toBe("V4c");
    expect(companyFromAtsUrl("https://nationsbenefits.breezy.hr/p/14dbd9e43ce1-lead-data-engineer")).toBe("Nationsbenefits");
    expect(companyFromAtsUrl("https://teoco.na.teamtailor.com/jobs/727050-data-engineer")).toBe("Teoco");
  });

  it("gives up on a link that isn't a known applicant-tracking system, or isn't a link at all", () => {
    expect(companyFromAtsUrl("https://www.linkedin.com/jobs/view/123")).toBe("");
    expect(companyFromAtsUrl("not a url")).toBe("");
  });
});

describe("parseResultTitle", () => {
  it("splits 'Company hiring Role in Place' from LinkedIn-style titles", () => {
    expect(parseResultTitle("Acme Corp hiring Senior Data Engineer in Bengaluru | LinkedIn")).toEqual({
      title: "Senior Data Engineer",
      company: "Acme Corp",
    });
  });

  it("splits 'Role - Company - Place' from Indeed/Naukri-style titles", () => {
    expect(parseResultTitle("Senior Data Engineer - Acme Corp - Bengaluru")).toEqual({ title: "Senior Data Engineer", company: "Acme Corp" });
    expect(parseResultTitle("Senior Data Engineer - Pune - LTM - 3 to 5 years of experience - Naukri.com")).toEqual({ title: "Senior Data Engineer", company: "LTM" });
  });

  it("takes the part that isn't the company as the title when the link names the company, in either order (Lever)", () => {
    expect(parseResultTitle("Chaipay - Senior Product Designer (India) - Lever", "Chaipay")).toEqual({ title: "Senior Product Designer (India)", company: "Chaipay" });
    expect(parseResultTitle("Data Engineer - Wahed - Lever", "Wahed.com")).toEqual({ title: "Data Engineer", company: "Wahed.com" });
    expect(parseResultTitle("IDT - Senior Data Engineer (with AI/ML experience) India - Lever", "Idt")).toEqual({ title: "Senior Data Engineer (with AI/ML experience) India", company: "Idt" });
    expect(parseResultTitle("Senior Data Engineer", "Acme")).toEqual({ title: "Senior Data Engineer", company: "" });
  });

  it("reads Greenhouse, Ashby and LinkedIn job-page titles", () => {
    expect(parseResultTitle("Job Application for Senior Data Engineer (India) at Karat")).toEqual({ title: "Senior Data Engineer (India)", company: "Karat" });
    expect(parseResultTitle("Senior Data Engineer @ Outmarket AI - Jobs")).toEqual({ title: "Senior Data Engineer", company: "Outmarket AI" });
    expect(parseResultTitle("Senior Data Engineer at Cognite — Bengaluru, Karnataka, India")).toEqual({ title: "Senior Data Engineer", company: "Cognite" });
  });

  it("falls back to the whole title with no company when nothing matches", () => {
    expect(parseResultTitle("Senior Data Engineer")).toEqual({ title: "Senior Data Engineer", company: "" });
  });
});

describe("postingFromResult", () => {
  it("prefers the ATS URL's company over a guess from the title", () => {
    const posting = postingFromResult({
      url: "https://job-boards.greenhouse.io/acmecorp/jobs/1234",
      title: "Senior Data Engineer",
      description: "Build our data platform.",
      markdown: null,
    });
    expect(posting).toMatchObject({ source: "FIRECRAWL", title: "Senior Data Engineer", company: "Acmecorp", complete: false });
    expect(posting.externalId).toBe(posting.url);
  });

  it("uses the title guess when the link isn't a known ATS", () => {
    const posting = postingFromResult({
      url: "https://www.linkedin.com/jobs/view/123",
      title: "Acme Corp hiring Senior Data Engineer in Bengaluru | LinkedIn",
      description: null,
      markdown: "**Build** our data platform.",
    });
    expect(posting).toMatchObject({ title: "Senior Data Engineer", company: "Acme Corp", description: "Build our data platform." });
  });
});

describe("indexedAtOf", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("reads the search engine's date for the page, not the posting's", () => {
    expect(indexedAtOf("1 day ago · Job Description for Senior Data Engineer", now)).toBe("2026-10-27T12:00:00.000Z");
    expect(indexedAtOf("20 hours ago · We are looking for", now)).toBe("2026-10-27T16:00:00.000Z");
    expect(indexedAtOf("Python Data Engineer. at Flatgigs. RemoteIndia. Posted today.", now)).toBe(now.toISOString());
    expect(indexedAtOf("Build our data platform.", now)).toBeNull();
  });
});

describe("Firecrawl details and test", () => {
  it("fetches the posting's own page for the rest of it, like Adzuna does", async () => {
    fetchPosting.mockResolvedValueOnce({ ok: true, text: "The whole posting.", source: "page", url: "https://example.com/job" });
    const posting = postingFromResult({ url: "https://example.com/job", title: "Data Engineer", description: "snippet", markdown: null });
    expect(await firecrawl.details(posting, creds)).toBe("The whole posting.");
    expect(fetchPosting).toHaveBeenCalledWith(posting.url);

    fetchPosting.mockResolvedValueOnce({ ok: false, error: "unreadable" });
    expect(await firecrawl.details(posting, creds)).toBeNull();
    expect(await firecrawl.details({ ...posting, url: "" }, creds)).toBeNull();
  });

  it("tests the key with one small search", async () => {
    const requests = stubFetch(() => answer([]));
    await firecrawl.test(creds);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({ query: '"developer" jobs' });
  });
});
