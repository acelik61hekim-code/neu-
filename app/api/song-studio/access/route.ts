import { NextRequest, NextResponse } from "next/server";

import { getActiveSongSubscription } from "@/lib/song-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const subscription = await getActiveSongSubscription(request).catch(() => null);

  if (!subscription) {
    return NextResponse.json(
      {
        error:
          "Für den Upload und die Bearbeitung eigener Audiodateien brauchst du ein aktives Song-Abo.",
        needsSubscription: true,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    planName: subscription.plan.name,
    editsRemaining: Math.max(
      0,
      subscription.plan.aiEditsPerMonth - subscription.usage.edits,
    ),
  });
}
