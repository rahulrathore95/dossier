import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { jobFacts } from "./job-facts";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const now = new Date("2026-10-28T12:00:00Z");

describe("jobFacts (this fork)", () => {
  it("says where a Find jobs posting was found and when, where it can be done from, its pay and its relevance", async () => {
    await prisma().skill.createMany({ data: [{ name: "BigQuery" }, { name: "Python" }] });
    const variant = await prisma().resumeVariant.create({ data: { name: "GCP Senior Data Engineer", focusSkills: ["BigQuery"] } });
    const application = await prisma().application.create({
      data: { title: "Senior Data Engineer", company: "Acme", postingText: "Remote - India. BigQuery and Python. ₹45-60 LPA.", variantId: variant.id },
    });
    await prisma().posting.create({
      data: {
        source: "FIRECRAWL",
        externalId: "x",
        title: "Senior Data Engineer",
        company: "Acme",
        url: "https://jobs.lever.co/acme/02b45afd-5a49-41b2-a244-b0ca76306692",
        postedAt: new Date("2026-10-27T12:00:00Z"),
        applicationId: application.id,
        createdAt: new Date("2026-10-27T13:00:00Z"),
      },
    });
    const facts = await jobFacts(application, now);
    expect(facts).toMatchObject({
      found: "Find jobs, through Firecrawl, via Lever",
      posted: "Posted yesterday",
      discovered: expect.stringMatching(/^found /),
      link: "Direct apply on the employer's site (Lever)",
      where: expect.stringMatching(/^India/),
      salary: "₹45–60 LPA (stated)",
      variant: "GCP Senior Data Engineer",
    });
    expect(facts.relevance.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^Matches 2 of your skills/)]));
  });

  it("works from the application alone when it was pasted, saying what isn't known", async () => {
    const application = await prisma().application.create({ data: { title: "Data Engineer", postingText: "Join us." } });
    expect(await jobFacts(application, now)).toMatchObject({
      found: "Pasted by you",
      posted: "Posting date not given",
      discovered: null,
      link: "No link saved",
      salary: "Salary not disclosed",
      variant: null,
    });
  });
});
