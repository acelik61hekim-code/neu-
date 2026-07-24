// Geteilter Speicher über Upstash Redis (kostenlos), damit alle
// Vercel-Serverfunktionen denselben Job-Status sehen können.

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export type VideoJob = {
  status: "pending" | "processing" | "done" | "error";
  prompt: string;
  videoUrl?: string;
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
    // Läuft nach 24 Stunden automatisch ab, damit sich nichts aufstaut.
    await redis.set(keyFor(jobId), job, { ex: 60 * 60 * 24 });
  },
};
