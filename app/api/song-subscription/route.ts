import { NextRequest, NextResponse } from "next/server";

import { SONG_PLANS } from "@/lib/song-plans";
import { getActiveSongSubscription } from "@/lib/song-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const subscription = await getActiveSongSubscription(request);
    if (!subscription) return NextResponse.json({ active: false, plans: SONG_PLANS });
    return NextResponse.json({
      active: true,
      plan: subscription.plan,
      songsUsed: subscription.usage.songs,
      songsRemaining: Math.max(0, subscription.plan.songsPerMonth - subscription.usage.songs),
      editsUsed: subscription.usage.edits,
      editsRemaining: Math.max(0, subscription.plan.aiEditsPerMonth - subscription.usage.edits),
      renewsAt: subscription.periodEnd * 1000,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      plans: SONG_PLANS,
    });
  } catch (error) {
    console.error("Song-Abo-Status konnte nicht geladen werden:", error);
    return NextResponse.json({ active: false, plans: SONG_PLANS });
  }
}
