import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { canAccessSong } from "@/lib/song-access";
import {
  isRestartableSongProviderError,
  shouldStartFreshSongProviderTask,
} from "@/lib/song-recovery";
import { songStore } from "@/lib/song-store";
import { getCurrentUser } from "@/lib/supabase/server";
import { renderSongWorkflow } from "@/workflows/render-song";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: {
    jobId?: unknown;
    sessionId?: unknown;
    accessToken?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (!jobId) return NextResponse.json({ error: "Song-ID fehlt." }, { status: 400 });

  const user = await getCurrentUser();
  const job = await songStore.get(jobId);
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  if (!job || (!accountOwner && !canAccessSong(job, sessionId, accessToken))) {
    return NextResponse.json({ error: "Songauftrag nicht gefunden." }, { status: 404 });
  }
  if (job.paymentStatus !== "paid") {
    return NextResponse.json({ error: "Der Songauftrag ist nicht bezahlt." }, { status: 409 });
  }
  if (job.status === "done" && job.audioUri) {
    return NextResponse.json({ success: true, alreadyComplete: true });
  }
  if (job.status !== "error" || !isRestartableSongProviderError(job.errorMessage)) {
    return NextResponse.json(
      { error: "Dieser Songauftrag kann nicht automatisch neu gestartet werden." },
      { status: 409 },
    );
  }
  if ((job.recoveryAttempts ?? 0) >= 3) {
    return NextResponse.json(
      { error: "Die sicheren Wiederholungen dieses Songauftrags sind ausgeschöpft. Bitte wende dich an den Support." },
      { status: 409 },
    );
  }

  const restartProviderTask =
    shouldStartFreshSongProviderTask(
      job.errorMessage,
    );

  await songStore.clearWorkflowStart(jobId);
  await songStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: "queued",
    progressPercent: 5,
    providerTaskId: restartProviderTask ? undefined : job.providerTaskId,
    providerTraceId: restartProviderTask ? undefined : job.providerTraceId,
    providerSongId: restartProviderTask ? undefined : job.providerSongId,
    providerRestartAttempts: restartProviderTask ? 0 : job.providerRestartAttempts,
    recoveryAttempts: (job.recoveryAttempts ?? 0) + 1,
    workflowRunId: undefined,
    errorMessage: undefined,
  });

  try {
    const claimed = await songStore.claimWorkflowStart(jobId, `safe-recovery:${Date.now()}`);
    if (!claimed) {
      return NextResponse.json({ success: true, queued: true, alreadyStarting: true }, { status: 202 });
    }

    const run = await start(renderSongWorkflow, [jobId]);
    await songStore.confirmWorkflowStarted(jobId, run.runId);
    await songStore.update(jobId, (current) => ({ ...current, workflowRunId: run.runId }));
    return NextResponse.json({ success: true, queued: true, workflowRunId: run.runId });
  } catch (error) {
    await songStore.clearWorkflowStart(jobId);
    await songStore.update(jobId, (current) => ({
      ...current,
      status: "error",
      renderStage: "failed",
      progressPercent: 0,
      errorMessage:
        error instanceof Error
          ? `Der kostenlose Neustart konnte nicht gestartet werden: ${error.message}`.slice(0, 600)
          : "Der kostenlose Neustart konnte momentan nicht gestartet werden.",
    }));
    return NextResponse.json(
      { error: "Der Song konnte momentan nicht neu gestartet werden. Bitte versuche es gleich noch einmal." },
      { status: 500 },
    );
  }
}
