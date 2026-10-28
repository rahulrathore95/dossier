import { linkKey, type FoundPosting } from "./search";

// The same job found by more than one source (this fork): JSearch, Adzuna
// and Firecrawl overlap — LinkedIn's copy, the employer's own page, an
// aggregator's — and each should show once.

/** Lower case, letters and digits only, accents dropped, and a company's legal suffix gone: "Acme Pvt. Ltd." and "acme" match. */
export const normalName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(private|pvt|limited|ltd|llc|inc|gmbh|corp|corporation|co|technologies|technology)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether two postings are one job: the same link without tracking
 * parameters, or the same company and title in the same place (a place one
 * of them doesn't give counts as the same: a web search result never does).
 */
export function sameJob(a: FoundPosting, b: FoundPosting): boolean {
  const linkA = linkKey(a.url);
  if (linkA && linkA === linkKey(b.url)) return true;
  const companyA = normalName(a.company);
  if (!companyA || companyA !== normalName(b.company) || normalName(a.title) !== normalName(b.title)) return false;
  const placeA = normalName(a.place);
  const placeB = normalName(b.place);
  return !placeA || !placeB || placeA === placeB;
}

/** Postings without repeats, the first of each kept; returns how many were dropped. */
export function withoutRepeats(postings: readonly FoundPosting[]): { postings: FoundPosting[]; repeats: number } {
  const kept: FoundPosting[] = [];
  for (const posting of postings) if (!kept.some((other) => sameJob(other, posting))) kept.push(posting);
  return { postings: kept, repeats: postings.length - kept.length };
}
