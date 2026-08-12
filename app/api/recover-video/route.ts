import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { jobStore } from "@/lib/store";
import { recoverVideoFinalizationWorkflow } from "@/workflows/render-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown; session_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!jobId || !sessionId) {
    return NextResponse.json({ error: "jobId and session_id are required." }, { status: 400 });
  }

  const job = await jobStore.get(jobId);
  if (!job || job.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.paymentStatus !== "paid") {
    return NextResponse.json({ error: "Job is not paid." }, { status: 409 });
  }
  if (job.status === "done" && job.videoUri?.startsWith("blob:")) {
    return NextResponse.json({ recovered: true, alreadyComplete: true, jobId });
  }
  if (job.targetDurationSeconds !== 8) {
    return NextResponse.json({ error: "Recovery is limited to the 8-second safety test." }, { status: 409 });
  }
  if (!job.videoUri || job.videoUri.startsWith("blob:") || job.currentOperationName) {
    return NextResponse.json({ error: "No completed provider video is available for recovery." }, { status: 409 });
  }
  if (job.status === "processing" && job.renderStage === "trimming") {
    return NextResponse.json({ recovering: true, jobId }, { status: 202 });
  }

  await jobStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: "trimming",
    progressPercent: 92,
    errorMessage: undefined,
  });

  try {
    const run = await start(recoverVideoFinalizationWorkflow, [jobId]);
    const latest = await jobStore.get(jobId);
    if (latest) {
      await jobStore.set(jobId, { ...latest, workerId: run.runId });
    }
    return NextResponse.json({ recovering: true, jobId, workflowRunId: run.runId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recovery workflow could not be started.";
    const latest = await jobStore.get(jobId);
    if (latest) {
      await jobStore.set(jobId, { ...latest, status: "error", renderStage: "failed", errorMessage: message });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}