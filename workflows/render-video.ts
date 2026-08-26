import { createWebhook, sleep } from "workflow";

import {
  CURRENTLY_RELEASED_MAX_DURATION_SECONDS,
} from "@/lib/pricing";

import {
  VIRAL_CHARACTERS,
} from "@/lib/viral-characters";

import {
  MUSIC_VIDEO_MAX_DURATION_SECONDS,
} from "@/lib/music-video";

import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoModelId,
} from "@/types/story";

type DialogueCue = {
  startSeconds: number;
  maximumDurationSeconds: number;
  speaker: string;
  text: string;
  voiceName: string;
  voiceDirection: string;
};

type PlannedSegment = {
  chapterNumber: number;
  targetSeconds: number;
  openingPrompt: string;
  continuationPrompts: string[];
};

type ViralBeatSource = {
  source: Record<string, unknown>;
  dialogues: Record<string, unknown>[];
};

type ViralPreparedShot = {
  targetSeconds: number;
  prompt: string;
  dialogues: Record<string, unknown>[];
};

type PreparedRender = {
  jobId: string;
  duration: VideoDurationSeconds;
  aspectRatio: VideoAspectRatio;
  videoModel: VideoModelId;
  segments: PlannedSegment[];
  completedSegmentUris: string[];
  totalExtensions: number;

  finishing: {
    voiceoverText?: string;
    voiceoverVoiceName?: "Charon" | "Kore";
    dialogueCues?: DialogueCue[];
    closingText?: string;
    spokenLanguage?: "auto" | "de" | "en";
    musicTrackUri?: string;
    musicTrackDurationSeconds?: number;
  };
};

type RenderResult = {
  jobId: string;
  providerRenderEnabled: boolean;
  pipelineComplete: boolean;
  outputPathname?: string;
  reason?: string;
};

type WebhookOperationResult =
  | {
      completed: true;
      videoUri: string;
    }
  | {
      completed: false;
      providerMessage: string;
      restartAllowed: boolean;
    };

type StartedProviderOperation = {
  operationName: string;
  reusedExistingOperation: boolean;
};

type ProviderStartResult =
  | {
      started: true;
      operationName: string;
      reusedExistingOperation: boolean;
    }
  | {
      started: false;
      retryAfterMs: number;
      httpStatus: number;
    };

const SEEDANCE_CLIP_DURATION_SECONDS =
  15;

const PROVIDER_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  12 * 60 * 60_000,
  12 * 60 * 60_000,
  12 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

const PROVIDER_OPERATION_RESTART_DELAYS_MS = [
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
] as const;

export async function renderVideoWorkflow(
  jobId: string,
): Promise<RenderResult> {
  "use workflow";

  try {
    const prepared =
      await prepareRenderJobStep(
        jobId,
      );

    const gate =
      await providerRenderEnabledStep(
        prepared.duration,
        Boolean(
          prepared.finishing
            .musicTrackUri,
        ),
        prepared.videoModel,
      );

    if (!gate.enabled) {
      await markRenderDisabledStep(
        jobId,
      );

      return {
        jobId,
        providerRenderEnabled:
          false,
        pipelineComplete:
          false,

        reason:
          gate.reason ||
          "Seedance-Rendering ist durch den Sicherheitsschalter deaktiviert.",
      };
    }

    const chapterUris:
      string[] = [
      ...prepared
        .completedSegmentUris,
    ];

    const completedSegmentCount =
      prepared
        .completedSegmentUris
        .length;

    let completedExtensions =
      0;

    for (
      const segment
      of prepared.segments.slice(
        completedSegmentCount,
      )
    ) {
      if (
        prepared.videoModel === "google-veo" ||
        prepared.videoModel === "google-veo-fast"
      ) {
        let currentUri =
          await completeVeoOpening(
            jobId,
            segment.openingPrompt,
            prepared.aspectRatio,
            segment.chapterNumber,
          );

        const extensionCount =
          veoExtensionCountFor(
            segment.targetSeconds,
          );

        for (
          let index = 0;
          index < extensionCount;
          index += 1
        ) {
          const promptIndex =
            segment.continuationPrompts.length > 0
              ? Math.min(
                  segment.continuationPrompts.length - 1,
                  Math.floor(
                    index *
                      segment.continuationPrompts.length /
                      extensionCount,
                  ),
                )
              : -1;

          const continuationPrompt =
            promptIndex >= 0
              ? segment.continuationPrompts[promptIndex]
              : [
                  segment.openingPrompt,
                  "Continue the same scene and action naturally without restarting it.",
                ].join("\n\n");

          currentUri =
            await completeVeoExtension(
              jobId,
              currentUri,
              continuationPrompt,
              prepared.aspectRatio,
              segment.chapterNumber,
              completedExtensions + 1,
            );

          completedExtensions += 1;
        }

        chapterUris.push(
          currentUri,
        );

        await recordChapterStep(
          jobId,
          segment.chapterNumber,
          chapterUris,
          completedExtensions,
          prepared.totalExtensions,
        );

        continue;
      }

      let currentUri =
        await completeOpeningWithOperationRecovery(
          jobId,
          segment.openingPrompt,
          prepared.aspectRatio,
          segment.chapterNumber,
          completedExtensions,
          prepared.totalExtensions,
          seedanceOpeningClipDurationFor(
            segment.targetSeconds,
          ),
        );

      chapterUris.push(
        currentUri,
      );

      for (
        let index = 0;
        index <
        segment
          .continuationPrompts
          .length;
        index += 1
      ) {
        const globalExtensionNumber =
          completedExtensions +
          1;

        currentUri =
          await completeExtensionWithOperationRecovery(
            jobId,
            currentUri,

            segment
              .continuationPrompts[
                index
              ],

            prepared.aspectRatio,
            segment.chapterNumber,
            globalExtensionNumber,
            prepared.totalExtensions,
          );

        completedExtensions =
          globalExtensionNumber;

        chapterUris.push(
          currentUri,
        );
      }

      await recordChapterStep(
        jobId,
        segment.chapterNumber,
        chapterUris,
        completedExtensions,
        prepared.totalExtensions,
      );
    }

    await markFinalizingStep(
      jobId,
      chapterUris.length >
        1,
    );

    const output =
      chapterUris.length ===
      1
        ? await trimFinalVideoStep(
            jobId,
            chapterUris[0],
            prepared.duration,
            prepared.finishing,
          )
        : await mergeFinalVideoStep(
            jobId,
            chapterUris,
            prepared.duration,
            prepared.finishing,
          );

    await finishRenderJobStep(
      jobId,
      output.pathname,
    );

    return {
      jobId,

      providerRenderEnabled:
        true,

      pipelineComplete:
        true,

      outputPathname:
        output.pathname,
    };
  } catch (error) {
    const message =
      readableRenderError(
        error,
      );

    await failRenderJobStep(
      jobId,
      message,
    );

    throw error;
  }
}

export default renderVideoWorkflow;

export async function recoverVideoFinalizationWorkflow(
  jobId: string,
): Promise<RenderResult> {
  "use workflow";

  const prepared =
    await prepareRecoveryFinalizationStep(
      jobId,
    );

  try {
    const output =
      await trimFinalVideoStep(
        jobId,
        prepared.videoUri,
        prepared.duration,
        prepared.finishing,
      );

    await finishRenderJobStep(
      jobId,
      output.pathname,
    );

    return {
      jobId,

      providerRenderEnabled:
        false,

      pipelineComplete:
        true,

      outputPathname:
        output.pathname,

      reason:
        "Recovered existing provider video without a new Seedance request.",
    };
  } catch (error) {
    const message =
      readableRenderError(
        error,
      );

    await failRenderJobStep(
      jobId,
      message,
    );

    throw error;
  }
}

async function startOpeningWithProviderRetry(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  clipDurationSeconds: number,
  webhookUrl: string,
): Promise<StartedProviderOperation> {
  for (
    let attempt = 0;
    attempt <=
      PROVIDER_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const plannedRetryDelayMs =
      PROVIDER_RETRY_DELAYS_MS[
        attempt
      ] ?? 0;

    const result =
      await startOpeningVideoStep(
        jobId,
        prompt,
        aspectRatio,
        chapterNumber,
        clipDurationSeconds,
        webhookUrl,
        plannedRetryDelayMs,
      );

    if (
      result.started ===
      true
    ) {
      return {
        operationName:
          result.operationName,

        reusedExistingOperation:
          result
            .reusedExistingOperation,
      };
    }

    await sleep(
      `${Math.ceil(
        result.retryAfterMs /
          1000,
      )}s`,
    );
  }

  throw new Error(
    "Seedance konnte nach mehreren sicheren Versuchen nicht gestartet werden.",
  );
}

async function startExtensionWithProviderRetry(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
  webhookUrl: string,
): Promise<StartedProviderOperation> {
  for (
    let attempt = 0;
    attempt <=
      PROVIDER_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    const plannedRetryDelayMs =
      PROVIDER_RETRY_DELAYS_MS[
        attempt
      ] ?? 0;

    const result =
      await startExtensionVideoStep(
        jobId,
        previousVideoUri,
        prompt,
        aspectRatio,
        chapterNumber,
        extensionNumber,
        webhookUrl,
        plannedRetryDelayMs,
      );

    if (
      result.started ===
      true
    ) {
      return {
        operationName:
          result.operationName,

        reusedExistingOperation:
          result
            .reusedExistingOperation,
      };
    }

    await sleep(
      `${Math.ceil(
        result.retryAfterMs /
          1000,
      )}s`,
    );
  }

  throw new Error(
    "Seedance konnte die Fortsetzung nach mehreren sicheren Versuchen nicht starten.",
  );
}

async function waitForExistingSeedanceOperation(
  jobId: string,
  operationName: string,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
): Promise<WebhookOperationResult> {
  /*
   * Nur für Operationen, die vor dem
   * Webhook-Umbau gestartet wurden.
   */
  for (
    let attempt = 0;
    attempt < 120;
    attempt += 1
  ) {
    const result =
      await recoverExistingSeedanceOperationStep(
        jobId,
        operationName,
        chapterNumber,
        completedExtensions,
        totalExtensions,
      );

    if (
      result.completed ===
        true ||
      (
        result.completed ===
          false &&
        result.restartAllowed
      )
    ) {
      return result;
    }

    await sleep(
      "30s",
    );
  }

  return {
    completed:
      false,

    restartAllowed:
      false,

    providerMessage:
      "Die bereits gestartete Seedance-Operation laeuft nach 60 Minuten noch. Sie wurde nicht doppelt gestartet.",
  };
}

async function completeOpeningWithOperationRecovery(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
  clipDurationSeconds: number,
): Promise<string> {
  for (
    let attempt = 0;
    attempt <=
      PROVIDER_OPERATION_RESTART_DELAYS_MS.length;
    attempt += 1
  ) {
    using webhook =
      createWebhook();

    const started =
      await startOpeningWithProviderRetry(
        jobId,
        prompt,
        aspectRatio,
        chapterNumber,
        clipDurationSeconds,
        webhook.url,
      );

    let result:
      WebhookOperationResult;

    if (
      started
        .reusedExistingOperation
    ) {
      result =
        await waitForExistingSeedanceOperation(
          jobId,
          started.operationName,
          chapterNumber,
          completedExtensions,
          totalExtensions,
        );
    } else {
      const request =
        await webhook;

      const payload =
        await request.json();

      result =
        await handleSeedanceWebhookStep(
          jobId,
          started.operationName,
          payload,
          chapterNumber,
          completedExtensions,
          totalExtensions,
        );

      if (
        result.completed === false &&
        !result.restartAllowed
      ) {
        result =
          await waitForExistingSeedanceOperation(
            jobId,
            started.operationName,
            chapterNumber,
            completedExtensions,
            totalExtensions,
          );
      }
    }

    if (
      result.completed ===
      true
    ) {
      return result.videoUri;
    }

    if (
      !result.restartAllowed
    ) {
      throw new Error(
        result.providerMessage,
      );
    }

    const retryDelayMs =
      PROVIDER_OPERATION_RESTART_DELAYS_MS[
        attempt
      ];

    if (
      retryDelayMs ===
      undefined
    ) {
      throw new Error(
        "Seedance hat die Videoerstellung wiederholt wegen eines internen Serverfehlers beendet. Der bezahlte Auftrag bleibt gespeichert.",
      );
    }

    await scheduleOperationRestartStep(
      jobId,
      retryDelayMs,
      result.providerMessage,
    );

    await sleep(
      `${Math.ceil(
        retryDelayMs /
          1000,
      )}s`,
    );
  }

  throw new Error(
    "Seedance konnte die Videoerstellung nicht abschliessen.",
  );
}

async function completeExtensionWithOperationRecovery(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
  totalExtensions: number,
): Promise<string> {
  for (
    let attempt = 0;
    attempt <=
      PROVIDER_OPERATION_RESTART_DELAYS_MS.length;
    attempt += 1
  ) {
    using webhook =
      createWebhook();

    const started =
      await startExtensionWithProviderRetry(
        jobId,
        previousVideoUri,
        prompt,
        aspectRatio,
        chapterNumber,
        extensionNumber,
        webhook.url,
      );

    let result:
      WebhookOperationResult;

    if (
      started
        .reusedExistingOperation
    ) {
      result =
        await waitForExistingSeedanceOperation(
          jobId,
          started.operationName,
          chapterNumber,
          extensionNumber,
          totalExtensions,
        );
    } else {
      const request =
        await webhook;

      const payload =
        await request.json();

      result =
        await handleSeedanceWebhookStep(
          jobId,
          started.operationName,
          payload,
          chapterNumber,
          extensionNumber,
          totalExtensions,
        );

      if (
        result.completed === false &&
        !result.restartAllowed
      ) {
        result =
          await waitForExistingSeedanceOperation(
            jobId,
            started.operationName,
            chapterNumber,
            extensionNumber,
            totalExtensions,
          );
      }
    }

    if (
      result.completed ===
      true
    ) {
      return result.videoUri;
    }

    if (
      !result.restartAllowed
    ) {
      throw new Error(
        result.providerMessage,
      );
    }

    const retryDelayMs =
      PROVIDER_OPERATION_RESTART_DELAYS_MS[
        attempt
      ];

    if (
      retryDelayMs ===
      undefined
    ) {
      throw new Error(
        "Seedance hat die Videofortsetzung wiederholt wegen eines internen Serverfehlers beendet. Der bezahlte Auftrag bleibt gespeichert.",
      );
    }

    await scheduleOperationRestartStep(
      jobId,
      retryDelayMs,
      result.providerMessage,
    );

    await sleep(
      `${Math.ceil(
        retryDelayMs /
          1000,
      )}s`,
    );
  }

  throw new Error(
    "Seedance konnte die Videofortsetzung nicht abschliessen.",
  );
}

async function scheduleOperationRestartStep(
  jobId: string,
  retryDelayMs: number,
  providerMessage: string,
): Promise<void> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      "Render-Job wurde vor dem automatischen Neustart nicht gefunden.",
    );
  }

  const nextAttemptAt =
    Date.now() +
    retryDelayMs;

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      renderStage:
        "waiting-provider",

      retryCount:
        (
          job.retryCount ??
          0
        ) + 1,

      nextAttemptAt,

      errorMessage:
        "Seedance hatte einen internen Serverfehler. Dein bezahlter Auftrag wird automatisch neu gestartet.",

      currentOperationName:
        undefined,

      currentOperationType:
        undefined,
    },
  );

  console.warn(
    "Restarting failed Seedance operation after provider backoff",
    {
      jobId,
      retryDelayMs,
      providerMessage,
    },
  );
}

async function prepareRecoveryFinalizationStep(
  jobId: string,
): Promise<{
  videoUri: string;
  duration: VideoDurationSeconds;

  finishing:
    PreparedRender["finishing"];
}> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      `Recovery job ${jobId} was not found.`,
    );
  }

  if (
    job.paymentStatus !==
    "paid"
  ) {
    throw new Error(
      "Recovery job is not paid.",
    );
  }

  if (
    !job.targetDurationSeconds
  ) {
    throw new Error(
      "Recovery job has no target duration.",
    );
  }

  if (
    !job.videoUri ||
    job.videoUri.startsWith(
      "blob:",
    ) ||
    job.videoUri.startsWith(
      "local:",
    )
  ) {
    throw new Error(
      "No recoverable provider video URI is stored.",
    );
  }

  if (
    job.currentOperationName
  ) {
    throw new Error(
      "The provider operation is not complete yet.",
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

  const recoveryDialogueCues =
    job.voiceMode ===
      "dialogue" &&
    job.nativeCharacterDialogue !==
      true
      ? buildDialogueCuesFromStoredPrompt(
          job.prompt,
          job.targetDurationSeconds,
          job.videoModel ??
            "seedance-2-fast",
        )
      : [];

  return {
    videoUri:
      job.videoUri,

    duration:
      job.targetDurationSeconds,

    finishing: {
      voiceoverText:
        recoveryDialogueCues.length >
        0
          ? undefined
          : job.voiceoverText,

      voiceoverVoiceName:
        job.voiceoverVoiceName,

      dialogueCues:
        recoveryDialogueCues,

      closingText:
        job.closingText,

      spokenLanguage:
        job.spokenLanguage,

      musicTrackUri:
        job.musicVideoAudioUri,

      musicTrackDurationSeconds:
        job.musicVideoAudioDurationSeconds,
    },
  };
}

async function providerRenderEnabledStep(
  duration: number,
  musicVideoMode: boolean,
  videoModel: VideoModelId,
): Promise<{
  enabled: boolean;
  reason?: string;
}> {
  "use step";

  try {
    assertProviderRenderAllowed(
      duration,
      musicVideoMode,
      videoModel,
    );

    return {
      enabled:
        true,
    };
  } catch (error) {
    return {
      enabled:
        false,

      reason:
        error instanceof Error
          ? error.message
          : "Seedance-Rendering ist deaktiviert.",
    };
  }
}

async function prepareRenderJobStep(
  jobId: string,
): Promise<PreparedRender> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const {
    buildMovieContinuationPrompt,
    buildVideoDurationPlan,
    removeVisibleTextRenderingInstructions,
  } =
    await import(
      "@/lib/veo"
    );

  const {
    buildSelectedAudioDirection,
  } =
    await import(
      "@/lib/audio-options"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      `Render-Job ${jobId} wurde nicht gefunden.`,
    );
  }

  if (
    job.paymentStatus !==
    "paid"
  ) {
    throw new Error(
      `Render-Job ${jobId} ist nicht bezahlt.`,
    );
  }

  if (
    !job.targetDurationSeconds ||
    !job.aspectRatio
  ) {
    throw new Error(
      `Render-Job ${jobId} enthält keine vollständige Videokonfiguration.`,
    );
  }

  let story:
    Record<string, unknown>;

  try {
    story =
      JSON.parse(
        job.prompt,
      ) as Record<
        string,
        unknown
      >;
  } catch {
    throw new Error(
      "Die gespeicherte Story ist kein gültiges JSON.",
    );
  }

  const moviePlan =
    asRecord(
      story.moviePlan,
    );

  if (
    Object.keys(
      moviePlan,
    ).length === 0
  ) {
    throw new Error(
      "moviePlan fehlt in der gespeicherten Story.",
    );
  }

  if (
    moviePlan
      .targetDurationSeconds !==
    job.targetDurationSeconds
  ) {
    throw new Error(
      "Die bezahlte Videodauer stimmt nicht mit dem MoviePlan überein.",
    );
  }

  if (
    moviePlan.aspectRatio !==
    job.aspectRatio
  ) {
    throw new Error(
      "Das bezahlte Bildformat stimmt nicht mit dem MoviePlan überein.",
    );
  }

  const durationPlan =
    buildVideoDurationPlan(
      job.targetDurationSeconds,
    );

  const videoModel =
    job.videoModel ??
    "seedance-2-fast";

  const segments:
    PlannedSegment[] = [];

  const viralStoryMode =
    story.creationMode ===
    "viral-story";

  const nativeCharacterDialogue =
    viralStoryMode &&
    job.nativeCharacterDialogue ===
      true;

  const nativeDialogueAudioRetry =
    nativeCharacterDialogue &&
    job.nativeDialogueAudioRetry ===
      true;

  const trashTvReactionBoost =
    viralStoryMode &&
    job.trashTvReactionBoost ===
      true;

  const postProducedDialogue =
    !viralStoryMode &&
    job.voiceMode ===
    "dialogue";

  const productionBible =
    asRecord(
      story.productionBible,
    );

  const bibleCharacterNames =
    Array.isArray(
      productionBible.characterBible,
    )
      ? productionBible
          .characterBible
          .map(
            asRecord,
          )
          .map(
            (character) =>
              typeof character.name ===
                "string"
                ? character.name.trim()
                : "",
          )
          .filter(Boolean)
      : [];

  const storyCharacterNames =
    Array.isArray(
      story.characters,
    )
      ? story.characters
          .map(
            asRecord,
          )
          .map(
            (character) =>
              typeof character.name ===
                "string"
                ? character.name.trim()
                : "",
          )
          .filter(Boolean)
      : [];

  const standardDialogueSpeakers =
    (
      bibleCharacterNames.length > 0
        ? bibleCharacterNames
        : storyCharacterNames
    ).slice(
      0,
      3,
    );

  const requiredStandardSpeakerCount =
    Math.min(
      3,
      Math.max(
        1,
        standardDialogueSpeakers.length,
      ),
    );

  const musicVideoMode =
    job.editingStyle ===
      "music-video" &&
    Boolean(
      job.musicVideoAudioUri,
    );

  const audioRecoveryFallback =
    !nativeCharacterDialogue &&
    (
      job.manualRecoveryAttempts ??
      0
    ) >= 2;

  const selectedAudioDirection =
    musicVideoMode
      ? "ORIGINAL SONG WILL BE ADDED IN POST-PRODUCTION (highest priority): Generate visuals only with silent, non-vocal background audio. Do not create music, singing, lyrics, dialogue, narration, voice-over or prominent sound effects. Cut the visible action, performance, camera movement and internal shot changes to the supplied music-video beat and section plan. The complete uploaded customer song replaces all generated audio during finishing."
      : nativeDialogueAudioRetry
      ? "AUDIO-FILTER-SAFE NATIVE CHARACTER DIALOGUE (highest priority): Use clear, emotionally tense but controlled German conversational speech from the visible assigned character with synchronized lips. The physical acting may be extremely dramatic even while the spoken delivery remains controlled. Use quiet neutral room ambience and simple Foley only. No music, narrator, voice-over, off-screen voice, shouting, screaming, crying, whispering, breathy vocalizations, singing, profanity or threats."
      : nativeCharacterDialogue
        ? "NATIVE ON-SCREEN CHARACTER DIALOGUE (highest priority): The visible active character speaks the assigned exact line audibly and naturally in German. Synchronize the voice with that character's mouth, face, emotion and body performance. Only the currently visible assigned character may speak. Voice consistency between separate shots is less important than clear in-scene speech. Never use a narrator, voice-over, off-screen voice, studio commentary, singing or subtitles. Keep ambience and effects quiet underneath the dialogue."
        : audioRecoveryFallback
          ? "RECOVERY AUDIO FALLBACK (highest priority): Generate only clean visual footage with quiet, neutral, non-vocal ambience and simple Foley. Do not generate dialogue, narration, singing, humming, vocalizations or music. Ignore every earlier audio or speech instruction. Exact voices are added during final post-production."
          : viralStoryMode
            ? "POST-PRODUCED CHARACTER DIALOGUE: Generate clean music, ambience and sound effects only. Do not synthesize audible speech in the provider clip. The visible active character performs the planned sentence with natural facial and mouth movement; a fixed studio voice is mixed in during finishing."
            : postProducedDialogue
              ? requiredStandardSpeakerCount ===
                  1
                ? "POST-PRODUCED ON-CAMERA SPOKESPERSON (highest priority): Generate quiet non-vocal ambience, Foley and restrained music only. Do not synthesize audible dialogue, narration, voice-over, off-screen speech, singing or vocalizations. The single visible presenter performs every exact planned line directly to camera with natural sentence-paced mouth, jaw, facial and body movement. One fixed studio voice is mixed scene-synchronously during final finishing. Never invent a second speaker."
                : "POST-PRODUCED MULTI-SPEAKER DIALOGUE (highest priority): Generate quiet non-vocal ambience, Foley and restrained music only. Do not synthesize audible dialogue, narration, voice-over, off-screen speech, singing or vocalizations. The visible active character performs the exact planned line with natural sentence-paced mouth, jaw, facial and body movement. A distinct fixed studio voice for each character is mixed scene-synchronously during final finishing."
              : buildSelectedAudioDirection(
                  job.audioStyle ??
                    "cinematic",

                  job.voiceMode ??
                    "auto",

                  job.spokenLanguage ??
                    "de",

                  job.voiceoverText ??
                    "",

                  job.targetDurationSeconds,
                );

  let dialogueCues:
    DialogueCue[] = [];

  /*
   * =======================================================
   * VIRAL STORY
   * =======================================================
   *
   * Früher:
   * 8-Sekunden-Einzelshots.
   *
   * Neu:
   * 15-Sekunden-Einzelshots.
   *
   * 15s  = 1 Shot
   * 30s  = 2 Shots
   * 60s  = 4 Shots
   * 120s = 8 Shots
   */
  if (
    viralStoryMode
  ) {
    if (
      job.aspectRatio !==
      "9:16"
    ) {
      throw new Error(
        "Der TikTok-Story-Modus benötigt das vertikale Format 9:16.",
      );
    }

    const opening =
      asRecord(
        moviePlan.opening,
      );

    const openingDialogue =
      asRecord(
        opening.dialogue,
      );

    const openingDialogueTurns =
      Array.isArray(
        opening.dialogueTurns,
      )
        ? opening
            .dialogueTurns
            .map(
              asRecord,
            )
        : [];

    const openingDialogues = [
      openingDialogue,
      ...openingDialogueTurns,
    ];

    const rawContinuations =
      Array.isArray(
        moviePlan.continuations,
      )
        ? moviePlan.continuations
        : [];

    const viralBeats = [
      {
        source:
          opening,

        dialogues:
          openingDialogues,
      },

      ...rawContinuations.map(
        (
          item,
          index,
        ) => {
          const continuation =
            asRecord(
              item,
            );

          const dialogueTurns =
            Array.isArray(
              continuation
                .dialogueTurns,
            )
              ? continuation
                  .dialogueTurns
                  .map(
                    asRecord,
                  )
              : [];

          return {
            source:
              continuation,

            dialogues: [
              asRecord(
                continuation
                  .dialogue,
              ),

              ...dialogueTurns,
            ],
          };
        },
      ),
    ];

    const productionBible =
      asRecord(
        story.productionBible,
      );

    const bibleCharacterNames =
      Array.isArray(
        productionBible
          .characterBible,
      )
        ? (
            productionBible
              .characterBible as unknown[]
          )
            .map(
              asRecord,
            )
            .map(
              (
                character,
              ) =>
                typeof character.name ===
                "string"
                  ? character.name.trim()
                  : "",
            )
            .filter(
              Boolean,
            )
        : [];

    const storyCharacterNames =
      Array.isArray(
        story.characters,
      )
        ? story.characters
            .map(
              asRecord,
            )
            .map(
              (
                character,
              ) =>
                typeof character.name ===
                "string"
                  ? character.name.trim()
                  : "",
            )
            .filter(
              Boolean,
            )
        : [];

    const selectedCharacterNames =
      (
        bibleCharacterNames
          .length >= 2
          ? bibleCharacterNames
          : storyCharacterNames
      ).slice(
        0,
        3,
      );

    const providerShotSeconds =
      getViralProviderShotSeconds(
        job.targetDurationSeconds,
        videoModel,
      );

    const shotCount =
      Math.max(
        viralBeats.length,
        Math.ceil(
          job.targetDurationSeconds /
            providerShotSeconds,
        ),
      );

    const selectedShots =
      buildViralPreparedShots(
        story,
        viralBeats,
        shotCount,
        providerShotSeconds,
        selectedAudioDirection,
        nativeCharacterDialogue,
        nativeDialogueAudioRetry,
        trashTvReactionBoost,
      );

    selectedShots.forEach(
      (
        shot,
        index,
      ) => {
        segments.push({
          chapterNumber:
            index + 1,

          targetSeconds:
            shot.targetSeconds,

          openingPrompt:
            shot.prompt,

          continuationPrompts:
            [],
        });
      },
    );

    dialogueCues =
      buildViralDialogueCues(
        selectedShots,
        job.targetDurationSeconds,
      );

    const requiredSpeakers =
      Math.min(
        3,

        Math.max(
          2,
          selectedCharacterNames
            .length,
        ),
      );

    const cueSpeakers =
      new Set(
        dialogueCues.map(
          (cue) =>
            cue.speaker
              .toLocaleLowerCase(
                "de-DE",
              ),
        ),
      );

    if (
      dialogueCues.length <
        requiredSpeakers ||

      cueSpeakers.size <
        requiredSpeakers ||

      !selectedCharacterNames.every(
        (name) => {
          const fullName =
            name.toLocaleLowerCase(
              "de-DE",
            );

          const shortName =
            fullName
              .split(",")[0]
              .trim();

          return (
            cueSpeakers.has(
              fullName,
            ) ||
            cueSpeakers.has(
              shortName,
            )
          );
        },
      )
    ) {
      throw new Error(
        "Der TikTok-Story-Modus enthält keine vollständigen Figurendialoge.",
      );
    }
  } else if (
    job.targetDurationSeconds <=
    120
  ) {
    /*
     * =====================================================
     * STANDARD 15/30/60/120
     * =====================================================
     */

    const opening =
      asRecord(
        moviePlan.opening,
      );

    const openingDialogueTurns =
      Array.isArray(
        opening.dialogueTurns,
      )
        ? opening
            .dialogueTurns
            .map(
              asRecord,
            )
        : [];

    const openingDialogues = [
      asRecord(
        opening.dialogue,
      ),
      ...openingDialogueTurns,
    ];

    const safeOpening = {
      ...opening,

      dialogue:
        postProducedDialogue
          ? {
              enabled:
                false,

              speaker:
                "",

              text:
                "",

              language:
                "",

              voiceDirection:
                "",
            }
          : opening.dialogue,

      dialogueTurns:
        postProducedDialogue
          ? []
          : opening.dialogueTurns,

      veoPrompt:
        removeVisibleTextRenderingInstructions(
          readString(
            opening.veoPrompt,

            "moviePlan.opening.veoPrompt fehlt.",
          ),
        ),
    };

    const openingPrompt = [
      buildOpeningPrompt(
        safeOpening,

        job.aspectRatio,

        job.editingStyle,

        selectedAudioDirection,
      ),

      postProducedDialogue
        ? buildViralVisualDialogueDirection(
            openingDialogues,
          )
        : "",
    ]
      .filter(
        Boolean,
      )
      .join(
        "\n\n",
      );

    const rawContinuations =
      Array.isArray(
        moviePlan.continuations,
      )
        ? moviePlan.continuations
        : [];

    const continuationDialogueShots:
      Record<
        string,
        unknown
      >[][] = [];

    const continuationPrompts =
      rawContinuations.map(
        (item) => {
          const continuation =
            asRecord(
              item,
            );

          const turns =
            Array.isArray(
              continuation
                .dialogueTurns,
            )
              ? continuation
                  .dialogueTurns
                  .map(
                    asRecord,
                  )
              : [];

          const dialogues = [
            asRecord(
              continuation.dialogue,
            ),

            ...turns,
          ];

          continuationDialogueShots.push(
            dialogues,
          );

          const safeContinuation =
            postProducedDialogue
              ? {
                  ...continuation,

                  dialogue: {
                    enabled:
                      false,

                    speaker:
                      "",

                    text:
                      "",

                    language:
                      "",

                    voiceDirection:
                      "",
                  },

                  dialogueTurns:
                    [],
                }
              : continuation;

          return [
            buildMovieContinuationPrompt(
              story as unknown as import(
                "@/types/story"
              ).Story,

              safeContinuation as unknown as import(
                "@/types/story"
              ).MovieContinuation,
            ),

            postProducedDialogue
              ? buildViralVisualDialogueDirection(
                  dialogues,
                )
              : "",

            selectedAudioDirection,
          ]
            .filter(
              Boolean,
            )
            .join(
              "\n\n",
            );
        },
      );

    const expected =
      extensionCountFor(
        job.targetDurationSeconds,
      );

    if (
      continuationPrompts.length !==
      expected
    ) {
      throw new Error(
        `MoviePlan enthält ${continuationPrompts.length} Extensions; erwartet werden ${expected}.`,
      );
    }

    if (
      postProducedDialogue
    ) {
      dialogueCues =
        buildExtensionDialogueCues(
          [
            openingDialogues,
            ...continuationDialogueShots,
          ],

          job.targetDurationSeconds,
        );

      const dialogueSpeakers =
        new Set(
          dialogueCues.map(
            (cue) =>
              cue.speaker
                .toLocaleLowerCase(
                  "de-DE",
                ),
          ),
        );

      const hasEveryExpectedSpeaker =
        standardDialogueSpeakers.every(
          (name) => {
            const fullName =
              name.toLocaleLowerCase(
                "de-DE",
              );

            const shortName =
              fullName
                .split(",")[0]
                .trim();

            return (
              dialogueSpeakers.has(
                fullName,
              ) ||
              dialogueSpeakers.has(
                shortName,
              )
            );
          },
        );

      const requiredDialogueCueCount =
        requiredStandardSpeakerCount ===
          1
          ? job.targetDurationSeconds >
              15
            ? 2
            : 1
          : requiredStandardSpeakerCount;

      if (
        dialogueCues.length <
          requiredDialogueCueCount ||
        dialogueSpeakers.size <
          requiredStandardSpeakerCount ||
        !hasEveryExpectedSpeaker
      ) {
        throw new Error(
          "Der Dialogmodus enthält keine vollständig ausführbare sichtbare Sprache.",
        );
      }
    }

    segments.push({
      chapterNumber:
        1,

      targetSeconds:
        job.targetDurationSeconds,

      openingPrompt,

      continuationPrompts,
    });
  } else {
    /*
     * =====================================================
     * SPÄTERE 180–300 SEKUNDEN
     * =====================================================
     */

    const rawChapters =
      Array.isArray(
        moviePlan.chapters,
      )
        ? moviePlan.chapters
        : [];

    if (
      rawChapters.length !==
      durationPlan
        .chapterTargets
        .length
    ) {
      throw new Error(
        `MoviePlan enthält ${rawChapters.length} Kapitel; erwartet werden ${durationPlan.chapterTargets.length}.`,
      );
    }

    rawChapters.forEach(
      (
        rawChapter,
        index,
      ) => {
        const chapter =
          asRecord(
            rawChapter,
          );

        const targetSeconds =
          durationPlan
            .chapterTargets[
              index
            ];

        const openingPrompt = [
          readString(
            chapter.openingPrompt,

            `Kapitel ${index + 1}: openingPrompt fehlt.`,
          ),

          selectedAudioDirection,
        ].join(
          "\n\n",
        );

        const expected =
          extensionCountFor(
            targetSeconds,
          );

        const supplied =
          Array.isArray(
            chapter
              .continuationPrompts,
          )
            ? chapter
                .continuationPrompts
                .filter(
                  (
                    value,
                  ): value is string =>
                    typeof value ===
                      "string" &&
                    Boolean(
                      value.trim(),
                    ),
                )
                .map(
                  (value) =>
                    value.trim(),
                )
            : [];

        const continuationPrompts =
          Array.from(
            {
              length:
                expected,
            },

            (
              _,
              extensionIndex,
            ) => [
              supplied[
                extensionIndex
              ] ||
                buildChapterContinuationPrompt(
                  moviePlan,
                  chapter,
                  index + 1,
                  extensionIndex +
                    1,
                  expected,
                ),

              selectedAudioDirection,
            ].join(
              "\n\n",
            ),
          );

        segments.push({
          chapterNumber:
            index + 1,

          targetSeconds,

          openingPrompt,

          continuationPrompts,
        });
      },
    );
  }

  const totalExtensions =
    segments.reduce(
      (
        sum,
        segment,
      ) =>
        sum +
        (
          videoModel === "google-veo" ||
          videoModel === "google-veo-fast"
            ? veoExtensionCountFor(
                segment.targetSeconds,
              )
            : segment
                .continuationPrompts
                .length
        ),

      0,
    );

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      renderStage:
        "planning",

      progressPercent:
        Math.max(
          job.progressPercent ??
            0,

          2,
        ),

      totalChapters:
        segments.length,

      totalExtensions,

      startedAt:
        job.startedAt ??
        Date.now(),

      errorMessage:
        undefined,
    },
  );

  return {
    jobId,

    duration:
      job.targetDurationSeconds,

    aspectRatio:
      job.aspectRatio,

    videoModel,

    segments,

    completedSegmentUris:
      nativeCharacterDialogue
        ? (
            job.chapterVideoUris ??
            []
          ).slice(
            0,
            segments.length,
          )
        : [],

    totalExtensions,

    finishing: {
      voiceoverText:
        viralStoryMode
          ? undefined
          : job.voiceoverText,

      voiceoverVoiceName:
        job.voiceoverVoiceName,

      dialogueCues:
        nativeCharacterDialogue
          ? undefined
          : dialogueCues,

      closingText:
        job.closingText,

      spokenLanguage:
        job.spokenLanguage,

      musicTrackUri:
        musicVideoMode
          ? job.musicVideoAudioUri
          : undefined,

      musicTrackDurationSeconds:
        musicVideoMode
          ? job.musicVideoAudioDurationSeconds
          : undefined,
    },
  };
}

async function markRenderDisabledStep(
  jobId: string,
): Promise<void> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    return;
  }

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "pending",

      renderStage:
        "queued",

      progressPercent:
        0,

      errorMessage:
        undefined,
    },
  );
}

async function completeVeoOpening(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
): Promise<string> {
  const operationName =
    await startVeoOpeningStep(
      jobId,
      prompt,
      aspectRatio,
      chapterNumber,
    );

  return await waitForVeoOperation(
    jobId,
    operationName,
  );
}

async function completeVeoExtension(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
): Promise<string> {
  const operationName =
    await startVeoExtensionStep(
      jobId,
      previousVideoUri,
      prompt,
      aspectRatio,
      chapterNumber,
      extensionNumber,
    );

  return await waitForVeoOperation(
    jobId,
    operationName,
  );
}

async function waitForVeoOperation(
  jobId: string,
  operationName: string,
): Promise<string> {
  for (
    let attempt = 0;
    attempt < 150;
    attempt += 1
  ) {
    const status =
      await checkVeoOperationStep(
        jobId,
        operationName,
      );

    if (
      status.done &&
      status.videoUri
    ) {
      return status.videoUri;
    }

    await sleep("10s");
  }

  throw new Error(
    "Google Veo hat die Videoerstellung nicht rechtzeitig abgeschlossen.",
  );
}

async function startVeoOpeningStep(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
): Promise<string> {
  "use step";

  const { jobStore } =
    await import("@/lib/store");

  const { startVideoGeneration } =
    await import("@/lib/veo");

  const job =
    await jobStore.get(jobId);

  if (
    !job ||
    job.paymentStatus !== "paid" ||
    job.videoModel !== "google-veo" &&
    job.videoModel !== "google-veo-fast"
  ) {
    throw new Error(
      "Der Google-Veo-Auftrag ist nicht vollständig freigeschaltet.",
    );
  }

  const operationType =
    chapterNumber === 1
      ? "opening"
      : "chapter-opening";

  if (
    job.currentOperationName &&
    job.currentOperationType === operationType &&
    (
      operationType !== "chapter-opening" ||
      job.currentChapter === chapterNumber
    )
  ) {
    return job.currentOperationName;
  }


  let storedStory:
    Record<
      string,
      unknown
    > = {};

  try {
    storedStory =
      JSON.parse(
        job.prompt,
      ) as Record<
        string,
        unknown
      >;
  } catch {
    /* prepareRenderJobStep validates the stored story before this step. */
  }

  const viralStoryMode =
    storedStory.creationMode ===
    "viral-story";

  const referenceImages =
    viralStoryMode
      ? await (
          await import(
            "@/lib/video-backend/images"
          )
        ).loadViralCharacterReferences(
          Array.isArray(
            storedStory.characters,
          )
            ? storedStory.characters
                .map(
                  (value) =>
                    asRecord(
                      value,
                    ).name,
                )
                .filter(
                  (
                    value,
                  ): value is string =>
                    typeof value ===
                    "string",
                )
            : [],
        )
      : undefined;

  const operationName =
    await startVideoGeneration(
      prompt,
      {
        modelTier:
          job.videoModel === "google-veo-fast"
            ? "fast"
            : "standard",
        aspectRatio,
        referenceImages,
        maxAttempts: 4,
      },
    );

  await jobStore.set(
    jobId,
    {
      ...job,
      provider: "veo",
      status: "processing",
      renderStage:
        chapterNumber > 1
          ? "generating-chapter"
          : "generating-opening",
      currentChapter: chapterNumber,
      currentOperationName: operationName,
      currentOperationType: operationType,
      lastProviderRequestAt: Date.now(),
      errorMessage: undefined,
    },
  );

  return operationName;
}

async function startVeoExtensionStep(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
): Promise<string> {
  "use step";

  const { jobStore } =
    await import("@/lib/store");

  const { startVideoExtension } =
    await import("@/lib/veo");

  const job =
    await jobStore.get(jobId);

  if (
    !job ||
    job.paymentStatus !== "paid" ||
    job.videoModel !== "google-veo" &&
    job.videoModel !== "google-veo-fast"
  ) {
    throw new Error(
      "Der Google-Veo-Auftrag ist nicht vollständig freigeschaltet.",
    );
  }

  if (
    job.currentOperationName &&
    job.currentOperationType === "extension" &&
    job.currentChapter === chapterNumber &&
    job.currentExtension === extensionNumber
  ) {
    return job.currentOperationName;
  }

  const operationName =
    await startVideoExtension(
      previousVideoUri,
      prompt,
      {
        modelTier:
          job.videoModel === "google-veo-fast"
            ? "fast"
            : "standard",
        aspectRatio,
        extensionNumber,
        maxAttempts: 4,
      },
    );

  await jobStore.set(
    jobId,
    {
      ...job,
      provider: "veo",
      status: "processing",
      renderStage: "extending",
      currentChapter: chapterNumber,
      currentExtension: extensionNumber,
      currentOperationName: operationName,
      currentOperationType: "extension",
      lastProviderRequestAt: Date.now(),
      errorMessage: undefined,
    },
  );

  return operationName;
}

async function checkVeoOperationStep(
  jobId: string,
  operationName: string,
): Promise<{
  done: boolean;
  videoUri?: string;
}> {
  "use step";

  const { jobStore } =
    await import("@/lib/store");

  const { checkVideoStatus } =
    await import("@/lib/veo");

  const [job, status] =
    await Promise.all([
      jobStore.get(jobId),
      checkVideoStatus(operationName),
    ]);

  if (!job) {
    throw new Error(
      "Der Google-Veo-Auftrag wurde während der Erstellung nicht gefunden.",
    );
  }

  if (
    status.done &&
    status.videoUri
  ) {
    await jobStore.set(
      jobId,
      {
        ...job,
        videoUri: status.videoUri,
        progressPercent: Math.min(
          88,
          Math.max(
            job.progressPercent ?? 0,
            12 +
              Math.round(
                (
                  (job.currentExtension ?? 0) /
                  Math.max(
                    1,
                    job.totalExtensions ?? 1,
                  )
                ) * 76,
              ),
          ),
        ),
        currentOperationName: undefined,
        currentOperationType: undefined,
        lastProviderPollAt: Date.now(),
      },
    );

    return {
      done: true,
      videoUri: status.videoUri,
    };
  }

  await jobStore.set(
    jobId,
    {
      ...job,
      lastProviderPollAt: Date.now(),
    },
  );

  return { done: false };
}

async function startOpeningVideoStep(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  clipDurationSeconds: number,
  webhookUrl: string,
  plannedRetryDelayMs: number,
): Promise<ProviderStartResult> {
  "use step";

  if (
    process.env
      .SEEDANCE_WORKFLOW_RENDER_ENABLED !==
    "true"
  ) {
    throw new Error(
      "Seedance-Rendering ist deaktiviert.",
    );
  }

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const {
    startVideoGeneration,
  } =
    await import(
      "@/lib/seedance"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (
    !job ||
    job.paymentStatus !==
      "paid"
  ) {
    throw new Error(
      "Der Render-Job ist nicht bezahlt.",
    );
  }

  assertProviderRenderAllowed(
    job.targetDurationSeconds,
  );

  const operationType =
    chapterNumber === 1 &&
    job.generationStrategy !==
      "chaptered"
      ? "opening"
      : "chapter-opening";

  if (
    job.currentOperationName &&
    job.currentOperationType ===
      operationType &&
    (
      operationType !==
        "chapter-opening" ||
      job.currentChapter ===
        chapterNumber
    )
  ) {
    return {
      started:
        true,

      operationName:
        job.currentOperationName,

      reusedExistingOperation:
        true,
    };
  }

  let storedStory:
    Record<
      string,
      unknown
    > = {};

  try {
    storedStory =
      JSON.parse(
        job.prompt,
      ) as Record<
        string,
        unknown
      >;
  } catch {
    /*
     * prepareRenderJobStep liefert
     * bei ungültigem JSON bereits
     * die klare Fehlermeldung.
     */
  }

  const viralStoryMode =
    storedStory.creationMode ===
    "viral-story";

  const referenceImages =
    viralStoryMode
      ? await (
          await import(
            "@/lib/video-backend/images"
          )
        ).loadViralCharacterReferences(
          Array.isArray(
            storedStory.characters,
          )
            ? storedStory.characters
                .map(
                  (value) =>
                    asRecord(
                      value,
                    ).name,
                )
                .filter(
                  (
                    value,
                  ): value is string =>
                    typeof value ===
                    "string",
                )
            : [],
        )
      : undefined;

  const referenceImage =
    !viralStoryMode &&
    chapterNumber === 1 &&
    job.referenceImageUrl
      ? await (
          await import(
            "@/lib/video-backend/images"
          )
        ).loadStoredPreview(
          job.referenceImageUrl,
          job.referenceImageMimeType,
        )
      : undefined;

  let operationName:
    string;

  try {
    operationName =
      await startVideoGeneration(
        prompt,
        {
          modelTier:
            job.videoModel ===
            "seedance-2-original"
              ? "original"
              : "fast",

          aspectRatio,

          referenceImage,

          referenceImages,

          maxAttempts:
            1,

          webhookUrl,

          durationSeconds:
            clipDurationSeconds,
        },
      );
  } catch (error) {
    const {
      getRetryableSeedanceStartError,
    } =
      await import(
        "@/lib/seedance"
      );

    const providerError =
      getRetryableSeedanceStartError(
        error,
      );

    if (
      !providerError ||
      plannedRetryDelayMs <=
        0
    ) {
      throw error;
    }

    const retryAfterMs =
      Math.min(
        12 *
          60 *
          60_000,

        Math.max(
          plannedRetryDelayMs,

          providerError
            .retryAfterMs ??
            0,
        ),
      );

    const nextAttemptAt =
      Date.now() +
      retryAfterMs;

    const message =
      providerError.httpStatus ===
      429
        ? "Das Seedance-Kontingent ist voruebergehend erreicht. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht."
        : "Seedance ist voruebergehend ausgelastet. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht.";

    await jobStore.pauseProvider({
      until:
        nextAttemptAt,

      reason:
        message,

      sourceJobId:
        jobId,

      httpStatus:
        providerError
          .httpStatus,
    });

    await jobStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        renderStage:
          "waiting-provider",

        retryCount:
          (
            job.retryCount ??
            0
          ) + 1,

        nextAttemptAt,

        errorMessage:
          message,
      },
    );

    return {
      started:
        false,

      retryAfterMs,

      httpStatus:
        providerError
          .httpStatus,
    };
  }

  const latest =
    await jobStore.get(
      jobId,
    );

  if (!latest) {
    throw new Error(
      "Render-Job ist nach dem Seedance-Start verschwunden.",
    );
  }

  const totalChapters =
    Math.max(
      1,
      latest.totalChapters ?? 1,
    );

  const activeChapterProgress =
    Math.min(
      84,
      8 +
        Math.round(
          (
            Math.max(
              0,
              chapterNumber - 1,
            ) /
            totalChapters
          ) * 80,
        ),
    );

  await jobStore.set(
    jobId,
    {
      ...latest,

      status:
        "processing",

      renderStage:
        chapterNumber > 1 ||
        latest
          .generationStrategy ===
          "chaptered"
          ? "generating-chapter"
          : "generating-opening",

      progressPercent:
        Math.max(
          latest.progressPercent ?? 0,
          activeChapterProgress,
        ),

      currentChapter:
        chapterNumber,

      currentOperationName:
        operationName,

      currentOperationType:
        operationType,

      lastProviderRequestAt:
        Date.now(),

      nextAttemptAt:
        undefined,

      errorMessage:
        undefined,
    },
  );

  await jobStore
    .clearProviderPause(
      jobId,
    );

  return {
    started:
      true,

    operationName,

    reusedExistingOperation:
      false,
  };
}

startOpeningVideoStep.maxRetries =
  0;

async function startExtensionVideoStep(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
  webhookUrl: string,
  plannedRetryDelayMs: number,
): Promise<ProviderStartResult> {
  "use step";

  if (
    process.env
      .SEEDANCE_WORKFLOW_RENDER_ENABLED !==
    "true"
  ) {
    throw new Error(
      "Seedance-Rendering ist deaktiviert.",
    );
  }

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const {
    startVideoExtension,
  } =
    await import(
      "@/lib/seedance"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (
    !job ||
    job.paymentStatus !==
      "paid"
  ) {
    throw new Error(
      "Der Render-Job ist nicht bezahlt.",
    );
  }

  assertProviderRenderAllowed(
    job.targetDurationSeconds,
  );

  if (
    job.currentOperationName &&
    job.currentOperationType ===
      "extension" &&
    job.currentChapter ===
      chapterNumber &&
    job.currentExtension ===
      extensionNumber
  ) {
    return {
      started:
        true,

      operationName:
        job.currentOperationName,

      reusedExistingOperation:
        true,
    };
  }

  let operationName:
    string;

  try {
    operationName =
      await startVideoExtension(
        previousVideoUri,
        prompt,
        {
          modelTier:
            job.videoModel ===
            "seedance-2-original"
              ? "original"
              : "fast",

          aspectRatio,

          extensionNumber,

          maxAttempts:
            1,

          webhookUrl,

          /*
           * Neue Seedance-Fortsetzungen
           * sind 15 Sekunden lang.
           */
          durationSeconds:
            15,
        },
      );
  } catch (error) {
    const {
      getRetryableSeedanceStartError,
    } =
      await import(
        "@/lib/seedance"
      );

    const providerError =
      getRetryableSeedanceStartError(
        error,
      );

    if (
      !providerError ||
      plannedRetryDelayMs <=
        0
    ) {
      throw error;
    }

    const retryAfterMs =
      Math.min(
        12 *
          60 *
          60_000,

        Math.max(
          plannedRetryDelayMs,

          providerError
            .retryAfterMs ??
            0,
        ),
      );

    const nextAttemptAt =
      Date.now() +
      retryAfterMs;

    const message =
      providerError.httpStatus ===
      429
        ? "Das Seedance-Kontingent ist voruebergehend erreicht. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht."
        : "Seedance ist voruebergehend ausgelastet. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht.";

    await jobStore.pauseProvider({
      until:
        nextAttemptAt,

      reason:
        message,

      sourceJobId:
        jobId,

      httpStatus:
        providerError
          .httpStatus,
    });

    await jobStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        renderStage:
          "waiting-provider",

        retryCount:
          (
            job.retryCount ??
            0
          ) + 1,

        nextAttemptAt,

        errorMessage:
          message,
      },
    );

    return {
      started:
        false,

      retryAfterMs,

      httpStatus:
        providerError
          .httpStatus,
    };
  }

  const latest =
    await jobStore.get(
      jobId,
    );

  if (!latest) {
    throw new Error(
      "Render-Job ist nach dem Seedance-Extension-Start verschwunden.",
    );
  }

  const totalExtensions =
    Math.max(
      1,
      latest.totalExtensions ?? 1,
    );

  const activeExtensionProgress =
    Math.min(
      84,
      8 +
        Math.round(
          (
            extensionNumber /
            (totalExtensions + 1)
          ) * 80,
        ),
    );

  await jobStore.set(
    jobId,
    {
      ...latest,

      status:
        "processing",

      renderStage:
        "extending",

      progressPercent:
        Math.max(
          latest.progressPercent ?? 0,
          activeExtensionProgress,
        ),

      currentChapter:
        chapterNumber,

      currentExtension:
        extensionNumber,

      currentOperationName:
        operationName,

      currentOperationType:
        "extension",

      lastProviderRequestAt:
        Date.now(),

      nextAttemptAt:
        undefined,

      errorMessage:
        undefined,
    },
  );

  await jobStore
    .clearProviderPause(
      jobId,
    );

  return {
    started:
      true,

    operationName,

    reusedExistingOperation:
      false,
  };
}

startExtensionVideoStep.maxRetries =
  0;

async function handleSeedanceWebhookStep(
  jobId: string,
  operationName: string,
  payload: unknown,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
): Promise<WebhookOperationResult> {
  "use step";

  const {
    getRestartableSeedanceOperationError,
    readSeedanceWebhookResult,
  } =
    await import(
      "@/lib/seedance"
    );

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      "Render-Job wurde beim Seedance-Webhook nicht gefunden.",
    );
  }

  try {
    const status =
      readSeedanceWebhookResult(
        operationName,
        payload,
      );

    if (!status.done) {
      await jobStore.set(
        jobId,
        {
          ...job,

          status:
            "processing",

          renderStage:
            "waiting-provider",

          lastProviderPollAt:
            Date.now(),

          currentOperationName:
            operationName,

          errorMessage:
            undefined,
        },
      );

      return {
        completed:
          false,

        providerMessage:
          "Seedance erstellt das Video noch. Die bestehende Operation wird weiter beobachtet.",

        restartAllowed:
          false,
      };
    }

    if (!status.videoUri) {
      throw new Error(
        "Seedance hat den Auftrag abgeschlossen, aber keine Video-URL geliefert.",
      );
    }

    const completedFraction =
      totalExtensions > 0
        ? completedExtensions /
          Math.max(
            1,
            totalExtensions,
          )
        : chapterNumber /
          Math.max(
            1,
            job.totalChapters ??
              1,
          );

    const progress =
      Math.min(
        88,

        5 +
          Math.round(
            completedFraction *
              80,
          ),
      );

    await jobStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        progressPercent:
          Math.max(
            job.progressPercent ??
              0,

            progress,
          ),

        currentChapter:
          chapterNumber,

        lastProviderPollAt:
          Date.now(),

        videoUri:
          status.videoUri,

        currentOperationName:
          undefined,

        currentOperationType:
          undefined,

        errorMessage:
          undefined,
      },
    );

    return {
      completed:
        true,

      videoUri:
        status.videoUri,
    };
  } catch (error) {
    const restartableFailure =
      getRestartableSeedanceOperationError(
        error,
      );

    if (
      !restartableFailure
    ) {
      throw error;
    }

    await jobStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        renderStage:
          "waiting-provider",

        lastProviderPollAt:
          Date.now(),

        currentOperationName:
          undefined,

        currentOperationType:
          undefined,

        errorMessage:
          "Seedance hatte einen internen Serverfehler. Dein bezahlter Auftrag wird automatisch neu gestartet.",
      },
    );

    return {
      completed:
        false,

      providerMessage:
        restartableFailure
          .message,

      restartAllowed:
        true,
    };
  }
}

handleSeedanceWebhookStep.maxRetries =
  0;

async function recoverExistingSeedanceOperationStep(
  jobId: string,
  operationName: string,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
): Promise<WebhookOperationResult> {
  "use step";

  const {
    checkVideoStatus,
    getRestartableSeedanceOperationError,
  } =
    await import(
      "@/lib/seedance"
    );

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      "Render-Job wurde bei der Seedance-Wiederaufnahme nicht gefunden.",
    );
  }

  let status;

  try {
    status =
      await checkVideoStatus(
        operationName,
      );
  } catch (error) {
    const restartableFailure =
      getRestartableSeedanceOperationError(
        error,
      );

    if (
      !restartableFailure
    ) {
      throw error;
    }

    await jobStore.set(
      jobId,
      {
        ...job,

        status:
          "processing",

        renderStage:
          "waiting-provider",

        lastProviderPollAt:
          Date.now(),

        currentOperationName:
          undefined,

        currentOperationType:
          undefined,

        errorMessage:
          "Seedance hatte einen internen Serverfehler. Dein bezahlter Auftrag wird automatisch neu gestartet.",
      },
    );

    return {
      completed:
        false,

      providerMessage:
        restartableFailure
          .message,

      restartAllowed:
        true,
    };
  }

  if (
    !status.done ||
    !status.videoUri
  ) {
    await jobStore.set(
      jobId,
      {
        ...job,

        lastProviderPollAt:
          Date.now(),

        currentOperationName:
          operationName,
      },
    );

    return {
      completed:
        false,

      providerMessage:
        "Die bereits gestartete Seedance-Operation laeuft noch und wird nicht doppelt gestartet.",

      restartAllowed:
        false,
    };
  }

  const completedFraction =
    totalExtensions > 0
      ? completedExtensions /
        Math.max(
          1,
          totalExtensions,
        )
      : chapterNumber /
        Math.max(
          1,
          job.totalChapters ??
            1,
        );

  const progress =
    Math.min(
      88,

      5 +
        Math.round(
          completedFraction *
            80,
        ),
    );

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      progressPercent:
        Math.max(
          job.progressPercent ??
            0,

          progress,
        ),

      currentChapter:
        chapterNumber,

      lastProviderPollAt:
        Date.now(),

      videoUri:
        status.videoUri,

      currentOperationName:
        undefined,

      currentOperationType:
        undefined,

      errorMessage:
        undefined,
    },
  );

  return {
    completed:
      true,

    videoUri:
      status.videoUri,
  };
}

recoverExistingSeedanceOperationStep.maxRetries =
  0;

async function recordChapterStep(
  jobId: string,
  chapterNumber: number,
  chapterUris: string[],
  completedExtensions: number,
  totalExtensions: number,
): Promise<void> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      "Render-Job wurde nach einem Kapitel nicht gefunden.",
    );
  }

  await jobStore.set(
    jobId,
    {
      ...job,

      chapterVideoUris:
        chapterUris,

      currentChapter:
        chapterNumber,

      currentExtension:
        completedExtensions,

      progressPercent:
        Math.min(
          90,

          10 +
            Math.round(
              (
                totalExtensions >
                0
                  ? completedExtensions /
                    Math.max(
                      1,
                      totalExtensions,
                    )
                  : chapterNumber /
                    Math.max(
                      1,

                      job.totalChapters ??
                        1,
                    )
              ) * 80,
            ),
        ),
    },
  );
}

async function markFinalizingStep(
  jobId: string,
  merging: boolean,
): Promise<void> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      "Render-Job wurde vor der Finalisierung nicht gefunden.",
    );
  }

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      renderStage:
        merging
          ? "merging-chapters"
          : "trimming",

      progressPercent:
        92,

      currentOperationName:
        undefined,

      currentOperationType:
        undefined,
    },
  );
}

async function trimFinalVideoStep(
  jobId: string,
  videoUri: string,
  seconds: number,

  finishing:
    PreparedRender["finishing"],
) {
  "use step";

  const {
    trimAndStore,
  } =
    await import(
      "@/lib/video-backend/media"
    );

  return trimAndStore(
    videoUri,
    seconds,
    `finished-videos/${jobId}.mp4`,
    finishing,
  );
}

trimFinalVideoStep.maxRetries =
  0;

async function mergeFinalVideoStep(
  jobId: string,
  chapterUris: string[],
  seconds: number,

  finishing:
    PreparedRender["finishing"],
) {
  "use step";

  const {
    mergeAndStore,
  } =
    await import(
      "@/lib/video-backend/media"
    );

  return mergeAndStore(
    chapterUris,
    seconds,
    `finished-videos/${jobId}.mp4`,
    finishing,
  );
}

mergeFinalVideoStep.maxRetries =
  0;

async function finishRenderJobStep(
  jobId: string,
  pathname: string,
): Promise<void> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      "Render-Job wurde beim Abschluss nicht gefunden.",
    );
  }

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "done",

      renderStage:
        "completed",

      progressPercent:
        100,

      videoUri:
        pathname.startsWith(
          "local:",
        )
          ? pathname
          : `blob:${pathname}`,

      videoUrl:
        undefined,

      videoUrls:
        undefined,

      currentOperationName:
        undefined,

      currentOperationType:
        undefined,

      completedAt:
        Date.now(),

      errorMessage:
        undefined,
    },
  );
}

async function failRenderJobStep(
  jobId: string,
  message: string,
): Promise<void> {
  "use step";

  const {
    jobStore,
  } =
    await import(
      "@/lib/store"
    );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    return;
  }

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "error",

      renderStage:
        "failed",

      errorMessage:
        message,
    },
  );
}

function assertProviderRenderAllowed(
  duration:
    number |
    undefined,
  musicVideoMode = false,
  videoModel: VideoModelId =
    "seedance-2-fast",
): void {
  if (
    videoModel === "google-veo" ||
    videoModel === "google-veo-fast"
  ) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "Google Veo ist nicht konfiguriert.",
      );
    }
  } else if (
    process.env
      .SEEDANCE_WORKFLOW_RENDER_ENABLED !==
      "true" ||
    (
      process.env.SEEDANCE_PROVIDER === "byteplus"
        ? !(
            process.env.BYTEPLUS_ARK_API_KEY ||
            process.env.BYTEPLUS_LAS_API_KEY ||
            process.env.LAS_API_KEY
          )
        : !process.env.FAL_KEY
    )
  ) {
    throw new Error(
      "Seedance-Rendering ist deaktiviert.",
    );
  }

  if (
    !duration ||
    duration >
      (
        musicVideoMode
          ? MUSIC_VIDEO_MAX_DURATION_SECONDS
          : CURRENTLY_RELEASED_MAX_DURATION_SECONDS
      )
  ) {
    throw new Error(
      `Die Videodauer ${duration || "unbekannt"}s ueberschreitet die freigegebene Grenze von ${musicVideoMode ? MUSIC_VIDEO_MAX_DURATION_SECONDS : CURRENTLY_RELEASED_MAX_DURATION_SECONDS}s.`,
    );
  }
}

function readableRenderError(
  error: unknown,
): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error ===
            "object" &&
          error !== null &&
          "message" in
            error &&
          typeof error.message ===
            "string"
        ? error.message
        : "Unbekannter Renderfehler.";

  if (
    rawMessage.includes(
      "No blob credentials found",
    )
  ) {
    return "Die finale Videodatei konnte nicht gespeichert werden. Das vorhandene Rohvideo kann ohne neue KI-Generierung wiederhergestellt werden.";
  }

  if (
    /inlineData.*isn(?:'|’)t supported by this model/i.test(
      rawMessage,
    )
  ) {
    return "Das freigegebene Vorschaubild konnte nicht an die Video-KI übergeben werden. Der Auftrag kann ohne neue Zahlung erneut gestartet werden.";
  }

  if (
    /(?:may contain|contains?).{0,30}(?:real person|real human)|real (?:person|human).{0,30}(?:reference|face)/i.test(
      rawMessage,
    )
  ) {
    return "Seedance hat ein Referenzbild fälschlich als mögliche echte Person eingestuft. Beim erneuten Start wird dieses Bild automatisch entfernt und die Figur ausschließlich aus ihrer schriftlichen Beschreibung erzeugt. Es ist keine neue Zahlung nötig.";
  }

  return rawMessage;
}

/*
 * Neue Seedance-Zeitberechnung:
 *
 * 15 s  -> 0 Extensions
 * 30 s  -> 1 Extension
 * 60 s  -> 3 Extensions
 * 120 s -> 7 Extensions
 *
 * 8 Sekunden bleiben als Legacy-Sonderfall.
 */
function extensionCountFor(
  seconds: number,
): number {
  if (
    seconds <=
    15
  ) {
    return 0;
  }

  return Math.ceil(
    (
      seconds -
      15
    ) /
      15,
  );
}

function seedanceOpeningClipDurationFor(
  targetSeconds: number,
): number {
  return Math.min(
    SEEDANCE_CLIP_DURATION_SECONDS,
    Math.max(
      4,
      Math.round(
        targetSeconds,
      ),
    ),
  );
}

function asRecord(
  value: unknown,
): Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    !Array.isArray(
      value,
    )
  )
    ? value as Record<
        string,
        unknown
      >
    : {};
}

function readString(
  value: unknown,
  error: string,
): string {
  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {
    throw new Error(
      error,
    );
  }

  return value.trim();
}

function selectEvenlyIncludingFinal<T>(
  items:
    readonly T[],
  requestedCount:
    number,
): T[] {
  if (
    requestedCount >=
    items.length
  ) {
    return [
      ...items,
    ];
  }

  if (
    requestedCount <=
    1
  ) {
    return items.length >
      0
      ? [
          items[0],
        ]
      : [];
  }

  return [
    ...items.slice(
      0,
      requestedCount -
        1,
    ),

    items[
      items.length -
        1
    ],
  ];
}

function dialogueSpeakerMatches(
  characterName: string,
  speakerName: string,
): boolean {
  const fullName =
    characterName
      .toLocaleLowerCase(
        "de-DE",
      );

  const shortName =
    fullName
      .split(",")[0]
      .trim();

  const normalizedSpeaker =
    speakerName
      .toLocaleLowerCase(
        "de-DE",
      );

  return (
    normalizedSpeaker ===
      fullName ||
    normalizedSpeaker ===
      shortName
  );
}

function selectViralShotsIncludingCharacters<
  T extends {
    dialogues:
      readonly Record<
        string,
        unknown
      >[];
  },
>(
  items:
    readonly T[],
  requestedCount:
    number,
  characterNames:
    readonly string[],
): T[] {
  if (
    requestedCount >=
    items.length
  ) {
    return [
      ...items,
    ];
  }

  if (
    requestedCount <=
    1
  ) {
    return items.length >
      0
      ? [
          items[0],
        ]
      : [];
  }

  const lastIndex =
    items.length -
    1;

  const selectedIndices =
    new Set([
      ...Array.from(
        {
          length:
            requestedCount -
            1,
        },

        (
          _,
          index,
        ) =>
          index,
      ),

      lastIndex,
    ]);

  const shotIncludesCharacter =
    (
      shotIndex:
        number,

      characterName:
        string,
    ) =>
      items[
        shotIndex
      ].dialogues.some(
        (value) => {
          const dialogue =
            readViralDialogue(
              value,
            );

          return (
            dialogue !==
              null &&
            dialogueSpeakerMatches(
              characterName,
              dialogue.speaker,
            )
          );
        },
      );

  const selectionIncludesCharacter =
    (
      indices:
        ReadonlySet<
          number
        >,

      characterName:
        string,
    ) =>
      [
        ...indices,
      ].some(
        (index) =>
          shotIncludesCharacter(
            index,
            characterName,
          ),
      );

  for (
    const missingCharacter
    of characterNames
  ) {
    if (
      selectionIncludesCharacter(
        selectedIndices,
        missingCharacter,
      )
    ) {
      continue;
    }

    const replacementIndex =
      items.findIndex(
        (
          _,
          index,
        ) =>
          !selectedIndices.has(
            index,
          ) &&
          shotIncludesCharacter(
            index,
            missingCharacter,
          ),
      );

    if (
      replacementIndex <
      0
    ) {
      continue;
    }

    const charactersToKeep =
      characterNames.filter(
        (
          characterName,
        ) =>
          selectionIncludesCharacter(
            selectedIndices,
            characterName,
          ),
      );

    const removableIndex =
      [
        ...selectedIndices,
      ]
        .filter(
          (index) =>
            index !==
              0 &&
            index !==
              lastIndex,
        )
        .reverse()
        .find(
          (index) => {
            const candidateIndices =
              new Set(
                selectedIndices,
              );

            candidateIndices.delete(
              index,
            );

            candidateIndices.add(
              replacementIndex,
            );

            return [
              ...charactersToKeep,
              missingCharacter,
            ].every(
              (
                characterName,
              ) =>
                selectionIncludesCharacter(
                  candidateIndices,
                  characterName,
                ),
            );
          },
        );

    if (
      removableIndex !==
      undefined
    ) {
      selectedIndices.delete(
        removableIndex,
      );

      selectedIndices.add(
        replacementIndex,
      );
    }
  }

  return [
    ...selectedIndices,
  ]
    .sort(
      (
        left,
        right,
      ) =>
        left -
        right,
    )
    .map(
      (index) =>
        items[index],
    );
}

function readViralDialogue(
  value:
    Record<
      string,
      unknown
    >,
): {
  speaker: string;
  text: string;
  voiceDirection: string;
} | null {
  if (
    value.enabled !==
    true
  ) {
    return null;
  }

  const speaker =
    typeof value.speaker ===
    "string"
      ? value.speaker.trim()
      : "";

  const text =
    typeof value.text ===
    "string"
      ? value.text.trim()
      : "";

  const voiceDirection =
    typeof value.voiceDirection ===
    "string"
      ? value.voiceDirection
          .trim()
          .slice(
            0,
            180,
          )
      : "Natural, concise and emotionally believable delivery.";

  const wordCount =
    text
      .split(/\s+/)
      .filter(
        Boolean,
      )
      .length;

  if (
    !speaker ||
    !text ||
    wordCount > 12 ||
    text.length > 140
  ) {
    return null;
  }

  return {
    speaker,
    text,
    voiceDirection,
  };
}

const DIALOGUE_VOICES = [
  "Kore",
  "Puck",
  "Aoede",
  "Charon",
  "Orus",
  "Leda",
  "Fenrir",
  "Zephyr",
] as const;

function getFixedVoiceName(
  speaker: string,
  assignments:
    Map<
      string,
      string
    >,
): string {
  const normalized =
    speaker
      .toLocaleLowerCase(
        "de-DE",
      );

  const existing =
    assignments.get(
      normalized,
    );

  if (existing) {
    return existing;
  }

  const character =
    VIRAL_CHARACTERS.find(
      (candidate) =>
        candidate.name
          .toLocaleLowerCase(
            "de-DE",
          ) ===
          normalized ||
        candidate.shortName
          .toLocaleLowerCase(
            "de-DE",
          ) ===
          normalized,
    );

  if (character) {
    assignments.set(
      normalized,
      character.voiceName,
    );

    return character.voiceName;
  }

  const usedVoices =
    new Set(
      assignments.values(),
    );

  const unusedVoice =
    DIALOGUE_VOICES.find(
      (voice) =>
        !usedVoices.has(
          voice,
        ),
    );

  const hash = [
    ...normalized,
  ].reduce(
    (
      sum,
      characterValue,
    ) =>
      sum +
      characterValue.charCodeAt(
        0,
      ),

    0,
  );

  const voiceName =
    unusedVoice ??
    DIALOGUE_VOICES[
      hash %
        DIALOGUE_VOICES.length
    ];

  assignments.set(
    normalized,
    voiceName,
  );

  return voiceName;
}

/*
 * Veo erzeugt zuerst 8 Sekunden und erweitert danach
 * jeweils um ungefähr 7 Sekunden. Das fertige Ergebnis
 * wird anschließend exakt auf die bezahlte Länge geschnitten.
 */
function veoExtensionCountFor(
  seconds: number,
): number {
  if (seconds <= 8) {
    return 0;
  }

  return Math.ceil(
    (seconds - 8) / 7,
  );
}

function buildViralStudioVoiceDirection(
  speaker: string,
  text: string,
): string {
  const value =
    `${speaker} ${text}`
      .toLocaleLowerCase(
        "de-DE",
      );

  const pronunciationGuides = [
    ["ruby", "Ruby wie Ruh-bi"],
    ["bano", "Bano wie Bah-no"],
    ["pina", "Pina wie Pii-na"],
    ["limo", "Limo wie Lii-mo"],
    ["melo", "Melo wie Mee-lo"],
    ["ora", "Ora wie Oh-ra"],
    ["gino", "Gino wie Dschii-no"],
    ["ava", "Ava wie Ah-va"],
  ]
    .filter(
      ([name]) =>
        value.includes(name),
    )
    .map(
      ([, guide]) =>
        guide,
    );

  return [
    "Energetic but controlled German reality-TV dialogue.",
    "Use crisp natural Hochdeutsch, clear consonants and complete word endings.",
    "Speak at conversational volume without shouting, screaming, whispering, sobbing or breathy effects.",
    "Keep the emotional drama in timing and emphasis, not distorted pronunciation.",
    pronunciationGuides.length > 0
      ? `Pronunciation guide: ${pronunciationGuides.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getViralProviderShotSeconds(
  targetDurationSeconds: number,
  videoModel: VideoModelId,
): number {
  if (
    videoModel === "google-veo" ||
    videoModel === "google-veo-fast"
  ) {
    return 8;
  }

  if (targetDurationSeconds <= 8) {
    return 8;
  }

  if (targetDurationSeconds <= 30) {
    return 5;
  }

  if (targetDurationSeconds <= 60) {
    return 10;
  }

  return 15;
}

function distributeViralBeatShotCounts(
  beatCount: number,
  shotCount: number,
): number[] {
  const safeBeatCount =
    Math.max(1, beatCount);

  const safeShotCount =
    Math.max(
      safeBeatCount,
      shotCount,
    );

  const baseCount =
    Math.floor(
      safeShotCount /
        safeBeatCount,
    );

  const extraCount =
    safeShotCount %
    safeBeatCount;

  return Array.from(
    {
      length:
        safeBeatCount,
    },
    (
      _,
      index,
    ) =>
      baseCount +
      (index < extraCount
        ? 1
        : 0),
  );
}

function distributeViralDialogues(
  dialogues:
    readonly Record<
      string,
      unknown
    >[],
  phaseCount: number,
): Record<string, unknown>[][] {
  const chunks =
    Array.from(
      {
        length:
          Math.max(
            1,
            phaseCount,
          ),
      },
      () =>
        [] as Record<
          string,
          unknown
        >[],
    );

  const validDialogues =
    dialogues.filter(
      (dialogue) =>
        readViralDialogue(
          dialogue,
        ) !== null,
    );

  validDialogues.forEach(
    (
      dialogue,
      index,
    ) => {
      const destination =
        Math.min(
          chunks.length - 1,
          Math.floor(
            index *
              chunks.length /
              Math.max(
                1,
                validDialogues.length,
              ),
          ),
        );

      chunks[destination].push(
        dialogue,
      );
    },
  );

  return chunks;
}

function buildViralFocusedPhaseDirection(
  phaseIndex: number,
  phaseCount: number,
  isFinalShot: boolean,
): string {
  if (phaseCount <= 1) {
    return [
      "Play exactly one coherent reality-TV story beat with no unrelated subplot.",
      "Use at most three motivated shots: the concrete action or proof, the direct reaction, then one answer or reveal.",
      isFinalShot
        ? "End on the episode's unresolved physical cliffhanger and hold the shocked reaction."
        : "End on a clear reaction that motivates the next clip.",
    ].join(" ");
  }

  if (phaseIndex === 0) {
    return [
      "Show the causal event itself first, then the exact instant a character witnesses or discovers it.",
      "Do not begin with an explanation, phone, receipt or generic shocked face.",
      "End on the witness understanding what happened.",
    ].join(" ");
  }

  if (
    phaseIndex ===
    phaseCount - 1
  ) {
    return [
      "Show the immediate counter-reveal, visible consequence or unmistakable new evidence.",
      isFinalShot
        ? "Finish on one unresolved physical cliffhanger and the strongest readable reaction of the episode."
        : "Finish on a concrete reaction or action that continues the same conflict.",
      "Do not reconcile or add a new unrelated secret.",
    ].join(" ");
  }

  return [
    "Stage the direct accusation and its immediate relevant answer.",
    "Keep the active speaker's face readable and let the other character react silently.",
    "Do not change subject, location or evidence.",
  ].join(" ");
}

function buildViralFocusedShotPrompt(
  story:
    Record<
      string,
      unknown
    >,
  source:
    Record<
      string,
      unknown
    >,
  dialogues:
    readonly Record<
      string,
      unknown
    >[],
  shotNumber: number,
  totalShots: number,
  beatNumber: number,
  totalBeats: number,
  phaseIndex: number,
  phaseCount: number,
  targetSeconds: number,
  selectedAudioDirection: string,
  nativeCharacterDialogue: boolean,
  nativeDialogueAudioRetry: boolean,
  trashTvReactionBoost: boolean,
): string {
  const title =
    typeof story.title ===
      "string"
      ? story.title
      : "TikTok microdrama";

  const summary =
    typeof story.summary ===
      "string"
      ? story.summary
      : "";

  const visibleBeat = [
    source.hook,
    source.storyBeat,
    source.action,
    source.actionContinuation,
  ]
    .filter(
      (
        value,
      ): value is string =>
        typeof value ===
          "string" &&
        value.trim().length >
          0,
    )
    .join(" ");

  const emotionalBeat =
    typeof source.emotionalBeat ===
      "string"
      ? source.emotionalBeat
      : "Tense, emotionally readable reality-TV conflict.";

  const isFinalShot =
    shotNumber ===
    totalShots;

  return [
    `EXACTLY ${targetSeconds} SECONDS. Vertical 9:16 social-video shot ${shotNumber} of ${totalShots}, story beat ${beatNumber} of ${totalBeats}.`,

    `STORY: ${title}. ${summary}`,

    buildViralReferenceDirection(
      story,
    ),

    `CURRENT VISIBLE BEAT: ${visibleBeat || summary}`,

    `EMOTION: ${emotionalBeat}`,

    buildViralFocusedPhaseDirection(
      phaseIndex,
      phaseCount,
      isFinalShot,
    ),

    "ONE CAUSAL MOMENT ONLY: every gesture, reaction and camera cut must serve this exact beat. Do not compress the entire episode into this clip. Do not repeat an earlier beat.",

    "REALITY-TV PERFORMANCE: natural conversational timing with sharp interruptions, accusing looks, defensive posture and one strong readable reaction. Nobody presents to camera or stands neutrally. Keep the conflict non-violent.",

    trashTvReactionBoost
      ? "REACTION BOOST: make the final facial and body reaction bold and instantly readable on a phone screen without distorting anatomy."
      : "Keep expressions emotionally strong but anatomically stable.",

    buildViralVisualDialogueDirection(
      dialogues,
      nativeCharacterDialogue,
      nativeDialogueAudioRetry,
    ),

    selectedAudioDirection,

    "CAMERA: one or two motivated shots maximum for clips under eight seconds; stable eyelines, readable faces, no random montage, no whip-pan chaos and no unnecessary establishing shot.",

    "QUALITY LOCK: stable fruit heads and faces, exact outfits, realistic hands, clean lip movement, stable lighting, no humans, no extra characters, no duplicated bodies, no morphing, no text, no subtitles, no logos and no watermark.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildViralPreparedShots(
  story:
    Record<
      string,
      unknown
    >,
  beats:
    readonly ViralBeatSource[],
  shotCount: number,
  targetSeconds: number,
  selectedAudioDirection: string,
  nativeCharacterDialogue: boolean,
  nativeDialogueAudioRetry: boolean,
  trashTvReactionBoost: boolean,
): ViralPreparedShot[] {
  const shotCounts =
    distributeViralBeatShotCounts(
      beats.length,
      shotCount,
    );

  const shots:
    ViralPreparedShot[] = [];

  beats.forEach(
    (
      beat,
      beatIndex,
    ) => {
      const phaseCount =
        shotCounts[
          beatIndex
        ];

      const dialogueChunks =
        distributeViralDialogues(
          beat.dialogues,
          phaseCount,
        );

      dialogueChunks.forEach(
        (
          dialogues,
          phaseIndex,
        ) => {
          const shotNumber =
            shots.length + 1;

          shots.push({
            targetSeconds,
            dialogues,
            prompt:
              buildViralFocusedShotPrompt(
                story,
                beat.source,
                dialogues,
                shotNumber,
                shotCount,
                beatIndex + 1,
                beats.length,
                phaseIndex,
                phaseCount,
                targetSeconds,
                selectedAudioDirection,
                nativeCharacterDialogue,
                nativeDialogueAudioRetry,
                trashTvReactionBoost,
              ),
          });
        },
      );
    },
  );

  return shots;
}

function buildViralDialogueCues(
  dialogueShots:
    readonly ViralPreparedShot[],

  targetDurationSeconds:
    number,
): DialogueCue[] {
  const cues:
    DialogueCue[] = [];

  const voiceAssignments =
    new Map<
      string,
      string
    >();

  let elapsedSeconds =
    0;

  dialogueShots.forEach(
    (
      shot,
    ) => {
      const shotStartSeconds =
        elapsedSeconds;

      elapsedSeconds +=
        shot.targetSeconds;

      const dialogues =
        shot.dialogues
          .map(
            readViralDialogue,
          )
          .filter(
            (
              dialogue,
            ): dialogue is NonNullable<
              ReturnType<
                typeof readViralDialogue
              >
            > =>
              dialogue !==
              null,
          );

      if (
        dialogues.length ===
        0
      ) {
        return;
      }

      const firstCueStartSeconds =
        shotStartSeconds +
        0.45;

      const dialogueWindowSeconds =
        Math.min(
          Math.max(
            1.2,
            shot.targetSeconds -
              0.9,
          ),

          Math.max(
            2,

            targetDurationSeconds +
              0.8 -
              firstCueStartSeconds,
          ),
        );

      const turnWindowSeconds =
        dialogueWindowSeconds /
        dialogues.length;

      dialogues.forEach(
        (
          dialogue,
          turnIndex,
        ) => {
          cues.push({
            startSeconds:
              firstCueStartSeconds +
              turnIndex *
                turnWindowSeconds,

            maximumDurationSeconds:
              Math.min(
                11.5,

                Math.max(
                  1.2,

                  turnWindowSeconds -
                    0.15,
                ),
              ),

            speaker:
              dialogue.speaker,

            text:
              dialogue.text,

            voiceName:
              getFixedVoiceName(
                dialogue.speaker,
                voiceAssignments,
              ),

            voiceDirection:
              buildViralStudioVoiceDirection(
                dialogue.speaker,
                dialogue.text,
              ),
          });
        },
      );
    },
  );

  return cues;
}

/*
 * Standard-Extension-Dialog:
 *
 * Neu:
 * 0–15, 15–30, 30–45 ...
 *
 * Ein alter 8-Sekunden-Auftrag wird
 * beim ersten Shot weiterhin korrekt
 * behandelt.
 */
function buildExtensionDialogueCues(
  dialogueShots:
    readonly (
      readonly Record<
        string,
        unknown
      >[]
    )[],

  targetDurationSeconds:
    number,
): DialogueCue[] {
  const cues:
    DialogueCue[] = [];

  const voiceAssignments =
    new Map<
      string,
      string
    >();

  const legacyEightSecond =
    targetDurationSeconds ===
    8;

  dialogueShots.forEach(
    (
      values,
      shotIndex,
    ) => {
      const dialogues =
        values
          .map(
            readViralDialogue,
          )
          .filter(
            (
              dialogue,
            ): dialogue is NonNullable<
              ReturnType<
                typeof readViralDialogue
              >
            > =>
              dialogue !==
              null,
          );

      if (
        dialogues.length ===
        0
      ) {
        return;
      }

      const shotStartSeconds =
        legacyEightSecond
          ? 0
          : shotIndex *
            SEEDANCE_CLIP_DURATION_SECONDS;

      const shotDurationSeconds =
        legacyEightSecond
          ? 8
          : SEEDANCE_CLIP_DURATION_SECONDS;

      const firstCueStartSeconds =
        shotStartSeconds +
        0.45;

      const availableEndSeconds =
        Math.min(
          shotStartSeconds +
            shotDurationSeconds -
            0.3,

          targetDurationSeconds +
            0.8,
        );

      const dialogueWindowSeconds =
        Math.max(
          1.2,

          availableEndSeconds -
            firstCueStartSeconds,
        );

      const turnWindowSeconds =
        dialogueWindowSeconds /
        dialogues.length;

      dialogues.forEach(
        (
          dialogue,
          turnIndex,
        ) => {
          cues.push({
            startSeconds:
              firstCueStartSeconds +
              turnIndex *
                turnWindowSeconds,

            maximumDurationSeconds:
              Math.min(
                11.5,

                Math.max(
                  1.1,

                  turnWindowSeconds -
                    0.12,
                ),
              ),

            speaker:
              dialogue.speaker,

            text:
              dialogue.text,

            voiceName:
              getFixedVoiceName(
                dialogue.speaker,
                voiceAssignments,
              ),

            voiceDirection:
              dialogue
                .voiceDirection,
          });
        },
      );
    },
  );

  return cues;
}

function buildDialogueCuesFromStoredPrompt(
  prompt: string,
  targetDurationSeconds: number,
  videoModel: VideoModelId,
): DialogueCue[] {
  try {
    const story =
      JSON.parse(
        prompt,
      ) as Record<
        string,
        unknown
      >;

    const moviePlan =
      asRecord(
        story.moviePlan,
      );

    const opening =
      asRecord(
        moviePlan.opening,
      );

    const continuations =
      Array.isArray(
        moviePlan.continuations,
      )
        ? moviePlan
            .continuations
            .map(
              asRecord,
            )
        : [];

    const dialogueShots = [
      [
        asRecord(
          opening.dialogue,
        ),

        ...(
          Array.isArray(
            opening.dialogueTurns,
          )
            ? opening
                .dialogueTurns
                .map(
                  asRecord,
                )
            : []
        ),
      ],

      ...continuations.map(
        (continuation) => [
          asRecord(
            continuation.dialogue,
          ),

          ...(
            Array.isArray(
              continuation
                .dialogueTurns,
            )
              ? continuation
                  .dialogueTurns
                  .map(
                    asRecord,
                  )
              : []
          ),
        ],
      ),
    ];

    if (
      story.creationMode ===
      "viral-story"
    ) {
      const providerShotSeconds =
        getViralProviderShotSeconds(
          targetDurationSeconds,
          videoModel,
        );

      const shotCount =
        Math.max(
          dialogueShots.length,

          Math.ceil(
            targetDurationSeconds /
              providerShotSeconds,
          ),
        );

      const shotCounts =
        distributeViralBeatShotCounts(
          dialogueShots.length,
          shotCount,
        );

      const preparedShots:
        ViralPreparedShot[] = [];

      dialogueShots.forEach(
        (
          dialogues,
          beatIndex,
        ) => {
          const dialogueChunks =
            distributeViralDialogues(
              dialogues,
              shotCounts[
                beatIndex
              ],
            );

          dialogueChunks.forEach(
            (chunk) => {
              preparedShots.push({
                targetSeconds:
                  providerShotSeconds,
                prompt:
                  "",
                dialogues:
                  chunk,
              });
            },
          );
        },
      );

      return buildViralDialogueCues(
        preparedShots,
        targetDurationSeconds,
      );
    }

    return buildExtensionDialogueCues(
      dialogueShots,
      targetDurationSeconds,
    );
  } catch {
    return [];
  }
}

function buildViralVisualDialogueDirection(
  values:
    readonly Record<
      string,
      unknown
    >[],

  nativeCharacterDialogue =
    false,

  nativeDialogueAudioRetry =
    false,
): string {
  const dialogues =
    values
      .map(
        readViralDialogue,
      )
      .filter(
        (
          dialogue,
        ): dialogue is NonNullable<
          ReturnType<
            typeof readViralDialogue
          >
        > =>
          dialogue !==
          null,
      );

  const renderedDialogues =
    dialogues.map(
      (dialogue) => ({
        ...dialogue,

        text:
          nativeDialogueAudioRetry
            ? buildAudioFilterSafeDramaLine(
                dialogue.speaker,
                dialogue.text,
              )
            : dialogue.text,

        voiceDirection:
          nativeDialogueAudioRetry
            ? "Calm, clear, ordinary conversational German; no shouting, crying, whispering or vocal effects."
            : dialogue
                .voiceDirection,
      }),
    );

  if (
    dialogues.length ===
    0
  ) {
    return "No character speaks in this shot. Use reaction acting and clean background audio only.";
  }

  return [
    nativeCharacterDialogue
      ? "MANDATORY NATIVE ON-SCREEN SPEAKING SEQUENCE:"
      : "VISIBLE SPEAKING SEQUENCE:",

    ...renderedDialogues.map(
      (
        dialogue,
        index,
      ) =>
        `${index + 1}. ${dialogue.speaker}: "${dialogue.text}" — ${dialogue.voiceDirection}`,
    ),

    nativeCharacterDialogue
      ? "The named visible characters themselves must say these exact words audibly, in this order, one at a time. Show each active speaker's face and mouth clearly and synchronize natural mouth, jaw and facial movement to their own voice. Never turn these lines into narration, voice-over, off-screen speech or speech by another character."
      : "Show the currently active character's face and mouth clearly, then shift focus naturally to the next speaker. Create natural mouth, jaw and facial movement paced to each short sentence, but do not synthesize audible words inside the provider clip. The fixed studio voices are added later.",
  ].join(
    "\n",
  );
}

function buildAudioFilterSafeDramaLine(
  speaker: string,
  originalText: string,
): string {
  const lines = [
    "Warum hast du uns die Wahrheit verschwiegen?",
    "Jetzt erfahren alle, was wirklich passiert ist.",
    "Damit habe ich wirklich nicht gerechnet.",
    "Diese Überraschung verändert jetzt einfach alles.",
  ] as const;

  const seed =
    `${speaker}:${originalText}`;

  const hash = [
    ...seed,
  ].reduce(
    (
      sum,
      character,
    ) =>
      sum +
      character.charCodeAt(
        0,
      ),

    0,
  );

  return lines[
    hash %
      lines.length
  ];
}

function buildViralReferenceDirection(
  story:
    Record<
      string,
      unknown
    >,
): string {
  const productionBible =
    asRecord(
      story.productionBible,
    );

  const characters =
    Array.isArray(
      productionBible
        .characterBible,
    )
      ? productionBible
          .characterBible
          .map(
            asRecord,
          )
      : [];

  const identityList =
    characters
      .map(
        (character) =>
          [
            typeof character.name ===
            "string"
              ? character.name
              : "Character",

            typeof character.fixedAppearance ===
            "string"
              ? character
                  .fixedAppearance
              : "",

            typeof character.clothing ===
            "string"
              ? `clothing=${character.clothing}`
              : "",
          ]
            .filter(
              Boolean,
            )
            .join(
              ": ",
            ),
      )
      .filter(
        Boolean,
      )
      .join(
        "\n",
      );

  return [
    "HIGHEST-PRIORITY VIRAL FRUIT REALITY-TV LOCK:",

    "The supplied asset reference images define the exact immutable identity of the selected adult fruit characters. They are identity references, not a required first frame.",

    "Recompose the characters naturally for this shot while preserving fruit species, head geometry, facial features, body proportions, outfit, colors, shoes and accessories exactly.",

    "CLOSED CAST: show only the selected referenced fruit characters. Never show humans, hosts, extras, bystanders, audiences, unreferenced hands, silhouettes, reflections of other people, crowds or additional fruit characters.",

    "Never merge two characters, swap their outfits, change their fruit type, create a human face or human head, duplicate a character or introduce any unreferenced character. Every visible head remains the exact fruit head from its reference for the entire shot.",

    "WORLD LOCK: every shot takes place in the same luxurious tropical dating-show villa with pool terrace, fire pit, palms and warm evening light. Allowed zones are the fire pit, pool terrace, lounge and bedroom of that same villa. Never use an office, warehouse, classroom, street, studio or generic neutral room.",

    "TEXT-FREE FRAME: absolutely no subtitles, closed captions, lower thirds, title cards, speech bubbles, letters, words, numbers, logos, watermarks, signs, name tags or readable text on phones, screens, luggage, clothing or props. The primary proof must be a witnessed action or an unmistakable physical situation with clear ownership and context. A phone, paper, photo or receipt may only confirm a secondary detail and must never carry the plot alone.",

    identityList
      ? `LOCKED IDENTITIES:\n${identityList}`
      : "",
  ]
    .filter(
      Boolean,
    )
    .join(
      "\n",
    );
}

function buildViralTrashTvDirection(
  reactionBoost =
    false,
): string {
  return [
    "TIKTOK TRASH-TV DRAMA (mandatory):",

    "Stage an exaggerated interpersonal reality-show confrontation between the fruit characters: accusation, secret, betrayal, jealousy or alliance, escalating reactions, a sharp reveal and a dramatic payoff.",

    "SHOW, THEN CONFRONT: first show the forbidden action, discovery or unmistakable physical evidence in context; then cut to the witness discovering it; only then stage the accusation and denial. Never substitute a generic phone close-up, receipt or unexplained prop for the actual event.",

    "Every shot contains an active visible verbal argument, never a calm explanatory conversation. Characters interrupt each other, point accusingly, throw their hands up, invade personal space without touching, turn away in outrage, snap back, roll their eyes, exchange hostile side-eye, recoil in disbelief and perform huge double-takes.",

    "Include at least three unmistakably exaggerated physical reaction beats in every 15-second shot. Use motivated shot-reverse-shot coverage and tight reaction close-ups so the conflict reads instantly on a phone screen.",

    "Nobody stands neutrally or behaves like a presenter. Keep the dispute non-violent: no hitting, pushing, injury or physical harm.",

    reactionBoost
      ? "MAXIMUM REACTION BOOST: Push facial expressions, gestures, timing and confrontational body language far beyond everyday realism, like the loudest peak moment of sensational reality television. The characters visibly argue throughout the shot and finish on a giant shocked, offended or triumphant reaction."
      : "",

    "This is fictional entertainment, never a documentary, report, educational explainer, interview, presenter segment or observational nature film.",
  ]
    .filter(
      Boolean,
    )
    .join(
      "\n",
    );
}

function buildViralMicrodramaBeatDirection(
  shotNumber: number,
  totalShots: number,
): string {
  let storyPhase:
    string;

  if (
    totalShots <=
    1
  ) {
    storyPhase =
      "Compress the full arc into this shot: show the forbidden action itself, its immediate discovery, direct confrontation, counter-reveal and an unresolved final sting.";
  } else if (
    shotNumber ===
    1
  ) {
    storyPhase =
      "COLD OPEN: Start on the forbidden action itself or the exact instant it is discovered. Show who does what to whom before the accusation; never begin with a phone, receipt, backstory, recap or calm setup.";
  } else if (
    shotNumber ===
    totalShots
  ) {
    storyPhase =
      "CLIFFHANGER: Give one partial answer, then reveal a bigger secret or new piece of evidence. Finish on a huge shocked reaction, an opening door, an incriminating prop or a half-revealed secret. Do not resolve, reconcile or settle into a calm ending.";
  } else if (
    shotNumber ===
    totalShots -
      1
  ) {
    storyPhase =
      "CONFRONTATION: Force a face-to-face accusation, interruption and counter-reveal. Reverse who appears guilty and push reactions to their highest level so far.";
  } else if (
    shotNumber ===
    2
  ) {
    storyPhase =
      "DISCOVERY: A character directly witnesses an action or finds physical evidence whose owner and meaning are visually unmistakable. Turn that discovery into a direct accusation and end with a specific contradictory fact.";
  } else {
    storyPhase =
      "ESCALATION: Break an alliance, expose a contradiction or introduce a witness from the locked cast. Every action must tighten the same central scandal.";
  }

  return [
    `VIRAL MICRODRAMA BEAT ${shotNumber}/${totalShots} (mandatory):`,

    storyPhase,

    "Use purposeful multi-shot editing inside the 15 seconds: 0.0–2.0s shock cold open; CUT TO 2.0–5.0s wide proof of the action or discovery; CUT TO 5.0–9.0s accused character answering; CUT TO 9.0–12.0s witness or counter-reaction; CUT TO 12.0–15.0s a new visible reveal and hard reaction ending.",

    "Keep every individual line punchy and no longer than nine words. Show the active speaker's face and sentence-paced mouth movement clearly. No narrator, no voice-over and no off-screen speech.",
  ].join(
    "\n",
  );
}

function buildViralIndependentShotPrompt(
  story:
    Record<
      string,
      unknown
    >,

  continuation:
    Record<
      string,
      unknown
    >,

  shotNumber:
    number,

  totalShots:
    number,

  selectedAudioDirection:
    string,

  nativeCharacterDialogue:
    boolean,

  nativeDialogueAudioRetry:
    boolean,

  trashTvReactionBoost:
    boolean,
): string {
  const title =
    typeof story.title ===
    "string"
      ? story.title
      : "TikTok story";

  const summary =
    typeof story.summary ===
    "string"
      ? story.summary
      : "";

  const isFinalShot =
    shotNumber ===
    totalShots;

  const dialogueTurns =
    Array.isArray(
      continuation
        .dialogueTurns,
    )
      ? continuation
          .dialogueTurns
          .map(
            asRecord,
          )
      : [];

  return [
    `INDEPENDENT 15-SECOND TIKTOK STORY SHOT ${shotNumber} OF ${totalShots}.`,

    `STORY TITLE: ${title}`,

    summary
      ? `COMPLETE STORY CONTEXT: ${summary}`
      : "",

    buildViralReferenceDirection(
      story,
    ),

    buildViralTrashTvDirection(
      trashTvReactionBoost,
    ),

    buildViralMicrodramaBeatDirection(
      shotNumber,
      totalShots,
    ),

    typeof continuation.storyBeat ===
    "string"
      ? `STORY BEAT: ${continuation.storyBeat}`
      : "",

    typeof continuation.emotionalBeat ===
    "string"
      ? `EMOTION: ${continuation.emotionalBeat}`
      : "",

    typeof continuation.actionContinuation ===
    "string"
      ? `VISIBLE ACTION: ${continuation.actionContinuation}`
      : "",

    typeof continuation.environmentContinuity ===
    "string"
      ? `LOCATION: ${continuation.environmentContinuity}`
      : "",

    typeof continuation.cameraContinuation ===
    "string"
      ? `CAMERA: ${continuation.cameraContinuation}`
      : "",

    typeof continuation.performanceContinuation ===
    "string"
      ? `PERFORMANCE: ${continuation.performanceContinuation}`
      : "",

    "Any location, cast or prop instruction above that conflicts with the tropical-villa, closed-cast or text-free lock is invalid and must be ignored.",

    buildViralVisualDialogueDirection(
      [
        asRecord(
          continuation.dialogue,
        ),
        ...dialogueTurns,
      ],

      nativeCharacterDialogue,
      nativeDialogueAudioRetry,
    ),

    "Create a fresh, story-appropriate composition. Do not repeat the neutral reference-card pose or studio backdrop.",

    "The action must be instantly readable on a phone screen and advance the story without a visual reset or repeated beat.",

    isFinalShot
      ? "Deliver one partial payoff, then finish on an unresolved visual cliffhanger and the strongest reaction of the episode. Never use a calm resting frame or complete reconciliation."
      : "End on a strong reaction, reveal or motivated action that cuts cleanly to the next shot.",

    selectedAudioDirection,

    nativeCharacterDialogue
      ? "The assigned visible characters speak their lines with synchronized lips. No narrator, no voice-over, no off-screen speech, no subtitles, no captions, no readable text, no logos and no watermark."
      : "Do not synthesize audible words inside the Seedance clip. Preserve clear sentence-paced speaking performance and mouth movement for the later fixed studio voices. No narrator, subtitles, captions, readable text, logos or watermark.",
  ]
    .filter(
      Boolean,
    )
    .join(
      "\n\n",
    );
}

function buildOpeningDialoguePrompt(
  value: unknown,
): string {
  const dialogue =
    asRecord(
      value,
    );

  if (
    dialogue.enabled !==
    true
  ) {
    return "";
  }

  const speaker =
    readString(
      dialogue.speaker,
      "moviePlan.opening.dialogue.speaker fehlt.",
    );

  const text =
    readString(
      dialogue.text,
      "moviePlan.opening.dialogue.text fehlt.",
    );

  const language =
    readString(
      dialogue.language,
      "moviePlan.opening.dialogue.language fehlt.",
    );

  const voiceDirection =
    readString(
      dialogue.voiceDirection,
      "moviePlan.opening.dialogue.voiceDirection fehlt.",
    );

  return [
    "MANDATORY ON-SCREEN DIALOGUE:",

    `Visible speaker: ${speaker}`,

    `Language: ${language}`,

    `Exact spoken words: "${text}"`,

    `Voice and delivery: ${voiceDirection}`,

    "The named character must visibly say these exact words once with natural pronunciation and synchronized lip movement.",

    "Keep the speaking face and mouth clearly visible. Dialogue must be louder than music and ambience.",

    "Do not replace this line with narration, voice-over, a monologue by another person or subtitles.",
  ].join(
    "\n",
  );
}

function buildOpeningPrompt(
  opening:
    Record<
      string,
      unknown
    >,

  aspectRatio:
    VideoAspectRatio,

  editingStyle:
    string |
    undefined,

  selectedAudioDirection:
    string,
): string {
  return [
    readString(
      opening.veoPrompt,
      "moviePlan.opening.veoPrompt fehlt.",
    ),

    "",

    `ASPECT RATIO: ${aspectRatio}`,

    `EDITING STYLE: ${editingStyle || "auto"}`,

    buildOpeningDialoguePrompt(
      opening.dialogue,
    ),

    typeof opening.audioPrompt ===
    "string"
      ? `AUDIO DIRECTION:\n${opening.audioPrompt}`
      : "",

    selectedAudioDirection,

    typeof opening.negativePrompt ===
    "string"
      ? `NEGATIVE REQUIREMENTS:\n${opening.negativePrompt}`
      : "",

    "ABSOLUTE TEXT SAFETY: Do not render readable letters, words, numbers, URLs, logos, captions, code or interface text anywhere in the footage. Computer and phone screens use abstract unlettered light patterns only. Exact titles are added later in post-production.",
  ]
    .filter(
      Boolean,
    )
    .join(
      "\n",
    );
}

function buildChapterContinuationPrompt(
  moviePlan:
    Record<
      string,
      unknown
    >,

  chapter:
    Record<
      string,
      unknown
    >,

  chapterNumber:
    number,

  extensionNumber:
    number,

  totalExtensions:
    number,
): string {
  return [
    `Continue chapter ${chapterNumber} seamlessly, extension ${extensionNumber} of ${totalExtensions}.`,

    `Chapter title: ${
      typeof chapter.title ===
      "string"
        ? chapter.title
        : `Chapter ${chapterNumber}`
    }`,

    typeof chapter.storyGoal ===
    "string"
      ? `Story goal: ${chapter.storyGoal}`
      : "",

    typeof chapter.visualGoal ===
    "string"
      ? `Visual goal: ${chapter.visualGoal}`
      : "",

    typeof moviePlan.characterContinuityRules ===
    "string"
      ? `Character continuity: ${moviePlan.characterContinuityRules}`
      : "",

    typeof moviePlan.visualContinuityRules ===
    "string"
      ? `Visual continuity: ${moviePlan.visualContinuityRules}`
      : "",

    "Preserve the same characters, wardrobe, world, camera direction, lighting, audio identity and temporal continuity.",

    extensionNumber ===
      totalExtensions &&
    typeof chapter.transitionOut ===
      "string"
      ? `End transition: ${chapter.transitionOut}`
      : "Advance the action and finish in a continuation-ready state.",
  ]
    .filter(
      Boolean,
    )
    .join(
      "\n",
    );
}
