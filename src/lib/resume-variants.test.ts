import { describe, expect, it } from "vitest";

import { focusSkillsOf, recommendVariant, variantForPrompt, type ResumeVariant } from "./resume-variants";

const gcp: ResumeVariant = { id: "gcp", name: "GCP Senior Data Engineer", positioning: "GCP-native pipelines.", focusSkills: ["GCP", "BigQuery", "Dataflow"] };
const azure: ResumeVariant = { id: "azure", name: "Azure Senior Data Engineer", positioning: "", focusSkills: ["Azure", "Databricks", "Synapse"] };

describe("recommendVariant", () => {
  it("picks the variant whose focus skills the posting names most, and says why", () => {
    expect(recommendVariant([gcp, azure], "We run Databricks on Azure, with Synapse for reporting.")).toEqual({
      variant: azure,
      matched: ["Azure", "Databricks", "Synapse"],
      reason: "The posting names 3 of its focus skills: Azure, Databricks, Synapse",
    });
    expect(recommendVariant([gcp, azure], "BigQuery and Dataflow on GCP.")?.variant.id).toBe("gcp");
  });

  it("recommends none when the posting names no variant's skills", () => {
    expect(recommendVariant([gcp, azure], "Snowflake and dbt.")).toBeNull();
    expect(recommendVariant([], "BigQuery")).toBeNull();
  });

  it("breaks a tie by the name's words, then by order", () => {
    const both = "Azure or GCP, with BigQuery or Databricks.";
    expect(recommendVariant([gcp, azure], both)?.variant.id).toBe("gcp");
  });
});

describe("variantForPrompt", () => {
  it("names only the profile's own skills to lead with, and says facts come from the profile", () => {
    const text = variantForPrompt(gcp, ["GCP", "BigQuery", "Python"]);
    expect(text).toContain("every fact still comes from the profile");
    expect(text).toContain("Positioning: GCP-native pipelines.");
    expect(text).toContain("lead with: GCP, BigQuery.");
    expect(text).not.toContain("Dataflow");
  });
});

describe("focusSkillsOf", () => {
  it("reads a list of names, and anything else as none", () => {
    expect(focusSkillsOf(["A", 1, "B"])).toEqual(["A", "B"]);
    expect(focusSkillsOf("A")).toEqual([]);
  });
});
