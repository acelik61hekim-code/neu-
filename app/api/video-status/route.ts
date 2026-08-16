import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim();
  if (!jobId || !sessionId) {
    return NextResponse.json({ error: "jobId und session_id fehlen." }, { status: 400 });
  }

  const job = await jobStore.get(jobId);
  if (!job || !job.stripeSessionId || job.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: "Job nicht gefunden." }, { status: 404 });
  }

  const videoReady = job.status === "done" && Boolean(
    job.videoUri?.startsWith("blob:") || job.videoUri?.startsWith("local:"),
  );
  const videoUrl = videoReady
    ? `/api/video-download/${encodeURIComponent(jobId)}?session_id=${encodeURIComponent(sessionId)}`
    : undefined;

  return NextResponse.json({
    jobId,
    status: job.status,
    format: job.format,
    paymentStatus: job.paymentStatus,
    renderStage: job.renderStage,
    progressPercent: job.progressPercent ?? 0,
    targetDurationSeconds: job.targetDurationSeconds,
    aspectRatio: job.aspectRatio,
    editingStyle: job.editingStyle,
    audioStyle: job.audioStyle,
    voiceMode: job.voiceMode,
    spokenLanguage: job.spokenLanguage,
    nativeCharacterDialogue: job.nativeCharacterDialogue === true,
    hasReferenceImage: Boolean(job.referenceImageUrl),
    generationStrategy: job.generationStrategy,
    currentChapter: job.currentChapter ?? 0,
    totalChapters: job.totalChapters ?? 0,
    currentExtension: job.currentExtension ?? 0,
    totalExtensions: job.totalExtensions ?? 0,
    retryCount: job.retryCount ?? 0,
    nextAttemptAt: job.nextAttemptAt,
    videoReady,
    videoUrl,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
  });
}
