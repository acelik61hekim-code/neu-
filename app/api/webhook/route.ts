import {
  NextRequest,
  NextResponse,
} from "next/server";

import { start } from "workflow/api";

import { renderVideoWorkflow } from "@/workflows/render-video";
import { renderSongWorkflow } from "@/workflows/render-song";
import { renderImageWorkflow } from "@/workflows/render-image";

import { stripe } from "../../../lib/stripe";
import { jobStore } from "../../../lib/store";
import { songStore } from "../../../lib/song-store";
import { imageStore } from "../../../lib/image-store";

import {
  buildVideoDurationPlan,
} from "../../../lib/veo";
import {
  normalizeVideoAudioStyle,
  normalizeVideoSpokenLanguage,
  normalizeVideoVoiceMode,
} from "../../../lib/audio-options";

import type {
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORTED_VIDEO_DURATIONS = [
  8,
  30,
  60,
  120,
  180,
  240,
  300,
] as const satisfies readonly VideoDurationSeconds[];

const SUPPORTED_ASPECT_RATIOS = [
  "9:16",
  "16:9",
] as const satisfies readonly VideoAspectRatio[];

const SUPPORTED_EDITING_STYLES = [
  "auto",
  "social",
  "cinematic",
  "music-video",
] as const satisfies readonly VideoEditingStyle[];

type CheckoutSessionLike = {
  id?: string;

  payment_status?: string;

  metadata?: Record<
    string,
    string
  > | null;
};

type PaidVideoConfig = {
  targetDurationSeconds:
    VideoDurationSeconds;

  aspectRatio:
    VideoAspectRatio;

  editingStyle:
    VideoEditingStyle;

  audioStyle:
    VideoAudioStyle;

  voiceMode:
    VideoVoiceMode;

  spokenLanguage:
    VideoSpokenLanguage;
};

function isVideoDurationSeconds(
  value: number,
): value is VideoDurationSeconds {
  return SUPPORTED_VIDEO_DURATIONS.includes(
    value as VideoDurationSeconds,
  );
}

function isVideoAspectRatio(
  value: string,
): value is VideoAspectRatio {
  return SUPPORTED_ASPECT_RATIOS.includes(
    value as VideoAspectRatio,
  );
}

function isVideoEditingStyle(
  value: string,
): value is VideoEditingStyle {
  return SUPPORTED_EDITING_STYLES.includes(
    value as VideoEditingStyle,
  );
}

function readPaidVideoConfig(
  metadata:
    Record<string, string> | null | undefined,
  legacyFormat:
    "short" | "long",
): PaidVideoConfig {
  const rawDuration =
    metadata?.targetDurationSeconds;

  let targetDurationSeconds:
    VideoDurationSeconds;

  if (
    rawDuration === undefined
  ) {
    /*
     * Rückwärtskompatibilität für Stripe-Sessions,
     * die vor der neuen Dauer-Auswahl erstellt wurden.
     */
    targetDurationSeconds =
      legacyFormat === "long"
        ? 60
        : 8;
  } else {
    const parsedDuration =
      Number(
        rawDuration,
      );

    if (
      !Number.isInteger(
        parsedDuration,
      ) ||
      !isVideoDurationSeconds(
        parsedDuration,
      )
    ) {
      throw new Error(
        `Ungültige bezahlte Videolänge in Stripe-Metadata: ${rawDuration}`,
      );
    }

    targetDurationSeconds =
      parsedDuration;
  }

  const rawAspectRatio =
    metadata?.aspectRatio;

  let aspectRatio:
    VideoAspectRatio =
    "9:16";

  if (
    rawAspectRatio !==
    undefined
  ) {
    if (
      !isVideoAspectRatio(
        rawAspectRatio,
      )
    ) {
      throw new Error(
        `Ungültiges bezahltes Bildformat in Stripe-Metadata: ${rawAspectRatio}`,
      );
    }

    aspectRatio =
      rawAspectRatio;
  }

  const rawEditingStyle =
    metadata?.editingStyle;

  let editingStyle:
    VideoEditingStyle =
    "social";

  if (
    rawEditingStyle !==
    undefined
  ) {
    if (
      !isVideoEditingStyle(
        rawEditingStyle,
      )
    ) {
      throw new Error(
        `Ungültiger bezahlter Schnittstil in Stripe-Metadata: ${rawEditingStyle}`,
      );
    }

    editingStyle =
      rawEditingStyle;
  }

  return {
    targetDurationSeconds,
    aspectRatio,
    editingStyle,
    audioStyle: normalizeVideoAudioStyle(metadata?.audioStyle),
    voiceMode: normalizeVideoVoiceMode(metadata?.voiceMode),
    spokenLanguage: normalizeVideoSpokenLanguage(metadata?.spokenLanguage),
  };
}

function countTotalExtensions(
  chapterTargets:
    VideoDurationSeconds[],
): number {
  return chapterTargets.reduce(
    (
      total,
      chapterDuration,
    ) => {
      if (
        chapterDuration <=
        8
      ) {
        return total;
      }

      return (
        total +
        Math.ceil(
          (
            chapterDuration -
            8
          ) / 7,
        )
      );
    },
    0,
  );
}

type WorkflowStartResult =
  | {
      status:
        "started";

      workflowRunId:
        string;
    }
  | {
      status:
        "starting";
    };

async function startQueuedRenderWorkflowOnce(
  jobId: string,
  claimId: string,
): Promise<WorkflowStartResult> {
  /*
   * Erst den persistenten Start-Marker prüfen.
   *
   * Dadurch verlassen wir uns NICHT allein auf workerId
   * im Job-JSON. Der separate Redis-Key schützt auch
   * parallele Stripe-Webhook-Zustellungen.
   */
  const existingState =
    await jobStore
      .getWorkflowStartState(
        jobId,
      );

  if (
    existingState?.status ===
    "started"
  ) {
    return {
      status:
        "started",

      workflowRunId:
        existingState
          .workflowRunId,
    };
  }

  if (
    existingState?.status ===
    "starting"
  ) {
    return {
      status:
        "starting",
    };
  }

  const claimed =
    await jobStore
      .claimWorkflowStart(
        jobId,
        claimId,
      );

  if (!claimed) {
    const stateAfterClaim =
      await jobStore
        .getWorkflowStartState(
          jobId,
        );

    if (
      stateAfterClaim?.status ===
      "started"
    ) {
      return {
        status:
          "started",

        workflowRunId:
          stateAfterClaim
            .workflowRunId,
      };
    }

    return {
      status:
        "starting",
    };
  }

  /*
   * Nur der Request, der den atomaren NX-Claim gewonnen
   * hat, darf start() ausführen.
   */
  const run =
    await start(
      renderVideoWorkflow,
      [
        jobId,
      ],
    );

  /*
   * ZUERST den separaten persistenten Start-Marker
   * bestätigen. Danach aktualisieren wir zusätzlich
   * das normale Job-JSON für Status/Diagnose.
   */
  await jobStore
    .confirmWorkflowStarted(
      jobId,
      run.runId,
    );

  await jobStore.update(
    jobId,
    (
      current,
    ) => ({
      ...current,

      workerId:
        run.runId,

      claimedAt:
        current.claimedAt ??
        Date.now(),
    }),
  );

  return {
    status:
      "started",

    workflowRunId:
      run.runId,
  };
}

function workflowStillStartingResponse(
  jobId: string,
) {
  /*
   * Absichtlich HTTP 500:
   *
   * Wenn ein anderer Webhook gerade den Start-Claim
   * besitzt, soll Stripe später erneut zustellen.
   *
   * Sobald der erste Request den Workflow erfolgreich
   * bestätigt hat, liefert der Retry anschließend 200.
   *
   * Falls der erste Request vor start() abstürzt, läuft
   * der kurze Claim nach einigen Minuten aus und ein
   * späterer Stripe-Retry kann übernehmen.
   */
  return NextResponse.json(
    {
      received:
        true,

      queued:
        true,

      jobId,

      workflowStarting:
        true,
    },
    {
      status:
        500,
    },
  );
}

async function handlePaidSongCheckout(
  jobId: string,
  sessionId: string,
  metadata: Record<string, string> | null | undefined,
) {
  const job = await songStore.get(jobId);
  if (!job) {
    console.error("Bezahlter Stripe-Song ohne passenden Auftrag:", { jobId, sessionId });
    return NextResponse.json({ received: true });
  }

  if (metadata?.songLength !== job.length || metadata?.lyricsMode !== job.lyricsMode) {
    await songStore.set(jobId, {
      ...job,
      status: "error",
      paymentStatus: "paid",
      stripeSessionId: sessionId,
      paidAt: Date.now(),
      renderStage: "failed",
      progressPercent: 0,
      errorMessage: "Die bezahlte Song-Konfiguration ist ungültig.",
    });
    return NextResponse.json({ received: true });
  }

  if (job.paymentStatus !== "paid") {
    await songStore.set(jobId, {
      ...job,
      status: "processing",
      paymentStatus: "paid",
      stripeSessionId: sessionId,
      paidAt: Date.now(),
      renderStage: "queued",
      progressPercent: 5,
      errorMessage: undefined,
    });
  }

  try {
    const existing = await songStore.getWorkflowStartState(jobId);
    if (existing?.status === "started") {
      return NextResponse.json({ received: true, queued: true, jobId, workflowRunId: existing.workflowRunId });
    }
    if (existing?.status === "starting") {
      return NextResponse.json({ received: true, queued: true, jobId, workflowStarting: true }, { status: 500 });
    }

    const claimed = await songStore.claimWorkflowStart(jobId, sessionId);
    if (!claimed) {
      return NextResponse.json({ received: true, queued: true, jobId, workflowStarting: true }, { status: 500 });
    }

    const run = await start(renderSongWorkflow, [jobId]);
    await songStore.confirmWorkflowStarted(jobId, run.runId);
    await songStore.update(jobId, (current) => ({ ...current, workflowRunId: run.runId }));
    return NextResponse.json({ received: true, queued: true, jobId, workflowRunId: run.runId });
  } catch (error) {
    console.error("Song-Workflow konnte nicht gestartet werden:", { jobId, error });
    return NextResponse.json({ error: "Song-Workflow konnte nicht gestartet werden." }, { status: 500 });
  }
}

async function handlePaidImageCheckout(jobId: string, sessionId: string, metadata: Record<string, string> | null | undefined) {
  const job = await imageStore.get(jobId);
  if (!job) { console.error("Bezahltes Stripe-Bild ohne passenden Auftrag:", { jobId, sessionId }); return NextResponse.json({ received: true }); }
  if (metadata?.quality !== job.quality || metadata?.aspectRatio !== job.aspectRatio || metadata?.style !== job.style) {
    await imageStore.set(jobId, { ...job, status: "error", paymentStatus: "paid", stripeSessionId: sessionId, paidAt: Date.now(), renderStage: "failed", progressPercent: 0, errorMessage: "Die bezahlte Bild-Konfiguration ist ungültig." });
    return NextResponse.json({ received: true });
  }
  if (job.paymentStatus !== "paid") await imageStore.set(jobId, { ...job, status: "processing", paymentStatus: "paid", stripeSessionId: sessionId, paidAt: Date.now(), renderStage: "queued", progressPercent: 5, errorMessage: undefined });
  try {
    const existing = await imageStore.getWorkflowStartState(jobId);
    if (existing?.status === "started") return NextResponse.json({ received: true, queued: true, jobId, workflowRunId: existing.workflowRunId });
    if (existing?.status === "starting") return NextResponse.json({ received: true, queued: true, jobId, workflowStarting: true }, { status: 500 });
    const claimed = await imageStore.claimWorkflowStart(jobId, sessionId);
    if (!claimed) return NextResponse.json({ received: true, queued: true, jobId, workflowStarting: true }, { status: 500 });
    const run = await start(renderImageWorkflow, [jobId]);
    await imageStore.confirmWorkflowStarted(jobId, run.runId);
    await imageStore.update(jobId, (current) => ({ ...current, workflowRunId: run.runId }));
    return NextResponse.json({ received: true, queued: true, jobId, workflowRunId: run.runId });
  } catch (error) {
    console.error("Bild-Workflow konnte nicht gestartet werden:", { jobId, error });
    return NextResponse.json({ error: "Bild-Workflow konnte nicht gestartet werden." }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
) {
  const body =
    await req.text();

  const signature =
    req.headers.get(
      "stripe-signature",
    );

  const webhookSecret =
    process.env
      .STRIPE_WEBHOOK_SECRET;

  if (
    !signature ||
    !webhookSecret
  ) {
    return NextResponse.json(
      {
        error:
          "Webhook nicht konfiguriert",
      },
      {
        status: 400,
      },
    );
  }

  let event;

  try {
    /*
     * Die Stripe-Signaturprüfung ist die Vertrauensgrenze.
     * Erst danach werden Session und Metadata ausgewertet.
     */
    event =
      stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret,
      );
  } catch (
    error
  ) {
    console.error(
      "Webhook-Signatur ungültig:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Ungültige Signatur",
      },
      {
        status: 400,
      },
    );
  }

  if (
    event.type !==
    "checkout.session.completed"
  ) {
    return NextResponse.json({
      received:
        true,
    });
  }

  const session =
    event.data.object as
      CheckoutSessionLike;

  /*
   * Kein kostenpflichtiger Render-Auftrag,
   * solange Stripe nicht eindeutig "paid" meldet.
   */
  if (
    session.payment_status !==
    "paid"
  ) {
    console.warn(
      "Checkout abgeschlossen, aber nicht als bezahlt markiert:",
      {
        sessionId:
          session.id,

        paymentStatus:
          session.payment_status,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  const sessionId =
    typeof session.id ===
      "string"
      ? session.id.trim()
      : "";

  if (!sessionId) {
    console.error(
      "Bezahlte Stripe-Session ohne gültige Session-ID.",
    );

    return NextResponse.json(
      {
        error:
          "Stripe-Session-ID fehlt.",
      },
      {
        status:
          500,
      },
    );
  }

  const jobId =
    session.metadata?.jobId;

  if (!jobId) {
    console.error(
      "Bezahlte Stripe-Session ohne jobId-Metadata:",
      {
        sessionId:
          sessionId,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  if (session.metadata?.productType === "song") {
    return handlePaidSongCheckout(jobId, sessionId, session.metadata);
  }

  if (session.metadata?.productType === "image") {
    return handlePaidImageCheckout(jobId, sessionId, session.metadata);
  }

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    console.error(
      "Bezahlter Stripe-Auftrag ohne passenden Job:",
      {
        jobId,

        sessionId:
          sessionId,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  /*
   * Stripe-Webhooks können mehrfach oder sogar nahezu
   * gleichzeitig zugestellt werden.
   *
   * Der normale VideoJob allein reicht dafür nicht als
   * Lock. Deshalb prüfen/starten wir über den separaten
   * atomaren Workflow-Start-Marker im jobStore.
   */
  if (
    job.paymentStatus ===
    "paid"
  ) {
    try {
      const workflowStart =
        await startQueuedRenderWorkflowOnce(
          jobId,
          sessionId,
        );

      if (
        workflowStart.status ===
        "starting"
      ) {
        console.warn(
          "Workflow-Start ist bereits von einem parallelen Webhook geclaimt:",
          {
            jobId,
            sessionId:
              sessionId,
          },
        );

        return workflowStillStartingResponse(
          jobId,
        );
      }

      console.log(
        "Bereits bezahlter Auftrag besitzt einen Workflow-Start:",
        {
          jobId,

          sessionId:
            sessionId,

          workflowRunId:
            workflowStart
              .workflowRunId,
        },
      );

      return NextResponse.json({
        received:
          true,

        queued:
          true,

        jobId,

        workflowRunId:
          workflowStart
            .workflowRunId,
      });
    } catch (
      workflowStartError
    ) {
      console.error(
        "Workflow-Start für bereits bezahlten Auftrag fehlgeschlagen:",
        {
          jobId,
          workflowStartError,
        },
      );

      return NextResponse.json(
        {
          error:
            "Render-Workflow konnte nicht gestartet werden.",
        },
        {
          status:
            500,
        },
      );
    }
  }

  let config:
    PaidVideoConfig;

  try {
    config =
      readPaidVideoConfig(
        session.metadata,
        job.format,
      );
  } catch (
    metadataError
  ) {
    const message =
      metadataError instanceof
        Error
        ? metadataError.message
        : "Ungültige Stripe-Metadata.";

    console.error(
      "Bezahlte Video-Konfiguration ungültig:",
      {
        jobId,

        sessionId:
          sessionId,

        message,
      },
    );

    /*
     * Zahlung ist real erfolgt, auch wenn die interne
     * Video-Konfiguration beschädigt ist. Das speichern
     * wir bewusst korrekt für Support/Refund-Behandlung.
     */
    await jobStore.set(
      jobId,
      {
        ...job,

        paymentStatus:
          "paid",

        stripeSessionId:
          sessionId,

        paidAt:
          Date.now(),

        status:
          "error",

        renderStage:
          "failed",

        progressPercent:
          0,

        errorMessage:
          "Die bezahlte Video-Konfiguration ist ungültig.",
      },
    );

    /*
     * 200 zurückgeben:
     * Ein dauerhaft ungültiger Event soll von Stripe
     * nicht endlos erneut zugestellt werden.
     */
    return NextResponse.json({
      received:
        true,
    });
  }

  const durationPlan =
    buildVideoDurationPlan(
      config.targetDurationSeconds,
    );

  const totalExtensions =
    countTotalExtensions(
      durationPlan.chapterTargets,
    );

  const now =
    Date.now();

  /*
   * =========================================================
   * WICHTIGER ARCHITEKTURWECHSEL
   * =========================================================
   *
   * Der Webhook startet KEIN Veo mehr.
   * Kein waitUntil.
   * Keine Polling-Schleife.
   * Keine Langvideo-Generierung innerhalb des Webhooks.
   *
   * Er macht nur:
   *
   * 1. Zahlung verifizieren
   * 2. bezahlte Konfiguration validieren
   * 3. vollständigen Render-Auftrag persistent speichern
   * 4. renderStage = "queued"
   *
   * Der Render-Worker übernimmt danach den Job.
   */
  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      format:
        config
          .targetDurationSeconds ===
        8
          ? "short"
          : "long",

      targetDurationSeconds:
        config
          .targetDurationSeconds,

      aspectRatio:
        config
          .aspectRatio,

      editingStyle:
        config
          .editingStyle,

      audioStyle:
        config
          .audioStyle,

      voiceMode:
        config
          .voiceMode,

      spokenLanguage:
        config
          .spokenLanguage,

      provider:
        "auto",

      generationStrategy:
        durationPlan
          .generationStrategy,

      paymentStatus:
        "paid",

      stripeSessionId:
        sessionId,

      paidAt:
        now,

      renderStage:
        "queued",

      progressPercent:
        0,

      currentChapter:
        0,

      totalChapters:
        durationPlan
          .chapterTargets
          .length,

      currentExtension:
        0,

      totalExtensions,

      retryCount:
        0,

      maxRetries:
        3,

      nextAttemptAt:
        now,

      workerId:
        undefined,

      claimedAt:
        undefined,

      leaseExpiresAt:
        undefined,

      startedAt:
        undefined,

      completedAt:
        undefined,

      errorMessage:
        undefined,
    },
  );

  console.log(
    "Bezahlter Videoauftrag dauerhaft in Render-Queue gespeichert:",
    {
      jobId,

      sessionId:
        sessionId,

      targetDurationSeconds:
        config
          .targetDurationSeconds,

      aspectRatio:
        config
          .aspectRatio,

      editingStyle:
        config
          .editingStyle,

      generationStrategy:
        durationPlan
          .generationStrategy,

      totalChapters:
        durationPlan
          .chapterTargets
          .length,

      totalExtensions,
    },
  );

  /*
   * Nach erfolgreicher Zahlungs-Persistenz darf nur der
   * Gewinner des atomaren Workflow-Start-Claims den
   * durable Workflow starten.
   *
   * Der Workflow enthält zu diesem Zeitpunkt weiterhin
   * noch keinen kostenpflichtigen Veo-Start-Step.
   */
  try {
    const workflowStart =
      await startQueuedRenderWorkflowOnce(
        jobId,
        sessionId,
      );

    if (
      workflowStart.status ===
      "starting"
    ) {
      console.warn(
        "Workflow-Start wurde parallel bereits geclaimt:",
        {
          jobId,
          sessionId:
            sessionId,
        },
      );

      return workflowStillStartingResponse(
        jobId,
      );
    }

    console.log(
      "Durable Render-Workflow atomar gestartet/bestätigt:",
      {
        jobId,

        workflowRunId:
          workflowStart
            .workflowRunId,
      },
    );

    return NextResponse.json({
      received:
        true,

      queued:
        true,

      jobId,

      workflowRunId:
        workflowStart
          .workflowRunId,
    });
  } catch (
    workflowStartError
  ) {
    console.error(
      "Durable Render-Workflow konnte nicht gestartet werden:",
      {
        jobId,
        workflowStartError,
      },
    );

    /*
     * HTTP 500 ist hier gewollt.
     *
     * Stripe darf erneut zustellen. Ein bestehender
     * "starting"-Claim verhindert während seiner kurzen
     * TTL einen parallelen Doppelstart. Nach erfolgreicher
     * Bestätigung wird er zu "started".
     */
    return NextResponse.json(
      {
        error:
          "Render-Workflow konnte nicht gestartet werden.",
      },
      {
        status:
          500,
      },
    );
  }
}
