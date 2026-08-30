import { NextRequest, NextResponse } from "next/server";

import {
  getGeneratedSongVersions,
  songStore,
} from "@/lib/song-store";
import { canAccessSong } from "@/lib/song-access";
import {
  isRestartableSongProviderError,
  publicSongFailureMessage,
} from "@/lib/song-recovery";
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
  const songVersions =
    getGeneratedSongVersions(
      job,
    );

  const ready =
    job.status === "done" &&
    songVersions.length > 0;

  const versions = ready
    ? songVersions.map(
        (version, index) => {
          const versionNumber =
            index + 1;

          const versionQuery =
            `${accessQuery}&version=${versionNumber}`;

          return {
            number:
              versionNumber,
            title:
              version.title ||
              job.title ||
              `Song-Version ${versionNumber}`,
            durationSeconds:
              version.durationSeconds,
            audioUrl:
              `/api/song-download/${encodeURIComponent(jobId)}?${versionQuery}`,
            downloadUrl:
              `/api/song-download/${encodeURIComponent(jobId)}?${versionQuery}&download=1`,
            imageUrl:
              version.imageUri
                ? `/api/song-cover/${encodeURIComponent(jobId)}?${versionQuery}`
                : undefined,
            studioUrl:
              version.providerSongId
                ? `/sound-studio?jobId=${encodeURIComponent(jobId)}&${versionQuery}`
                : undefined,
          };
        },
      )
    : [];

  return NextResponse.json({
    status: job.status,
    paymentStatus: job.paymentStatus,
    renderStage: job.renderStage,
    progressPercent: job.progressPercent,
    title: job.title,
    length: job.length,
    lyricsMode: job.lyricsMode,
    generatedLyrics: job.generatedLyrics,
    versions,
    audioUrl:
      versions[0]
        ?.audioUrl,
    imageUrl:
      versions[0]
        ?.imageUrl,
    studioUrl:
      versions[0]
        ?.studioUrl,
    canRetry:
      job.status === "error" &&
      isRestartableSongProviderError(job.errorMessage) &&
      (job.recoveryAttempts ?? 0) < 3,
    errorMessage:
      job.status === "error"
        ? publicSongFailureMessage(job.errorMessage)
        : undefined,
  });
}
