import { describe, expect, it } from "vitest";

import { isDirectEmployerLink, pageKind, platformOf } from "./ats";

// Links and titles as real searches returned them on 28 October 2026.

describe("pageKind", () => {
  it.each([
    ["https://jobs.ashbyhq.com/rearc/180396cb-92a2-4f78-b38b-748eb4341e12", "Ashby"],
    ["https://jobs.lever.co/netomi/02b45afd-5a49-41b2-a244-b0ca76306692", "Lever"],
    ["https://job-boards.greenhouse.io/karat/jobs/8880766002", "Greenhouse"],
    ["https://boards.greenhouse.io/okta/jobs/8132163", "Greenhouse"],
    ["https://apply.workable.com/v4c/j/BA848A8DD3/", "Workable"],
    ["https://jobs.smartrecruiters.com/TechVedika/744000150060439-google-data-engineer", "SmartRecruiters"],
    ["https://visa.wd5.myworkdayjobs.com/Visa/job/IN---Bengaluru-India/Sr-Data-Engineer_REF089135W-1", "Workday"],
    ["https://nationsbenefits.breezy.hr/p/14dbd9e43ce1-lead-data-engineer", "Breezy"],
    ["https://teoco.na.teamtailor.com/jobs/727050-data-engineer", "Teamtailor"],
    ["https://confluence.pinpointhq.com/postings/c177a19c-b1ea-4bbc-bbba-bd80f2043bfb", "Pinpoint"],
  ])("knows %s as one posting on %s", (url, name) => {
    expect(pageKind(url)).toEqual({ kind: "ats", name });
    expect(isDirectEmployerLink(url)).toBe(true);
  });

  it.each([
    ["https://www.linkedin.com/jobs/view/senior-data-engineer-at-cognite-4476169665", "LinkedIn"],
    ["https://www.naukri.com/job-listings-senior-data-engineer-chevron-bengaluru-6-to-8-years-271026503270", "Naukri"],
    ["https://jobs.workable.com/view/h4PPBCqx3LQNVnB6izMgZg/remote-data-engineer-in-india-at-infystrat", "Workable"],
  ])("knows %s as a board's copy of one posting", (url, name) => {
    expect(pageKind(url)).toEqual({ kind: "board", name });
    expect(isDirectEmployerLink(url)).toBe(false);
    expect(platformOf(url)).toBe(name);
  });

  it.each([
    ["https://in.linkedin.com/jobs/remote-data-engineer-jobs", "Remote Data Engineer Jobs in India (2,000+ Open Roles) | LinkedIn"],
    ["https://in.indeed.com/q-senior-data-engineer-l-remote-jobs.html", "500 Senior Data Engineer Job Vacancies in Remote - Indeed"],
    ["https://jobs.workable.com/search/global/remote-data-engineer-jobs", "Remote Data Engineer Jobs | Jobs by Workable"],
    ["https://sdggroupcareers.teamtailor.com/jobs", "Jobs - SDG Group"],
    ["https://www.remoterocketship.com/country/india/jobs/senior-data-engineer/", "Remote Senior Data Engineer Jobs in India"],
    ["https://himalayas.app/jobs/countries/india/data-engineer", "Remote Data Engineer Jobs in India | Himalayas"],
    ["https://www.michaelpage.co.in/jobs/data-engineer", "Data Engineer jobs in India | Michael Page"],
    ["https://www.glassdoor.co.in/Salaries/data-engineer-salary.htm", "Data Engineer salary"],
  ])("knows %s as a list, not a posting", (url, title) => {
    expect(pageKind(url, title).kind).toBe("list");
  });

  it("keeps a company's own careers page, and counts it as a direct link", () => {
    expect(pageKind("https://careers.acme.com/jobs/1234-data-engineer", "Data Engineer - Acme")).toEqual({ kind: "other" });
    expect(isDirectEmployerLink("https://careers.acme.com/jobs/1234-data-engineer")).toBe(true);
    expect(isDirectEmployerLink("https://acme.com/blog/we-are-hiring")).toBe(false);
  });

  it("refuses anything that isn't a web address", () => {
    expect(pageKind("javascript:alert(1)").kind).toBe("list");
  });
});
