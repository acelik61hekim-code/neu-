import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { checkRateLimit } from "@/lib/rate-limit";
import { IMAGE_PRICE_CENTS, imageQualityLabel, isImageAspectRatio, isImageQuality, isImageStyle } from "@/lib/image-product";
import { imageStore } from "@/lib/image-store";
import { stripe } from "@/lib/stripe";
import { accountLibrary } from "@/lib/account-library";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, "image-checkout", 15, 60 * 60);
  if (!rateLimit.allowed) return NextResponse.json({ error: "Zu viele Bestellversuche. Bitte versuche es später erneut." }, { status: 429 });
  if (process.env.NODE_ENV !== "development" && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN || (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) || !process.env.STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Die Bild-Bestellung ist vorübergehend nicht verfügbar." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 }); }

  const prompt = text(body.prompt, 2_500);
  const title = text(body.title, 100);
  const textInImage = text(body.textInImage, 300);
  const colorMood = text(body.colorMood, 300);
  const negativePrompt = text(body.negativePrompt, 500);
  if (prompt.length < 10) return NextResponse.json({ error: "Bitte beschreibe dein Wunschbild etwas genauer." }, { status: 400 });
  if (!isImageQuality(body.quality) || !isImageAspectRatio(body.aspectRatio) || !isImageStyle(body.style)) {
    return NextResponse.json({ error: "Bitte prüfe Qualität, Format und Bildstil." }, { status: 400 });
  }
  if (body.rightsAccepted !== true) {
    return NextResponse.json({ error: "Bitte bestätige die Rechte- und Sicherheitsbedingungen." }, { status: 400 });
  }

  const jobId = nanoid();
  const now = Date.now();
  const user = await getCurrentUser();
  await imageStore.set(jobId, {
    userId: user?.id,
    status: "pending", paymentStatus: "unpaid", renderStage: "queued", progressPercent: 0,
    prompt, title: title || undefined, style: body.style, aspectRatio: body.aspectRatio, quality: body.quality,
    textInImage: textInImage || undefined, colorMood: colorMood || undefined, negativePrompt: negativePrompt || undefined,
    createdAt: now, updatedAt: now,
  });
  if (user) await accountLibrary.addMedia(user.id, { kind: "image", jobId, title: title || "KI-Bild", createdAt: now });

  try {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allow_promotion_codes: true,
      line_items: [{ price_data: { currency: "eur", product_data: { name: `Professionelles KI-Bild · ${imageQualityLabel(body.quality)}`, description: `Ein individuelles Bild im Format ${body.aspectRatio}` }, unit_amount: IMAGE_PRICE_CENTS[body.quality] }, quantity: 1 }],
      metadata: { productType: "image", jobId, userId: user?.id || "", quality: body.quality, aspectRatio: body.aspectRatio, style: body.style },
      success_url: `${appUrl}/image-success?jobId=${encodeURIComponent(jobId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?studio=image&canceled=1`,
    });
    if (!session.url) return NextResponse.json({ error: "Stripe hat keine Checkout-Adresse zurückgegeben." }, { status: 502 });
    return NextResponse.json({ url: session.url, jobId });
  } catch (error) {
    console.error("Bild-Checkout konnte nicht erstellt werden:", error);
    return NextResponse.json({ error: "Der sichere Bild-Checkout konnte nicht geöffnet werden. Bitte versuche es erneut." }, { status: 500 });
  }
}
