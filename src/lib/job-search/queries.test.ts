import { describe, expect, it } from "vitest";

import { MAX_QUERIES, placeTerms, plannedQueries, searchRoles } from "./queries";
import { EMPTY_QUERY, type SearchQuery } from "./search";

const query: SearchQuery = { ...EMPTY_QUERY, keywords: "Senior Data Engineer", country: "in", remoteOnly: true, roles: ["Staff Data Engineer", "Lead Data Engineer"] };

describe("plannedQueries", () => {
  it("puts two ATS sites first in each query, then one role and the places", () => {
    const planned = plannedQueries(query);
    expect(planned[0].text).toBe('site:jobs.ashbyhq.com OR site:jobs.lever.co "Senior Data Engineer" ("India" OR "Remote")');
    expect(planned[1].text.startsWith("site:job-boards.greenhouse.io OR site:boards.greenhouse.io ")).toBe(true);
    expect(planned.map((entry) => entry.label)).toEqual([
      "Ashby + Lever",
      "Greenhouse",
      "Workable + SmartRecruiters",
      "Workday + Breezy",
      "Teamtailor + Pinpoint",
      "LinkedIn and job board postings",
      "Company careers pages",
    ]);
  });

  it("stays within the per-search limit", () => {
    expect(plannedQueries(query).length).toBeLessThanOrEqual(MAX_QUERIES);
  });

  it("asks boards for their posting pages only, with Naukri in India", () => {
    const boards = plannedQueries(query).find((entry) => entry.label.startsWith("LinkedIn"))!;
    expect(boards.text.startsWith("site:linkedin.com/jobs/view OR site:naukri.com/job-listings ")).toBe(true);
    const abroad = plannedQueries({ ...query, country: "de", remoteOnly: false }).find((entry) => entry.label.startsWith("LinkedIn"))!;
    expect(abroad.text).not.toContain("naukri");
  });

  it("names every target role in the open query only, and keeps salary pages out of it", () => {
    const planned = plannedQueries(query);
    expect(planned.at(-1)!.text).toBe('("Senior Data Engineer" OR "Staff Data Engineer" OR "Lead Data Engineer") ("India" OR "Remote") careers apply -salary -salaries');
    for (const entry of planned.slice(0, -1)) expect(entry.text).not.toContain("Staff Data Engineer");
  });

  it("plans nothing without a role", () => {
    expect(plannedQueries({ ...query, keywords: "", roles: [] })).toEqual([]);
  });
});

describe("searchRoles", () => {
  it("drops repeats and quotes, keeping three", () => {
    expect(searchRoles({ keywords: 'Data "Engineer"', roles: ["data engineer", "A", "B", "C"] })).toEqual(["Data Engineer", "A", "B"]);
  });
});

describe("placeTerms", () => {
  it("adds a city's other names", () => {
    expect(placeTerms({ place: "Bengaluru", country: "in", remoteOnly: false })).toEqual(['"Bengaluru"', '"Bangalore"']);
  });

  it("adds India and Remote to a remote search from an Indian city", () => {
    expect(placeTerms({ place: "Pune", country: "in", remoteOnly: true })).toEqual(['"Pune"', '"India"', '"Remote"']);
  });

  it("says nothing for a search with no place outside India", () => {
    expect(placeTerms({ place: "", country: "de", remoteOnly: false })).toEqual([]);
  });
});
