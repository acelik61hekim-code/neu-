import { Redis } from "@upstash/redis";

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

type UsageKind = "credits" | "studio-edits";

const memoryUsage = new Map<string, { count: number; expiresAt: number }>();

function usageKey(subscriptionId: string, periodStart: number, kind: UsageKind): string {
  return `video-subscription:${subscriptionId}:${periodStart}:${kind}`;
}

function ttlSeconds(periodEnd: number): number {
  return Math.max(60 * 60, periodEnd - Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}

export async function getVideoSubscriptionUsage(
  subscriptionId: string,
  periodStart: number,
): Promise<{ credits: number; studioEdits: number }> {
  const read = async (kind: UsageKind): Promise<number> => {
    const key = usageKey(subscriptionId, periodStart, kind);
    if (redis) return Number(await redis.get<number>(key) ?? 0);
    const value = memoryUsage.get(key);
    if (!value || value.expiresAt <= Date.now()) {
      memoryUsage.delete(key);
      return 0;
    }
    return value.count;
  };

  const [credits, studioEdits] = await Promise.all([
    read("credits"),
    read("studio-edits"),
  ]);
  return { credits, studioEdits };
}

export async function reserveVideoSubscriptionUsage(input: {
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
  kind: UsageKind;
  amount: number;
  limit: number;
}): Promise<{ allowed: boolean; used: number; remaining: number }> {
  const amount = Math.max(1, Math.floor(input.amount));
  const key = usageKey(input.subscriptionId, input.periodStart, input.kind);
  let used: number;

  if (redis) {
    used = Number(await redis.incrby(key, amount));
    if (used === amount) await redis.expire(key, ttlSeconds(input.periodEnd));
    if (used > input.limit) {
      await redis.decrby(key, amount);
      return { allowed: false, used: Math.min(input.limit, used - amount), remaining: Math.max(0, input.limit - (used - amount)) };
    }
  } else {
    const current = memoryUsage.get(key);
    const previous = current && current.expiresAt > Date.now() ? current.count : 0;
    used = previous + amount;
    if (used > input.limit) return { allowed: false, used: previous, remaining: Math.max(0, input.limit - previous) };
    memoryUsage.set(key, {
      count: used,
      expiresAt: Date.now() + ttlSeconds(input.periodEnd) * 1000,
    });
  }

  return { allowed: true, used, remaining: Math.max(0, input.limit - used) };
}

export async function releaseVideoSubscriptionUsage(input: {
  subscriptionId: string;
  periodStart: number;
  kind: UsageKind;
  amount: number;
}): Promise<void> {
  const amount = Math.max(1, Math.floor(input.amount));
  const key = usageKey(input.subscriptionId, input.periodStart, input.kind);

  if (redis) {
    const remaining = Number(await redis.decrby(key, amount));
    if (remaining < 0) await redis.set(key, 0);
    return;
  }

  const current = memoryUsage.get(key);
  if (!current || current.expiresAt <= Date.now()) return;
  memoryUsage.set(key, {
    ...current,
    count: Math.max(0, current.count - amount),
  });
}
