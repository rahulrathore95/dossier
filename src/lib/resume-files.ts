import "server-only";

import { prisma } from "@/lib/prisma";

// The master resume's original files (this fork): every resume uploaded for
// the profile import is kept as it was sent, apart from what was read from
// it and from every tailored resume, so the source of truth is never lost.
// Only the latest few are kept; "Delete everything" removes them all.

/** How many uploads are kept; the oldest go first. */
export const RESUME_FILES_KEPT = 5;

export type ResumeFileInfo = { id: string; name: string; mimeType: string; size: number; createdAt: string };

/** A file name safe to keep and show: no path, no control characters, at most 200 characters. */
export function cleanFileName(raw: string | null | undefined): string {
  let name = "";
  try {
    name = decodeURIComponent(raw ?? "");
  } catch {
    name = raw ?? "";
  }
  name = name.split(/[\\/]/).at(-1)!.replace(/[\p{Cc}"]/gu, "").trim();
  return name.slice(-200) || "resume";
}

/** Keeps an uploaded resume as sent, and lets the oldest go past RESUME_FILES_KEPT. */
export async function saveResumeFile(name: string, mimeType: string, bytes: Uint8Array): Promise<ResumeFileInfo> {
  const file = await prisma.resumeFile.create({
    data: { name: cleanFileName(name), mimeType: mimeType.slice(0, 100) || "application/octet-stream", size: bytes.length, bytes: Buffer.from(bytes) },
    select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
  });
  const old = await prisma.resumeFile.findMany({ orderBy: { createdAt: "desc" }, skip: RESUME_FILES_KEPT, select: { id: true } });
  if (old.length > 0) await prisma.resumeFile.deleteMany({ where: { id: { in: old.map((entry) => entry.id) } } });
  return { ...file, createdAt: file.createdAt.toISOString() };
}

/** The kept uploads, newest first, without their bytes. */
export async function listResumeFiles(): Promise<ResumeFileInfo[]> {
  const files = await prisma.resumeFile.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, mimeType: true, size: true, createdAt: true } });
  return files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() }));
}

export async function loadResumeFile(id: string) {
  return prisma.resumeFile.findUnique({ where: { id } });
}
