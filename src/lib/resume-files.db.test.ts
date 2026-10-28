import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { cleanFileName, listResumeFiles, loadResumeFile, RESUME_FILES_KEPT, saveResumeFile } from "./resume-files";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("resume files (this fork)", () => {
  it("keeps an upload byte for byte, and lists it without its bytes", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
    const saved = await saveResumeFile("Jane%20Doe%20CV.pdf", "application/pdf", bytes);
    expect(saved).toMatchObject({ name: "Jane Doe CV.pdf", mimeType: "application/pdf", size: 8 });
    expect(new Uint8Array((await loadResumeFile(saved.id))!.bytes)).toEqual(bytes);
    expect(await listResumeFiles()).toEqual([{ id: saved.id, name: "Jane Doe CV.pdf", mimeType: "application/pdf", size: 8, createdAt: saved.createdAt }]);
  });

  it("keeps only the latest few", async () => {
    for (let index = 0; index < RESUME_FILES_KEPT + 2; index++) await saveResumeFile(`cv-${index}.md`, "text/markdown", new Uint8Array([index]));
    const kept = await listResumeFiles();
    expect(kept).toHaveLength(RESUME_FILES_KEPT);
    expect(kept[0].name).toBe(`cv-${RESUME_FILES_KEPT + 1}.md`);
  });
});

describe("cleanFileName", () => {
  it("drops paths and control characters, and never comes back empty", () => {
    expect(cleanFileName("..%2F..%2Fetc%2Fpasswd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\me\\cv.pdf")).toBe("cv.pdf");
    expect(cleanFileName('a"b\u0007.pdf')).toBe("ab.pdf");
    expect(cleanFileName("%E0%A4%A")).toBe("%E0%A4%A");
    expect(cleanFileName("")).toBe("resume");
  });
});
