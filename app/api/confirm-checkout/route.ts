import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getRun,
  start,
} from "workflow/api";

import {
  stripe,
} from "@/lib/stripe";

import {
  jobStore,
} from "@/lib/store";

import {
  buildVideoDurationPlan,
} from "@/lib/veo";

import {
  renderVideoWorkflow,
} from "@/workflows/render-video";

import {
  normalizeVideoAudioStyle,
  normalizeVideoSpokenLanguage,
  normalizeVideoVoiceMode,
} from "@/lib/audio-options";

import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoModelId,
} from "@/types/story";

import {
  isVideoModelId,
} from "@/types/story";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;

/*
 * 8 Sekunden bleiben hier absichtlich
 * für bereits bezahlte Legacy-Sessions erhalten.
 *
 * Neue Checkout-Sessions können seit dem Umbau
 * nur noch ab 15 Sekunden erstellt werden.
 */
const SUPPORTED_DURATIONS = [
  8,
  15,
  30,
  60,
  120,
  180,
  240,
  300,
] as const;

const SUPPORTED_ASPECT_RATIOS = [
  "9:16",
  "16:9",
] as const;

const SUPPORTED_EDITING_STYLES = [
  "auto",
  "social",
  "cinematic",
  "music-video",
] as const;

type ConfirmRequest = {
  jobId?: unknown;
  sessionId?: unknown;
};

function isDuration(
  value: number,
): value is VideoDurationSeconds {
  return SUPPORTED_DURATIONS.includes(
    value as VideoDurationSeconds,
  );
}

function isAspectRatio(
  value: string,
): value is VideoAspectRatio {
  return SUPPORTED_ASPECT_RATIOS.includes(
    value as VideoAspectRatio,
  );
}

function isEditingStyle(
  value: string,
): value is VideoEditingStyle {
  return SUPPORTED_EDITING_STYLES.includes(
    value as VideoEditingStyle,
  );
}

/*
 * Neue Seedance-Dauerplanung:
 *
 * 8 s   -> 0 Extensions (nur Legacy)
 * 15 s  -> 0 Extensions
 * 30 s  -> 1 Extension
 * 60 s  -> 3 Extensions
 * 120 s -> 7 Extensions
 *
 * Jeder neue Clip umfasst 15 Sekunden.
 */
function countExtensions(
  chapterTargets:
    VideoDurationSeconds[],
  videoModel: VideoModelId,
): number {
  return chapterTargets.reduce(
    (
      total,
      seconds,
    ) => {
      return (
        total +
        (videoModel === "google-veo" || videoModel === "google-veo-fast"
          ? Math.max(0, Math.ceil((seconds - 8) / 7))
          : Math.max(0, Math.ceil((seconds - 15) / 15)))
      );
    },
    0,
  );
}

export async function POST(
  request: NextRequest,
) {
  let body:
    ConfirmRequest;

  try {
    body =
      await request
        .json() as ConfirmRequest;
  } catch {
    return NextResponse.json(
      {
        error:
          "Ungültige Anfrage.",
      },
      {
        status:
          400,
      },
    );
  }

  const jobId =
    typeof body.jobId ===
    "string"
      ? body.jobId.trim()
      : "";

  const sessionId =
    typeof body.sessionId ===
    "string"
      ? body.sessionId.trim()
      : "";

  if (
    !jobId ||
    !sessionId ||
    !sessionId.startsWith(
      "cs_",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Job- oder Stripe-Session-ID fehlt.",
      },
      {
        status:
          400,
      },
    );
  }

  try {
    let job =
      await jobStore.get(
        jobId,
      );

    if (!job) {
      return NextResponse.json(
        {
          error:
            "Der Videoauftrag wurde nicht gefunden.",
        },
        {
          status:
            404,
        },
      );
    }

    /*
     * Ein bereits serverseitig bestätigter Auftrag
     * braucht nach einem lokalen Neustart keine
     * erneute Stripe-Abfrage.
     *
     * Sicher ist das nur, wenn:
     * - paymentStatus = paid
     * - exakt dieselbe Stripe-Session gespeichert ist.
     */
    const locallyVerifiedPayment =
      job.paymentStatus ===
        "paid" &&
      job.stripeSessionId ===
        sessionId;

    if (
      locallyVerifiedPayment &&
      job.status ===
        "done" &&
      (
        job.videoUri?.startsWith(
          "blob:",
        ) ||
        job.videoUri?.startsWith(
          "local:",
        )
      )
    ) {
      return NextResponse.json({
        confirmed:
          true,

        queued:
          false,

        alreadyComplete:
          true,
      });
    }

    /*
     * Bestimmte alte Transportfehler können sicher
     * erneut gestartet werden, solange noch keine
     * kostenpflichtige Provider-Operation lief.
     */
    if (
      locallyVerifiedPayment &&
      job.status ===
        "error"
    ) {
      const canRepairImageTransportFailure =
        (
          job.retryCount ??
          0
        ) < 1 &&
        !job.currentOperationName &&
        /`?inlineData`?.*isn(?:'|’)t supported by this model/i.test(
          job.errorMessage ||
            "",
        );

      if (
        !canRepairImageTransportFailure
      ) {
        return NextResponse.json({
          confirmed:
            true,

          queued:
            false,

          failed:
            true,
        });
      }

      await jobStore
        .clearWorkflowStart(
          jobId,
        );

      const recoveredJob = {
        ...job,

        status:
          "processing",

        renderStage:
          "queued",

        progressPercent:
          1,

        currentChapter:
          0,

        currentExtension:
          0,

        currentOperationName:
          undefined,

        currentOperationType:
          undefined,

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

        retryCount:
          (
            job.retryCount ??
            0
          ) + 1,

        nextAttemptAt:
          Date.now(),

        errorMessage:
          undefined,
      } as const;

      await jobStore.set(
        jobId,
        recoveredJob,
      );

      job =
        recoveredJob;
    }

    /*
     * Existiert bereits ein Workflow,
     * prüfen wir, ob er noch läuft.
     */
    if (
      locallyVerifiedPayment &&
      job.status ===
        "processing" &&
      job.workerId
    ) {
      let workflowStatus:
        Awaited<
          ReturnType<
            typeof getRun
          >["status"]
        > |
        undefined;

      try {
        workflowStatus =
          await getRun(
            job.workerId,
          ).status;
      } catch (error) {
        console.warn(
          "Workflow-Status konnte nicht geprüft werden:",
          error,
        );
      }

      const failedBeforeProviderStart =
        (
          workflowStatus ===
            "failed" ||
          workflowStatus ===
            "cancelled"
        ) &&
        !job.currentOperationName &&
        (
          job.progressPercent ??
          0
        ) <= 2;

      if (
        !failedBeforeProviderStart
      ) {
        return NextResponse.json({
          confirmed:
            true,

          queued:
            true,

          workflowRunId:
            job.workerId,
        });
      }

      /*
       * Der Workflow ist sicher beendet,
       * bevor Seedance kostenpflichtig gestartet wurde.
       *
       * Derselbe bezahlte Auftrag darf daher
       * erneut aufgenommen werden.
       */
      await jobStore
        .clearWorkflowStart(
          jobId,
        );

      const recoveredJob = {
        ...job,

        status:
          "processing",

        renderStage:
          "queued",

        progressPercent:
          0,

        currentChapter:
          0,

        currentExtension:
          0,

        currentOperationName:
          undefined,

        currentOperationType:
          undefined,

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

        retryCount:
          (
            job.retryCount ??
            0
          ) + 1,

        nextAttemptAt:
          Date.now(),

        errorMessage:
          undefined,
      } as const;

      await jobStore.set(
        jobId,
        recoveredJob,
      );

      job =
        recoveredJob;
    }

    /*
     * Der Browser allein wird niemals als
     * Zahlungsbestätigung akzeptiert.
     *
     * Stripe wird serverseitig abgefragt.
     */
    const session =
      await stripe
        .checkout
        .sessions
        .retrieve(
          sessionId,
        );

    if (
      session.payment_status !==
      "paid"
    ) {
      return NextResponse.json(
        {
          error:
            "Die Zahlung ist noch nicht bestätigt.",
        },
        {
          status:
            409,
        },
      );
    }

    if (
      session.metadata
        ?.jobId !==
      jobId
    ) {
      return NextResponse.json(
        {
          error:
            "Die Zahlung gehört nicht zu diesem Auftrag.",
        },
        {
          status:
            403,
        },
      );
    }

    /*
     * Zahlungsdaten einmalig aus den
     * serverseitigen Stripe-Metadaten
     * in den gespeicherten Job übernehmen.
     */
    if (
      job.paymentStatus !==
      "paid"
    ) {
      const rawDuration =
        Number(
          session.metadata
            ?.targetDurationSeconds,
        );

      const rawAspectRatio =
        session.metadata
          ?.aspectRatio ??
        "";

      const rawEditingStyle =
        session.metadata
          ?.editingStyle ??
        "";

      const rawVideoModel: VideoModelId | null =
        session.metadata?.videoModel === undefined
          ? "seedance-2-fast"
          : isVideoModelId(session.metadata.videoModel)
            ? session.metadata.videoModel
            : null;

      if (
        !Number.isInteger(
          rawDuration,
        ) ||
        !isDuration(
          rawDuration,
        ) ||
        !isAspectRatio(
          rawAspectRatio,
        ) ||
        !isEditingStyle(
          rawEditingStyle,
        ) ||
        !rawVideoModel
      ) {
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

        return NextResponse.json(
          {
            error:
              "Die bezahlte Video-Konfiguration ist ungültig.",
          },
          {
            status:
              422,
          },
        );
      }

      /*
       * buildVideoDurationPlan verwendet jetzt:
       *
       * 15  -> 15
       * 30  -> 15 + 15
       * 60  -> 15 + 15 + 15 + 15
       * 120 -> 8 x 15
       *
       * 8 bleibt als Legacy-Sonderfall erhalten.
       */
      const durationPlan =
        buildVideoDurationPlan(
          rawDuration,
        );

      const now =
        Date.now();

      await jobStore.set(
        jobId,
        {
          ...job,

          status:
            "processing",

          /*
           * Legacy-8 und neue 15 Sekunden
           * gelten beide als short.
           */
          format:
            rawDuration <=
            15
              ? "short"
              : "long",

          targetDurationSeconds:
            rawDuration,

          aspectRatio:
            rawAspectRatio,

          editingStyle:
            rawEditingStyle,

          audioStyle:
            normalizeVideoAudioStyle(
              session.metadata
                ?.audioStyle,
            ),

          voiceMode:
            normalizeVideoVoiceMode(
              session.metadata
                ?.voiceMode,
            ),

          spokenLanguage:
            normalizeVideoSpokenLanguage(
              session.metadata
                ?.spokenLanguage,
            ),

          videoModel:
            rawVideoModel,

          provider:
            rawVideoModel === "google-veo" || rawVideoModel === "google-veo-fast"
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

          totalExtensions:
            countExtensions(
              durationPlan
                .chapterTargets,
              rawVideoModel,
            ),

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
    }

    /*
     * Idempotenz:
     * niemals denselben bezahlten Auftrag
     * versehentlich mehrfach starten.
     */
    const existingStart =
      await jobStore
        .getWorkflowStartState(
          jobId,
        );

    if (
      existingStart?.status ===
      "started"
    ) {
      return NextResponse.json({
        confirmed:
          true,

        queued:
          true,

        workflowRunId:
          existingStart
            .workflowRunId,
      });
    }

    if (
      existingStart?.status ===
      "starting"
    ) {
      return NextResponse.json(
        {
          confirmed:
            true,

          queued:
            true,

          starting:
            true,
        },
        {
          status:
            202,
        },
      );
    }

    const claimed =
      await jobStore
        .claimWorkflowStart(
          jobId,
          `checkout-return:${sessionId}`,
        );

    if (
      !claimed
    ) {
      return NextResponse.json(
        {
          confirmed:
            true,

          queued:
            true,

          starting:
            true,
        },
        {
          status:
            202,
        },
      );
    }

    /*
     * Bezahlten Render-Workflow starten.
     */
    const run =
      await start(
        renderVideoWorkflow,
        [
          jobId,
        ],
      );

    await jobStore
      .confirmWorkflowStarted(
        jobId,
        run.runId,
      );

    await jobStore.update(
      jobId,

      (current) => ({
        ...current,

        workerId:
          run.runId,

        claimedAt:
          current.claimedAt ??
          Date.now(),
      }),
    );

    return NextResponse.json({
      confirmed:
        true,

      queued:
        true,

      workflowRunId:
        run.runId,
    });
  } catch (error) {
    console.error(
      "Checkout-Rückkehr konnte den Render nicht bestätigen:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Die Zahlung wird erneut geprüft. Bitte lasse diese Seite geöffnet.",
      },
      {
        status:
          500,
      },
    );
  }
}
