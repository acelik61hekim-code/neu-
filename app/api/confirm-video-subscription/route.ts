import { NextRequest, NextResponse } from "next/server";

import { accountLibrary } from "@/lib/account-library";
import { getCurrentUser } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { isVideoPlanId } from "@/lib/video-plans";
import { createVideoSubscriptionCookie, VIDEO_SUBSCRIPTION_COOKIE } from "@/lib/video-subscription";

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
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Bitte melde dich an, um das Abo deinem Konto zuzuordnen." }, { status: 401 });
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription", "customer"] });
    if (session.mode !== "subscription" || session.metadata?.productType !== "video-subscription") return NextResponse.json({ error: "Diese Zahlung gehört nicht zu einem Video-Abo." }, { status: 403 });
    if (session.metadata.userId !== user.id || session.client_reference_id !== user.id) return NextResponse.json({ error: "Dieses Abo gehört zu einem anderen Kundenkonto." }, { status: 403 });

    const subscription = session.subscription;
    const customer = session.customer;
    if (!subscription || typeof subscription === "string" || !isVideoPlanId(subscription.metadata.videoPlanId)) return NextResponse.json({ error: "Das Abo ist noch nicht aktiv." }, { status: 409 });
    const customerId = typeof customer === "string" ? customer : customer?.id;
    if (!customerId?.startsWith("cus_") || (subscription.status !== "active" && subscription.status !== "trialing")) return NextResponse.json({ error: "Das Abo ist noch nicht aktiv." }, { status: 409 });

    await accountLibrary.setVideoSubscription(user.id, { subscriptionId: subscription.id, customerId });
    const response = NextResponse.json({ confirmed: true, planId: subscription.metadata.videoPlanId });
    response.cookies.set(VIDEO_SUBSCRIPTION_COOKIE, createVideoSubscriptionCookie({ subscriptionId: subscription.id, customerId }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
    });
    return response;
  } catch (error) {
    console.error("Video-Abo konnte nicht bestätigt werden:", error);
    return NextResponse.json({ error: "Die Abo-Zahlung wird noch geprüft. Bitte versuche es gleich erneut." }, { status: 500 });
  }
}
