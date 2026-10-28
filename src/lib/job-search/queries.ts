// The web searches one Firecrawl search runs (this fork): `site:` queries
// aimed at employers' own applicant-tracking systems, then the job boards'
// posting pages, then one open query for company careers pages.
//
// Measured on 28 October 2026, with "Senior Data Engineer" in India:
// - two ATS sites per query, site: first, returned 12 of 12 real postings;
// - five sites ORed after the role (what this fork used to do with eleven)
//   returned 10 list pages out of 15 ("2,000+ Data Engineer jobs | LinkedIn"),
//   which is where most irrelevant results came from;
// - the same site: query with three roles ORed in brackets lost its site
//   restriction: 8 of 12 results were list pages from other sites. So site:
//   queries name one role (the keywords); the other target roles go into the
//   open query, where three ORed roles returned 10 careers-page postings of 12;
// - Firecrawl's plan allowed 11 requests a minute, so a search runs a fixed,
//   small number of queries (MAX_QUERIES) rather than one per site and role.

import { ATS_DOMAINS } from "./ats";
import type { SearchQuery } from "./search";

/** The most web searches one Dossier search runs, under Firecrawl's per-minute limit with room for a second search. */
export const MAX_QUERIES = 7;

export type PlannedQuery = { label: string; text: string };

/** Names a place goes by in postings (from where-to-apply's list), so a search for one finds the others. */
const PLACE_ALIASES: Record<string, string[]> = {
  bengaluru: ["Bengaluru", "Bangalore"],
  bangalore: ["Bengaluru", "Bangalore"],
  gurugram: ["Gurugram", "Gurgaon"],
  gurgaon: ["Gurugram", "Gurgaon"],
  mumbai: ["Mumbai", "Bombay"],
  "delhi ncr": ["Delhi", "Gurugram", "Gurgaon", "Noida"],
  delhi: ["Delhi", "New Delhi"],
  thiruvananthapuram: ["Thiruvananthapuram", "Trivandrum"],
  kochi: ["Kochi", "Cochin"],
  chennai: ["Chennai", "Madras"],
};

const quote = (text: string) => `"${text.replace(/"/g, "").trim()}"`;
const anyOf = (terms: readonly string[]) => (terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`);

/** The roles to search for: the keywords, then the target roles, without repeats; at most three, to keep each query precise. */
export function searchRoles(query: Pick<SearchQuery, "keywords" | "roles">): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const role of [query.keywords, ...(query.roles ?? [])]) {
    const clean = role.replace(/"/g, "").trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    roles.push(clean);
  }
  return roles.slice(0, 3);
}

/** Where, as search terms: the place and its other names, "India" for a remote search in India, and "Remote" when asked for. */
export function placeTerms(query: Pick<SearchQuery, "place" | "country" | "remoteOnly">): string[] {
  const place = query.place.trim();
  const terms = place ? (PLACE_ALIASES[place.toLowerCase()] ?? [place]) : query.country === "in" ? ["India"] : [];
  if (query.remoteOnly) {
    if (place && query.country === "in" && !terms.includes("India")) terms.push("India");
    terms.push("Remote");
  }
  return [...new Set(terms)].map(quote);
}

/** ATS sites two at a time; Greenhouse's two hosts go together. */
function atsPairs(): string[][] {
  const sites = ATS_DOMAINS.map((domain) => domain.site);
  const pairs: string[][] = [];
  for (let index = 0; index < sites.length; index += 2) pairs.push(sites.slice(index, index + 2));
  return pairs;
}

/** Job boards' own posting pages, by path, for the country; their list pages are left out by the path. */
function boardSites(country: string): string[] {
  return country === "in" ? ["linkedin.com/jobs/view", "naukri.com/job-listings"] : ["linkedin.com/jobs/view"];
}

/**
 * The queries for one search, most precise first, at most MAX_QUERIES:
 *
 *   site:jobs.ashbyhq.com OR site:jobs.lever.co "Senior Data Engineer" ("India" OR "Remote")
 *   …the other ATS pairs…
 *   site:linkedin.com/jobs/view OR site:naukri.com/job-listings "Senior Data Engineer" ("India" OR "Remote")
 *   ("Senior Data Engineer" …) ("India" OR "Remote") careers apply -salary -salaries
 */
export function plannedQueries(query: SearchQuery): PlannedQuery[] {
  const roles = searchRoles(query);
  if (roles.length === 0) return [];
  // One role in a site: query keeps it precise; every role in the open one (see the measurements above).
  const one = quote(roles[0]);
  const what = anyOf(roles.map(quote));
  const where = placeTerms(query);
  const tail = where.length > 0 ? ` ${anyOf(where)}` : "";
  const site = (sites: string[]) => sites.map((entry) => `site:${entry}`).join(" OR ");

  const planned: PlannedQuery[] = atsPairs().map((pair) => ({
    label: pair.map((entry) => ATS_DOMAINS.find((domain) => domain.site === entry)!.name).filter((name, index, all) => all.indexOf(name) === index).join(" + "),
    text: `${site(pair)} ${one}${tail}`,
  }));
  planned.push({ label: "LinkedIn and job board postings", text: `${site(boardSites(query.country))} ${one}${tail}` });
  planned.push({ label: "Company careers pages", text: `${what}${tail} careers apply -salary -salaries` });
  return planned.slice(0, MAX_QUERIES).map((entry) => ({ ...entry, text: entry.text.slice(0, 500) }));
}
