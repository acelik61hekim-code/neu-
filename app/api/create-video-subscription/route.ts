import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { getVideoPlan, isVideoPlanId } from "@/lib/video-plans";
import { getActiveVideoSubscription } from "@/lib/video-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, "video-subscription-checkout", 10, 60 * 60);
  if (!rateLimit.allowed) return NextResponse.json({ error: "Zu viele Versuche. Bitte probiere es später erneut." }, { status: 429 });

  let body: { planId?: unknown };
  try {
    body = await request.json() as { planId?: unknown };
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  if (!isVideoPlanId(body.planId)) return NextResponse.json({ error: "Bitte wähle ein gültiges Video-Abo." }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Bitte melde dich an oder registriere dich, damit dein Abo gespeichert wird." }, { status: 401 });

  const existing = await getActiveVideoSubscription(request).catch(() => null);
  if (existing) return NextResponse.json({ error: "Du hast bereits ein aktives Video-Abo. Öffne zum Wechseln bitte die Abo-Verwaltung." }, { status: 409 });

  const plan = getVideoPlan(body.planId);
  const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      line_items: [{
        price_data: {
          currency: "eur",
          recurring: { interval: "month" },
          unit_amount: plan.priceCents,
          product_data: {
            name: `KI Video Studio ${plan.name}`,
            description: `${formatVideoMinutes(plan.videoSecondsPerMonth)} mit Fast-Modellen und ${plan.studioEditsPerMonth} Studio-Exporte pro Monat`,
          },
        },
        quantity: 1,
      }],
      metadata: { productType: "video-subscription", videoPlanId: plan.id, userId: user.id },
      subscription_data: { metadata: { productType: "video-subscription", videoPlanId: plan.id, userId: user.id } },
      success_url: `${appUrl}/video-pro-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/ki-video-erstellen?abo=abgebrochen#video-abos`,
    });
    if (!session.url) throw new Error("Stripe hat keine Checkout-Adresse zurückgegeben.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Video-Abo-Checkout konnte nicht erstellt werden:", error);
    return NextResponse.json({ error: "Das Video-Abo konnte gerade nicht geöffnet werden." }, { status: 500 });
  }
}

function formatVideoMinutes(seconds: number): string {
  const minutes = seconds / 60;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(minutes)} Video-Minuten`;
}
