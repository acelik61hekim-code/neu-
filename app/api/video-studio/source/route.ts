import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/supabase/server";
import { jobStore } from "@/lib/store";
import { getActiveVideoSubscription } from "@/lib/video-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim() || "";
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Bitte melde dich an, um das Video Studio zu verwenden." },
      { status: 401 },
    );
  }

  const subscription = await getActiveVideoSubscription(request).catch(() => null);
  if (!subscription) {
    return NextResponse.json(
      { error: "Das Video Studio ist in allen Video-Abos enthalten.", locked: true },
      { status: 403 },
    );
  }

  if (!jobId) {
    return NextResponse.json({ error: "Bitte wähle zuerst ein fertiges Video aus deinem Konto." }, { status: 400 });
  }

  const job = await jobStore.get(jobId);
  if (
    !job ||
    job.userId !== user.id ||
    job.paymentStatus !== "paid" ||
    job.status !== "done" ||
    !job.videoUri
  ) {
    return NextResponse.json({ error: "Dieses fertige Video wurde in deinem Konto nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({
    jobId,
    title: `KI-Video · ${job.targetDurationSeconds ?? 15} Sekunden`,
    durationSeconds: job.targetDurationSeconds ?? 15,
    videoUrl: `/api/video-download/${encodeURIComponent(jobId)}`,
    studioEditsRemaining: Math.max(
      0,
      subscription.plan.studioEditsPerMonth - subscription.usage.studioEdits,
    ),
    versions: (job.studioVersions ?? []).map((version) => ({
      ...version,
      videoUrl:
        `/api/video-download/${encodeURIComponent(jobId)}?version=${encodeURIComponent(version.id)}`,
      downloadUrl:
        `/api/video-download/${encodeURIComponent(jobId)}?version=${encodeURIComponent(version.id)}&download=1`,
    })),
  });
}
