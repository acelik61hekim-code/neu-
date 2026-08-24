import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";

import { getVideoModel, getVideoQuotaSeconds } from "@/lib/pricing";
import { startVideoGeneration as startSeedanceVideoGeneration } from "@/lib/seedance";
import { getCurrentUser } from "@/lib/supabase/server";
import { jobStore } from "@/lib/store";
import { extractVideoFrameReference } from "@/lib/video-backend/media";
import { getActiveVideoSubscription } from "@/lib/video-subscription";
import { releaseVideoSubscriptionUsage, reserveVideoSubscriptionUsage } from "@/lib/video-subscription-usage";
import { buildVideoStudioScenes } from "@/lib/video-studio-scenes";
import { startVideoGeneration as startVeoVideoGeneration } from "@/lib/veo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SceneRequest = {
  jobId?: unknown;
  sceneNumber?: unknown;
  instruction?: unknown;
};

export async function POST(request: NextRequest) {
  let body: SceneRequest;
  try {
    body = await request.json() as SceneRequest;
  } catch {
    return NextResponse.json({ error: "Ungültige Szenen-Einstellungen." }, { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Bitte melde dich an." }, { status: 401 });
  }

  const subscription = await getActiveVideoSubscription(request).catch(() => null);
  if (!subscription) {
    return NextResponse.json(
      { error: "Die Szenen-Neugenerierung ist nur mit einem aktiven Video-Abo verfügbar.", locked: true },
      { status: 403 },
    );
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sceneNumber = typeof body.sceneNumber === "number" ? Math.floor(body.sceneNumber) : 0;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 700) : "";
  const job = jobId ? await jobStore.get(jobId) : undefined;

  if (
    !job ||
    job.userId !== user.id ||
    job.paymentStatus !== "paid" ||
    job.status !== "done" ||
    !job.videoUri
  ) {
    return NextResponse.json({ error: "Das fertige Video wurde in deinem Konto nicht gefunden." }, { status: 404 });
  }

  if (instruction.length < 5) {
    return NextResponse.json(
      { error: "Beschreibe kurz und konkret, was in dieser Szene geändert werden soll." },
      { status: 400 },
    );
  }

  const running = (job.studioSceneRenders ?? []).some(
    (render) => render.status === "generating" || render.status === "finalizing",
  );
  if (running) {
    return NextResponse.json(
      { error: "Eine Szene dieses Videos wird bereits neu erstellt. Bitte warte kurz." },
      { status: 409 },
    );
  }

  const scene = buildVideoStudioScenes(job.targetDurationSeconds ?? 15)
    .find((candidate) => candidate.number === sceneNumber);
  if (!scene) {
    return NextResponse.json({ error: "Bitte wähle eine gültige Szene aus." }, { status: 400 });
  }

  const videoModel = job.videoModel ?? "seedance-2-fast";
  const selectedModel = getVideoModel(videoModel);
  // Jeder Provider erstellt für den Szenenaustausch einen vollständigen
  // 8-Sekunden-Clip. Ein kürzeres Schlussstück wird beim Einsetzen gekürzt.
  const quotaAmount = getVideoQuotaSeconds(8, videoModel);
  const reservation = await reserveVideoSubscriptionUsage({
    subscriptionId: subscription.subscriptionId,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    kind: "video-seconds",
    amount: quotaAmount,
    limit: subscription.plan.videoSecondsPerMonth,
  });

  if (!reservation.allowed) {
    const remainingVideoSeconds = reservation.remaining / selectedModel.quotaMultiplier;
    return NextResponse.json(
      {
        error: `Für die Neugenerierung fehlen Videominuten. Mit ${selectedModel.shortName} sind noch ${formatVideoTime(remainingVideoSeconds)} verfügbar.`,
      },
      { status: 409 },
    );
  }

  try {
    const referenceImage = await extractVideoFrameReference(job.videoUri, scene.startSeconds);
    const prompt = buildScenePrompt({
      instruction,
      originalPrompt: job.prompt,
      sceneNumber,
      sceneCount: buildVideoStudioScenes(job.targetDurationSeconds ?? 15).length,
    });
    const operationName = selectedModel.provider === "veo"
      ? await startVeoVideoGeneration(prompt, {
          modelTier: videoModel === "google-veo" ? "standard" : "fast",
          aspectRatio: job.aspectRatio ?? "9:16",
          referenceImage,
        })
      : await startSeedanceVideoGeneration(prompt, {
          modelTier: videoModel === "seedance-2-original" ? "original" : "fast",
          aspectRatio: job.aspectRatio ?? "9:16",
          durationSeconds: 8,
          referenceImage,
        });

    const renderId = nanoid(12);
    const versionId = nanoid(12);
    const now = Date.now();

    await jobStore.update(jobId, (current) => ({
      ...current,
      studioSceneRenders: [
        ...(current.studioSceneRenders ?? []),
        {
          id: renderId,
          versionId,
          sceneNumber,
          startSeconds: scene.startSeconds,
          endSeconds: scene.endSeconds,
          instruction,
          operationName,
          videoModel,
          status: "generating" as const,
          createdAt: now,
          updatedAt: now,
          quotaAmount,
        },
      ].slice(-20),
    }));

    return NextResponse.json({
      renderId,
      status: "generating",
      videoSecondsRemaining: reservation.remaining,
    });
  } catch (error) {
    await releaseVideoSubscriptionUsage({
      subscriptionId: subscription.subscriptionId,
      periodStart: subscription.periodStart,
      kind: "video-seconds",
      amount: quotaAmount,
    }).catch(() => undefined);

    console.error("Szenen-Neugenerierung konnte nicht gestartet werden:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Die Szene konnte nicht gestartet werden." },
      { status: 500 },
    );
  }
}

function buildScenePrompt(input: {
  instruction: string;
  originalPrompt: string;
  sceneNumber: number;
  sceneCount: number;
}): string {
  return [
    "Create one polished replacement shot for an existing finished video.",
    `This is scene ${input.sceneNumber} of ${input.sceneCount}.`,
    "The supplied image is the exact continuity frame. Preserve the same characters, faces, fruit identities, wardrobe, lighting, set, color grade, lens language and visual quality.",
    "Begin naturally from that frame. Use one coherent shot with believable motion and clear visual storytelling. Do not add captions, subtitles, logos, watermarks or unreadable interface text.",
    "The final edit keeps the original audio, so concentrate on matching the visible action and continuity.",
    "CUSTOMER'S REQUIRED CHANGE:",
    input.instruction,
    "ORIGINAL PROJECT CONTEXT:",
    input.originalPrompt.slice(0, 1800),
  ].join("\n\n");
}

function formatVideoTime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))} Sekunden`;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(seconds / 60)} Video-Minuten`;
}
