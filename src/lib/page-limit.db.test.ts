import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import type { ProfileData } from "@/lib/profile";
import { createTestClient, resetDatabase } from "@/test/db";

import type { Unit } from "./application-data";
import { describeTrim, fitResumeToPages, jobTerms, lineRelevance, nextCut, NO_TERMS, type JobTerms } from "./page-limit";
import { countPdfPages } from "./pdf/pages";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn() }));

const prisma = () => db.client!;
const profile = demoProfile();
const units = demoResumeUnits();
// The demo roles, oldest first: Studio Brik (e3), Fieldnote (e2), Northwind (e1); one project (p1) and one publication (u1).
const resume = async () => (await prisma().document.findFirstOrThrow({ where: { applicationId: "app-1", kind: "RESUME" } }));

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "app-1", documents: { create: { kind: "RESUME", units } } } });
});
afterAll(() => prisma().$disconnect());

// A data engineer's resume, to see relevance decide the order (this fork).
const span = (startYear: number, endYear: number | null) => ({ startYear, startMonth: 1, endYear, endMonth: endYear ? 12 : null, current: endYear === null });
const engineer: ProfileData = {
  ...profile,
  skills: ["Python", "BigQuery", "Airflow", "Tableau", "Java"].map((name) => ({ id: name, name })),
  experience: [
    { id: "new", role: "Senior Data Engineer", company: "Acme", location: "", bullets: "", skillIds: [], ...span(2022, null) },
    { id: "mid", role: "Data Engineer", company: "Beta", location: "", bullets: "", skillIds: [], ...span(2019, 2021) },
    { id: "old", role: "Java Developer", company: "Gamma", location: "", bullets: "", skillIds: [], ...span(2016, 2018) },
  ],
  projects: [{ id: "side", name: "Recipe app", link: "", bullets: "", skillIds: [], ...span(2020, 2020) }],
};
const engineerUnits: Unit[] = [
  { id: "summary", label: "Summary", text: "Data engineer with eight years of pipelines." },
  { id: "experience:new", label: "Acme role", text: "Built BigQuery pipelines in Python cutting cost 40%\nOrganised the team offsite\nMigrated Airflow DAGs to Composer, halving failures" },
  { id: "experience:mid", label: "Beta role", text: "Designed Airflow orchestration for 200 daily jobs\nBuilt Tableau dashboards for sales" },
  { id: "experience:old", label: "Gamma role", text: "Wrote Java services for billing\nMentored two interns" },
  { id: "project:side", label: "Recipe app project", text: "A React app for recipes" },
  { id: "skills", label: "Skills", text: "Python · BigQuery · Airflow · Tableau · Java" },
];
const terms: JobTerms = [
  { term: "bigquery", weight: 3 },
  { term: "airflow", weight: 3 },
  { term: "python", weight: 3 },
  { term: "pipelines", weight: 1 },
];
const cutIds = (units: Unit[], times: number, with_ = terms) => {
  const cuts: string[] = [];
  let current = units;
  for (let index = 0; index < times; index++) {
    const cut = nextCut(current, engineer, with_);
    if (!cut) break;
    cuts.push(cut.trimmed.kind === "unit" ? cut.trimmed.unit.id : `${cut.trimmed.unitId}: ${cut.trimmed.lines[0]}`);
    current = cut.units;
  }
  return { cuts, units: current };
};

describe("nextCut (E10-10, by relevance in this fork)", () => {
  it("leaves out the summary first", () => {
    expect(cutIds(engineerUnits, 1).cuts).toEqual(["summary"]);
  });

  it("then the least relevant project or bullet, keeping every company, never shortening a bullet", () => {
    const { cuts, units } = cutIds(engineerUnits, 5);
    expect(cuts).toEqual([
      "summary",
      // Nothing in it the job asks for: a project goes before an equally irrelevant bullet.
      "project:side",
      // Then irrelevant bullets, oldest role first, lower bullets first.
      "experience:old: Mentored two interns",
      "experience:mid: Built Tableau dashboards for sales",
      "experience:new: Organised the team offsite",
    ]);
    // Every company is still there, each with its most relevant work, word for word.
    expect(units.filter((unit) => unit.id.startsWith("experience:")).map((unit) => unit.text)).toEqual([
      "Built BigQuery pipelines in Python cutting cost 40%\nMigrated Airflow DAGs to Composer, halving failures",
      "Designed Airflow orchestration for 200 daily jobs",
      "Wrote Java services for billing",
    ]);
    expect(units.find((unit) => unit.id === "skills")!.text).toBe("Python · BigQuery · Airflow · Tableau · Java");
  });

  it("then the least relevant whole role, never the most recent one", () => {
    const { cuts } = cutIds(engineerUnits, 8);
    expect(cuts.slice(5)).toEqual([
      // Acme's last two bullets are both relevant: the less relevant one goes before any role does.
      "experience:new: Migrated Airflow DAGs to Composer, halving failures",
      "experience:old",
      "experience:mid",
    ]);
    expect(nextCut(cutIds(engineerUnits, 8).units, engineer, terms)).toBeNull();
  });

  it("without the posting's terms, goes oldest first, as upstream did", () => {
    const { cuts } = cutIds(engineerUnits, 3, NO_TERMS);
    expect(cuts).toEqual(["summary", "project:side", "experience:old: Mentored two interns"]);
  });

  it("leaves out the last publication when nothing else is left (#218)", () => {
    const one = units.filter((unit) => unit.id !== "experience:e2" && unit.id !== "experience:e3" && unit.id !== "summary" && unit.id !== "project:p1");
    const single = one.map((unit) => (unit.id === "experience:e1" ? { ...unit, text: unit.text.split("\n")[0] } : unit));
    const cut = nextCut(single, profile)!;
    expect(cut.trimmed).toMatchObject({ kind: "unit", unit: { id: "publication:u1" } });
    expect(describeTrim([cut.trimmed], profile, false, 2)[0]).toMatch(/^Left out the publication “Doe, J\., & Vermeer, K\. \(2016\)\. Trust in…” to fit two pages$/);
    expect(nextCut(cut.units, profile)).toBeNull();
  });
});

describe("jobTerms and lineRelevance", () => {
  it("weights the profile's own skills the posting names above other words", () => {
    const extracted = {
      title: "Senior Data Engineer",
      company: "Acme",
      role: "Data Engineer",
      location: null,
      mode: null,
      salary: null,
      deadline: null,
      requirements: [{ text: "5+ years building data pipelines", kind: "years" as const, skill: null, years: 5, language: null }],
      asksForReferences: false,
      language: "English",
    };
    const found = jobTerms(extracted, "We use BigQuery and Airflow every day.", engineer);
    expect(found).toEqual(expect.arrayContaining([{ term: "bigquery", weight: 3 }, { term: "airflow", weight: 3 }, { term: "pipelines", weight: 1 }]));
    expect(found.find((entry) => entry.term === "java")).toBeUndefined();
    expect(lineRelevance("Built BigQuery pipelines", found)).toBe(4);
    expect(lineRelevance("Organised the team offsite", found)).toBe(0);
  });
});

describe("fitResumeToPages (E10-10)", () => {
  it("leaves a resume that fits alone, up to two pages", async () => {
    expect(await fitResumeToPages("app-1", profile, 2, async () => 2)).toEqual({ trimmed: [], fits: true });
    expect((await resume()).trimmed).toBeNull();
  });

  it("always leaves the summary out of a one-page resume, and can put it back", async () => {
    const { trimmed, fits } = await fitResumeToPages("app-1", profile, 1, async () => 1);
    expect(fits).toBe(true);
    expect(trimmed).toEqual([{ kind: "unit", unit: units.find((unit) => unit.id === "summary"), index: 0 }]);
    expect(describeTrim(trimmed, profile, fits, 1)).toEqual(["Left out the summary: a one-page resume leads with experience"]);
    expect(((await resume()).units as { id: string }[]).map((unit) => unit.id)).not.toContain("summary");
  });

  it("cuts what matters least to the posting until the real PDF fits, and keeps what it cut", async () => {
    await prisma().application.update({
      where: { id: "app-1" },
      data: {
        postingText: "Design systems lead. Figma, accessibility, user research.",
        extracted: { title: "Design lead", company: null, role: null, location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: null },
      },
    });
    // Over one page while it has more than ten bullets in its roles.
    const bulletCount = async () =>
      ((await resume()).units as Unit[]).filter((unit) => unit.id.startsWith("experience:")).reduce((sum, unit) => sum + unit.text.split("\n").length, 0);
    const pages = vi.fn(async () => ((await bulletCount()) > 6 ? 2 : 1));
    const { trimmed, fits } = await fitResumeToPages("app-1", profile, 1, pages);
    expect(fits).toBe(true);
    expect(pages).toHaveBeenCalledWith("/print/resume/app-1");
    expect(await bulletCount()).toBe(6);
    // Every role is still there.
    expect(((await resume()).units as Unit[]).filter((unit) => unit.id.startsWith("experience:"))).toHaveLength(3);
    expect(trimmed[0]).toMatchObject({ kind: "unit", unit: { id: "summary" } });
    const saved = await resume();
    expect(saved.trimmed).toEqual(trimmed);
    expect(describeTrim(trimmed, profile, fits, 1).slice(1).every((line) => /^Left out (the .* project|\d+ less relevant bullets? from the .* role) to fit one page$/.test(line))).toBe(true);
    // The cut resume is a version, one click from the draft before it (E8-10).
    expect(await db.client!.documentVersion.findMany({ select: { cause: true, units: true } })).toEqual([{ cause: "TRIMMED", units: saved.units }]);
  });

  it("trims to two pages when that's the limit, keeping the summary", async () => {
    const pages = vi.fn(async () => (((await resume()).units as Unit[]).some((unit) => unit.id === "project:p1") ? 3 : 2));
    const { trimmed, fits } = await fitResumeToPages("app-1", profile, 2, pages);
    expect(fits).toBe(true);
    expect(trimmed.map((item) => (item.kind === "unit" ? item.unit.id : item.unitId))).toEqual(["summary", "project:p1"]);
  });

  it("gives up after cutting all it can, and says so", async () => {
    const { fits, trimmed } = await fitResumeToPages("app-1", profile, 1, async () => 2);
    expect(fits).toBe(false);
    const lines = describeTrim(trimmed, profile, fits, 1);
    expect(lines.at(-1)).toBe("It still runs over one page, so shorten it by hand if it has to fit");
    // The most recent role is never cut.
    expect(((await resume()).units as Unit[]).map((unit) => unit.id)).toContain("experience:e1");
  });
});

describe("countPdfPages", () => {
  it("counts page objects, not the page tree", () => {
    const pdf = new TextEncoder().encode("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page /Parent 1 0 R >>");
    expect(countPdfPages(pdf)).toBe(2);
  });
});
