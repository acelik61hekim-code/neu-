import { NextRequest, NextResponse } from "next/server";

import { accountLibrary, type AccountMediaKind } from "@/lib/account-library";
import { canAccessSong } from "@/lib/song-access";
import { imageStore } from "@/lib/image-store";
import { songStore } from "@/lib/song-store";
import { jobStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Bitte melde dich zuerst an." }, { status: 401 });
  let body: { kind?: unknown; jobId?: unknown; sessionId?: unknown; accessToken?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const kind = body.kind === "song" || body.kind === "video" || body.kind === "image" ? body.kind : null;
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (!kind || !jobId) return NextResponse.json({ error: "Auftrag fehlt." }, { status: 400 });

  const title = await claimJob(kind, jobId, sessionId, accessToken, user.id);
  if (!title) return NextResponse.json({ error: "Der sichere Auftrag konnte nicht übernommen werden." }, { status: 403 });
  await accountLibrary.addMedia(user.id, { kind, jobId, title, createdAt: Date.now() });
  return NextResponse.json({ claimed: true });
}

async function claimJob(kind: AccountMediaKind, jobId: string, sessionId: string, accessToken: string, userId: string): Promise<string | null> {
  if (kind === "song") {
    const job = await songStore.get(jobId);
    if (!job || (job.userId && job.userId !== userId) || !canAccessSong(job, sessionId, accessToken)) return null;
    await songStore.set(jobId, { ...job, userId });
    return job.title || "KI-Song";
  }
  if (kind === "image") {
    const job = await imageStore.get(jobId);
    if (!job || (job.userId && job.userId !== userId) || job.stripeSessionId !== sessionId) return null;
    await imageStore.set(jobId, { ...job, userId });
    return job.title || "KI-Bild";
  }
  const job = await jobStore.get(jobId);
  if (!job || (job.userId && job.userId !== userId) || job.stripeSessionId !== sessionId) return null;
  await jobStore.set(jobId, { ...job, userId });
  return `KI-Video · ${job.targetDurationSeconds || ""} Sek.`;
}
