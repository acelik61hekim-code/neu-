import { Redis } from "@upstash/redis";

import type {
  SongLanguage,
  SongLength,
  SongLyricsMode,
  SongVocalStyle,
} from "@/lib/song";

export type SongJobStatus = "pending" | "processing" | "done" | "error";
export type SongPaymentStatus = "unpaid" | "paid" | "failed" | "refunded";
export type SongRenderStage = "queued" | "generating" | "uploading" | "completed" | "failed";

export type SongJob = {
  status: SongJobStatus;
  paymentStatus: SongPaymentStatus;
  renderStage: SongRenderStage;
  progressPercent: number;
  title?: string;
  description: string;
  style: string;
  mood: string;
  length: SongLength;
  lyricsMode: SongLyricsMode;
  lyrics?: string;
  language: SongLanguage;
  vocalStyle: SongVocalStyle;
  voiceIdeaAnalysis?: string;
  audioUri?: string;
  audioMimeType?: string;
  generatedLyrics?: string;
  stripeSessionId?: string;
  workflowRunId?: string;
  paidAt?: number;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};

type WorkflowState =
  | { status: "starting"; claimId: string }
  | { status: "started"; workflowRunId: string };

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

const JOB_TTL_SECONDS = 60 * 60 * 24 * 7;
const memoryJobs = new Map<string, SongJob>();
const memoryWorkflowStates = new Map<string, { value: string; expiresAt: number }>();

const jobKey = (jobId: string) => `song-job:${jobId}`;
const workflowKey = (jobId: string) => `song-job:${jobId}:workflow-start`;

function parseWorkflowState(value?: string | null): WorkflowState | undefined {
  if (!value) return undefined;
  if (value.startsWith("started:")) {
    return { status: "started", workflowRunId: value.slice("started:".length) };
  }
  if (value.startsWith("starting:")) {
    return { status: "starting", claimId: value.slice("starting:".length) };
  }
  return undefined;
}

export const songStore = {
  async get(jobId: string): Promise<SongJob | undefined> {
    if (redis) return (await redis.get<SongJob>(jobKey(jobId))) ?? undefined;
    return memoryJobs.get(jobId);
  },

  async set(jobId: string, job: SongJob): Promise<void> {
    const stored = { ...job, updatedAt: Date.now() };
    if (redis) {
      await redis.set(jobKey(jobId), stored, { ex: JOB_TTL_SECONDS });
      return;
    }
    memoryJobs.set(jobId, stored);
  },

  async update(jobId: string, updater: (job: SongJob) => SongJob | Promise<SongJob>): Promise<SongJob> {
    const current = await this.get(jobId);
    if (!current) throw new Error(`Songauftrag ${jobId} wurde nicht gefunden.`);
    const updated = { ...(await updater(current)), updatedAt: Date.now() };
    await this.set(jobId, updated);
    return updated;
  },

  async claimWorkflowStart(jobId: string, claimId: string, ttlSeconds = 5 * 60): Promise<boolean> {
    const value = `starting:${claimId.trim()}`;
    if (!claimId.trim()) throw new Error("claimId fehlt.");
    if (redis) {
      return await redis.set(workflowKey(jobId), value, { nx: true, ex: ttlSeconds }) === "OK";
    }
    const existing = memoryWorkflowStates.get(jobId);
    if (existing && existing.expiresAt > Date.now()) return false;
    memoryWorkflowStates.set(jobId, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  },

  async confirmWorkflowStarted(jobId: string, workflowRunId: string): Promise<void> {
    const value = `started:${workflowRunId.trim()}`;
    if (redis) {
      await redis.set(workflowKey(jobId), value, { ex: JOB_TTL_SECONDS });
      return;
    }
    memoryWorkflowStates.set(jobId, { value, expiresAt: Date.now() + JOB_TTL_SECONDS * 1000 });
  },

  async getWorkflowStartState(jobId: string): Promise<WorkflowState | undefined> {
    if (redis) return parseWorkflowState(await redis.get<string>(workflowKey(jobId)));
    const stored = memoryWorkflowStates.get(jobId);
    if (!stored || stored.expiresAt <= Date.now()) {
      memoryWorkflowStates.delete(jobId);
      return undefined;
    }
    return parseWorkflowState(stored.value);
  },
};
