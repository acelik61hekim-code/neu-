import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY fehlt in den Umgebungsvariablen (.env.local)");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Preis pro Video in Cent (4,99 EUR). Hier änderst du später den Preis.
export const PRICE_PER_VIDEO_CENTS = 499;
