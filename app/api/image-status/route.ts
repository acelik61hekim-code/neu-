import { NextRequest, NextResponse } from "next/server";
import { imageStore } from "@/lib/image-store";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  const sessionId = request.nextUrl.searchParams.get("session_id")?.trim();
  if (!jobId) return NextResponse.json({ error: "Bild-ID fehlt." }, { status: 400 });
  const job = await imageStore.get(jobId);
  const user = await getCurrentUser();
  const validSession = Boolean(sessionId && job?.stripeSessionId === sessionId);
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  if (!job || (!validSession && !accountOwner)) return NextResponse.json({ error: "Bildauftrag nicht gefunden." }, { status: 404 });
  const ready = job.status === "done" && Boolean(job.imageUri);
  const accessQuery = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  return NextResponse.json({ status: job.status, paymentStatus: job.paymentStatus, renderStage: job.renderStage, progressPercent: job.progressPercent, title: job.title, quality: job.quality, aspectRatio: job.aspectRatio, imageUrl: ready ? `/api/image-download/${encodeURIComponent(jobId)}${accessQuery}` : undefined, errorMessage: job.errorMessage });
}
