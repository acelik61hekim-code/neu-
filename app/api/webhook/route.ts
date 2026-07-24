import { NextRequest, NextResponse } from "next/server";
import { stripe } from "../../../lib/stripe";
import { jobStore } from "../../../lib/store";
import { startVideoGeneration, checkVideoStatus } from "../../../lib/veo";

export const runtime = "nodejs";

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

      generateVideoInBackground(jobId, job.prompt).catch(async (err) => {
        console.error("Fehler bei der Videoerstellung:", err);
        const failedJob = await jobStore.get(jobId);
        if (failedJob) {
          failedJob.status = "error";
          failedJob.errorMessage = "Videoerstellung fehlgeschlagen.";
          await jobStore.set(jobId, failedJob);
        }
      });
    }
  }

  return NextResponse.json({ received: true });
}

async function generateVideoInBackground(jobId: string, prompt: string) {
  const operationName = await startVideoGeneration(prompt);

  for (let attempt = 0; attempt < 36; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const status = await checkVideoStatus(operationName);

    if (status.done) {
      const job = await jobStore.get(jobId);
      if (job) {
        job.status = "done";
        job.videoUrl = status.videoUrl;
        await jobStore.set(jobId, job);
      }
      return;
    }
  }

  throw new Error("Zeitüberschreitung bei der Videoerstellung.");
}
