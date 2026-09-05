import {
  del,
} from "@vercel/blob";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  start,
} from "workflow/api";

import {
  jobStore,
} from "@/lib/store";

import {
  getCurrentUser,
} from "@/lib/supabase/server";

import {
  checkVideoStatus as checkVeoVideoStatus,
} from "@/lib/veo";

import {
  checkVideoStatus as checkSeedanceVideoStatus,
  isSeedanceOperationName,
} from "@/lib/seedance";

import {
  trimAndStore,
} from "@/lib/video-backend/media";

import {
  promptHasProvidedDialogue,
} from "@/lib/dialogue-render-mode";

import {
  recoverVideoFinalizationWorkflow,
  renderVideoWorkflow,
} from "@/workflows/render-video";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  300;

type RecoveryRequest = {
  jobId?: unknown;
  session_id?: unknown;

  test_ffmpeg?: unknown;

  retry_generation?: unknown;

  skip_reference_image?: unknown;

  native_character_dialogue?: unknown;

  trash_tv_reaction_boost?: unknown;
};

/*
 * =========================================================
 * SINGLE-CLIP-RECOVERY
 * =========================================================
 *
 * Nur diese beiden Ziellängen dürfen aus
 * EINEM vorhandenen Provider-Video direkt
 * finalisiert werden:
 *
 * 8 Sekunden  -> alte Legacy-Aufträge
 * 15 Sekunden -> neue Seedance-Aufträge
 *
 * 30 / 60 / 120 Sekunden bestehen aus
 * mehreren 15-Sekunden-Clips.
 *
 * Deshalb darf bei diesen Längen niemals
 * irgendein einzelner Provider-Clip als
 * fertiges Gesamtvideo gespeichert werden.
 */
function isSingleClipTarget(
  duration:
    number |
    undefined,
): boolean {
  return (
    duration ===
      8 ||
    duration ===
      15
  );
}

function isStoredFinalVideo(
  videoUri:
    string |
    undefined,
): boolean {
  return Boolean(
    videoUri &&
      (
        videoUri.startsWith(
          "blob:",
        ) ||
        videoUri.startsWith(
          "local:",
        )
      ),
  );
}

function isRawProviderVideo(
  videoUri:
    string |
    undefined,
): boolean {
  return Boolean(
    videoUri &&
      !videoUri.startsWith(
        "blob:",
      ) &&
      !videoUri.startsWith(
        "local:",
      ),
  );
}

export async function POST(
  req:
    NextRequest,
) {
  let body:
    RecoveryRequest;

  try {
    body =
      await req
        .json() as RecoveryRequest;
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid JSON body.",
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
    typeof body.session_id ===
    "string"
      ? body.session_id.trim()
      : "";

  if (
    !jobId
  ) {
    return NextResponse.json(
      {
        error:
          "jobId is required.",
      },
      {
        status:
          400,
      },
    );
  }

  let job =
    await jobStore.get(
      jobId,
    );

  const user =
    await getCurrentUser();

  const ownsAccountJob =
    Boolean(
      user &&
      job?.userId ===
        user.id,
    );

  const ownsCheckoutJob =
    Boolean(
      sessionId &&
      job?.stripeSessionId ===
        sessionId,
    );

  if (
    !job ||
    !(
      ownsAccountJob ||
      ownsCheckoutJob
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Job not found.",
      },
      {
        status:
          404,
      },
    );
  }

  if (
    job.paymentStatus !==
    "paid"
  ) {
    return NextResponse.json(
      {
        error:
          "Job is not paid.",
      },
      {
        status:
          409,
      },
    );
  }

  const retryGeneration =
    body.retry_generation ===
    true;

  const skipReferenceImage =
    body.skip_reference_image ===
    true;

  const nativeCharacterDialogue =
    body.native_character_dialogue ===
    true;

  const trashTvReactionBoost =
    body.trash_tv_reaction_boost ===
    true;

  const exactProvidedDialogue =
    promptHasProvidedDialogue(
      job.prompt,
    );

  /*
   * =======================================================
   * FFMPEG DIAGNOSE
   * =======================================================
   *
   * Der Selbsttest darf nur mit einem bereits
   * fertigen Single-Clip-Video laufen.
   *
   * Unterstützt:
   * - 8 Sekunden Legacy
   * - 15 Sekunden Seedance
   */
  if (
    body.test_ffmpeg ===
    true
  ) {
    if (
      job.status !==
        "done" ||
      !job.videoUri?.startsWith(
        "blob:",
      ) ||
      !isSingleClipTarget(
        job.targetDurationSeconds,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "A completed single-clip Blob video (8s legacy or 15s Seedance) is required.",
        },
        {
          status:
            409,
        },
      );
    }

    const diagnosticPath =
      `diagnostics/${jobId}-ffmpeg-self-test.mp4`;

    const diagnosticSeconds =
      job.targetDurationSeconds ===
      8
        ? 7
        : 14;

    let outputPathname:
      string |
      undefined;

    try {
      const output =
        await trimAndStore(
          job.videoUri,
          diagnosticSeconds,
          diagnosticPath,
        );

      outputPathname =
        output.pathname;

      return NextResponse.json({
        ffmpegReady:
          true,

        sourceVideoUnchanged:
          true,

        jobId,
      });
    } catch (
      error
    ) {
      const message =
        error instanceof
        Error
          ? error.message
          : "FFmpeg self-test failed.";

      return NextResponse.json(
        {
          ffmpegReady:
            false,

          error:
            message,
        },
        {
          status:
            500,
        },
      );
    } finally {
      if (
        outputPathname
      ) {
        try {
          await del(
            outputPathname,
          );
        } catch (
          cleanupError
        ) {
          console.warn(
            "Could not delete FFmpeg diagnostic Blob:",
            cleanupError,
          );
        }
      }
    }
  }

  /*
   * Bereits vollständig abgeschlossen:
   * nichts mehr tun.
   *
   * Eine ausdrücklich angeforderte neue
   * native Viral-Dialog-Generation darf
   * weiterhin neu gestartet werden.
   */
  if (
    job.status ===
      "done" &&
    isStoredFinalVideo(
      job.videoUri,
    ) &&
    !(
      retryGeneration &&
      nativeCharacterDialogue
    )
  ) {
    return NextResponse.json({
      recovered:
        true,

      alreadyComplete:
        true,

      jobId,
    });
  }

  if (
    !job.targetDurationSeconds
  ) {
    return NextResponse.json(
      {
        error:
          "The paid target duration is missing.",
      },
      {
        status:
          409,
      },
    );
  }

  const singleClipTarget =
    isSingleClipTarget(
      job.targetDurationSeconds,
    );

  /*
   * =======================================================
   * LAUFENDE PROVIDER-OPERATION PRÜFEN
   * =======================================================
   */
  let providerFailureMessage:
    string |
    undefined;

  if (
    job.currentOperationName
  ) {
    try {
      const providerStatus =
        isSeedanceOperationName(
          job.currentOperationName,
        )
          ? await checkSeedanceVideoStatus(
              job.currentOperationName,
            )
          : await checkVeoVideoStatus(
              job.currentOperationName,
            );

      if (
        !providerStatus.done
      ) {
        return NextResponse.json(
          {
            recovering:
              true,

            waitingForProvider:
              true,

            jobId,
          },
          {
            status:
              202,
          },
        );
      }

      if (
        providerStatus.videoUri
      ) {
        job = {
          ...job,

          videoUri:
            providerStatus.videoUri,

          videoUrl:
            providerStatus.videoUrl,

          currentOperationName:
            undefined,

          currentOperationType:
            undefined,

          lastProviderPollAt:
            Date.now(),
        };

        await jobStore.set(
          jobId,
          job,
        );
      }
    } catch (
      error
    ) {
      providerFailureMessage =
        error instanceof
        Error
          ? error.message
          : "The previous provider operation could not be recovered.";

      if (
        !retryGeneration
      ) {
        return NextResponse.json(
          {
            error:
              providerFailureMessage,

            retryAvailable:
              true,
          },
          {
            status:
              409,
          },
        );
      }
    }
  }

  /*
   * Ein einzelnes bereits fertiges Provider-Video
   * ist nur bei 8s oder 15s wirklich das komplette
   * Kundenprodukt.
   */
  const hasRawProviderVideo =
    isRawProviderVideo(
      job.videoUri,
    ) &&
    !job.currentOperationName;

  const hasRecoverableProviderVideo =
    hasRawProviderVideo &&
    singleClipTarget;

  /*
   * =======================================================
   * KOSTENLOSE MANUELLE NEUGENERIERUNG
   * =======================================================
   *
   * Wichtig für die neue 15-Sekunden-Struktur:
   *
   * Wenn ein 30/60/120-Sekunden-Auftrag nur einen
   * einzelnen Provider-Clip besitzt, darf dieser
   * NICHT finalisiert werden.
   *
   * Bei retry_generation wird stattdessen der
   * bezahlte Auftrag über den normalen Workflow
   * wieder aufgenommen.
   */
  if (
    retryGeneration &&
    !hasRecoverableProviderVideo
  ) {
    const previousRecoveryAttempts =
      job.manualRecoveryAttempts ??
      0;

    const recoveryMessage =
      job.errorMessage ??
      providerFailureMessage ??
      "";

    const audioFailureCanRetry =
      /issue with the audio|audio for your prompt/i.test(
        recoveryMessage,
      );

    const internalProviderFailureCanRetry =
      /internal server issue|try again in a few minutes|internen Serverfehler/i.test(
        recoveryMessage,
      );

    const preProviderConfigurationFailureCanRetry =
      !job.currentOperationName &&
      /Veo-Rendering ist deaktiviert|Seedance-Rendering ist deaktiviert|SEEDANCE_WORKFLOW_RENDER_ENABLED ist deaktiviert/i.test(
        recoveryMessage,
      );

    const maximumRecoveryAttempts =
      preProviderConfigurationFailureCanRetry
        ? 2
        : trashTvReactionBoost
          ? 5
          : nativeCharacterDialogue
            ? 4
            : audioFailureCanRetry
              ? 2
              : internalProviderFailureCanRetry
                ? 4
                : 1;

    if (
      previousRecoveryAttempts >=
      maximumRecoveryAttempts
    ) {
      return NextResponse.json(
        {
          error:
            "Dieser Auftrag hat die sichere Anzahl kostenloser Wiederherstellungsversuche erreicht.",
        },
        {
          status:
            409,
        },
      );
    }

    /*
     * Alten Workflow-Start-Lock entfernen,
     * bevor ein neuer Recovery-Workflow
     * atomar geclaimt wird.
     */
    await jobStore
      .clearWorkflowStart(
        jobId,
      );

    const claimed =
      await jobStore
        .claimWorkflowStart(
          jobId,

          `manual-recovery:${jobId}:${Date.now()}`,
        );

    if (
      !claimed
    ) {
      return NextResponse.json(
        {
          regenerating:
            true,

          starting:
            true,

          jobId,
        },
        {
          status:
            202,
        },
      );
    }

    /*
     * Bei bestimmten nativen Viral-Dialog-
     * Audiofehlern können bereits erfolgreich
     * erzeugte 15-Sekunden-Segmente weiter-
     * verwendet werden.
     */
    const resumeCompletedNativeSections =
      nativeCharacterDialogue &&
      job.nativeCharacterDialogue ===
        true &&
      !exactProvidedDialogue &&
      audioFailureCanRetry &&
      !trashTvReactionBoost &&
      Array.isArray(
        job.chapterVideoUris,
      ) &&
      job.chapterVideoUris.length >
        0;

    await jobStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        renderStage:
          "queued",

        progressPercent:
          5,

        errorMessage:
          undefined,

        /*
         * Ein einzelnes Rohvideo aus einem
         * Multi-Clip-Auftrag darf niemals
         * als Gesamtvideo weiterverwendet werden.
         */
        videoUri:
          undefined,

        videoUrl:
          undefined,

        videoUrls:
          undefined,

        chapterVideoUris:
          resumeCompletedNativeSections
            ? job.chapterVideoUris
            : undefined,

        currentOperationName:
          undefined,

        currentOperationType:
          undefined,

        currentChapter:
          1,

        currentExtension:
          0,

        retryCount:
          0,

        nextAttemptAt:
          undefined,

        completedAt:
          undefined,

        manualRecoveryAttempts:
          previousRecoveryAttempts +
          1,

        nativeCharacterDialogue,

        nativeDialogueAudioRetry:
          nativeCharacterDialogue &&
          !exactProvidedDialogue &&
          (
            audioFailureCanRetry ||
            job.nativeDialogueAudioRetry ===
              true
          ),

        trashTvReactionBoost,

        referenceImageUrl:
          skipReferenceImage &&
          !exactProvidedDialogue
            ? undefined
            : job.referenceImageUrl,

        referenceImageMimeType:
          skipReferenceImage &&
          !exactProvidedDialogue
            ? undefined
            : job.referenceImageMimeType,
      },
    );

    try {
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

        (
          current,
        ) => ({
          ...current,

          workerId:
            run.runId,
        }),
      );

      return NextResponse.json(
        {
          regenerating:
            true,

          recoveredFromPaidOrder:
            true,

          referenceImageSkipped:
            skipReferenceImage,

          nativeCharacterDialogue,

          trashTvReactionBoost,

          jobId,
        },
        {
          status:
            202,
        },
      );
    } catch (
      error
    ) {
      const message =
        error instanceof
        Error
          ? error.message
          : "The paid video could not be restarted.";

      await jobStore
        .clearWorkflowStart(
          jobId,
        );

      const latest =
        await jobStore.get(
          jobId,
        );

      if (
        latest
      ) {
        await jobStore.set(
          jobId,
          {
            ...latest,

            status:
              "error",

            renderStage:
              "failed",

            errorMessage:
              message,

            /*
             * Fehlgeschlagener Workflow-Start
             * soll keinen Recovery-Versuch
             * verbrauchen.
             */
            manualRecoveryAttempts:
              previousRecoveryAttempts,
          },
        );
      }

      return NextResponse.json(
        {
          error:
            message,
        },
        {
          status:
            500,
        },
      );
    }
  }

  /*
   * =======================================================
   * DIREKTE PROVIDER-VIDEO-RECOVERY
   * =======================================================
   *
   * Nur 8s Legacy oder 15s Seedance.
   */
  if (
    !hasRecoverableProviderVideo
  ) {
    /*
     * Sehr wichtiger Schutz:
     *
     * Bei 30 / 60 / 120 Sekunden kann job.videoUri
     * durchaus auf einen einzelnen bereits fertigen
     * 15-Sekunden-Provider-Clip zeigen.
     *
     * Diesen dürfen wir NICHT trimmen und als
     * vollständiges Kundenvideo speichern.
     */
    if (
      hasRawProviderVideo &&
      !singleClipTarget
    ) {
      return NextResponse.json(
        {
          error:
            `Ein einzelner Provider-Clip kann bei einem ${job.targetDurationSeconds}-Sekunden-Auftrag nicht als fertiges Gesamtvideo übernommen werden.`,

          retryAvailable:
            true,

          requiresFullWorkflowRecovery:
            true,

          jobId,
        },
        {
          status:
            409,
        },
      );
    }

    return NextResponse.json(
      {
        error:
          providerFailureMessage ||
          "No completed provider video is available for recovery.",

        retryAvailable:
          true,
      },
      {
        status:
          409,
      },
    );
  }

  /*
   * Wenn die Finalisierung bereits läuft,
   * keinen zweiten Workflow starten.
   */
  if (
    job.status ===
      "processing" &&
    job.renderStage ===
      "trimming"
  ) {
    return NextResponse.json(
      {
        recovering:
          true,

        jobId,
      },
      {
        status:
          202,
      },
    );
  }

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      renderStage:
        "trimming",

      progressPercent:
        92,

      errorMessage:
        undefined,
    },
  );

  try {
    /*
     * Dieser Workflow finalisiert genau EIN
     * vorhandenes Provider-Video.
     *
     * Deshalb ist er oben ausdrücklich auf
     * 8s / 15s beschränkt.
     */
    const run =
      await start(
        recoverVideoFinalizationWorkflow,
        [
          jobId,
        ],
      );

    const latest =
      await jobStore.get(
        jobId,
      );

    if (
      latest
    ) {
      await jobStore.set(
        jobId,
        {
          ...latest,

          workerId:
            run.runId,
        },
      );
    }

    return NextResponse.json(
      {
        recovering:
          true,

        jobId,

        workflowRunId:
          run.runId,
      },
      {
        status:
          202,
      },
    );
  } catch (
    error
  ) {
    const message =
      error instanceof
      Error
        ? error.message
        : "Recovery workflow could not be started.";

    const latest =
      await jobStore.get(
        jobId,
      );

    if (
      latest
    ) {
      await jobStore.set(
        jobId,
        {
          ...latest,

          status:
            "error",

          renderStage:
            "failed",

          errorMessage:
            message,
        },
      );
    }

    return NextResponse.json(
      {
        error:
          message,
      },
      {
        status:
          500,
      },
    );
  }
}
