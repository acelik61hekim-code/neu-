import type Stripe from "stripe";

export const INSTAGRAM_DISCOUNT_CODE = "INSTA10";
export const INSTAGRAM_DISCOUNT_PERCENT = 10;

type CampaignEnvironment = {
  [key: string]: string | undefined;
  STRIPE_INSTA10_COUPON_ID?: string;
  INSTA10_EXPIRES_AT?: string;
};

export type InstagramDiscountCampaign = {
  code: typeof INSTAGRAM_DISCOUNT_CODE;
  couponId: string;
  expiresAt: number;
  expiresAtUnix: number;
  id: string;
  percentOff: typeof INSTAGRAM_DISCOUNT_PERCENT;
};

export type BillingCustomerStore = {
  getCustomerId(userId: string): Promise<string | undefined>;
  setCustomerId(userId: string, customerId: string): Promise<void>;
};

type InstagramDiscountStripe = Pick<
  Stripe,
  "coupons" | "customers" | "promotionCodes"
>;

type InstagramDiscountUser = {
  id: string;
  email?: string | null;
};

export function getInstagramDiscountCampaign(
  now = Date.now(),
  environment: CampaignEnvironment = process.env,
): InstagramDiscountCampaign | null {
  const expiresAtText =
    environment.INSTA10_EXPIRES_AT?.trim() ?? "";
  const expiresAt = Date.parse(expiresAtText);

  if (
    !expiresAtText ||
    !Number.isFinite(expiresAt) ||
    now >= expiresAt
  ) {
    return null;
  }

  const expiresAtUnix = Math.floor(expiresAt / 1_000);
  const couponId =
    environment.STRIPE_INSTA10_COUPON_ID?.trim() ||
    `INSTA10_${expiresAtUnix}`;

  return {
    code: INSTAGRAM_DISCOUNT_CODE,
    couponId,
    expiresAt,
    expiresAtUnix,
    id: `insta10-${expiresAtUnix}`,
    percentOff: INSTAGRAM_DISCOUNT_PERCENT,
  };
}

export async function prepareInstagramDiscountForAccount({
  stripe,
  store,
  user,
  now = Date.now(),
  environment = process.env,
}: {
  stripe: InstagramDiscountStripe;
  store: BillingCustomerStore;
  user: InstagramDiscountUser;
  now?: number;
  environment?: CampaignEnvironment;
}): Promise<
  | {
      campaign: InstagramDiscountCampaign;
      customerId: string;
      promotionCodeId: string;
    }
  | null
> {
  const campaign = getInstagramDiscountCampaign(now, environment);

  if (!campaign) {
    return null;
  }

  await ensureCampaignCoupon(stripe, campaign);

  let customerId = await store.getCustomerId(user.id);

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        email: user.email?.trim() || undefined,
        metadata: {
          appUserId: user.id,
          source: "ki-video-studio-account",
        },
      },
      {
        idempotencyKey: `billing-customer-${user.id}`,
      },
    );

    customerId = customer.id;
    await store.setCustomerId(user.id, customerId);
  }

  const promotionCodes = await stripe.promotionCodes.list({
    code: campaign.code,
    customer: customerId,
    limit: 100,
  });

  const existing = promotionCodes.data.find(
    (promotionCode) =>
      promotionCode.metadata?.campaignId === campaign.id,
  );

  if (existing) {
    return {
      campaign,
      customerId,
      promotionCodeId: existing.id,
    };
  }

  try {
    const promotionCode = await stripe.promotionCodes.create(
      {
        active: true,
        code: campaign.code,
        coupon: campaign.couponId,
        customer: customerId,
        expires_at: campaign.expiresAtUnix,
        max_redemptions: 1,
        metadata: {
          campaignId: campaign.id,
          appUserId: user.id,
          percentOff: String(campaign.percentOff),
        },
      },
      {
        idempotencyKey: `${campaign.id}-${user.id}`,
      },
    );

    return {
      campaign,
      customerId,
      promotionCodeId: promotionCode.id,
    };
  } catch (error) {
    /*
     * Zwei zeitgleiche Checkout-Anfragen können denselben Code vorbereiten.
     * Stripe lässt pro Kunde nur einen aktiven Code mit demselben Namen zu.
     * Nach dem Konflikt lesen wir deshalb das idempotent erzeugte Ergebnis.
     */
    const retry = await stripe.promotionCodes.list({
      code: campaign.code,
      customer: customerId,
      limit: 100,
    });
    const created = retry.data.find(
      (promotionCode) =>
        promotionCode.metadata?.campaignId === campaign.id,
    );

    if (!created) {
      throw error;
    }

    return {
      campaign,
      customerId,
      promotionCodeId: created.id,
    };
  }
}

async function ensureCampaignCoupon(
  stripe: Pick<Stripe, "coupons">,
  campaign: InstagramDiscountCampaign,
): Promise<void> {
  try {
    const coupon = await stripe.coupons.retrieve(campaign.couponId);

    if (
      "deleted" in coupon ||
      coupon.percent_off !== campaign.percentOff ||
      coupon.duration !== "once" ||
      coupon.redeem_by !== campaign.expiresAtUnix ||
      !coupon.valid
    ) {
      throw new Error(
        `Stripe-Coupon ${campaign.couponId} stimmt nicht mit der INSTA10-Aktion überein.`,
      );
    }

    return;
  } catch (error) {
    if (!isMissingStripeResource(error)) {
      throw error;
    }
  }

  await stripe.coupons.create(
    {
      id: campaign.couponId,
      duration: "once",
      name: "INSTA10 · 10 % · 24 Stunden",
      percent_off: campaign.percentOff,
      redeem_by: campaign.expiresAtUnix,
      metadata: {
        campaignId: campaign.id,
        publicCode: campaign.code,
        perAccount: "true",
      },
    },
    {
      idempotencyKey: `coupon-${campaign.id}`,
    },
  );
}

function isMissingStripeResource(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "resource_missing",
  );
}
