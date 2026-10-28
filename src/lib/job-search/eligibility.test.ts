import { describe, expect, it } from "vitest";

import { indiaEligibility, isPlaceList } from "./eligibility";

const posting = (title: string, description = "", place = "", remote: boolean | null = null) => ({ title, description, place, remote });

// Titles and snippets as real searches returned them on 28 October 2026.

describe("indiaEligibility", () => {
  it.each([
    posting("Senior Data Engineer (India) @ Rearc"),
    posting("Senior Data Engineer - Global Team (India)"),
    posting("Senior Data Engineer", "Remote (India - Bangalore ONLY). Apply."),
    posting("Data Engineer", "Location. Hyderabad, India Office. Employment Type. Full time."),
    posting("Data Engineer I", "Data Engineer I. Remote - India. Product Engineering"),
    posting("Data Engineer", "", "Bengaluru, Karnataka"),
  ])("says India for %o", (input) => {
    expect(indiaEligibility(input).status).toBe("india");
  });

  it.each([
    posting("Senior Data Engineer II - Remote - US - Samsara"),
    posting("Sr. Data Engineer (Remote) at Rula — United States"),
    posting("Jobgether hiring Senior Data Engineer - REMOTE in Latin America"),
    posting("Senior Data Engineer", "Fully remote. You must be based in the United States to apply.", "", true),
  ])("says remote elsewhere only for %o", (input) => {
    expect(indiaEligibility(input).status).toBe("restricted");
  });

  it("says anywhere for a worldwide remote role", () => {
    expect(indiaEligibility(posting("Data Engineer", "We are a fully distributed team; work from anywhere.")).status).toBe("anywhere");
  });

  it("says elsewhere for an on-site role in another country", () => {
    expect(indiaEligibility(posting("Senior Data Engineer - Pittsburgh, PA")).status).toBe("elsewhere");
    // No word of remote work: a US job, not a remote one limited to the US.
    expect(indiaEligibility(posting("Firstup - Senior Data Engineer (US)")).status).toBe("elsewhere");
    expect(indiaEligibility(posting("Data Engineer", "Location. United Kingdom; United States.")).status).toBe("elsewhere");
  });

  it("says unclear rather than guessing", () => {
    expect(indiaEligibility(posting("Senior Data Engineer @ Overflow", "Location. Remote. Employment Type. Full time.", "", true)).status).toBe("unclear");
    expect(indiaEligibility(posting("Data Engineer", "Join us to build pipelines.")).status).toBe("unclear");
  });

  it("doesn't read the 'us' of 'join us' as the United States", () => {
    expect(indiaEligibility(posting("Remote Data Engineer", "Come join us. Only the curious need apply.", "", true)).status).toBe("unclear");
  });

  it("gives the words its answer rests on", () => {
    expect(indiaEligibility(posting("Data Engineer I", "Data Engineer I. Remote - India. Product Engineering")).evidence).toContain("Remote - India");
  });
});

describe("isPlaceList", () => {
  it("knows Indian places and lists of them", () => {
    expect(isPlaceList("Jaipur,Indore")).toBe(true);
    expect(isPlaceList("Hyderabad")).toBe(true);
    expect(isPlaceList("LTM")).toBe(false);
  });
});
