import { NextRequest, NextResponse } from "next/server";
import { stripe, PRICE_PER_VIDEO_CENTS } from "@/lib/stripe";
import { jobStore } from "@/lib/store";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();

  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
    return NextResponse.json(
      { error: "Bitte gib eine Beschreibung für dein Video ein." },
      { status: 400 }
    );
  }

  // Eigene Job-ID, die wir durch den ganzen Bezahl- und Erstellungsprozess
  // mitschleifen, damit wir später wissen, welcher Prompt zu welcher Zahlung gehört.
  const jobId = nanoid();
  jobStore.set(jobId, {
    status: "pending",
    prompt: prompt.trim(),
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
          product_data: { name: "KI-generiertes Video" },
          unit_amount: PRICE_PER_VIDEO_CENTS,
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
