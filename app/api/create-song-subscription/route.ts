import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { getSongPlan, isSongPlanId } from "@/lib/song-plans";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, "song-subscription-checkout", 10, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte probiere es später erneut." }, { status: 429 });
  }

  let body: { planId?: unknown };
  try {
    body = await request.json() as { planId?: unknown };
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  if (!isSongPlanId(body.planId)) {
    return NextResponse.json({ error: "Bitte wähle ein gültiges Abo." }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Bitte melde dich an oder registriere dich, damit dein Abo dauerhaft gespeichert wird.", signInUrl: "/anmelden?next=/ki-song-erstellen%23song-abos" }, { status: 401 });
  }

  const existingSubscription = await getActiveSongSubscription(request).catch(() => null);
  if (existingSubscription) {
    return NextResponse.json({ error: "Du hast bereits ein aktives Song-Abo. Öffne zum Kündigen oder Verwalten bitte deinen Abo-Bereich." }, { status: 409 });
  }

  const plan = getSongPlan(body.planId);
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
            name: `KI Song Studio ${plan.name}`,
            description: `${plan.songsPerMonth} vollständige Songs und ${plan.aiEditsPerMonth} KI-Bearbeitungen pro Monat`,
          },
        },
        quantity: 1,
      }],
      metadata: { productType: "song-subscription", songPlanId: plan.id, userId: user.id },
      subscription_data: { metadata: { productType: "song-subscription", songPlanId: plan.id, userId: user.id } },
      success_url: `${appUrl}/song-pro-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/ki-song-erstellen?abo=abgebrochen#song-abos`,
    });

    if (!session.url) throw new Error("Stripe hat keine Checkout-Adresse zurückgegeben.");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Song-Abo-Checkout konnte nicht erstellt werden:", error);
    return NextResponse.json({ error: "Das Abo konnte gerade nicht geöffnet werden. Bitte versuche es erneut." }, { status: 500 });
  }
}
