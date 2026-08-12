import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";

import { songStore } from "@/lib/song-store";
import { stripe } from "@/lib/stripe";
import { renderSongWorkflow } from "@/workflows/render-song";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { jobId?: unknown; sessionId?: unknown };
  try {
    body = await request.json() as { jobId?: unknown; sessionId?: unknown };
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!jobId || !sessionId.startsWith("cs_")) {
    return NextResponse.json({ error: "Song- oder Zahlungs-ID fehlt." }, { status: 400 });
  }

  try {
    const job = await songStore.get(jobId);
    if (!job) return NextResponse.json({ error: "Der Songauftrag wurde nicht gefunden." }, { status: 404 });
    if (job.paymentStatus === "paid" && job.stripeSessionId === sessionId && job.status === "done") {
      return NextResponse.json({ confirmed: true, queued: false, alreadyComplete: true });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Die Zahlung ist noch nicht bestätigt." }, { status: 409 });
    }
    if (session.metadata?.productType !== "song" || session.metadata.jobId !== jobId) {
      return NextResponse.json({ error: "Die Zahlung gehört nicht zu diesem Songauftrag." }, { status: 403 });
    }
    if (session.metadata.songLength !== job.length || session.metadata.lyricsMode !== job.lyricsMode) {
      return NextResponse.json({ error: "Die bezahlte Song-Konfiguration ist ungültig." }, { status: 422 });
    }

    if (job.paymentStatus !== "paid") {
      await songStore.set(jobId, {
        ...job,
        status: "processing",
        paymentStatus: "paid",
        renderStage: "queued",
        progressPercent: 5,
        stripeSessionId: sessionId,
        paidAt: Date.now(),
        errorMessage: undefined,
      });
    }

    const existing = await songStore.getWorkflowStartState(jobId);
    if (existing?.status === "started") {
      return NextResponse.json({ confirmed: true, queued: true, workflowRunId: existing.workflowRunId });
    }
    if (existing?.status === "starting") {
      return NextResponse.json({ confirmed: true, queued: true, starting: true }, { status: 202 });
    }

    const claimed = await songStore.claimWorkflowStart(jobId, `checkout-return:${sessionId}`);
    if (!claimed) {
      return NextResponse.json({ confirmed: true, queued: true, starting: true }, { status: 202 });
    }
    const run = await start(renderSongWorkflow, [jobId]);
    await songStore.confirmWorkflowStarted(jobId, run.runId);
    await songStore.update(jobId, (current) => ({ ...current, workflowRunId: run.runId }));
    return NextResponse.json({ confirmed: true, queued: true, workflowRunId: run.runId });
  } catch (error) {
    console.error("Song-Zahlung konnte nicht bestätigt werden:", error);
    return NextResponse.json(
      { error: "Die Zahlung wird erneut geprüft. Bitte lasse diese Seite geöffnet." },
      { status: 500 },
    );
  }
}
