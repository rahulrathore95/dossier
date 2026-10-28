import type { Metadata } from "next";

import { isAiConfigured, loadAiConfig } from "@/lib/ai/config";
import { listResumeFiles, RESUME_FILES_KEPT } from "@/lib/resume-files";
import { jobRetentionLabel } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { ProfileImport } from "./profile-import";

export const metadata: Metadata = { title: "Import from a resume" };

/** Starts the profile from an existing resume file (E4-10, PRO-12); `?job=` follows a reading in progress. */
export default async function ProfileImportPage({ searchParams }: PageProps<"/profile/import">) {
  const [{ job }, aiReady, ai, settings, files] = await Promise.all([searchParams, isAiConfigured(), loadAiConfig(), loadSettings(), listResumeFiles()]);
  return (
    <>
      <ProfileImport
        aiReady={aiReady}
        provider={ai.provider}
        initialJobId={typeof job === "string" ? job : null}
        keptFor={jobRetentionLabel(settings.jobRetentionHours)}
      />
      {files.length > 0 && (
        <section aria-labelledby="original-resumes" className="mx-10 mb-16 flex max-w-[760px] flex-col gap-2 rounded-panel border border-line-card bg-card px-7 py-6">
          <h2 id="original-resumes" className="text-lead font-medium">
            Your uploaded resumes
          </h2>
          <p className="text-meta text-muted">
            Kept exactly as you uploaded them, apart from your profile and every tailored resume, so the original is never lost. The latest{" "}
            {RESUME_FILES_KEPT} are kept.
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <a href={`/api/profile/resume-files/${file.id}`} className="underline underline-offset-2">
                  {file.name}
                </a>
                <span className="text-meta text-muted">
                  {Math.max(1, Math.round(file.size / 1024))} KB · uploaded {new Date(file.createdAt).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
