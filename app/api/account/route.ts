import { NextRequest, NextResponse } from "next/server";

import { accountLibrary, type AccountMediaRecord } from "@/lib/account-library";
import { imageStore } from "@/lib/image-store";
import {
  getGeneratedSongVersions,
  songStore,
} from "@/lib/song-store";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import { getActiveVideoSubscription } from "@/lib/video-subscription";
import { jobStore } from "@/lib/store";
import { hasPrivateInfluencerAccess } from "@/lib/private-influencer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  isRestartableSongProviderError,
  publicSongFailureMessage,
} from "@/lib/song-recovery";
import { songAudioFormatFromMimeType } from "@/lib/song-audio-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ configured: false, authenticated: false });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ configured: true, authenticated: false });
  const [records, subscription, videoSubscription] = await Promise.all([
    accountLibrary.listMedia(user.id),
    getActiveSongSubscription(request).catch(() => null),
    getActiveVideoSubscription(request).catch(() => null),
  ]);
  const media = (await Promise.all(records.map((record) => resolveRecord(user.id, record))))
    .filter((record): record is NonNullable<typeof record> => Boolean(record))
    .sort((a, b) => b.createdAt - a.createdAt);

  return NextResponse.json({
    configured: true,
    authenticated: true,
    email: user.email,
    privateInfluencerAccess: hasPrivateInfluencerAccess(user.email),
    media,
    subscription: subscription ? {
      planName: subscription.plan.name,
      songsRemaining: Math.max(0, subscription.plan.songsPerMonth - subscription.usage.songs),
      editsRemaining: Math.max(0, subscription.plan.aiEditsPerMonth - subscription.usage.edits),
      renewsAt: subscription.periodEnd * 1000,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    } : null,
    videoSubscription: videoSubscription ? {
      planName: videoSubscription.plan.name,
      videoSecondsRemaining: Math.max(0, videoSubscription.plan.videoSecondsPerMonth - videoSubscription.usage.videoSeconds),
      studioEditsRemaining: Math.max(0, videoSubscription.plan.studioEditsPerMonth - videoSubscription.usage.studioEdits),
      renewsAt: videoSubscription.periodEnd * 1000,
      cancelAtPeriodEnd: videoSubscription.cancelAtPeriodEnd,
    } : null,
  });
}

async function resolveRecord(userId: string, record: AccountMediaRecord) {
  if (record.kind === "song") {
    const job = await songStore.get(record.jobId);
    if (!job || job.userId !== userId || job.paymentStatus !== "paid") return null;
    const generatedVersions =
      getGeneratedSongVersions(
        job,
      );

    const ready =
      job.status === "done" &&
      generatedVersions.length > 0;

    const songVersions = ready
      ? generatedVersions.map(
          (version, index) => {
            const number =
              index + 1;

            const format =
              songAudioFormatFromMimeType(
                version.audioMimeType,
              );

            const accessQuery =
              `account=1&version=${number}`;

            return {
              number,
              title:
                version.title ||
                job.title ||
                `Song-Version ${number}`,
              audioMimeType:
                format.mimeType,
              audioExtension:
                format.extension,
              audioFormatLabel:
                format.label,
              audioUrl:
                `/api/song-download/${encodeURIComponent(record.jobId)}?${accessQuery}`,
              downloadUrl:
                `/api/song-download/${encodeURIComponent(record.jobId)}?${accessQuery}&download=1`,
              imageUrl:
                version.imageUri
                  ? `/api/song-cover/${encodeURIComponent(record.jobId)}?${accessQuery}`
                  : undefined,
              studioUrl:
                version.providerSongId
                  ? `/sound-studio?jobId=${encodeURIComponent(record.jobId)}&${accessQuery}`
                  : undefined,
            };
          },
        )
      : [];

    return {
      ...record,
      title: job.title || record.title,
      status: job.status,
      progress: job.progressPercent,
      ready,
      mediaUrl:
        songVersions[0]
          ?.audioUrl,
      downloadUrl:
        songVersions[0]
          ?.downloadUrl,
      studioUrl:
        songVersions[0]
          ?.studioUrl,
      songVersions,
      retryUrl:
        job.status === "error" &&
        isRestartableSongProviderError(job.errorMessage) &&
        (job.recoveryAttempts ?? 0) < 3
          ? "/api/recover-song"
          : undefined,
      errorMessage:
        job.status === "error"
          ? publicSongFailureMessage(job.errorMessage)
          : undefined,
    };
  }
  if (record.kind === "image") {
    const job = await imageStore.get(record.jobId);
    if (!job || job.userId !== userId || job.paymentStatus !== "paid") return null;
    const ready = job.status === "done" && Boolean(job.imageUri);
    return { ...record, title: job.title || record.title, status: job.status, progress: job.progressPercent, ready, mediaUrl: ready ? `/api/image-download/${encodeURIComponent(record.jobId)}` : undefined, downloadUrl: ready ? `/api/image-download/${encodeURIComponent(record.jobId)}?download=1` : undefined };
  }
  const job = await jobStore.get(record.jobId);
  if (!job || job.userId !== userId || job.paymentStatus !== "paid") return null;
  const ready = job.status === "done" && Boolean(job.videoUri);
  return { ...record, status: job.status, progress: job.progressPercent ?? 0, ready, mediaUrl: ready ? `/api/video-download/${encodeURIComponent(record.jobId)}` : undefined, downloadUrl: ready ? `/api/video-download/${encodeURIComponent(record.jobId)}?download=1` : undefined, studioUrl: ready ? `/video-studio?jobId=${encodeURIComponent(record.jobId)}` : undefined };
}
