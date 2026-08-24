import { NextRequest, NextResponse } from "next/server";

import { VIDEO_PLANS } from "@/lib/video-plans";
import { getActiveVideoSubscription } from "@/lib/video-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const subscription = await getActiveVideoSubscription(request);
    if (!subscription) return NextResponse.json({ active: false, plans: VIDEO_PLANS });
    return NextResponse.json({
      active: true,
      plan: subscription.plan,
      creditsUsed: subscription.usage.credits,
      creditsRemaining: Math.max(0, subscription.plan.creditsPerMonth - subscription.usage.credits),
      studioEditsUsed: subscription.usage.studioEdits,
      studioEditsRemaining: Math.max(0, subscription.plan.studioEditsPerMonth - subscription.usage.studioEdits),
      renewsAt: subscription.periodEnd * 1000,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      plans: VIDEO_PLANS,
    });
  } catch (error) {
    console.error("Video-Abo-Status konnte nicht geladen werden:", error);
    return NextResponse.json({ active: false, plans: VIDEO_PLANS });
  }
}
