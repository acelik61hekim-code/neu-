import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";

import { imageStore } from "@/lib/image-store";
import { stripe } from "@/lib/stripe";
import { renderImageWorkflow } from "@/workflows/render-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: { jobId?: unknown; sessionId?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!jobId || !sessionId.startsWith("cs_")) return NextResponse.json({ error: "Bild- oder Zahlungs-ID fehlt." }, { status: 400 });

  try {
    const job = await imageStore.get(jobId);
    if (!job) return NextResponse.json({ error: "Der Bildauftrag wurde nicht gefunden." }, { status: 404 });
    if (job.paymentStatus === "paid" && job.stripeSessionId === sessionId && job.status === "done") return NextResponse.json({ confirmed: true, alreadyComplete: true });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return NextResponse.json({ error: "Die Zahlung ist noch nicht bestätigt." }, { status: 409 });
    if (session.metadata?.productType !== "image" || session.metadata.jobId !== jobId) return NextResponse.json({ error: "Die Zahlung gehört nicht zu diesem Bildauftrag." }, { status: 403 });
    if (session.metadata.quality !== job.quality || session.metadata.aspectRatio !== job.aspectRatio || session.metadata.style !== job.style) return NextResponse.json({ error: "Die bezahlte Bild-Konfiguration ist ungültig." }, { status: 422 });
    if (job.paymentStatus !== "paid") await imageStore.set(jobId, { ...job, status: "processing", paymentStatus: "paid", stripeSessionId: sessionId, paidAt: Date.now(), renderStage: "queued", progressPercent: 5, errorMessage: undefined });

    const existing = await imageStore.getWorkflowStartState(jobId);
    if (existing?.status === "started") return NextResponse.json({ confirmed: true, queued: true, workflowRunId: existing.workflowRunId });
    if (existing?.status === "starting") return NextResponse.json({ confirmed: true, queued: true, starting: true }, { status: 202 });
    const claimed = await imageStore.claimWorkflowStart(jobId, `checkout-return:${sessionId}`);
    if (!claimed) return NextResponse.json({ confirmed: true, queued: true, starting: true }, { status: 202 });
    const run = await start(renderImageWorkflow, [jobId]);
    await imageStore.confirmWorkflowStarted(jobId, run.runId);
    await imageStore.update(jobId, (current) => ({ ...current, workflowRunId: run.runId }));
    return NextResponse.json({ confirmed: true, queued: true, workflowRunId: run.runId });
  } catch (error) {
    console.error("Bild-Zahlung konnte nicht bestätigt werden:", error);
    return NextResponse.json({ error: "Die Zahlung wird erneut geprüft. Bitte lasse diese Seite geöffnet." }, { status: 500 });
  }
}
