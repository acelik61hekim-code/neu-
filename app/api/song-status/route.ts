import { NextRequest, NextResponse } from "next/server";

import { songStore } from "@/lib/song-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  if (!jobId || !sessionId) {
    return NextResponse.json({ error: "Song- und Zahlungs-ID fehlen." }, { status: 400 });
  }
  const job = await songStore.get(jobId);
  if (!job || job.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: "Songauftrag nicht gefunden." }, { status: 404 });
  }
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
      ? `/api/song-download/${encodeURIComponent(jobId)}?session_id=${encodeURIComponent(sessionId)}`
      : undefined,
    errorMessage: job.errorMessage,
  });
}
