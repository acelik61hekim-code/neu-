import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { accountLibrary } from "@/lib/account-library";
import { getVideoPlan, isVideoPlanId, type VideoPlan } from "@/lib/video-plans";
import { getVideoSubscriptionUsage } from "@/lib/video-subscription-usage";
import {
  getInternalTestIds,
  getInternalTestPeriod,
  hasInternalTestAccess,
} from "@/lib/internal-test-access";
import { stripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/supabase/server";

export const VIDEO_SUBSCRIPTION_COOKIE = "kvs_video_studio";

type SubscriptionCookie = {
  subscriptionId: string;
  customerId: string;
};

export type ActiveVideoSubscription = {
  subscriptionId: string;
  customerId: string;
  plan: VideoPlan;
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  usage: { videoSeconds: number; studioEdits: number };
};

function signingSecret(): string {
  const secret = process.env.VIDEO_SUBSCRIPTION_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Video-Abo-Sitzungen sind nicht konfiguriert.");
  return secret;
}

function signature(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createVideoSubscriptionCookie(value: SubscriptionCookie): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function readVideoSubscriptionCookie(raw: string | undefined): SubscriptionCookie | null {
  if (!raw) return null;
  const [payload, suppliedSignature] = raw.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SubscriptionCookie>;
    if (!parsed.subscriptionId?.startsWith("sub_") || !parsed.customerId?.startsWith("cus_")) return null;
    return { subscriptionId: parsed.subscriptionId, customerId: parsed.customerId };
  } catch {
    return null;
  }
}

export async function getActiveVideoSubscription(request: NextRequest): Promise<ActiveVideoSubscription | null> {
  const user = await getCurrentUser();

  if (
    user &&
    hasInternalTestAccess(user)
  ) {
    const {
      subscriptionId,
      customerId,
    } = getInternalTestIds(
      user.id,
      "video",
    );

    const {
      periodStart,
      periodEnd,
    } = getInternalTestPeriod();

    return {
      subscriptionId,
      customerId,
      plan:
        getVideoPlan(
          "video-studio-max",
        ),
      periodStart,
      periodEnd,
      cancelAtPeriodEnd:
        false,
      usage:
        await getVideoSubscriptionUsage(
          subscriptionId,
          periodStart,
        ),
    };
  }

  const accountLink = user ? await accountLibrary.getVideoSubscription(user.id) : undefined;
  const cookie = readVideoSubscriptionCookie(request.cookies.get(VIDEO_SUBSCRIPTION_COOKIE)?.value);
  const link = accountLink ?? cookie;
  if (!link) return null;

  const subscription = await stripe.subscriptions.retrieve(link.subscriptionId);
  if (subscription.status !== "active" && subscription.status !== "trialing") return null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (customerId !== link.customerId || !isVideoPlanId(subscription.metadata.videoPlanId)) return null;

  if (user && !accountLink) {
    if (subscription.metadata.userId && subscription.metadata.userId !== user.id) return null;
    await accountLibrary.setVideoSubscription(user.id, { subscriptionId: subscription.id, customerId });
  }

  const periodStart = subscription.current_period_start;
  const periodEnd = subscription.current_period_end;
  const usage = await getVideoSubscriptionUsage(subscription.id, periodStart);
  return {
    subscriptionId: subscription.id,
    customerId,
    plan: getVideoPlan(subscription.metadata.videoPlanId),
    periodStart,
    periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    usage,
  };
}
