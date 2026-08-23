import { NextRequest, NextResponse } from "next/server";

import { isSongPlanId } from "@/lib/song-plans";
import { createSongSubscriptionCookie, SONG_SUBSCRIPTION_COOKIE } from "@/lib/song-subscription";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { sessionId?: unknown };
  try {
    body = await request.json() as { sessionId?: unknown };
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId.startsWith("cs_")) return NextResponse.json({ error: "Abo-Bestätigung fehlt." }, { status: 400 });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription", "customer"] });
    if (session.mode !== "subscription" || session.metadata?.productType !== "song-subscription") {
      return NextResponse.json({ error: "Diese Zahlung gehört nicht zu einem Song-Abo." }, { status: 403 });
    }
    const subscription = session.subscription;
    const customer = session.customer;
    if (!subscription || typeof subscription === "string" || !isSongPlanId(subscription.metadata.songPlanId)) {
      return NextResponse.json({ error: "Das Abo ist noch nicht aktiv." }, { status: 409 });
    }
    const customerId = typeof customer === "string" ? customer : customer?.id;
    if (!customerId?.startsWith("cus_") || (subscription.status !== "active" && subscription.status !== "trialing")) {
      return NextResponse.json({ error: "Das Abo ist noch nicht aktiv." }, { status: 409 });
    }

    const response = NextResponse.json({ confirmed: true, planId: subscription.metadata.songPlanId });
    response.cookies.set(SONG_SUBSCRIPTION_COOKIE, createSongSubscriptionCookie({ subscriptionId: subscription.id, customerId }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    });
    return response;
  } catch (error) {
    console.error("Song-Abo konnte nicht bestätigt werden:", error);
    return NextResponse.json({ error: "Die Abo-Zahlung wird noch geprüft. Bitte versuche es gleich erneut." }, { status: 500 });
  }
}
