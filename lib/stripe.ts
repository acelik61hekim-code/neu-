import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY fehlt in den Umgebungsvariablen (.env.local)");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const PRICE_SHORT_CENTS = 499;
export const PRICE_LONG_CENTS = 2499;
export const LONG_FORMAT_SCENE_COUNT = 6;
