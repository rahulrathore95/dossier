import { describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";

import { WRITE_DOCUMENTS_STEPS } from "./application-steps";
import { writeDocumentsJob } from "./write-documents";

const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));
const variants = vi.hoisted(() => ({
  list: [] as { id: string; name: string; positioning: string; focusSkills: string[] }[],
}));
vi.mock("@/lib/resume-variants-data", () => ({ loadVariants: async () => variants.list }));

describe("writeDocumentsJob (E7-6)", () => {
  it("tailors the resume, then writes the letter, naming each step", async () => {
    provider.current = new MockProvider({
      reply: (call) =>
        call.json?.name === "tailored_resume"
          ? { summary: "Designer at Google.", roles: [], projects: [], skills: ["Figma"], education: [] }
          : { recipient: "Ledgerly · Hiring team", greeting: "Dear Ledgerly team,", paragraphs: [{ label: "Opening", text: "I'd love to join Ledgerly." }], signOff: "Warm regards," },
    });
    const steps: string[] = [];
    const extracted = {
      title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null,
      requirements: [], asksForReferences: false, language: "English",
    };
    const result = await writeDocumentsJob.run(
      { readJobId: "read-job", posting: "Ledgerly is hiring.", extracted, match: { items: [] }, tone: "WARM", note: "" },
      { id: "test-job", step: async (name) => void steps.push(name), signal: new AbortController().signal },
    );
    expect(steps).toEqual(WRITE_DOCUMENTS_STEPS.slice(0, 2));
    expect(result.resumeWith).toBe("tailor-resume@7");
    expect(result.letterWith).toBe("write-cover-letter@5");
    // Strict mode: the fact guard marks what the profile doesn't back.
    expect(result.resume[0]).toMatchObject({ id: "summary", unverified: ["Google"] });
    expect(result.letter.map((unit) => unit.id)).toEqual(["recipient", "greeting", "paragraph:1", "sign-off"]);
    expect(result.variantId).toBeNull();
  });

  it("writes from the variant the posting fits best, or the one chosen, or none (this fork)", async () => {
    const systems: string[] = [];
    provider.current = new MockProvider({
      reply: (call) => {
        if (call.json?.name === "tailored_resume") {
          systems.push(call.system ?? "");
          return { summary: "Designer.", roles: [], projects: [], skills: ["Figma"], education: [] };
        }
        return { recipient: "Ledgerly", greeting: "Hi,", paragraphs: [{ label: "Opening", text: "Hello." }], signOff: "Thanks," };
      },
    });
    variants.list = [
      { id: "research", name: "Research-led designer", positioning: "Lead with research.", focusSkills: ["User research"] },
      { id: "systems", name: "Design systems lead", positioning: "Lead with systems.", focusSkills: ["Design systems", "Figma"] },
    ];
    const extracted = {
      title: "Designer", company: "Ledgerly", role: "Designer", location: null, mode: null, salary: null, deadline: null,
      requirements: [], asksForReferences: false, language: "English",
    };
    const run = (variantId?: string | null) =>
      writeDocumentsJob.run(
        { readJobId: "read-job", posting: "You'll own our Figma design systems.", extracted, match: { items: [] }, tone: "WARM", note: "", ...(variantId === undefined ? {} : { variantId }) },
        { id: "test-job", step: async () => {}, signal: new AbortController().signal },
      );

    const auto = await run();
    expect(auto).toMatchObject({ variantId: "systems", variantReason: "The posting names 2 of its focus skills: Design systems, Figma" });
    expect(systems.at(-1)).toContain("Resume variant: Design systems lead.");

    expect(await run("research")).toMatchObject({ variantId: "research" });
    expect(systems.at(-1)).toContain("Resume variant: Research-led designer.");
    expect((await run("research")).variantReason).toBeUndefined();

    expect(await run(null)).toMatchObject({ variantId: null });
    expect(systems.at(-1)).not.toContain("Resume variant");
    variants.list = [];
  });
});
