import { NextRequest, NextResponse } from "next/server";

import { getVideoModel } from "@/lib/pricing";
import { checkVideoStatus as checkSeedanceVideoStatus } from "@/lib/seedance";
import { getCurrentUser } from "@/lib/supabase/server";
import { jobStore, type VideoJob } from "@/lib/store";
import { replaceVideoSceneAndStore } from "@/lib/video-backend/media";
import { getActiveVideoSubscription } from "@/lib/video-subscription";
import { releaseVideoSubscriptionUsage } from "@/lib/video-subscription-usage";
import { checkVideoStatus as checkVeoVideoStatus } from "@/lib/veo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Bitte melde dich an." }, { status: 401 });
  }

  const subscription = await getActiveVideoSubscription(request).catch(() => null);
  if (!subscription) {
    return NextResponse.json(
      { error: "Das Video Studio ist nur mit einem aktiven Video-Abo verfügbar.", locked: true },
      { status: 403 },
    );
  }

  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  const renderId = request.nextUrl.searchParams.get("renderId")?.trim() || "";
  const job = jobId ? await jobStore.get(jobId) : undefined;

  if (
    !job ||
    job.userId !== user.id ||
    job.paymentStatus !== "paid" ||
    job.status !== "done" ||
    !job.videoUri
  ) {
    return NextResponse.json({ error: "Das fertige Video wurde nicht gefunden." }, { status: 404 });
  }

  let render = (job.studioSceneRenders ?? []).find((item) => item.id === renderId);
  if (!render) {
    return NextResponse.json({ error: "Diese Szenen-Bearbeitung wurde nicht gefunden." }, { status: 404 });
  }

  if (render.status === "error") {
    return NextResponse.json(
      { error: render.errorMessage || "Die Szene konnte nicht neu erstellt werden.", status: "error" },
      { status: 409 },
    );
  }

  if (render.status === "done") {
    return NextResponse.json(donePayload(jobId, job, render.versionId, subscription));
  }

  let providerCompleted = render.status === "finalizing";

  try {
    if (render.status === "generating") {
      const model = getVideoModel(render.videoModel);
      const providerStatus = model.provider === "veo"
        ? await checkVeoVideoStatus(render.operationName)
        : await checkSeedanceVideoStatus(render.operationName);

      if (!providerStatus.done) {
        return NextResponse.json({ status: "generating" });
      }

      const providerVideoUri = providerStatus.videoUri ?? providerStatus.videoUrl;
      if (!providerVideoUri) {
        throw new Error("Das Videomodell hat keine fertige Szene geliefert.");
      }

      providerCompleted = true;
      await updateSceneRender(jobId, renderId, (current) => ({
        ...current,
        status: "finalizing",
        providerVideoUri,
        updatedAt: Date.now(),
      }));
      render = {
        ...render,
        status: "finalizing",
        providerVideoUri,
      };
    }

    if (!render.providerVideoUri) {
      throw new Error("Die neu generierte Szene konnte nicht geladen werden.");
    }

    const result = await replaceVideoSceneAndStore(
      job.videoUri,
      render.providerVideoUri,
      `video-studio/${jobId}/${render.versionId}.mp4`,
      {
        startSeconds: render.startSeconds,
        endSeconds: render.endSeconds,
        aspectRatio: job.aspectRatio ?? "9:16",
      },
    );
    const videoUri = result.pathname.startsWith("local:")
      ? result.pathname
      : `blob:${result.pathname}`;
    const version = {
      id: render.versionId,
      videoUri,
      title: `Szene ${render.sceneNumber} neu generiert`,
      createdAt: Date.now(),
      durationSeconds: result.durationSeconds,
    };

    const updatedJob = await jobStore.update(jobId, (current) => ({
      ...current,
      studioVersions: [
        ...(current.studioVersions ?? []).filter((item) => item.id !== version.id),
        version,
      ].slice(-20),
      studioSceneRenders: (current.studioSceneRenders ?? []).map((item) =>
        item.id === renderId
          ? { ...item, status: "done" as const, updatedAt: Date.now(), errorMessage: undefined }
          : item,
      ),
    }));

    return NextResponse.json(donePayload(jobId, updatedJob ?? job, render.versionId, subscription));
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Die Szene konnte nicht neu erstellt werden.";

    await updateSceneRender(jobId, renderId, (current) => ({
      ...current,
      status: "error",
      errorMessage,
      updatedAt: Date.now(),
    })).catch(() => undefined);

    // Wenn das Modell noch kein Video erzeugt hat, wird das reservierte
    // Kontingent vollständig zurückgegeben. Beim finalen Videoschnitt sind
    // die Providerkosten bereits angefallen.
    if (!providerCompleted) {
      await releaseVideoSubscriptionUsage({
        subscriptionId: subscription.subscriptionId,
        periodStart: subscription.periodStart,
        kind: "video-seconds",
        amount: render.quotaAmount,
      }).catch(() => undefined);
    }

    console.error("Szenen-Neugenerierung fehlgeschlagen:", error);
    return NextResponse.json({ error: errorMessage, status: "error" }, { status: 500 });
  }
}

async function updateSceneRender(
  jobId: string,
  renderId: string,
  updater: (render: NonNullable<VideoJob["studioSceneRenders"]>[number]) => NonNullable<VideoJob["studioSceneRenders"]>[number],
) {
  return jobStore.update(jobId, (job) => ({
    ...job,
    studioSceneRenders: (job.studioSceneRenders ?? []).map((render) =>
      render.id === renderId ? updater(render) : render,
    ),
  }));
}

function donePayload(
  jobId: string,
  job: VideoJob,
  versionId: string,
  subscription: NonNullable<Awaited<ReturnType<typeof getActiveVideoSubscription>>>,
) {
  const version = (job.studioVersions ?? []).find((item) => item.id === versionId);
  if (!version) {
    return { status: "finalizing" };
  }

  return {
    status: "done",
    version: {
      ...version,
      videoUrl: `/api/video-download/${encodeURIComponent(jobId)}?version=${encodeURIComponent(version.id)}`,
      downloadUrl: `/api/video-download/${encodeURIComponent(jobId)}?version=${encodeURIComponent(version.id)}&download=1`,
    },
    videoSecondsRemaining: Math.max(
      0,
      subscription.plan.videoSecondsPerMonth - subscription.usage.videoSeconds,
    ),
  };
}
