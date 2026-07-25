import { NextRequest, NextResponse } from "next/server";
import { stripe, PRICE_SHORT_CENTS, PRICE_LONG_CENTS } from "../../../lib/stripe";
import { jobStore, VideoFormat } from "../../../lib/store";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  const { prompt, format } = await req.json();

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
    return NextResponse.json(
      { error: "Bitte gib eine Beschreibung für dein Video ein." },
      { status: 400 }
    );
  }

  const videoFormat: VideoFormat = format === "long" ? "long" : "short";
  const priceCents = videoFormat === "long" ? PRICE_LONG_CENTS : PRICE_SHORT_CENTS;
  const productName =
    videoFormat === "long" ? "KI-generiertes 1-Minuten-Video" : "KI-generiertes Video";

  const jobId = nanoid();
  await jobStore.set(jobId, {
    status: "pending",
    prompt: prompt.trim(),
    format: videoFormat,
    createdAt: Date.now(),
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: productName },
          unit_amount: priceCents,
        },
        quantity: 1,
      },
    ],
    metadata: { jobId },
    success_url: `${appUrl}/success?jobId=${jobId}`,
    cancel_url: `${appUrl}?canceled=1`,
  });

  return NextResponse.json({ checkoutUrl: session.url });
}
