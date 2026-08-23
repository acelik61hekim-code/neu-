import { NextRequest, NextResponse } from "next/server";

import { canAccessSong } from "@/lib/song-access";
import { songStore } from "@/lib/song-store";
import { getActiveSongSubscription } from "@/lib/song-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  const accessToken = request.nextUrl.searchParams.get("access_token")?.trim();
  if (!jobId) return NextResponse.json({ error: "Bitte öffne das Studio über deinen fertigen Song." }, { status: 400 });
  const [job, subscription] = await Promise.all([
    songStore.get(jobId),
    getActiveSongSubscription(request).catch(() => null),
  ]);
  if (!job || !canAccessSong(job, sessionId, accessToken) || job.status !== "done" || !job.audioUri) {
    return NextResponse.json({ error: "Der Song konnte nicht sicher geöffnet werden." }, { status: 404 });
  }
  if (!subscription) return NextResponse.json({ error: "Für das Sound Studio brauchst du ein aktives Song-Abo.", needsSubscription: true }, { status: 403 });
  const accessQuery = sessionId ? `session_id=${encodeURIComponent(sessionId)}` : `access_token=${encodeURIComponent(accessToken!)}`;
  return NextResponse.json({
    title: job.title || "Dein KI-Song",
    style: job.style,
    lyrics: job.generatedLyrics || job.lyrics || "",
    audioUrl: `/api/song-download/${encodeURIComponent(jobId)}?${accessQuery}`,
    canRegenerate: Boolean(job.provider === "acedata" && job.providerSongId),
    planName: subscription.plan.name,
    editsRemaining: Math.max(0, subscription.plan.aiEditsPerMonth - subscription.usage.edits),
  });
}
