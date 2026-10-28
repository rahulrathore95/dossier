import "server-only";

import { z } from "zod";

import { fetchPosting } from "@/lib/posting-fetch";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { countryName } from "./countries";
import { pageKind, platformOf } from "./ats";
import { isPlaceList } from "./eligibility";
import { JobSearchError, jobSearchError } from "./errors";
import { requestJson } from "./http";
import { plannedQueries } from "./queries";
import { fromMarkdown, plainText } from "./text";
import { safeLink, type FoundPosting, type PostedWithin, type SearchPage, type SearchQuery } from "./search";

// Firecrawl (E14-7, this fork): a web search across the open web, the way a
// person googling "data engineer jobs in Bengaluru" would, rather than one
// job board's own index — without Dossier maintaining a scraper per site,
// which breaks the moment a site's markup changes and risks its terms of use
// the way the Bundesagentur für Arbeit source already owns up to (sources.ts).
//
// One Dossier search runs the handful of web searches queries.ts plans:
// `site:` searches on employers' applicant-tracking systems two at a time,
// one on job boards' posting pages, and one open search for careers pages.
// Every result is then checked by ats.ts, and anything that isn't one
// posting — a board's "2,000+ jobs" page, a salary page — is left out and
// counted in the page's notes. (Until this change one search ORed eleven
// sites into one query and ran a second with no restriction at all; measured,
// two thirds of what came back were such list pages.)
//
// Trade-offs, on purpose:
// - Several Firecrawl credits a search (MAX_QUERIES at most), and two at a
//   time, under the plan's per-minute limit; a query refused for the limit
//   is noted, and the rest still count.
// - The search only returns a title, a link and a short snippet. The company
//   is pulled from the ATS's own URL shape (reliable: the company owns that
//   part of the address), else from the title's own wording (best-effort);
//   either way it can be "", which is honest rather than invented.
// - The date a search engine gives a page ("1 day ago") is kept as
//   indexedAt, not postedAt: it's when the page was seen, not when the job
//   was posted.
// - The full posting is fetched like Adzuna's (details() below) rather than
//   spent on Firecrawl's own scrape for every result.
// - Firecrawl's /search has no paging cursor, so next is always null.

const BASE = "https://api.firecrawl.dev/v2";
const SEARCH_PATH = "/search";
const PAGE_SIZE = 30;

/** Google's `tbs` date range closest to each "posted within" choice; Firecrawl passes it straight through. There's no 3-day unit, so that choice widens to a week rather than narrowing to a day, favouring a posting shown over one missed. */
const TBS: Partial<Record<PostedWithin, string>> = { day: "qdr:d", "3days": "qdr:w", week: "qdr:w", month: "qdr:m" };

const resultSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish().catch(null),
  description: z.string().nullish().catch(null),
  markdown: z.string().nullish().catch(null),
});
type Result = z.output<typeof resultSchema>;

const responseSchema = z.object({ success: z.boolean(), data: z.object({ web: z.array(z.unknown()).nullish().catch([]) }).nullish().catch({ web: [] }) });

/**
 * The company from an applicant-tracking system's own URL shape, which
 * names it in the path or the subdomain: reliable where the search gives
 * one, because the company owns that part of the address.
 *
 *   https://job-boards.greenhouse.io/acmecorp/jobs/1234        -> "Acmecorp"
 *   https://jobs.lever.co/acmecorp/...                         -> "Acmecorp"
 *   https://jobs.ashbyhq.com/acmecorp/...                      -> "Acmecorp"
 *   https://acmecorp.wd1.myworkdayjobs.com/en-US/careers/job/… -> "Acmecorp"
 *   https://jobs.smartrecruiters.com/Acmecorp/...              -> "Acmecorp"
 */
export function companyFromAtsUrl(url: string): string {
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (!parsed) return "";
  const host = parsed.hostname.toLowerCase();
  const segment = (index: number) => parsed.pathname.split("/").filter(Boolean)[index] ?? "";
  if (/(^|\.)(job-boards|jobs|boards)\.greenhouse\.io$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)jobs\.lever\.co$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)jobs\.ashbyhq\.com$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)jobs\.smartrecruiters\.com$/.test(host)) return titleCase(segment(0));
  if (/(^|\.)apply\.workable\.com$/.test(host)) return titleCase(segment(0));
  const workday = /^([a-z0-9-]+)\.[a-z0-9.]*myworkdayjobs\.com$/.exec(host);
  if (workday) return titleCase(workday[1]);
  // <company>.breezy.hr, <company>.teamtailor.com, <company>.pinpointhq.com
  const subdomain = /^([a-z0-9-]+)\.(?:[a-z]{2}\.)?(?:breezy\.hr|teamtailor\.com|pinpointhq\.com)$/.exec(host);
  if (subdomain) return titleCase(subdomain[1]);
  return "";
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
}

/** Suffixes a job board appends to its own page titles, trimmed before anything else is parsed out. */
const SITE_SUFFIX =
  /\s*[|·-]\s*(LinkedIn(\s+\w+)?|Jobs\s*-\s*LinkedIn|Indeed(\.com)?|Naukri(\.com)?|Glassdoor|Monster(\.com)?|Greenhouse|Lever|Ashby|Workday|Myworkdayjobs\.com|SmartRecruiters|Workable Jobs|Jobs By Workable|Teamtailor|Jobs)\s*$/i;

/**
 * Best-effort split of an aggregator's page title into a role and a
 * company, from the handful of phrasings LinkedIn, Indeed, Naukri and
 * Glassdoor write their titles in ("Acme Corp hiring Data Engineer in
 * Bengaluru", "Data Engineer - Acme Corp - Bengaluru"). Falls back to the
 * whole title with no company, rather than guessing wrong — isBlockedPosting
 * still has the full title and description to check against.
 */
export function parseResultTitle(raw: string): { title: string; company: string } {
  const bare = plainText(raw).replace(SITE_SUFFIX, "").replace(SITE_SUFFIX, "").trim();
  // Greenhouse: "Job Application for Senior Data Engineer at Karat"
  const application = /^Job Application for (.+?) at (.+)$/i.exec(bare);
  if (application) return { title: application[1].trim(), company: application[2].trim() };
  // Ashby: "Senior Data Engineer @ Outmarket AI"
  const at = /^(.+?)\s+@\s+(.+)$/.exec(bare);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  // LinkedIn: "Senior Data Engineer at Cognite — Bengaluru, Karnataka, India"
  const linkedIn = /^(.+?)\s+at\s+(.+?)\s+[—–]\s+.+$/.exec(bare);
  if (linkedIn) return { title: linkedIn[1].trim(), company: linkedIn[2].trim() };
  const hiring = /^(.+?)\s+(?:is\s+)?hiring\b\s*(?:for\s+)?(?:an?\s+)?(.+)$/i.exec(bare);
  if (hiring) {
    const title = hiring[2].replace(/\s+\bin\b\s+[^,-]+(,.*)?$/i, "").trim();
    return { title: title || bare, company: hiring[1].trim() };
  }
  // Naukri: "Senior Data Engineer - Pune - LTM - 3 to 5 years of experience": the years and the places aren't the company.
  const parts = bare.split(/\s+[-–—]\s+/).filter((part, index) => part && (index === 0 || !(/\byears?\b/i.test(part) || isPlaceList(part))));
  if (parts.length >= 2) return { title: parts[0].trim(), company: parts[parts.length - 1].trim() };
  return { title: bare, company: "" };
}

/**
 * When a search engine dates the page, from the snippet's start ("1 day ago ·",
 * "20 hours ago ·", "Posted today"); null when it doesn't. Not the posting
 * date: kept as indexedAt (search.ts).
 */
export function indexedAtOf(snippet: string, now = new Date()): string | null {
  const ago = /\b(\d{1,3})\s+(hour|day|week|month)s?\s+ago\b/i.exec(snippet.slice(0, 120));
  if (ago) {
    const hours = { hour: 1, day: 24, week: 24 * 7, month: 24 * 30 }[ago[2].toLowerCase() as "hour"] * Number(ago[1]);
    return new Date(now.getTime() - hours * 3_600_000).toISOString();
  }
  if (/\b(posted\s+)?(today|just now)\b/i.test(snippet.slice(0, 120))) return now.toISOString();
  return null;
}

export function postingFromResult(result: Result, now = new Date()): FoundPosting {
  const url = safeLink(result.url);
  const parsed = parseResultTitle(result.title ?? "");
  const company = companyFromAtsUrl(url) || parsed.company;
  const snippet = plainText(result.description);
  const description = fromMarkdown(result.markdown) || snippet.slice(0, 100_000);
  const remote = /\bremote\b/i.test(`${result.title ?? ""} ${snippet.slice(0, 300)}`) ? true : null;
  return {
    source: "FIRECRAWL",
    // Firecrawl doesn't hand back an id of its own; the link is the posting's stable identity.
    externalId: url.slice(0, 500) || result.url.slice(0, 500),
    title: parsed.title.slice(0, 500),
    company: company.slice(0, 300),
    place: "",
    remote,
    salary: "",
    postedAt: null,
    indexedAt: indexedAtOf(snippet, now),
    url: url.slice(0, 2000),
    via: platformOf(url),
    description,
    complete: false,
  };
}

/** One Firecrawl /search call, parsed into postings. */
async function runSearch(text: string, query: SearchQuery, key: string, context: RequestContext): Promise<{ postings: FoundPosting[]; lists: number }> {
  const url = new URL(`${context.baseUrl ?? BASE}${SEARCH_PATH}`);
  const body: Record<string, unknown> = {
    query: text.slice(0, 500),
    limit: PAGE_SIZE,
    country: (query.country || "us").toUpperCase(),
    location: query.place || countryName(query.country || "us"),
  };
  const tbs = TBS[query.postedWithin];
  if (tbs) body.tbs = tbs;

  const answer = responseSchema.safeParse(
    await requestJson("FIRECRAWL", url, { method: "POST", body, headers: { authorization: `Bearer ${key}` }, signal: context.signal }),
  );
  if (!answer.success || answer.data.success === false) throw jobSearchError("changed", "FIRECRAWL", { detail: `${url.pathname}: unexpected answer` });

  const postings: FoundPosting[] = [];
  let lists = 0;
  for (const item of answer.data.data?.web ?? []) {
    const result = resultSchema.safeParse(item);
    if (!result.success) continue;
    // A board's list of many jobs, a salary page, an article: not a posting (ats.ts).
    if (pageKind(result.data.url, result.data.title ?? "").kind === "list") {
      lists += 1;
      continue;
    }
    const posting = postingFromResult(result.data);
    if (posting.url && posting.title) postings.push(posting);
  }
  return { postings, lists };
}

/** How many of the planned queries run at once: under the plan's per-minute limit without making the search slow. */
const CONCURRENCY = 2;

/**
 * One page from every planned query (queries.ts), merged and de-duplicated
 * by link. A query that fails doesn't sink the others: the page says how
 * many failed and why. Only when every query fails does the search fail,
 * with the first query's error.
 */
async function searchPage(query: SearchQuery, { key }: SourceCredentials["FIRECRAWL"], _next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const planned = plannedQueries(query);
  const answers: ({ ok: true; postings: FoundPosting[]; lists: number } | { ok: false; error: JobSearchError })[] = [];
  for (let index = 0; index < planned.length; index += CONCURRENCY) {
    const batch = planned.slice(index, index + CONCURRENCY);
    answers.push(
      ...(await Promise.all(
        batch.map(async ({ text }) => {
          try {
            return { ok: true as const, ...(await runSearch(text, query, key, context)) };
          } catch (error) {
            if (error instanceof JobSearchError) return { ok: false as const, error };
            throw error;
          }
        }),
      )),
    );
  }
  const failed = answers.filter((answer) => !answer.ok);
  if (failed.length > 0 && failed.length === answers.length) throw failed[0].error;

  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  let lists = 0;
  for (const answer of answers) {
    if (!answer.ok) continue;
    lists += answer.lists;
    for (const posting of answer.postings) {
      if (seen.has(posting.externalId)) continue;
      seen.add(posting.externalId);
      postings.push(posting);
    }
  }
  const notes: string[] = [];
  if (lists > 0) notes.push(`Left out ${lists} ${lists === 1 ? "page that lists" : "pages that list"} many jobs rather than one posting.`);
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((answer) => answer.error.problem === "quota" ? "Firecrawl's rate limit" : answer.error.message))];
    notes.push(`${failed.length} of ${answers.length} Firecrawl searches didn't answer (${reasons.join("; ")}); these results may be incomplete.`);
  }
  // No cursor in Firecrawl's /search: one page, from every query, is what there is.
  return { postings, next: null, notes };
}

export const firecrawl: JobSourceAdapter<"FIRECRAWL"> = {
  source: "FIRECRAWL",
  search: searchPage,
  // The search only gives a snippet; the rest comes from the posting's own page, exactly as Adzuna's does.
  details: async (posting) => {
    if (!posting.url) return null;
    const page = await fetchPosting(posting.url);
    return page.ok ? page.text : null;
  },
  // One query, not the whole plan: the smallest request that shows the key works.
  test: async ({ key }, context = {}) => {
    const query: SearchQuery = { keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: false, postedWithin: "any" };
    await runSearch(`"developer" jobs`, query, key, context);
  },
};
