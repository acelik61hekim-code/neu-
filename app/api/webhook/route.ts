import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { stripe } from "../../../lib/stripe";
import { jobStore } from "../../../lib/store";
import { startVideoGeneration, checkVideoStatus, splitIntoScenes } from "../../../lib/veo";
import { LONG_FORMAT_SCENE_COUNT } from "../../../lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook nicht konfiguriert" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook-Signatur ungültig:", err);
    return NextResponse.json({ error: "Ungültige Signatur" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    const jobId = session.metadata?.jobId;
    const job = jobId ? await jobStore.get(jobId) : undefined;

    if (job) {
      job.status = "processing";
      await jobStore.set(jobId, job);

      const task =
        job.format === "long"
          ? generateLongVideoInBackground(jobId, job.prompt)
          : generateShortVideoInBackground(jobId, job.prompt);

      waitUntil(
        task.catch(async (err) => {
          console.error("Fehler bei der Videoerstellung:", err);
          const failedJob = await jobStore.get(jobId);
          if (failedJob) {
            failedJob.status = "error";
            failedJob.errorMessage = "Videoerstellung fehlgeschlagen.";
            await jobStore.set(jobId, failedJob);
          }
        })
      );
    }
  }

  return NextResponse.json({ received: true });
}

async function waitForClip(operationName: string): Promise<string> {
  for (let attempt = 0; attempt < 36; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const status = await checkVideoStatus(operationName);
    if (status.done && status.videoUrl) {
      return status.videoUrl;
    }
  }
  throw new Error("Zeitüberschreitung bei der Videoerstellung.");
}

async function generateShortVideoInBackground(jobId: string, prompt: string) {
  const operationName = await startVideoGeneration(prompt);
  const videoUrl = await waitForClip(operationName);
  const job = await jobStore.get(jobId);
  if (job) {
    job.status = "done";
    job.videoUrl = videoUrl;
    await jobStore.set(jobId, job);
  }
}

// Führt eine Liste von Aufgaben mit begrenzter Gleichzeitigkeit aus (statt alle auf einmal).
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}

async function generateLongVideoInBackground(jobId: string, prompt: string) {
  const scenes = await splitIntoScenes(prompt, LONG_FORMAT_SCENE_COUNT);
  const initJob = await jobStore.get(jobId);
  if (initJob) {
    initJob.totalScenes = scenes.length;
    initJob.completedScenes = 0;
    await jobStore.set(jobId, initJob);
  }

  let completedCount = 0;

  const videoUrls = await runWithConcurrencyLimit(scenes, 1, async (scenePrompt) => {
  const operationName = await startVideoGeneration(scenePrompt);

  const videoUrl = await waitForClip(operationName);

  // 30 Sekunden warten, bevor die nächste Szene gestartet wird
  await new Promise((resolve) => setTimeout(resolve, 30000));

  completedCount++;

  const progressJob = await jobStore.get(jobId);
  if (progressJob) {
    progressJob.completedScenes = completedCount;
    await jobStore.set(jobId, progressJob);
  }

  return videoUrl;
});
