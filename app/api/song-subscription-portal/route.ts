import { NextRequest, NextResponse } from "next/server";

import { getActiveSongSubscription } from "@/lib/song-subscription";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const subscription = await getActiveSongSubscription(request).catch(() => null);
  if (!subscription) return NextResponse.json({ error: "Kein aktives Song-Abo gefunden." }, { status: 401 });
  const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.customerId,
    return_url: `${appUrl}/ki-song-erstellen#song-abos`,
  });
  return NextResponse.json({ url: session.url });
}
