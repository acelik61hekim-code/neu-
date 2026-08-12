import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

function requestFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

export async function checkRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!redis) {
    return {
      allowed: process.env.NODE_ENV === "development",
      remaining: process.env.NODE_ENV === "development" ? limit : 0,
      retryAfterSeconds: windowSeconds,
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowNumber = Math.floor(nowSeconds / windowSeconds);
  const retryAfterSeconds = windowSeconds - (nowSeconds % windowSeconds);
  const key = `rate:${bucket}:${requestFingerprint(request)}:${windowNumber}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds + 30);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds,
    };
  } catch (error) {
    console.error(`Rate-Limit-Prüfung für ${bucket} fehlgeschlagen:`, error);
    return {
      allowed: process.env.NODE_ENV === "development",
      remaining: 0,
      retryAfterSeconds: 60,
    };
  }
}
