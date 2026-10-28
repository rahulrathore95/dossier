import "server-only";

import { formatShortCalendarDate } from "@/lib/dates";
import { platformOf } from "@/lib/job-search/ats";
import { ELIGIBILITY_LABELS } from "@/lib/job-search/eligibility";
import { withRelevance } from "@/lib/job-search/relevance-profile";
import { postedAgo, type FoundPosting } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";

// "About this job" on an application (this fork): where the posting was
// found and when, where it can be done from, what it pays, and how relevant
// it is to the master resume — from the Find jobs posting or agent candidate
// it was started from, or else from the application's own posting text.

/** The job's facts beside the posting (this fork), each in words for the screen. */
export type JobFacts = {
  /** "Firecrawl, via Lever", "Pasted by you", "The job agent, via JSearch". */
  found: string;
  /** "Posted 2 days ago", "Posting date not given". */
  posted: string;
  /** "Found 28 Oct". */
  discovered: string | null;
  /** "Direct apply on the employer's site" or "Apply link on LinkedIn". */
  link: string;
  /** "India (“Remote - India”)", "Location unclear". */
  where: string;
  /** "₹40–60 LPA (stated)", "Salary not disclosed". */
  salary: string;
  /** 0–100, with why. */
  relevance: { score: number; reasons: string[]; concerns: string[] };
  /** The resume variant it was written from, if any. */
  variant: string | null;
};

type ApplicationFields = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  postingUrl: string;
  postingText: string;
  origin: "MANUAL" | "AGENT";
  variantId: string | null;
  createdAt: Date;
};

export async function jobFacts(application: ApplicationFields, now = new Date()): Promise<JobFacts> {
  const [posting, candidate, variant] = await Promise.all([
    prisma.posting.findUnique({ where: { applicationId: application.id } }),
    prisma.agentCandidate.findUnique({ where: { applicationId: application.id } }),
    application.variantId ? prisma.resumeVariant.findUnique({ where: { id: application.variantId }, select: { name: true } }) : null,
  ]);
  const found = posting ?? candidate;
  const asFound: FoundPosting = found
    ? {
        source: found.source,
        externalId: found.externalId,
        title: found.title,
        company: found.company,
        place: found.place,
        remote: found.remote,
        salary: found.salary,
        postedAt: found.postedAt?.toISOString() ?? null,
        url: found.url,
        via: found.via,
        // The application keeps the whole text even when the source gave only a snippet.
        description: application.postingText || found.description,
        complete: true,
      }
    : {
        source: "FIRECRAWL",
        externalId: application.id,
        title: application.title,
        company: application.company,
        place: application.location,
        remote: null,
        salary: application.salary,
        postedAt: null,
        url: application.postingUrl,
        via: "",
        description: application.postingText,
        complete: true,
      };
  const [{ relevance }] = await withRelevance([asFound]);
  const platform = platformOf(asFound.url) || asFound.via;
  const who = candidate ? "The job agent" : found ? "Find jobs" : "Pasted by you";
  const ago = postedAgo(asFound.postedAt, now);
  return {
    found: found ? `${who}, through ${SOURCE_INFO[found.source].name}${platform ? `, via ${platform}` : ""}` : who,
    posted: ago ? `Posted ${ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago}` : "Posting date not given",
    discovered: found ? `found ${formatShortCalendarDate(found.createdAt, now)}` : null,
    link: !asFound.url ? "No link saved" : relevance.direct ? `Direct apply on the employer's site${platform ? ` (${platform})` : ""}` : `Apply link on ${platform || "another site"}`,
    where: `${ELIGIBILITY_LABELS[relevance.eligibility.status]}${relevance.eligibility.evidence && relevance.eligibility.status !== "unclear" ? ` (“${relevance.eligibility.evidence}”)` : ""}`,
    salary: relevance.salaryLabel,
    relevance: { score: relevance.score, reasons: relevance.reasons, concerns: relevance.concerns },
    variant: variant?.name ?? null,
  };
}
