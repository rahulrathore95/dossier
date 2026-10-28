"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";
import { ELIGIBILITY_LABELS, type Eligibility } from "@/lib/job-search/eligibility";
import type { Relevance } from "@/lib/job-search/relevance";
import type { JobSource, ShownPosting, SourceReport } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

// Relevance on Find jobs (this fork): the score against the master resume,
// with why, what each source did, and filters over the results.

const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs";

/** The relevance score as a small pill: strong, fair or weak. */
export function RelevancePill({ relevance }: { relevance: Relevance }) {
  const tone = relevance.score >= 70 ? "bg-success-surface text-success" : relevance.score >= 45 ? "bg-track text-ink" : "bg-warning-surface text-warning";
  return (
    <span className={cn(chip, "font-medium tabular-nums", tone)} title="Relevance to your resume, out of 100">
      {relevance.score}
      <span className="sr-only"> of 100 relevance</span>
    </span>
  );
}

/** Where, pay and link at a glance, under a posting in the list. */
export function RelevanceChips({ relevance }: { relevance: Relevance }) {
  const where = relevance.eligibility.status;
  const good = where === "india" || where === "anywhere";
  return (
    <span className="flex flex-wrap gap-1.5">
      {relevance.inIndia && (
        <span className={cn(chip, good ? "bg-success-surface text-success" : where === "unclear" ? "bg-track text-muted" : "bg-warning-surface text-warning")}>
          {ELIGIBILITY_LABELS[where]}
        </span>
      )}
      <span className={cn(chip, relevance.salary.status === "undisclosed" ? "bg-track text-muted" : "bg-track text-ink")}>{relevance.salaryLabel}</span>
      {relevance.direct && <span className={cn(chip, "bg-track text-ink")}>Direct apply</span>}
    </span>
  );
}

/** Why a posting scores what it does, in the posting's detail. */
export function RelevanceDetail({ relevance }: { relevance: Relevance }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5 rounded-card border border-line-card bg-paper px-4 py-3.5 text-sm">
      <p id={headingId} className="flex items-center gap-2 font-medium">
        <RelevancePill relevance={relevance} /> Relevance to your resume
      </p>
      {relevance.excluded && <p className="text-meta text-warning">Hidden by default: {relevance.excluded}</p>}
      {relevance.reasons.length > 0 && (
        <ul aria-label="Why it's relevant" className="flex list-disc flex-col gap-0.5 pl-5 text-muted">
          {relevance.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {relevance.concerns.length > 0 && (
        <ul aria-label="What counts against it" className="flex list-disc flex-col gap-0.5 pl-5 text-meta text-warning">
          {relevance.concerns.map((concern) => (
            <li key={concern}>{concern}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_WORDS: Record<SourceReport["status"], string> = { ok: "searched", failed: "failed", resting: "skipped", "not-configured": "not set up" };

/** What each source did during the search: never a short list mistaken for all there is. */
export function SourceReportNote({ report }: { report: readonly SourceReport[] }) {
  const asked = report.filter((entry) => entry.status !== "not-configured");
  if (asked.length === 0) return null;
  const trouble = report.some((entry) => entry.status === "failed" || entry.status === "resting");
  return (
    <details className={cn("rounded-card px-4 py-2.5 text-meta", trouble ? "bg-warning-surface text-warning" : "bg-track text-muted")} open={trouble}>
      <summary className="cursor-pointer">
        {report
          .filter((entry) => entry.status !== "not-configured" || entry.message)
          .map((entry) => `${SOURCE_INFO[entry.source].name} ${STATUS_WORDS[entry.status]}${entry.status === "ok" ? ` (${entry.found})` : ""}`)
          .join(" · ")}
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {report
          .filter((entry) => entry.message)
          .map((entry) => (
            <li key={entry.source}>
              <span className="font-medium">{SOURCE_INFO[entry.source].name}:</span> {entry.message}
            </li>
          ))}
      </ul>
    </details>
  );
}

export type ResultFilter = {
  text: string;
  minScore: number;
  where: "any" | "india" | "india-or-unclear";
  salary: "any" | "meets" | "disclosed";
  /** Days; 0 for any. */
  maxAge: number;
  source: JobSource | "any";
  directOnly: boolean;
  showExcluded: boolean;
};

export const NO_FILTER: ResultFilter = { text: "", minScore: 0, where: "any", salary: "any", maxAge: 0, source: "any", directOnly: false, showExcluded: false };

const OK_WHERE: Record<ResultFilter["where"], readonly Eligibility[] | null> = {
  any: null,
  india: ["india", "anywhere"],
  "india-or-unclear": ["india", "anywhere", "unclear"],
};

/** Whether a posting passes the filters; one without relevance (a search kept before this fork) passes those it can't be judged on. */
export function passes(posting: ShownPosting, filter: ResultFilter, floorLpa: number, now: Date): boolean {
  const { relevance } = posting;
  if (filter.text.trim()) {
    const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
    const text = `${posting.title} ${posting.company} ${posting.place} ${posting.description}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) return false;
  }
  if (filter.source !== "any" && posting.source !== filter.source) return false;
  const date = posting.postedAt ?? posting.indexedAt ?? null;
  if (filter.maxAge > 0 && (!date || now.getTime() - Date.parse(date) > filter.maxAge * 86_400_000)) return false;
  if (!relevance) return true;
  if (!filter.showExcluded && relevance.excluded) return false;
  if (relevance.score < filter.minScore) return false;
  const where = OK_WHERE[filter.where];
  if (where && !where.includes(relevance.eligibility.status)) return false;
  if (filter.salary === "disclosed" && relevance.salary.status === "undisclosed") return false;
  if (filter.salary === "meets" && !(relevance.salary.maxLpa !== null && relevance.salary.maxLpa >= floorLpa)) return false;
  if (filter.directOnly && !relevance.direct) return false;
  return true;
}

const field = "rounded-control border border-line-card bg-card px-2 py-1 text-meta";

/** The filter bar over search results. */
export function ResultFilters({
  filter,
  onChange,
  sources,
  floorLpa,
  excluded,
}: {
  filter: ResultFilter;
  onChange: (filter: ResultFilter) => void;
  sources: readonly JobSource[];
  floorLpa: number;
  /** How many postings relevance leaves out by default. */
  excluded: number;
}) {
  const set = <K extends keyof ResultFilter>(key: K, value: ResultFilter[K]) => onChange({ ...filter, [key]: value });
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-meta text-muted">
      <legend className="sr-only">Filter results</legend>
      <input aria-label="Filter by role or skill" placeholder="Role or skill" value={filter.text} onChange={(event) => set("text", event.target.value)} className={cn(field, "w-36")} />
      <select aria-label="Minimum relevance" value={filter.minScore} onChange={(event) => set("minScore", Number(event.target.value))} className={field}>
        <option value={0}>Any relevance</option>
        <option value={45}>45+</option>
        <option value={60}>60+</option>
        <option value={75}>75+</option>
      </select>
      <select aria-label="Location" value={filter.where} onChange={(event) => set("where", event.target.value as ResultFilter["where"])} className={field}>
        <option value="any">Any location</option>
        <option value="india-or-unclear">India, anywhere or unclear</option>
        <option value="india">India or anywhere only</option>
      </select>
      <select aria-label="Salary" value={filter.salary} onChange={(event) => set("salary", event.target.value as ResultFilter["salary"])} className={field}>
        <option value="any">Any salary</option>
        <option value="disclosed">Salary disclosed</option>
        <option value="meets">₹{floorLpa} LPA or more</option>
      </select>
      <select aria-label="Posted within" value={filter.maxAge} onChange={(event) => set("maxAge", Number(event.target.value))} className={field}>
        <option value={0}>Any age</option>
        <option value={1}>24 hours</option>
        <option value={2}>48 hours</option>
        <option value={7}>7 days</option>
      </select>
      {sources.length > 1 && (
        <select aria-label="Source" value={filter.source} onChange={(event) => set("source", event.target.value as ResultFilter["source"])} className={field}>
          <option value="any">Every source</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {SOURCE_INFO[source].name}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={filter.directOnly} onChange={(event) => set("directOnly", event.target.checked)} />
        Direct apply only
      </label>
      {excluded > 0 && (
        <button type="button" aria-pressed={filter.showExcluded} onClick={() => set("showExcluded", !filter.showExcluded)} className="underline-offset-3 hover:text-ink aria-pressed:text-ink aria-pressed:underline">
          {excluded === 1 ? "1 posting left out as not eligible or unrelated" : `${excluded} postings left out as not eligible or unrelated`} · {filter.showExcluded ? "Hide" : "Show"}
        </button>
      )}
    </fieldset>
  );
}
