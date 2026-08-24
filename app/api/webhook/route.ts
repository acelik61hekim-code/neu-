import {
  NextRequest,
  NextResponse,
} from "next/server";

import { start } from "workflow/api";

import {
  renderVideoWorkflow,
} from "@/workflows/render-video";

import {
  renderSongWorkflow,
} from "@/workflows/render-song";

import {
  renderImageWorkflow,
} from "@/workflows/render-image";

import {
  stripe,
} from "../../../lib/stripe";

import {
  jobStore,
} from "../../../lib/store";

import {
  songStore,
} from "../../../lib/song-store";

import {
  imageStore,
} from "../../../lib/image-store";

import {
  accountLibrary,
} from "../../../lib/account-library";

import {
  buildVideoDurationPlan,
} from "../../../lib/veo";

import {
  normalizeVideoAudioStyle,
  normalizeVideoSpokenLanguage,
  normalizeVideoVoiceMode,
} from "../../../lib/audio-options";

import {
  isVideoModelId,
} from "@/types/story";

import type {
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoModelId,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;

/*
 * 8 Sekunden bleiben ausschließlich für bereits
 * existierende alte Stripe-Sessions erhalten.
 *
 * Neue Checkout-Sessions starten bei 15 Sekunden.
 */
const SUPPORTED_VIDEO_DURATIONS = [
  8,
  15,
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

  customer?: string | { id?: string } | null;

  subscription?: string | { id?: string } | null;
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

  videoModel:
    VideoModelId;
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

/*
 * Liest ausschließlich die bezahlte
 * Konfiguration aus Stripe.
 *
 * Wenn bei einer sehr alten Stripe-Session
 * targetDurationSeconds noch fehlt:
 *
 * short -> 8 Sekunden Legacy
 * long  -> 60 Sekunden Legacy
 *
 * Neue Stripe-Sessions enthalten die Dauer
 * immer explizit und beginnen bei 15 Sekunden.
 */
function readPaidVideoConfig(
  metadata:
    Record<
      string,
      string
    > |
    null |
    undefined,

  legacyFormat:
    "short" | "long",
): PaidVideoConfig {
  const rawDuration =
    metadata
      ?.targetDurationSeconds;

  let targetDurationSeconds:
    VideoDurationSeconds;

  if (
    rawDuration ===
    undefined
  ) {
    targetDurationSeconds =
      legacyFormat ===
      "long"
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
    metadata
      ?.aspectRatio;

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
    metadata
      ?.editingStyle;

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

    audioStyle:
      normalizeVideoAudioStyle(
        metadata
          ?.audioStyle,
      ),

    voiceMode:
      normalizeVideoVoiceMode(
        metadata
          ?.voiceMode,
      ),

    spokenLanguage:
      normalizeVideoSpokenLanguage(
        metadata
          ?.spokenLanguage,
      ),

    videoModel:
      metadata?.videoModel === undefined
        ? "seedance-2-fast"
        : isVideoModelId(metadata.videoModel)
          ? metadata.videoModel
          : (() => {
              throw new Error(
                `Ungültiges bezahltes Videomodell in Stripe-Metadata: ${metadata.videoModel}`,
              );
            })(),
  };
}

/*
 * Seedance 15-Sekunden-Architektur:
 *
 * 8 s   -> 0 Extensions (Legacy)
 * 15 s  -> 0 Extensions
 * 30 s  -> 1 Extension
 * 60 s  -> 3 Extensions
 * 120 s -> 7 Extensions
 *
 * Bei späteren Langvideos werden die
 * Extensions pro Kapitel addiert.
 */
function countTotalExtensions(
  chapterTargets:
    VideoDurationSeconds[],
  videoModel: VideoModelId,
): number {
  return chapterTargets.reduce(
    (
      total,
      chapterDuration,
    ) => {
      return (
        total +
        (videoModel === "google-veo"
          ? Math.max(0, Math.ceil((chapterDuration - 8) / 7))
          : Math.max(0, Math.ceil((chapterDuration - 15) / 15)))
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
   * Dadurch verlassen wir uns NICHT allein
   * auf workerId im Job-JSON.
   *
   * Der separate Redis-Key schützt auch
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

  if (
    !claimed
  ) {
    const stateAfterClaim =
      await jobStore
        .getWorkflowStartState(
          jobId,
        );

    if (
      stateAfterClaim
        ?.status ===
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
   * Nur der Request, der den atomaren
   * NX-Claim gewonnen hat, darf den
   * Render-Workflow starten.
   */
  const run =
    await start(
      renderVideoWorkflow,
      [
        jobId,
      ],
    );

  /*
   * Zuerst den separaten persistenten
   * Start-Marker bestätigen.
   */
  await jobStore
    .confirmWorkflowStarted(
      jobId,
      run.runId,
    );

  /*
   * Danach normales Job-JSON für
   * Status und Diagnose aktualisieren.
   */
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
   * Wenn ein paralleler Webhook bereits
   * den Start-Claim besitzt, soll Stripe
   * später erneut zustellen.
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

/*
 * =========================================================
 * SONG CHECKOUT
 * =========================================================
 *
 * Unverändert gegenüber deiner bestehenden
 * Song-Pipeline.
 */
async function handlePaidSongCheckout(
  jobId: string,
  sessionId: string,

  metadata:
    Record<
      string,
      string
    > |
    null |
    undefined,
) {
  const job =
    await songStore.get(
      jobId,
    );

  if (
    !job
  ) {
    console.error(
      "Bezahlter Stripe-Song ohne passenden Auftrag:",
      {
        jobId,
        sessionId,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  if (
    metadata?.songLength !==
      job.length ||
    metadata?.lyricsMode !==
      job.lyricsMode
  ) {
    await songStore.set(
      jobId,
      {
        ...job,

        status:
          "error",

        paymentStatus:
          "paid",

        stripeSessionId:
          sessionId,

        paidAt:
          Date.now(),

        renderStage:
          "failed",

        progressPercent:
          0,

        errorMessage:
          "Die bezahlte Song-Konfiguration ist ungültig.",
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  if (
    job.paymentStatus !==
    "paid"
  ) {
    await songStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        paymentStatus:
          "paid",

        stripeSessionId:
          sessionId,

        paidAt:
          Date.now(),

        renderStage:
          "queued",

        progressPercent:
          5,

        errorMessage:
          undefined,
      },
    );
  }

  try {
    const existing =
      await songStore
        .getWorkflowStartState(
          jobId,
        );

    if (
      existing?.status ===
      "started"
    ) {
      return NextResponse.json({
        received:
          true,

        queued:
          true,

        jobId,

        workflowRunId:
          existing
            .workflowRunId,
      });
    }

    if (
      existing?.status ===
      "starting"
    ) {
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

    const claimed =
      await songStore
        .claimWorkflowStart(
          jobId,
          sessionId,
        );

    if (
      !claimed
    ) {
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

    const run =
      await start(
        renderSongWorkflow,
        [
          jobId,
        ],
      );

    await songStore
      .confirmWorkflowStarted(
        jobId,
        run.runId,
      );

    await songStore.update(
      jobId,

      (
        current,
      ) => ({
        ...current,

        workflowRunId:
          run.runId,
      }),
    );

    return NextResponse.json({
      received:
        true,

      queued:
        true,

      jobId,

      workflowRunId:
        run.runId,
    });
  } catch (
    error
  ) {
    console.error(
      "Song-Workflow konnte nicht gestartet werden:",
      {
        jobId,
        error,
      },
    );

    return NextResponse.json(
      {
        error:
          "Song-Workflow konnte nicht gestartet werden.",
      },
      {
        status:
          500,
      },
    );
  }
}

/*
 * =========================================================
 * IMAGE CHECKOUT
 * =========================================================
 *
 * Ebenfalls unverändert gegenüber der
 * bestehenden Bilder-Pipeline.
 */
async function handlePaidImageCheckout(
  jobId: string,
  sessionId: string,

  metadata:
    Record<
      string,
      string
    > |
    null |
    undefined,
) {
  const job =
    await imageStore.get(
      jobId,
    );

  if (
    !job
  ) {
    console.error(
      "Bezahltes Stripe-Bild ohne passenden Auftrag:",
      {
        jobId,
        sessionId,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  if (
    metadata?.quality !==
      job.quality ||
    metadata?.aspectRatio !==
      job.aspectRatio ||
    metadata?.style !==
      job.style
  ) {
    await imageStore.set(
      jobId,
      {
        ...job,

        status:
          "error",

        paymentStatus:
          "paid",

        stripeSessionId:
          sessionId,

        paidAt:
          Date.now(),

        renderStage:
          "failed",

        progressPercent:
          0,

        errorMessage:
          "Die bezahlte Bild-Konfiguration ist ungültig.",
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  if (
    job.paymentStatus !==
    "paid"
  ) {
    await imageStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        paymentStatus:
          "paid",

        stripeSessionId:
          sessionId,

        paidAt:
          Date.now(),

        renderStage:
          "queued",

        progressPercent:
          5,

        errorMessage:
          undefined,
      },
    );
  }

  try {
    const existing =
      await imageStore
        .getWorkflowStartState(
          jobId,
        );

    if (
      existing?.status ===
      "started"
    ) {
      return NextResponse.json({
        received:
          true,

        queued:
          true,

        jobId,

        workflowRunId:
          existing
            .workflowRunId,
      });
    }

    if (
      existing?.status ===
      "starting"
    ) {
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

    const claimed =
      await imageStore
        .claimWorkflowStart(
          jobId,
          sessionId,
        );

    if (
      !claimed
    ) {
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

    const run =
      await start(
        renderImageWorkflow,
        [
          jobId,
        ],
      );

    await imageStore
      .confirmWorkflowStarted(
        jobId,
        run.runId,
      );

    await imageStore.update(
      jobId,

      (
        current,
      ) => ({
        ...current,

        workflowRunId:
          run.runId,
      }),
    );

    return NextResponse.json({
      received:
        true,

      queued:
        true,

      jobId,

      workflowRunId:
        run.runId,
    });
  } catch (
    error
  ) {
    console.error(
      "Bild-Workflow konnte nicht gestartet werden:",
      {
        jobId,
        error,
      },
    );

    return NextResponse.json(
      {
        error:
          "Bild-Workflow konnte nicht gestartet werden.",
      },
      {
        status:
          500,
      },
    );
  }
}

/*
 * =========================================================
 * STRIPE WEBHOOK
 * =========================================================
 */
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
        status:
          400,
      },
    );
  }

  let event;

  try {
    /*
     * Stripe-Signaturprüfung ist die
     * Vertrauensgrenze.
     */
    event =
      stripe.webhooks
        .constructEvent(
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
        status:
          400,
      },
    );
  }

  const isSuccessfulCheckoutEvent =
    event.type ===
      "checkout.session.completed" ||
    event.type ===
      "checkout.session.async_payment_succeeded";

  if (
    !isSuccessfulCheckoutEvent
  ) {
    return NextResponse.json({
      received:
        true,
    });
  }

  const session =
    event.data
      .object as CheckoutSessionLike;

  /*
   * Kein kostenpflichtiger Render-Auftrag,
   * solange Stripe nicht eindeutig paid meldet.
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

  if (
    !sessionId
  ) {
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

  /*
   * Song-Abos erzeugen keinen einzelnen Renderauftrag.
   * Die sichere Abo-Freischaltung prüft die Checkout-Session
   * direkt bei Stripe und setzt anschließend die Studiositzung.
   */
  if (
    session.metadata
      ?.productType ===
    "song-subscription"
  ) {
    const userId =
      session.metadata
        ?.userId
        ?.trim();

    const subscriptionId =
      typeof session.subscription ===
      "string"
        ? session.subscription
        : session.subscription
          ?.id;

    const customerId =
      typeof session.customer ===
      "string"
        ? session.customer
        : session.customer
          ?.id;

    if (
      userId &&
      subscriptionId
        ?.startsWith("sub_") &&
      customerId
        ?.startsWith("cus_")
    ) {
      await accountLibrary
        .setSubscription(
          userId,
          {
            subscriptionId,
            customerId,
          },
        );
    }

    return NextResponse.json({
      received:
        true,
    });
  }

  if (
    session.metadata
      ?.productType ===
    "video-subscription"
  ) {
    const userId =
      session.metadata
        ?.userId
        ?.trim();

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;

    if (
      userId &&
      subscriptionId?.startsWith("sub_") &&
      customerId?.startsWith("cus_")
    ) {
      await accountLibrary.setVideoSubscription(
        userId,
        { subscriptionId, customerId },
      );
    }

    return NextResponse.json({ received: true });
  }

  const jobId =
    session.metadata
      ?.jobId;

  if (
    !jobId
  ) {
    console.error(
      "Bezahlte Stripe-Session ohne jobId-Metadata:",
      {
        sessionId,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  /*
   * Song und Bild bleiben vollständig
   * von der Video-Dauerumstellung getrennt.
   */
  if (
    session.metadata
      ?.productType ===
    "song"
  ) {
    return handlePaidSongCheckout(
      jobId,
      sessionId,
      session.metadata,
    );
  }

  if (
    session.metadata
      ?.productType ===
    "image"
  ) {
    return handlePaidImageCheckout(
      jobId,
      sessionId,
      session.metadata,
    );
  }

  const job =
    await jobStore.get(
      jobId,
    );

  if (
    !job
  ) {
    console.error(
      "Bezahlter Stripe-Auftrag ohne passenden Job:",
      {
        jobId,
        sessionId,
      },
    );

    return NextResponse.json({
      received:
        true,
    });
  }

  /*
   * Stripe-Webhooks können mehrfach oder
   * gleichzeitig zugestellt werden.
   *
   * Bereits bezahlte Jobs werden deshalb
   * über den separaten atomaren
   * Workflow-Start-Marker behandelt.
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

        sessionId,

        message,
      },
    );

    /*
     * Die Zahlung ist real erfolgt.
     *
     * Auch bei beschädigter Metadata muss
     * paymentStatus deshalb korrekt auf paid
     * gespeichert werden.
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
     * Dauerhaft ungültige Metadata:
     * HTTP 200 verhindert endlose
     * Stripe-Wiederholungen.
     */
    return NextResponse.json({
      received:
        true,
    });
  }

  /*
   * Zentrale Dauerplanung.
   *
   * Neue Seedance-Struktur:
   *
   * 15  -> 15
   * 30  -> 15 + 15
   * 60  -> 4 x 15
   * 120 -> 8 x 15
   *
   * 8 bleibt nur für alte bezahlte
   * Stripe-Sessions möglich.
   */
  const durationPlan =
    buildVideoDurationPlan(
      config
        .targetDurationSeconds,
    );

  const totalExtensions =
    countTotalExtensions(
      durationPlan
        .chapterTargets,
      config.videoModel,
    );

  const now =
    Date.now();

  /*
   * Der Webhook startet selbst KEINEN
   * Seedance-Provider-Aufruf.
   *
   * Er macht ausschließlich:
   *
   * 1. Stripe-Zahlung prüfen
   * 2. bezahlte Konfiguration validieren
   * 3. Job persistent speichern
   * 4. renderStage = queued
   * 5. durable Render-Workflow starten
   */
  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      /*
       * 8 s Legacy und neue 15 s
       * sind das Short-Format.
       */
      format:
        config
          .targetDurationSeconds <=
        15
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

      videoModel:
        config.videoModel,

      provider:
        config.videoModel ===
        "google-veo"
          ? "veo"
          : "seedance",

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
        12,

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
   * Nach erfolgreicher Zahlungs-Persistenz
   * darf nur der Gewinner des atomaren
   * Workflow-Start-Claims den durable
   * Render-Workflow starten.
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
     * Stripe darf erneut zustellen.
     * Der Workflow-Start-Lock verhindert
     * dabei parallele Doppelstarts.
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
