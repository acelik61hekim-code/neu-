type TestAccessUser = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
};

export function hasInternalTestAccess(
  user: TestAccessUser | null,
): boolean {
  return (
    Boolean(user?.id) &&
    user?.app_metadata?.internal_test_access === true
  );
}

export function getInternalTestPeriod(
  now = new Date(),
): {
  periodStart: number;
  periodEnd: number;
} {
  const periodStart =
    Math.floor(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
      ) / 1000,
    );

  const periodEnd =
    Math.floor(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        1,
      ) / 1000,
    );

  return {
    periodStart,
    periodEnd,
  };
}

export function getInternalTestIds(
  userId: string,
  product: "song" | "video",
): {
  subscriptionId: string;
  customerId: string;
} {
  const safeUserId =
    userId.replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );

  return {
    subscriptionId:
      `sub_internal_${product}_${safeUserId}`,
    customerId:
      `cus_internal_${safeUserId}`,
  };
}
