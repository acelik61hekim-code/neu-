import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { getSongPlan, isSongPlanId, type SongPlan } from "@/lib/song-plans";
import { getSubscriptionUsage } from "@/lib/song-subscription-usage";
import { stripe } from "@/lib/stripe";

export const SONG_SUBSCRIPTION_COOKIE = "kvs_song_studio";

type SubscriptionCookie = {
  subscriptionId: string;
  customerId: string;
};

export type ActiveSongSubscription = {
  subscriptionId: string;
  customerId: string;
  plan: SongPlan;
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  usage: { songs: number; edits: number };
};

function signingSecret(): string {
  const secret = process.env.SONG_SUBSCRIPTION_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Abo-Sitzungen sind nicht konfiguriert.");
  return secret;
}
function signature(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createSongSubscriptionCookie(value: SubscriptionCookie): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function readSongSubscriptionCookie(raw: string | undefined): SubscriptionCookie | null {
  if (!raw) return null;
  const [payload, suppliedSignature] = raw.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const actual = Buffer.from(expected);
  if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SubscriptionCookie>;
    if (!parsed.subscriptionId?.startsWith("sub_") || !parsed.customerId?.startsWith("cus_")) return null;
    return { subscriptionId: parsed.subscriptionId, customerId: parsed.customerId };
  } catch {
    return null;
  }
}

export async function getActiveSongSubscription(request: NextRequest): Promise<ActiveSongSubscription | null> {
  const cookie = readSongSubscriptionCookie(request.cookies.get(SONG_SUBSCRIPTION_COOKIE)?.value);
  if (!cookie) return null;

  const subscription = await stripe.subscriptions.retrieve(cookie.subscriptionId);
  if (subscription.status !== "active" && subscription.status !== "trialing") return null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (customerId !== cookie.customerId || !isSongPlanId(subscription.metadata.songPlanId)) return null;

  const periodStart = subscription.current_period_start;
  const periodEnd = subscription.current_period_end;
  const usage = await getSubscriptionUsage(subscription.id, periodStart);

  return {
    subscriptionId: subscription.id,
    customerId,
    plan: getSongPlan(subscription.metadata.songPlanId),
    periodStart,
    periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    usage,
  };
}
