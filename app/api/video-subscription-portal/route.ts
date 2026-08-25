import { NextRequest, NextResponse } from "next/server";

import { stripe } from "@/lib/stripe";
import { getActiveVideoSubscription } from "@/lib/video-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const subscription = await getActiveVideoSubscription(request).catch(() => null);
  if (!subscription) return NextResponse.json({ error: "Kein aktives Video-Abo gefunden." }, { status: 401 });
  if (subscription.subscriptionId.startsWith("sub_internal_")) {
    return NextResponse.json(
      { error: "Der interne Testzugang wird ohne Stripe verwaltet." },
      { status: 400 },
    );
  }
  const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.customerId,
    return_url: `${appUrl}/ki-video-erstellen#video-abos`,
  });
  return NextResponse.json({ url: session.url });
}
