import { NextResponse } from "next/server";

import { contentDisposition } from "@/lib/file-name";
import { loadResumeFile } from "@/lib/resume-files";
import { route } from "@/lib/route";

/** Hands back an uploaded resume exactly as it was sent (this fork): the master resume's original. */
export const GET = route<RouteContext<"/api/profile/resume-files/[id]">>(async (_request, { params }) => {
  const { id } = await params;
  const file = await loadResumeFile(id);
  if (!file) return NextResponse.json({ error: "That file isn't kept any more: only your latest uploads are." }, { status: 404 });
  // Sent as a download, never shown inline: it's the user's own file, but not one the app vouches for.
  return new Response(new Uint8Array(file.bytes), {
    headers: { "content-type": "application/octet-stream", "content-disposition": contentDisposition(file.name), "x-content-type-options": "nosniff" },
  });
});
