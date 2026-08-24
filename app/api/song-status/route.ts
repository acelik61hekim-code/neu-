import { NextRequest, NextResponse } from "next/server";

import { songStore } from "@/lib/song-store";
import { canAccessSong } from "@/lib/song-access";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  const accessToken = request.nextUrl.searchParams.get("access_token")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Song-ID fehlt." }, { status: 400 });
  }
  const job = await songStore.get(jobId);
  const user = await getCurrentUser();
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  if (!job || (!canAccessSong(job, sessionId, accessToken) && !accountOwner)) {
    return NextResponse.json({ error: "Songauftrag nicht gefunden." }, { status: 404 });
  }
  const accessQuery = sessionId
    ? `session_id=${encodeURIComponent(sessionId)}`
    : accessToken
      ? `access_token=${encodeURIComponent(accessToken)}`
      : "account=1";
  const ready = job.status === "done" && Boolean(job.audioUri);
  return NextResponse.json({
    status: job.status,
    paymentStatus: job.paymentStatus,
    renderStage: job.renderStage,
    progressPercent: job.progressPercent,
    title: job.title,
    length: job.length,
    lyricsMode: job.lyricsMode,
    generatedLyrics: job.generatedLyrics,
    audioUrl: ready
      ? `/api/song-download/${encodeURIComponent(jobId)}?${accessQuery}`
      : undefined,
    studioUrl: ready && job.providerSongId
      ? `/sound-studio?jobId=${encodeURIComponent(jobId)}&${accessQuery}`
      : undefined,
    errorMessage: job.errorMessage,
  });
}
