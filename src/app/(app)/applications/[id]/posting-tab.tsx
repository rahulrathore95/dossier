"use client";

import Link from "next/link";
import { useId } from "react";

import { FactList } from "@/components/fact-list";
import { MatchRows } from "@/components/match-rows";
import type { Match, Requirement } from "@/lib/application-data";
import type { JobFacts } from "@/lib/job-facts";
import type { FactItem } from "@/lib/profile";

import { sectionHref } from "../../profile/sections";

/** The Job posting tab's posting, as saved with the application. */
export type PostingData = {
  text: string;
  /** The saved link to the posting, or "". */
  url: string;
  /** When it was pasted, e.g. "27 Sep". */
  pasted: string;
  /** What's known about the job itself (this fork): where it was found, when, and how it fits. */
  about?: JobFacts | null;
};

/** "jobs.ledgerly.com/senior-designer" for a link, without the scheme. */
function shortLink(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === "/" ? "" : pathname}`;
  } catch {
    return url;
  }
}

/**
 * The Job posting tab (APP-11): what the user tells the AI for this
 * application (APP-15), how the profile matches the posting and the posting
 * as pasted, whitespace kept, with a link to the original if saved.
 */
export function PostingTab({
  applicationId,
  posting,
  match,
  requirements,
  onAddSkill,
  facts,
  setFacts,
}: {
  applicationId: string;
  posting: PostingData;
  match: Match | null;
  requirements: Requirement[];
  onAddSkill: (index: number, skill: string) => void;
  facts: FactItem[];
  setFacts: (change: (facts: FactItem[]) => FactItem[]) => void;
}) {
  const factsHint = useId();
  return (
    <div className="@container flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-16">
      <section
        aria-labelledby={`${factsHint}-title`}
        aria-describedby={factsHint}
        className="flex w-full max-w-[640px] flex-col gap-4 rounded-panel border border-line-card bg-card px-[30px] py-7"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={`${factsHint}-title`} className="text-[15px] font-medium">
            Facts for this application
          </h2>
          <p id={factsHint} className="text-sm text-pretty text-muted">
            What the AI should know for this job only, on top of your profile&apos;s{" "}
            <Link href={sectionHref("facts")} className="text-muted underline underline-offset-2 hover:text-ink">
              Facts about me
            </Link>
            . It uses them the next time it writes or rewrites something here.
          </p>
        </div>
        <FactList
          applicationId={applicationId}
          facts={facts}
          setFacts={setFacts}
          placeholder="e.g. I met their design lead at Config last year. Or: lean on my research work."
        />
      </section>
      {posting.about && <AboutJob about={posting.about} />}
      <div className="flex w-full max-w-[640px] flex-wrap justify-between gap-x-3 gap-y-1 text-meta text-muted">
        <span className="min-w-0">
          Job posting
          {posting.url && (
            <>
              {" · "}
              <a
                href={posting.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-muted underline underline-offset-2 hover:text-ink"
              >
                {shortLink(posting.url)}
                <span aria-hidden="true"> ↗</span>{" "}
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </>
          )}
        </span>
        <span>Pasted {posting.pasted}</span>
      </div>
      <div className="flex w-full max-w-[640px] flex-col gap-[22px] rounded-panel border border-line-card bg-card px-[30px] py-7">
        {match && match.items.length > 0 && <MatchRows match={match} requirements={requirements} onAddSkill={onAddSkill} />}
        <div className={match && match.items.length > 0 ? "flex flex-col gap-2.5 border-t border-line pt-5" : "flex flex-col gap-2.5"}>
          <h2 className="text-[15px] font-medium">Original posting</h2>
          {posting.text.trim() ? (
            <p className="text-sm leading-[1.65] whitespace-pre-wrap text-document">{posting.text}</p>
          ) : (
            <p className="text-sm text-muted">No posting was saved with this application.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** "About this job" (this fork): source, dates, where it can be done from, pay and relevance, as facts rather than a pitch. */
function AboutJob({ about }: { about: JobFacts }) {
  const headingId = useId();
  const rows: [string, string][] = [
    ["Found", [about.found, about.discovered].filter(Boolean).join(" · ")],
    ["Posted", about.posted],
    ["Apply", about.link],
    ["Location", about.where],
    ["Salary", about.salary],
    ...(about.variant ? [["Resume variant", about.variant] as [string, string]] : []),
  ];
  return (
    <section aria-labelledby={headingId} className="flex w-full max-w-[640px] flex-col gap-3 rounded-panel border border-line-card bg-card px-[30px] py-6 text-sm">
      <h2 id={headingId} className="flex items-baseline justify-between text-[15px] font-medium">
        About this job
        <span className="text-meta font-normal text-muted">Relevance {about.relevance.score} of 100</span>
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {about.relevance.reasons.length > 0 && (
        <ul aria-label="Why it's relevant" className="flex list-disc flex-col gap-0.5 pl-5 text-meta text-muted">
          {about.relevance.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {about.relevance.concerns.length > 0 && (
        <ul aria-label="What counts against it" className="flex list-disc flex-col gap-0.5 pl-5 text-meta text-warning">
          {about.relevance.concerns.map((concern) => (
            <li key={concern}>{concern}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
