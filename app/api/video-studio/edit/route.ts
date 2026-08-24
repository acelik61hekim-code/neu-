import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";

import { createVideoStudioVersion } from "@/lib/video-backend/media";
import { getCurrentUser } from "@/lib/supabase/server";
import { jobStore } from "@/lib/store";
import { getActiveVideoSubscription } from "@/lib/video-subscription";
import { releaseVideoSubscriptionUsage, reserveVideoSubscriptionUsage } from "@/lib/video-subscription-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type EditRequest = {
  jobId?: unknown;
  title?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
  playbackRate?: unknown;
  volume?: unknown;
  muted?: unknown;
  fadeInSeconds?: unknown;
  fadeOutSeconds?: unknown;
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: NextRequest) {
  let body: EditRequest;
  try {
    body = await request.json() as EditRequest;
  } catch {
    return NextResponse.json({ error: "Ungültige Studio-Einstellungen." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Bitte melde dich an." }, { status: 401 });

  const subscription = await getActiveVideoSubscription(request).catch(() => null);
  if (!subscription) {
    return NextResponse.json({ error: "Für den Export benötigst du ein Video-Abo." }, { status: 403 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const job = jobId ? await jobStore.get(jobId) : undefined;
  if (
    !job ||
    job.userId !== user.id ||
    job.paymentStatus !== "paid" ||
    job.status !== "done" ||
    !job.videoUri
  ) {
    return NextResponse.json({ error: "Das Video wurde in deinem Konto nicht gefunden." }, { status: 404 });
  }

  const maximumDuration = Math.max(1, job.targetDurationSeconds ?? 15);
  const startSeconds = Math.min(maximumDuration - 0.5, Math.max(0, finiteNumber(body.startSeconds, 0)));
  const endSeconds = Math.min(maximumDuration, Math.max(startSeconds + 0.5, finiteNumber(body.endSeconds, maximumDuration)));
  const playbackRate = finiteNumber(body.playbackRate, 1);
  const volume = finiteNumber(body.volume, 1);
  const fadeInSeconds = finiteNumber(body.fadeInSeconds, 0);
  const fadeOutSeconds = finiteNumber(body.fadeOutSeconds, 0);

  if (playbackRate < 0.5 || playbackRate > 2 || volume < 0 || volume > 2) {
    return NextResponse.json({ error: "Geschwindigkeit oder Lautstärke liegt außerhalb des erlaubten Bereichs." }, { status: 400 });
  }

  const usage = await reserveVideoSubscriptionUsage({
    subscriptionId: subscription.subscriptionId,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    kind: "studio-edits",
    amount: 1,
    limit: subscription.plan.studioEditsPerMonth,
  });

  if (!usage.allowed) {
    return NextResponse.json({ error: "Deine Video-Studio-Exporte für diesen Monat sind aufgebraucht." }, { status: 409 });
  }

  const versionId = nanoid(12);
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 80)
    : `Studio-Version ${(job.studioVersions?.length ?? 0) + 1}`;

  try {
    const result = await createVideoStudioVersion(
      job.videoUri,
      `video-studio/${jobId}/${versionId}.mp4`,
      {
        startSeconds,
        endSeconds,
        playbackRate,
        volume,
        muted: body.muted === true,
        fadeInSeconds: Math.min(5, Math.max(0, fadeInSeconds)),
        fadeOutSeconds: Math.min(5, Math.max(0, fadeOutSeconds)),
      },
    );

    const videoUri = result.pathname.startsWith("local:")
      ? result.pathname
      : `blob:${result.pathname}`;
    const version = {
      id: versionId,
      videoUri,
      title,
      createdAt: Date.now(),
      durationSeconds: result.durationSeconds,
    };

    await jobStore.update(jobId, (current) => ({
      ...current,
      studioVersions: [...(current.studioVersions ?? []), version].slice(-20),
    }));

    return NextResponse.json({
      version: {
        ...version,
        videoUrl: `/api/video-download/${encodeURIComponent(jobId)}?version=${encodeURIComponent(versionId)}`,
        downloadUrl: `/api/video-download/${encodeURIComponent(jobId)}?version=${encodeURIComponent(versionId)}&download=1`,
      },
      studioEditsRemaining: usage.remaining,
    });
  } catch (error) {
    await releaseVideoSubscriptionUsage({
      subscriptionId: subscription.subscriptionId,
      periodStart: subscription.periodStart,
      kind: "studio-edits",
      amount: 1,
    }).catch(() => undefined);

    console.error("Video-Studio-Export fehlgeschlagen:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Der Video-Export konnte nicht erstellt werden." },
      { status: 500 },
    );
  }
}
