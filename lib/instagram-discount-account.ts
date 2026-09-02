import type Stripe from "stripe";

import { accountLibrary } from "@/lib/account-library";
import { prepareInstagramDiscountForAccount } from "@/lib/instagram-discount";

type DiscountAccount = {
  id: string;
  email?: string | null;
};

export async function prepareInstagramDiscountCheckout(
  stripe: Pick<Stripe, "coupons" | "customers" | "promotionCodes">,
  user: DiscountAccount | null,
) {
  if (!user) {
    return null;
  }

  return prepareInstagramDiscountForAccount({
    stripe,
    user,
    store: {
      async getCustomerId(userId) {
        return (
          await accountLibrary.getBillingCustomer(userId)
        )?.customerId;
      },
      async setCustomerId(userId, customerId) {
        await accountLibrary.setBillingCustomer(userId, customerId);
      },
    },
  });
}
