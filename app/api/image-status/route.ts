import { NextRequest, NextResponse } from "next/server";
import { imageStore } from "@/lib/image-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  if (!jobId || !sessionId) return NextResponse.json({ error: "Bild- und Zahlungs-ID fehlen." }, { status: 400 });
  const job = await imageStore.get(jobId);
  if (!job || job.stripeSessionId !== sessionId) return NextResponse.json({ error: "Bildauftrag nicht gefunden." }, { status: 404 });
  const ready = job.status === "done" && Boolean(job.imageUri);
  return NextResponse.json({ status: job.status, paymentStatus: job.paymentStatus, renderStage: job.renderStage, progressPercent: job.progressPercent, title: job.title, quality: job.quality, aspectRatio: job.aspectRatio, imageUrl: ready ? `/api/image-download/${encodeURIComponent(jobId)}?session_id=${encodeURIComponent(sessionId)}` : undefined, errorMessage: job.errorMessage });
}
