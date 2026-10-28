import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { scoreRelevance } from "@/lib/job-search/relevance";
import type { FoundPosting, ShownPosting } from "@/lib/job-search/search";

import { NO_FILTER, passes, RelevanceDetail, SourceReportNote } from "./relevance-parts";

const now = new Date("2026-10-28T12:00:00Z");
const profile = { skills: ["Python", "SQL", "BigQuery"], roles: ["Senior Data Engineer"], years: 8, salaryFloorLpa: 40, requireIndia: true };

const shown = (fields: Partial<FoundPosting>): ShownPosting => {
  const posting: FoundPosting = {
    source: "FIRECRAWL",
    externalId: fields.url ?? "x",
    title: "Senior Data Engineer",
    company: "Acme",
    place: "",
    remote: null,
    salary: "",
    postedAt: null,
    url: "https://jobs.lever.co/acme/02b45afd-5a49-41b2-a244-b0ca76306692",
    via: "",
    description: "Python, SQL and BigQuery.",
    complete: false,
    ...fields,
  };
  return { ...posting, state: { postingId: null, saved: false, dismissed: false, applicationId: null, score: null }, relevance: scoreRelevance(posting, profile, now) };
};

describe("passes", () => {
  it("hides what relevance left out until asked", () => {
    const us = shown({ title: "Senior Data Engineer - Remote - US" });
    expect(passes(us, NO_FILTER, 40, now)).toBe(false);
    expect(passes(us, { ...NO_FILTER, showExcluded: true }, 40, now)).toBe(true);
  });

  it("filters by salary, location, age, source and direct link", () => {
    const india = shown({ title: "Senior Data Engineer (India)", salary: "₹45-60 LPA", postedAt: "2026-10-28T00:00:00Z" });
    const unclear = shown({ url: "https://www.naukri.com/job-listings-senior-data-engineer-acme-5-to-8-years-1" });
    expect(passes(india, { ...NO_FILTER, salary: "meets", where: "india", maxAge: 1, directOnly: true }, 40, now)).toBe(true);
    expect(passes(unclear, { ...NO_FILTER, salary: "disclosed" }, 40, now)).toBe(false);
    expect(passes(unclear, { ...NO_FILTER, where: "india" }, 40, now)).toBe(false);
    expect(passes(unclear, { ...NO_FILTER, where: "india-or-unclear" }, 40, now)).toBe(true);
    expect(passes(unclear, { ...NO_FILTER, maxAge: 7 }, 40, now)).toBe(false);
    expect(passes(unclear, { ...NO_FILTER, directOnly: true }, 40, now)).toBe(false);
    expect(passes(unclear, { ...NO_FILTER, source: "JSEARCH" }, 40, now)).toBe(false);
  });

  it("filters by words in the posting", () => {
    expect(passes(shown({}), { ...NO_FILTER, text: "bigquery senior" }, 40, now)).toBe(true);
    expect(passes(shown({}), { ...NO_FILTER, text: "snowflake" }, 40, now)).toBe(false);
  });
});

describe("RelevanceDetail", () => {
  it("shows the score, why, and what counts against it", () => {
    render(<RelevanceDetail relevance={shown({}).relevance!} />);
    expect(screen.getByRole("region", { name: /Relevance to your resume/ })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Why it's relevant" })).toHaveTextContent("Matches 3 of your skills");
    expect(screen.getByRole("list", { name: "What counts against it" })).toHaveTextContent("Salary not disclosed");
  });
});

describe("SourceReportNote", () => {
  it("says which sources were searched, failed or skipped, and why", () => {
    render(
      <SourceReportNote
        report={[
          { source: "JSEARCH", status: "failed", found: 0, message: "You've used up your JSearch searches for this month." },
          { source: "FIRECRAWL", status: "ok", found: 12, message: "Left out 9 pages that list many jobs rather than one posting." },
          { source: "ADZUNA", status: "not-configured", found: 0, message: "Add your Adzuna app ID and key in Settings → Job search first." },
        ]}
      />,
    );
    expect(screen.getByText("JSearch failed · Firecrawl searched (12)")).toBeInTheDocument();
    expect(screen.getByText(/used up your JSearch searches/)).toBeInTheDocument();
    expect(screen.getByText(/Left out 9 pages/)).toBeInTheDocument();
  });

  it("says nothing when no source was asked", () => {
    const { container } = render(<SourceReportNote report={[{ source: "ADZUNA", status: "not-configured", found: 0, message: "" }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
