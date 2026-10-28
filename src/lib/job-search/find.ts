import "server-only";

import { compileBlocklist, isBlockedPosting } from "./blocklist";
import { credentialsFor, loadJobSearchConfig, requestContext, type JobSearchConfig } from "./config";
import { withoutRepeats } from "./dedupe";
import { JobSearchError } from "./errors";
import { recordFailure, recordSuccess, restingReason } from "./health";
import { postingDetails, searchPostings } from "./index";
import { JOB_SOURCES, type FoundPosting, type JobSource, type SearchPage, type SearchProblem, type SearchQuery, type SourceReport } from "./search";
import { SOURCE_INFO } from "./sources";

// Asking job sources from Find jobs (E14-6), the job agent and the Claude
// connector: a page of postings with a report of every source, or what went
// wrong in words for the screen. Kept searches are in
// src/lib/posting-searches.ts.
//
// This fork asks every source with a key saved at once ("all", the default)
// and merges what they find, one copy of each job; or, set to "fallback",
// the chosen source first and the next only when it fails. Either way a
// source that just failed rests a while (health.ts) instead of being asked
// again on every search, and the report says so.

export type SourceAnswer = ({ ok: true; source: JobSource; report: SourceReport[] } & SearchPage) | (SearchProblem & { report?: SourceReport[] });

/** The order to try sources in: the one chosen in Settings first, then the rest in the order Settings lists them. */
function sourceOrder(primary: JobSource): JobSource[] {
  return [primary, ...JOB_SOURCES.filter((source) => source !== primary)];
}

/** A "Show more" cursor for every source that has another page, in one string: "multi:{"JSEARCH":"2"}". */
const MULTI = "multi:";
export function encodeCursors(cursors: Partial<Record<JobSource, string>>): string | null {
  return Object.keys(cursors).length > 0 ? `${MULTI}${JSON.stringify(cursors)}` : null;
}
export function decodeCursors(next: string): Partial<Record<JobSource, string>> | null {
  if (!next.startsWith(MULTI)) return null;
  try {
    const parsed: unknown = JSON.parse(next.slice(MULTI.length));
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([source, cursor]) => JOB_SOURCES.includes(source as JobSource) && typeof cursor === "string"));
  } catch {
    return {};
  }
}

type Attempt = { source: JobSource; page: SearchPage } | { source: JobSource; problem: SearchProblem; status: "failed" | "resting" | "not-configured" };

/** One source, asked unless it isn't set up or is resting; its health is kept either way. */
async function attempt(config: JobSearchConfig, source: JobSource, query: SearchQuery, next: string | null, now: Date): Promise<Attempt> {
  let credentials;
  try {
    credentials = credentialsFor(config, source);
  } catch (error) {
    if (!(error instanceof JobSearchError)) throw error;
    return { source, problem: { ok: false, problem: error.problem, message: error.message }, status: "not-configured" };
  }
  const resting = restingReason(source, credentials, now);
  if (resting) {
    const time = resting.until.slice(11, 16);
    return {
      source,
      problem: { ok: false, problem: "unavailable", message: `Not asked: it failed recently (${resting.message}) and rests until ${time} UTC.` },
      status: "resting",
    };
  }
  try {
    const page = await searchPostings(source, credentials, query, next, requestContext(source));
    recordSuccess(source, now);
    return { source, page };
  } catch (error) {
    if (!(error instanceof JobSearchError)) throw error;
    const problem: SearchProblem = { ok: false, problem: error.problem, message: error.message };
    // Not covering the country isn't a failure: the source just isn't for this search.
    if (error.problem === "country") return { source, problem, status: "not-configured" };
    recordFailure(source, error.problem, error.message, credentials, now);
    return { source, problem, status: "failed" };
  }
}

const reportOf = (result: Attempt): SourceReport =>
  "page" in result
    ? { source: result.source, status: "ok", found: result.page.postings.length, message: (result.page.notes ?? []).join(" ") }
    : { source: result.source, status: result.status, found: 0, message: result.problem.message };

/** What to say when no source answered: the primary's own problem when it's the only one, else every source's. */
function noAnswer(attempts: Attempt[], primary: JobSource): SourceAnswer {
  const failed = attempts.filter((result): result is Extract<Attempt, { problem: SearchProblem }> => "problem" in result && result.status !== "not-configured");
  const report = attempts.map(reportOf);
  if (failed.length === 0) {
    const own = attempts.find((result) => result.source === primary && "problem" in result) as Extract<Attempt, { problem: SearchProblem }> | undefined;
    return { ...(own?.problem ?? { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." }), report };
  }
  if (failed.length === 1) return { ...failed[0].problem, report };
  return {
    ok: false,
    problem: failed[0].problem.problem,
    message: `None of your job sources could answer. ${failed.map((result) => `${SOURCE_INFO[result.source].name}: ${result.problem.message}`).join(" ")}`,
    report,
  };
}

/**
 * One page for `query`, trying every source with a key saved — starting
 * from `primary` — until one answers (this fork, E14-9). A source with no key
 * saved is skipped without being asked; one resting after a failure too.
 */
export async function searchWithFallback(
  config: JobSearchConfig,
  primary: JobSource,
  query: SearchQuery,
  next: string | null = null,
  { exclude = [], now = new Date() }: { exclude?: readonly JobSource[]; now?: Date } = {},
): Promise<SourceAnswer> {
  const attempts: Attempt[] = [];
  for (const source of sourceOrder(primary)) {
    if (exclude.includes(source)) continue;
    const result = await attempt(config, source, query, next, now);
    attempts.push(result);
    if ("page" in result) return { ok: true, source, ...result.page, report: attempts.map(reportOf) };
  }
  return noAnswer(attempts, primary);
}

/**
 * One page from every source with a key saved, asked at once and merged
 * (this fork): the primary's postings first, then each other source's, with
 * one copy of each job (dedupe.ts). "Show more" goes on with every source
 * that has another page (encodeCursors). Fails only when no source answers.
 */
export async function searchAllSources(
  config: JobSearchConfig,
  primary: JobSource,
  query: SearchQuery,
  { exclude = [], cursors = null, now = new Date() }: { exclude?: readonly JobSource[]; cursors?: Partial<Record<JobSource, string>> | null; now?: Date } = {},
): Promise<SourceAnswer> {
  const sources = sourceOrder(primary).filter((source) => !exclude.includes(source) && (!cursors || cursors[source] !== undefined));
  const attempts = await Promise.all(sources.map((source) => attempt(config, source, query, cursors?.[source] ?? null, now)));
  const answered = attempts.filter((result): result is Extract<Attempt, { page: SearchPage }> => "page" in result);
  if (answered.length === 0) return noAnswer(attempts, primary);

  const { postings, repeats } = withoutRepeats(answered.flatMap((result) => result.page.postings));
  const report = attempts.map(reportOf);
  if (repeats > 0) {
    const first = report.find((entry) => entry.status === "ok")!;
    first.message = [first.message, `${repeats} ${repeats === 1 ? "job was" : "jobs were"} found by more than one source and ${repeats === 1 ? "shows" : "show"} once.`].filter(Boolean).join(" ");
  }
  const nextCursors = Object.fromEntries(answered.filter((result) => result.page.next).map((result) => [result.source, result.page.next!]));
  return { ok: true, source: answered[0].source, postings, next: encodeCursors(nextCursors), report };
}

/** The search as the sources get it: the target roles from Settings added, for Firecrawl's queries (queries.ts). */
const withRoles = (query: SearchQuery, config: JobSearchConfig): SearchQuery =>
  config.targetRoles.length > 0 && !query.roles ? { ...query, roles: [...config.targetRoles] } : query;

/** Takes blocked companies out (this fork, E14-8), and repeats within one source's page. */
function withoutBlocked(answer: SourceAnswer, blocklist: readonly string[]): SourceAnswer {
  if (!answer.ok) return answer;
  const blocked = compileBlocklist(blocklist);
  const postings: FoundPosting[] = answer.postings.filter((posting) => !isBlockedPosting(posting, blocked));
  return { ...answer, postings };
}

/**
 * One page for `query`: from every source, or by fallback, as Settings says
 * — or from `source` alone with its own cursor, for "Show more" on a search
 * kept from before this fork's multi-source searches. A `next` made by
 * searchAllSources goes on with every source that had another page.
 * Postings from a blocked company (E14-8) never reach the caller: Find jobs,
 * the job agent and the Claude connector all call this.
 */
export async function askSource(query: SearchQuery, { source, next = null }: { source?: JobSource; next?: string | null } = {}): Promise<SourceAnswer> {
  const config = await loadJobSearchConfig();
  if (!query.country) return { ok: false, problem: "no-country", message: "Choose a country to search in." };
  const asked = withRoles(query, config);

  const cursors = next ? decodeCursors(next) : null;
  if (cursors) return withoutBlocked(await searchAllSources(config, config.source ?? source ?? JOB_SOURCES[0], asked, { cursors }), config.blockedCompanies);

  if (source) {
    const result = await attempt(config, source, asked, next, new Date());
    if ("page" in result) return withoutBlocked({ ok: true, source, ...result.page, report: [reportOf(result)] }, config.blockedCompanies);
    return { ...result.problem, report: [reportOf(result)] };
  }

  if (!config.source) return { ok: false, problem: "off", message: "Choose where to search in Settings → Job search first." };
  const answer = config.mode === "all" ? await searchAllSources(config, config.source, asked) : await searchWithFallback(config, config.source, asked);
  return withoutBlocked(answer, config.blockedCompanies);
}

/**
 * The whole text of a posting, from its own source (which may no longer be
 * the one chosen, for a saved posting); null when it can't be had.
 */
export async function fullText(posting: FoundPosting): Promise<string | null> {
  if (posting.complete) return posting.description;
  try {
    return await postingDetails(posting.source, credentialsFor(await loadJobSearchConfig(), posting.source), posting, requestContext(posting.source));
  } catch (error) {
    if (error instanceof JobSearchError) return null;
    throw error;
  }
}
