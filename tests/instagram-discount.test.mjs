import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getInstagramDiscountCampaign,
  prepareInstagramDiscountForAccount,
} from "../lib/instagram-discount.ts";

const ACTIVE_ENVIRONMENT = {
  STRIPE_INSTA10_COUPON_ID: "coupon_insta10",
  INSTA10_EXPIRES_AT: "2026-09-04T12:00:00.000Z",
};

test("INSTA10 is active only before the configured 24-hour deadline", () => {
  const active = getInstagramDiscountCampaign(
    Date.parse("2026-09-04T11:59:59.999Z"),
    ACTIVE_ENVIRONMENT,
  );

  assert.equal(active?.code, "INSTA10");
  assert.equal(active?.percentOff, 10);
  assert.equal(active?.couponId, "coupon_insta10");
  assert.equal(
    active?.expiresAtUnix,
    Date.parse("2026-09-04T12:00:00.000Z") / 1_000,
  );
  assert.equal(
    getInstagramDiscountCampaign(
      Date.parse("2026-09-04T12:00:00.000Z"),
      ACTIVE_ENVIRONMENT,
    ),
    null,
  );
});

test("each account gets one customer-bound promotion code with one redemption", async () => {
  const promotionCodes = [];
  const savedCustomers = new Map();
  const createdPromotionParams = [];
  let customerCreations = 0;
  let coupon;
  let couponCreations = 0;

  const stripe = {
    coupons: {
      async retrieve() {
        if (coupon) return coupon;
        const error = new Error("missing");
        error.code = "resource_missing";
        throw error;
      },
      async create(params) {
        couponCreations += 1;
        coupon = {
          id: params.id,
          duration: params.duration,
          percent_off: params.percent_off,
          redeem_by: params.redeem_by,
          valid: true,
        };
        return coupon;
      },
    },
    customers: {
      async create(params) {
        customerCreations += 1;
        assert.equal(params.email, "kunde@example.com");
        return { id: "cus_account_1" };
      },
    },
    promotionCodes: {
      async list({ code, customer }) {
        return {
          data: promotionCodes.filter(
            (item) => item.code === code && item.customer === customer,
          ),
        };
      },
      async create(params) {
        createdPromotionParams.push(params);
        const promotionCode = {
          id: "promo_account_1",
          code: params.code,
          customer: params.customer,
          metadata: params.metadata,
        };
        promotionCodes.push(promotionCode);
        return promotionCode;
      },
    },
  };
  const store = {
    async getCustomerId(userId) {
      return savedCustomers.get(userId);
    },
    async setCustomerId(userId, customerId) {
      savedCustomers.set(userId, customerId);
    },
  };
  const options = {
    stripe,
    store,
    user: { id: "user-1", email: "kunde@example.com" },
    now: Date.parse("2026-09-03T12:00:00.000Z"),
    environment: ACTIVE_ENVIRONMENT,
  };

  const first = await prepareInstagramDiscountForAccount(options);
  const second = await prepareInstagramDiscountForAccount(options);

  assert.equal(first?.customerId, "cus_account_1");
  assert.equal(second?.promotionCodeId, "promo_account_1");
  assert.equal(customerCreations, 1);
  assert.equal(couponCreations, 1);
  assert.equal(createdPromotionParams.length, 1);
  assert.equal(createdPromotionParams[0].coupon, "coupon_insta10");
  assert.equal(createdPromotionParams[0].code, "INSTA10");
  assert.equal(createdPromotionParams[0].customer, "cus_account_1");
  assert.equal(createdPromotionParams[0].max_redemptions, 1);
  assert.equal(
    createdPromotionParams[0].expires_at,
    Date.parse("2026-09-04T12:00:00.000Z") / 1_000,
  );
});

test("an expired campaign never creates a Stripe customer or promotion code", async () => {
  let called = false;
  const stripe = {
    coupons: {
      async retrieve() { called = true; },
      async create() { called = true; },
    },
    customers: { async create() { called = true; } },
    promotionCodes: {
      async list() { called = true; },
      async create() { called = true; },
    },
  };
  const store = {
    async getCustomerId() { called = true; },
    async setCustomerId() { called = true; },
  };

  const result = await prepareInstagramDiscountForAccount({
    stripe,
    store,
    user: { id: "user-1" },
    now: Date.parse("2026-09-04T12:00:00.000Z"),
    environment: ACTIVE_ENVIRONMENT,
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test("all paid checkouts prepare the same account-bound Instagram discount", async () => {
  const routes = [
    "../app/api/create-checkout-session/route.ts",
    "../app/api/create-image-checkout/route.ts",
    "../app/api/create-song-checkout/route.ts",
    "../app/api/create-song-subscription/route.ts",
    "../app/api/create-video-subscription/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(
      source,
      /prepareInstagramDiscountCheckout\(\s*stripe,\s*user,?\s*\)/s,
    );
    assert.match(source, /customer:\s*instagramDiscount\?\.customerId/s);
    assert.match(source, /allow_promotion_codes:\s*true/s);
  }
});
