import { Redis } from "@upstash/redis";

import type { ImageAspectRatio, ImageQuality, ImageStyle } from "@/lib/image-product";

export type ImageJob = {
  status: "pending" | "processing" | "done" | "error";
  paymentStatus: "unpaid" | "paid" | "failed" | "refunded";
  renderStage: "queued" | "generating" | "uploading" | "completed" | "failed";
  progressPercent: number;
  prompt: string;
  title?: string;
  style: ImageStyle;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality;
  textInImage?: string;
  colorMood?: string;
  negativePrompt?: string;
  imageUri?: string;
  imageMimeType?: string;
  stripeSessionId?: string;
  workflowRunId?: string;
  paidAt?: number;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};

type WorkflowState = { status: "starting"; claimId: string } | { status: "started"; workflowRunId: string };
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;
const memoryJobs = new Map<string, ImageJob>();
const memoryStarts = new Map<string, { value: string; expiresAt: number }>();
const TTL = 60 * 60 * 24 * 7;
const jobKey = (id: string) => `image-job:${id}`;
const startKey = (id: string) => `image-job:${id}:workflow-start`;

function parseStart(value?: string | null): WorkflowState | undefined {
  if (value?.startsWith("started:")) return { status: "started", workflowRunId: value.slice(8) };
  if (value?.startsWith("starting:")) return { status: "starting", claimId: value.slice(9) };
  return undefined;
}

export const imageStore = {
  async get(id: string): Promise<ImageJob | undefined> {
    if (redis) return (await redis.get<ImageJob>(jobKey(id))) ?? undefined;
    return memoryJobs.get(id);
  },
  async set(id: string, job: ImageJob): Promise<void> {
    const stored = { ...job, updatedAt: Date.now() };
    if (redis) await redis.set(jobKey(id), stored, { ex: TTL });
    else memoryJobs.set(id, stored);
  },
  async update(id: string, updater: (job: ImageJob) => ImageJob | Promise<ImageJob>): Promise<ImageJob> {
    const current = await this.get(id);
    if (!current) throw new Error(`Bildauftrag ${id} wurde nicht gefunden.`);
    const updated = { ...(await updater(current)), updatedAt: Date.now() };
    await this.set(id, updated);
    return updated;
  },
  async claimWorkflowStart(id: string, claimId: string, ttl = 300): Promise<boolean> {
    const value = `starting:${claimId.trim()}`;
    if (!claimId.trim()) throw new Error("claimId fehlt.");
    if (redis) return await redis.set(startKey(id), value, { nx: true, ex: ttl }) === "OK";
    const existing = memoryStarts.get(id);
    if (existing && existing.expiresAt > Date.now()) return false;
    memoryStarts.set(id, { value, expiresAt: Date.now() + ttl * 1000 });
    return true;
  },
  async confirmWorkflowStarted(id: string, runId: string): Promise<void> {
    const value = `started:${runId.trim()}`;
    if (redis) await redis.set(startKey(id), value, { ex: TTL });
    else memoryStarts.set(id, { value, expiresAt: Date.now() + TTL * 1000 });
  },
  async getWorkflowStartState(id: string): Promise<WorkflowState | undefined> {
    if (redis) return parseStart(await redis.get<string>(startKey(id)));
    const state = memoryStarts.get(id);
    if (!state || state.expiresAt <= Date.now()) { memoryStarts.delete(id); return undefined; }
    return parseStart(state.value);
  },
};
