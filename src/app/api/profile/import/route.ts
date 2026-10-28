import { NextResponse } from "next/server";

import { isAiConfigured } from "@/lib/ai/config";
import { discardProfileImports, importProfileJob } from "@/lib/jobs/import-profile";
import { startJob } from "@/lib/jobs/runner";
import { saveResumeFile } from "@/lib/resume-files";
import { RESUME_MAX_BYTES, RESUME_MESSAGES, resumeText } from "@/lib/resume-text";
import { route } from "@/lib/route";

/**
 * Starts a profile import from a resume file, sent as the request body (E4-10):
 * its text is read here, then a job sorts it into a profile. Earlier readings
 * are deleted first, so only one resume's text is kept at a time. A route
 * handler, since Server Actions take at most 1 MB.
 */
export const POST = route(async (request) => {
  if (Number(request.headers.get("content-length") ?? 0) > RESUME_MAX_BYTES) {
    return NextResponse.json({ error: RESUME_MESSAGES.tooBig }, { status: 413 });
  }
  if (!(await isAiConfigured())) {
    return NextResponse.json({ error: "Choose an AI provider in Settings first: it's what reads the resume." }, { status: 409 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const read = await resumeText(bytes);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  // The original is kept as sent (this fork), apart from what's read from it.
  await saveResumeFile(request.headers.get("x-file-name") ?? "", request.headers.get("content-type") ?? "", bytes);
  await discardProfileImports();
  const jobId = await startJob(importProfileJob, { resume: read.text }, { key: "profile-import" });
  return NextResponse.json({ jobId });
});
