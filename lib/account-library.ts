import { Redis } from "@upstash/redis";

export type AccountMediaKind = "song" | "video" | "image";

export type AccountMediaRecord = {
  kind: AccountMediaKind;
  jobId: string;
  title: string;
  createdAt: number;
};

export type AccountSubscriptionLink = {
  subscriptionId: string;
  customerId: string;
  updatedAt: number;
};

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const memoryMedia = new Map<string, AccountMediaRecord[]>();
const memorySubscriptions = new Map<string, AccountSubscriptionLink>();
const memoryVideoSubscriptions = new Map<string, AccountSubscriptionLink>();
const mediaKey = (userId: string) => `account:${userId}:media`;
const mediaIdsKey = (userId: string) => `account:${userId}:media-ids`;
const subscriptionKey = (userId: string) => `account:${userId}:song-subscription`;
const videoSubscriptionKey = (userId: string) => `account:${userId}:video-subscription`;

export const accountLibrary = {
  async addMedia(userId: string, record: AccountMediaRecord): Promise<void> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) return;
    const id = `${record.kind}:${record.jobId}`;
    if (redis) {
      const added = await redis.sadd(mediaIdsKey(cleanUserId), id);
      if (Number(added) === 0) return;
      await redis.lpush(mediaKey(cleanUserId), record);
      await redis.ltrim(mediaKey(cleanUserId), 0, 999);
      return;
    }
    const current = memoryMedia.get(cleanUserId) ?? [];
    if (current.some((item) => item.kind === record.kind && item.jobId === record.jobId)) return;
    memoryMedia.set(cleanUserId, [record, ...current].slice(0, 1_000));
  },

  async listMedia(userId: string): Promise<AccountMediaRecord[]> {
    if (redis) return await redis.lrange<AccountMediaRecord>(mediaKey(userId), 0, 999);
    return memoryMedia.get(userId) ?? [];
  },

  async setSubscription(userId: string, link: Omit<AccountSubscriptionLink, "updatedAt">): Promise<void> {
    const value = { ...link, updatedAt: Date.now() };
    if (redis) await redis.set(subscriptionKey(userId), value);
    else memorySubscriptions.set(userId, value);
  },

  async getSubscription(userId: string): Promise<AccountSubscriptionLink | undefined> {
    if (redis) return (await redis.get<AccountSubscriptionLink>(subscriptionKey(userId))) ?? undefined;
    return memorySubscriptions.get(userId);
  },

  async setVideoSubscription(userId: string, link: Omit<AccountSubscriptionLink, "updatedAt">): Promise<void> {
    const value = { ...link, updatedAt: Date.now() };
    if (redis) await redis.set(videoSubscriptionKey(userId), value);
    else memoryVideoSubscriptions.set(userId, value);
  },

  async getVideoSubscription(userId: string): Promise<AccountSubscriptionLink | undefined> {
    if (redis) return (await redis.get<AccountSubscriptionLink>(videoSubscriptionKey(userId))) ?? undefined;
    return memoryVideoSubscriptions.get(userId);
  },
};
