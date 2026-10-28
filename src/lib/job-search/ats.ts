// Applicant-tracking systems and job boards (this fork): which web pages are
// one employer's posting, which are a board's list of many, and which link
// goes straight to the employer. Shared by the Firecrawl source (what to
// search, what to keep) and relevance.ts (a direct apply link counts).
//
// Every domain in ATS_DOMAINS was checked on 28 October 2026 with a real
// `site:` search for "Data Engineer" and returned employer postings under
// the path shape noted beside it. Domains that returned none (bamboohr.com,
// keka.com, darwinbox.in, recruitee.com) are left out rather than guessed.

export type AtsDomain = {
  /** As written after `site:`. */
  site: string;
  name: string;
  /** A posting's own page, as opposed to a list of them on the same host. */
  posting: RegExp;
};

/** Checked ATS domains, most productive first; Firecrawl searches them two at a time (firecrawl.ts). */
export const ATS_DOMAINS: readonly AtsDomain[] = [
  // jobs.ashbyhq.com/<company>/<uuid>
  { site: "jobs.ashbyhq.com", name: "Ashby", posting: /^\/[^/]+\/[0-9a-f-]{36}(\/application)?\/?$/i },
  // jobs.lever.co/<company>/<uuid>
  { site: "jobs.lever.co", name: "Lever", posting: /^\/[^/]+\/[0-9a-f-]{36}(\/apply)?\/?$/i },
  // job-boards.greenhouse.io/<company>/jobs/<id>; boards.greenhouse.io is the older host
  { site: "job-boards.greenhouse.io", name: "Greenhouse", posting: /^\/[^/]+\/jobs\/\d+\/?$/i },
  { site: "boards.greenhouse.io", name: "Greenhouse", posting: /^\/[^/]+\/jobs\/\d+\/?$/i },
  // apply.workable.com/<company>/j/<id> is the employer's own page (jobs.workable.com is Workable's board, below)
  { site: "apply.workable.com", name: "Workable", posting: /^\/[^/]+\/j\/[0-9a-z]+(\/apply)?\/?$/i },
  // jobs.smartrecruiters.com/<Company>/<id>-<slug>
  { site: "jobs.smartrecruiters.com", name: "SmartRecruiters", posting: /^\/[^/]+\/\d+(-[^/]*)?\/?$/i },
  // <company>.wd1.myworkdayjobs.com/en-US/<site>/job/<...>
  { site: "myworkdayjobs.com", name: "Workday", posting: /\/job\/.+/i },
  // <company>.breezy.hr/p/<id>-<slug>
  { site: "breezy.hr", name: "Breezy", posting: /^\/p\/[0-9a-f]+-[^/]+(\/apply)?\/?$/i },
  // <company>.teamtailor.com/jobs/<id>-<slug>; /jobs alone is the list
  { site: "teamtailor.com", name: "Teamtailor", posting: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/\d+-[^/]+\/?$/i },
  // <company>.pinpointhq.com/postings/<uuid> or /jobs/<id>
  { site: "pinpointhq.com", name: "Pinpoint", posting: /^\/(?:[a-z]{2}\/)?(?:postings\/[0-9a-f-]{36}|jobs\/\d+)\/?$/i },
];

/** Boards that list other employers' postings: a link there is not the employer's own. */
const AGGREGATORS: readonly { host: RegExp; posting: RegExp; name: string }[] = [
  { host: /(^|\.)linkedin\.com$/, name: "LinkedIn", posting: /^\/jobs\/view\/[^/]+/i },
  { host: /(^|\.)indeed\.[a-z.]+$/, name: "Indeed", posting: /^\/(viewjob|rc\/clk|m\/viewjob)/i },
  { host: /(^|\.)naukri\.com$/, name: "Naukri", posting: /^\/job-listings-/i },
  { host: /(^|\.)glassdoor\.[a-z.]+$/, name: "Glassdoor", posting: /^\/job-listing\//i },
  { host: /(^|\.)foundit\.in$/, name: "foundit", posting: /^\/job\//i },
  { host: /(^|\.)instahyre\.com$/, name: "Instahyre", posting: /^\/job-\d+/i },
  { host: /(^|\.)cutshort\.io$/, name: "Cutshort", posting: /^\/job\//i },
  { host: /(^|\.)hirist\.(tech|com)$/, name: "Hirist", posting: /^\/j\//i },
  { host: /(^|\.)wellfound\.com$/, name: "Wellfound", posting: /^\/jobs\/\d+/i },
  { host: /(^|\.)jobs\.workable\.com$/, name: "Workable", posting: /^\/view\//i },
  { host: /(^|\.)himalayas\.app$/, name: "Himalayas", posting: /^\/companies\/[^/]+\/jobs\/[^/]+/i },
  { host: /(^|\.)remoterocketship\.com$/, name: "Remote Rocketship", posting: /^\/company\/[^/]+\/jobs\/[^/]+/i },
  { host: /(^|\.)remoteok\.com$/, name: "Remote OK", posting: /^\/remote-jobs\/\d+/i },
  { host: /(^|\.)weworkremotely\.com$/, name: "We Work Remotely", posting: /^\/remote-jobs\/[^/]+/i },
  { host: /(^|\.)remotive\.com$/, name: "Remotive", posting: /^\/remote-jobs\/[^/]+\/[^/]+/i },
  { host: /(^|\.)jobgether\.com$/, name: "Jobgether", posting: /^\/offer\//i },
  { host: /(^|\.)arc\.dev$/, name: "Arc", posting: /^\/remote-jobs\/j\//i },
  { host: /(^|\.)monster\.[a-z.]+$/, name: "Monster", posting: /^\/job-openings\//i },
  { host: /(^|\.)ziprecruiter\.com$/, name: "ZipRecruiter", posting: /\/jobs?\/.+-[0-9a-f]{8}/i },
];

/** Paths that are never one posting: salary pages, search results, company reviews, articles. */
const NEVER_A_POSTING = /\/(salar(y|ies)|reviews?|interview|career-advice|blog|articles?|news|resources|companies\/?$|search\b)/i;
/** "Remote Data Engineer Jobs in India (2,000+ Open Roles)", "500 Senior Data Engineer Job Vacancies": a page's title saying it lists many. */
const LIST_TITLE = /(\b\d[\d,]*\+?\s+(open\s+)?(jobs|roles|positions|vacancies|openings)\b)|(\bjob\s+vacancies\b)|^(remote\s+)?[\w\s/&]{2,60}\sjobs\b\s*(in\b|\(|\||$)/i;

export type PageKind =
  /** One posting on the employer's own applicant-tracking system. */
  | { kind: "ats"; name: string }
  /** One posting copied onto a job board. */
  | { kind: "board"; name: string }
  /** A list of postings, a salary page, an article: not one job. */
  | { kind: "list"; reason: string }
  /** Anything else (a company's own careers page, most likely): kept, but not known to be a posting. */
  | { kind: "other" };

function hostOf(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/**
 * What kind of page a search result is, from its link (and title, for the
 * pages that only say "N jobs" there). A board's or an ATS's page that isn't
 * one posting is a list; a title that counts jobs is a list wherever it is.
 */
export function pageKind(url: string, title = ""): PageKind {
  const parsed = hostOf(url);
  if (!parsed) return { kind: "list", reason: "not a web address" };
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;

  const ats = ATS_DOMAINS.find((domain) => onSite(host, domain.site));
  if (ats) return ats.posting.test(path) ? { kind: "ats", name: ats.name } : { kind: "list", reason: `${ats.name} list or company page, not one posting` };

  const board = AGGREGATORS.find((entry) => entry.host.test(host));
  if (board) return board.posting.test(path) ? { kind: "board", name: board.name } : { kind: "list", reason: `${board.name} search or list page, not one posting` };

  if (NEVER_A_POSTING.test(path)) return { kind: "list", reason: "salary, review, search or article page" };
  if (LIST_TITLE.test(title.trim())) return { kind: "list", reason: "page title lists many jobs" };
  return { kind: "other" };
}

/** Whether a link applies on the employer's own system: an ATS posting, or a careers page on a site that isn't a job board. */
export function isDirectEmployerLink(url: string): boolean {
  const kind = pageKind(url);
  if (kind.kind === "ats") return true;
  if (kind.kind !== "other") return false;
  const parsed = hostOf(url);
  return Boolean(parsed && /(^|[./])(careers?|jobs)([./-]|$)/i.test(`${parsed.hostname}${parsed.pathname}`));
}

/** The ATS or board a link is on, for "via"; "" for anything else. */
export function platformOf(url: string): string {
  const kind = pageKind(url);
  return kind.kind === "ats" || kind.kind === "board" ? kind.name : "";
}
