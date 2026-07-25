import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export type VideoFormat = "short" | "long";

export type VideoJob = {
  status: "pending" | "processing" | "done" | "error";
  prompt: string;
  format: VideoFormat;
  videoUrl?: string;
  videoUrls?: string[];
  totalScenes?: number;
  completedScenes?: number;
  errorMessage?: string;
  createdAt: number;
};

const keyFor = (jobId: string) => `job:${jobId}`;

export const jobStore = {
  async get(jobId: string): Promise<VideoJob | undefined> {
    const data = await redis.get<VideoJob>(keyFor(jobId));
    return data ?? undefined;
  },
  async set(jobId: string, job: VideoJob): Promise<void> {
    await redis.set(keyFor(jobId), job, { ex: 60 * 60 * 24 });
  },
};
