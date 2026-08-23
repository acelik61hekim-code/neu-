import { Redis } from "@upstash/redis";

export type SongEditJob = {
  status: "processing" | "done" | "error";
  sourceJobId: string;
  subscriptionId: string;
  accessTokenHash: string;
  startSeconds: number;
  endSeconds: number;
  instruction: string;
  providerTaskId: string;
  providerTraceId?: string;
  providerSongId?: string;
  audioUri?: string;
  audioMimeType?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const memory = new Map<string, SongEditJob>();
const key = (editId: string) => `song-edit:${editId}`;
const TTL_SECONDS = 60 * 60 * 24 * 90;

export const songEditStore = {
  async get(editId: string): Promise<SongEditJob | undefined> {
    if (redis) return (await redis.get<SongEditJob>(key(editId))) ?? undefined;
    return memory.get(editId);
  },
  async set(editId: string, job: SongEditJob): Promise<void> {
    const value = { ...job, updatedAt: Date.now() };
    if (redis) await redis.set(key(editId), value, { ex: TTL_SECONDS });
    else memory.set(editId, value);
  },
};
