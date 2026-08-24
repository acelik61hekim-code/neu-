import { NextRequest, NextResponse } from "next/server";

import { accountLibrary, type AccountMediaRecord } from "@/lib/account-library";
import { imageStore } from "@/lib/image-store";
import { songStore } from "@/lib/song-store";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import { getActiveVideoSubscription } from "@/lib/video-subscription";
import { jobStore } from "@/lib/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";

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
      creditsRemaining: Math.max(0, videoSubscription.plan.creditsPerMonth - videoSubscription.usage.credits),
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
    const ready = job.status === "done" && Boolean(job.audioUri);
    return { ...record, title: job.title || record.title, status: job.status, progress: job.progressPercent, ready, mediaUrl: ready ? `/api/song-download/${encodeURIComponent(record.jobId)}` : undefined, downloadUrl: ready ? `/api/song-download/${encodeURIComponent(record.jobId)}?download=1` : undefined, studioUrl: ready && job.providerSongId ? `/sound-studio?jobId=${encodeURIComponent(record.jobId)}&account=1` : undefined };
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
