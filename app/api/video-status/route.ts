import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/store";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicVideoError(
  message: string | undefined,
): string | undefined {
  if (
    message &&
    /(?:may contain|contains?).{0,30}(?:real person|real human)|real (?:person|human).{0,30}(?:reference|face)/i.test(
      message,
    )
  ) {
    return "Seedance hat ein Referenzbild fälschlich als mögliche echte Person eingestuft. Starte den gespeicherten Auftrag unten ohne neue Zahlung erneut. Das abgelehnte Bild wird automatisch entfernt; die Figur wird weiterhin aus ihrer Beschreibung erzeugt.";
  }

  return message;
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Video-ID fehlt." }, { status: 400 });
  }

  const job = await jobStore.get(jobId);
  const user = await getCurrentUser();
  const validSession = Boolean(sessionId && job?.stripeSessionId === sessionId);
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  if (!job || (!validSession && !accountOwner)) {
    return NextResponse.json({ error: "Job nicht gefunden." }, { status: 404 });
  }

  const videoReady = job.status === "done" && Boolean(
    job.videoUri?.startsWith("blob:") || job.videoUri?.startsWith("local:"),
  );
  const videoUrl = videoReady
    ? `/api/video-download/${encodeURIComponent(jobId)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`
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
    videoModel: job.videoModel ?? "seedance-2-fast",
    musicVideoAudioName: job.musicVideoAudioName,
    musicVideoAudioDurationSeconds: job.musicVideoAudioDurationSeconds,
    hasOriginalSong: Boolean(job.musicVideoAudioUri),
    nativeCharacterDialogue: job.nativeCharacterDialogue === true,
    trashTvReactionBoost: job.trashTvReactionBoost === true,
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
    errorMessage:
      publicVideoError(
        job.errorMessage,
      ),
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
  });
}
