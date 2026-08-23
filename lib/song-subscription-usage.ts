import { Redis } from "@upstash/redis";

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

type UsageKind = "songs" | "edits";

const memoryUsage = new Map<string, { count: number; expiresAt: number }>();

function usageKey(subscriptionId: string, periodStart: number, kind: UsageKind): string {
  return `song-subscription:${subscriptionId}:${periodStart}:${kind}`;
}
function ttlSeconds(periodEnd: number): number {
  return Math.max(60 * 60, periodEnd - Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
}

export async function getSubscriptionUsage(
  subscriptionId: string,
  periodStart: number,
): Promise<{ songs: number; edits: number }> {
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

  const [songs, edits] = await Promise.all([read("songs"), read("edits")]);
  return { songs, edits };
}

export async function reserveSubscriptionUsage(input: {
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
  kind: UsageKind;
  limit: number;
}): Promise<{ allowed: boolean; used: number; remaining: number }> {
  const key = usageKey(input.subscriptionId, input.periodStart, input.kind);
  let used: number;

  if (redis) {
    used = Number(await redis.incr(key));
    if (used === 1) await redis.expire(key, ttlSeconds(input.periodEnd));
    if (used > input.limit) {
      await redis.decr(key);
      return { allowed: false, used: input.limit, remaining: 0 };
    }
  } else {
    const current = memoryUsage.get(key);
    used = (current && current.expiresAt > Date.now() ? current.count : 0) + 1;
    if (used > input.limit) return { allowed: false, used: input.limit, remaining: 0 };
    memoryUsage.set(key, {
      count: used,
      expiresAt: Date.now() + ttlSeconds(input.periodEnd) * 1000,
    });
  }

  return { allowed: true, used, remaining: Math.max(0, input.limit - used) };
}
