import { sleep } from "workflow";
import { CURRENTLY_RELEASED_MAX_DURATION_SECONDS } from "@/lib/pricing";
import { VIRAL_CHARACTERS } from "@/lib/viral-characters";
import type { VideoAspectRatio, VideoDurationSeconds } from "@/types/story";

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

type PreparedRender = {
  jobId: string;
  duration: VideoDurationSeconds;
  aspectRatio: VideoAspectRatio;
  segments: PlannedSegment[];
  completedSegmentUris: string[];
  totalExtensions: number;
  finishing: {
    voiceoverText?: string;
    dialogueCues?: DialogueCue[];
    closingText?: string;
    spokenLanguage?: "auto" | "de" | "en";
  };
};

type RenderResult = {
  jobId: string;
  providerRenderEnabled: boolean;
  pipelineComplete: boolean;
  outputPathname?: string;
  reason?: string;
};

type PollResult = {
  done: boolean;
  videoUri?: string;
  mimeType?: string;
  restartOperation?: boolean;
  providerMessage?: string;
};

type OperationWaitResult =
  | { completed: true; videoUri: string }
  | { completed: false; providerMessage: string };

type ProviderStartResult =
  | { started: true; operationName: string }
  | {
      started: false;
      retryAfterMs: number;
      httpStatus: number;
    };

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

export async function renderVideoWorkflow(jobId: string): Promise<RenderResult> {
  "use workflow";

  try {
    const prepared = await prepareRenderJobStep(jobId);
    const gate = await providerRenderEnabledStep(prepared.duration);
    if (!gate.enabled) {
      await markRenderDisabledStep(jobId);
      return {
        jobId,
        providerRenderEnabled: false,
        pipelineComplete: false,
        reason: gate.reason || "Veo-Rendering ist durch den Sicherheitsschalter deaktiviert.",
      };
    }

    const chapterUris: string[] = [...prepared.completedSegmentUris];
    let completedExtensions = 0;

    for (const segment of prepared.segments.slice(chapterUris.length)) {
      let currentUri = await completeOpeningWithOperationRecovery(
        jobId,
        segment.openingPrompt,
        prepared.aspectRatio,
        segment.chapterNumber,
        completedExtensions,
        prepared.totalExtensions,
      );

      for (let index = 0; index < segment.continuationPrompts.length; index += 1) {
        const globalExtensionNumber = completedExtensions + 1;
        currentUri = await completeExtensionWithOperationRecovery(
          jobId,
          currentUri,
          segment.continuationPrompts[index],
          prepared.aspectRatio,
          segment.chapterNumber,
          globalExtensionNumber,
          prepared.totalExtensions,
        );
        completedExtensions = globalExtensionNumber;
      }

      chapterUris.push(currentUri);
      await recordChapterStep(
        jobId,
        segment.chapterNumber,
        chapterUris,
        completedExtensions,
        prepared.totalExtensions,
      );
    }

    await markFinalizingStep(jobId, chapterUris.length > 1);
    const output = chapterUris.length === 1
      ? await trimFinalVideoStep(jobId, chapterUris[0], prepared.duration, prepared.finishing)
      : await mergeFinalVideoStep(jobId, chapterUris, prepared.duration, prepared.finishing);

    await finishRenderJobStep(jobId, output.pathname);
    return {
      jobId,
      providerRenderEnabled: true,
      pipelineComplete: true,
      outputPathname: output.pathname,
    };
  } catch (error) {
    const message = readableRenderError(error);
    await failRenderJobStep(jobId, message);
    throw error;
  }
}

export default renderVideoWorkflow;

export async function recoverVideoFinalizationWorkflow(jobId: string): Promise<RenderResult> {
  "use workflow";

  const prepared = await prepareRecoveryFinalizationStep(jobId);
  try {
    const output = await trimFinalVideoStep(
      jobId,
      prepared.videoUri,
      prepared.duration,
      prepared.finishing,
    );
    await finishRenderJobStep(jobId, output.pathname);
    return {
      jobId,
      providerRenderEnabled: false,
      pipelineComplete: true,
      outputPathname: output.pathname,
      reason: "Recovered existing provider video without a new Veo request.",
    };
  } catch (error) {
    const message = readableRenderError(error);
    await failRenderJobStep(jobId, message);
    throw error;
  }
}

async function startOpeningWithProviderRetry(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
): Promise<string> {
  for (let attempt = 0; attempt <= PROVIDER_RETRY_DELAYS_MS.length; attempt += 1) {
    const plannedRetryDelayMs = PROVIDER_RETRY_DELAYS_MS[attempt] ?? 0;
    const result = await startOpeningVideoStep(
      jobId,
      prompt,
      aspectRatio,
      chapterNumber,
      plannedRetryDelayMs,
    );

    if (result.started) return result.operationName;
    await sleep(`${Math.ceil(result.retryAfterMs / 1000)}s`);
  }

  throw new Error("Google Veo konnte nach mehreren sicheren Versuchen nicht gestartet werden.");
}

async function startExtensionWithProviderRetry(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
): Promise<string> {
  for (let attempt = 0; attempt <= PROVIDER_RETRY_DELAYS_MS.length; attempt += 1) {
    const plannedRetryDelayMs = PROVIDER_RETRY_DELAYS_MS[attempt] ?? 0;
    const result = await startExtensionVideoStep(
      jobId,
      previousVideoUri,
      prompt,
      aspectRatio,
      chapterNumber,
      extensionNumber,
      plannedRetryDelayMs,
    );

    if (result.started) return result.operationName;
    await sleep(`${Math.ceil(result.retryAfterMs / 1000)}s`);
  }

  throw new Error("Google Veo konnte die Fortsetzung nach mehreren sicheren Versuchen nicht starten.");
}

async function completeOpeningWithOperationRecovery(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
): Promise<string> {
  for (let attempt = 0; attempt <= PROVIDER_OPERATION_RESTART_DELAYS_MS.length; attempt += 1) {
    const operationName = await startOpeningWithProviderRetry(
      jobId,
      prompt,
      aspectRatio,
      chapterNumber,
    );
    const result = await waitForOperation(
      jobId,
      operationName,
      chapterNumber,
      completedExtensions,
      totalExtensions,
    );
    if (result.completed) return result.videoUri;

    const retryDelayMs = PROVIDER_OPERATION_RESTART_DELAYS_MS[attempt];
    if (retryDelayMs === undefined) {
      throw new Error(
        "Google Veo hat die Videoerstellung wiederholt wegen eines internen Serverfehlers beendet. Der bezahlte Auftrag bleibt gespeichert.",
      );
    }
    await scheduleOperationRestartStep(jobId, retryDelayMs, result.providerMessage);
    await sleep(`${Math.ceil(retryDelayMs / 1000)}s`);
  }

  throw new Error("Google Veo konnte die Videoerstellung nicht abschließen.");
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
  for (let attempt = 0; attempt <= PROVIDER_OPERATION_RESTART_DELAYS_MS.length; attempt += 1) {
    const operationName = await startExtensionWithProviderRetry(
      jobId,
      previousVideoUri,
      prompt,
      aspectRatio,
      chapterNumber,
      extensionNumber,
    );
    const result = await waitForOperation(
      jobId,
      operationName,
      chapterNumber,
      extensionNumber,
      totalExtensions,
    );
    if (result.completed) return result.videoUri;

    const retryDelayMs = PROVIDER_OPERATION_RESTART_DELAYS_MS[attempt];
    if (retryDelayMs === undefined) {
      throw new Error(
        "Google Veo hat die Videofortsetzung wiederholt wegen eines internen Serverfehlers beendet. Der bezahlte Auftrag bleibt gespeichert.",
      );
    }
    await scheduleOperationRestartStep(jobId, retryDelayMs, result.providerMessage);
    await sleep(`${Math.ceil(retryDelayMs / 1000)}s`);
  }

  throw new Error("Google Veo konnte die Videofortsetzung nicht abschließen.");
}

async function scheduleOperationRestartStep(
  jobId: string,
  retryDelayMs: number,
  providerMessage: string,
): Promise<void> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error("Render-Job wurde vor dem automatischen Neustart nicht gefunden.");

  const nextAttemptAt = Date.now() + retryDelayMs;
  await jobStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: "waiting-provider",
    retryCount: (job.retryCount ?? 0) + 1,
    nextAttemptAt,
    errorMessage:
      "Google Veo hatte einen internen Serverfehler. Dein bezahlter Auftrag wird automatisch neu gestartet.",
    currentOperationName: undefined,
    currentOperationType: undefined,
  });

  console.warn("Restarting failed Veo operation after provider backoff", {
    jobId,
    retryDelayMs,
    providerMessage,
  });
}

async function prepareRecoveryFinalizationStep(jobId: string): Promise<{
  videoUri: string;
  duration: VideoDurationSeconds;
  finishing: PreparedRender["finishing"];
}> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error(`Recovery job ${jobId} was not found.`);
  if (job.paymentStatus !== "paid") throw new Error("Recovery job is not paid.");
  if (!job.targetDurationSeconds) throw new Error("Recovery job has no target duration.");
  if (!job.videoUri || job.videoUri.startsWith("blob:") || job.videoUri.startsWith("local:")) {
    throw new Error("No recoverable provider video URI is stored.");
  }
  if (job.currentOperationName) throw new Error("The provider operation is not complete yet.");

  await jobStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: "trimming",
    progressPercent: 92,
    errorMessage: undefined,
  });
  const recoveryDialogueCues =
    job.voiceMode === "dialogue" && job.nativeCharacterDialogue !== true
      ? buildDialogueCuesFromStoredPrompt(
          job.prompt,
          job.targetDurationSeconds,
        )
      : [];
  return {
    videoUri: job.videoUri,
    duration: job.targetDurationSeconds,
    finishing: {
      voiceoverText: recoveryDialogueCues.length > 0 ? undefined : job.voiceoverText,
      dialogueCues: recoveryDialogueCues,
      closingText: job.closingText,
      spokenLanguage: job.spokenLanguage,
    },
  };
}

async function providerRenderEnabledStep(duration: number): Promise<{ enabled: boolean; reason?: string }> {
  "use step";
  try {
    assertProviderRenderAllowed(duration);
    return { enabled: true };
  } catch (error) {
    return {
      enabled: false,
      reason: error instanceof Error ? error.message : "Seedance-Rendering ist deaktiviert.",
    };
  }
}

async function prepareRenderJobStep(jobId: string): Promise<PreparedRender> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const {
    buildMovieContinuationPrompt,
    buildVideoDurationPlan,
    removeVisibleTextRenderingInstructions,
  } = await import("@/lib/veo");
  const { buildSelectedAudioDirection } = await import("@/lib/audio-options");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error(`Render-Job ${jobId} wurde nicht gefunden.`);
  if (job.paymentStatus !== "paid") throw new Error(`Render-Job ${jobId} ist nicht bezahlt.`);
  if (!job.targetDurationSeconds || !job.aspectRatio) {
    throw new Error(`Render-Job ${jobId} enthält keine vollständige Videokonfiguration.`);
  }

  let story: Record<string, unknown>;
  try {
    story = JSON.parse(job.prompt) as Record<string, unknown>;
  } catch {
    throw new Error("Die gespeicherte Story ist kein gültiges JSON.");
  }
  const moviePlan = asRecord(story.moviePlan);
  if (Object.keys(moviePlan).length === 0) throw new Error("moviePlan fehlt in der gespeicherten Story.");
  if (moviePlan.targetDurationSeconds !== job.targetDurationSeconds) {
    throw new Error("Die bezahlte Videodauer stimmt nicht mit dem MoviePlan überein.");
  }
  if (moviePlan.aspectRatio !== job.aspectRatio) {
    throw new Error("Das bezahlte Bildformat stimmt nicht mit dem MoviePlan überein.");
  }

  const durationPlan = buildVideoDurationPlan(job.targetDurationSeconds);
  const segments: PlannedSegment[] = [];
  const viralStoryMode = story.creationMode === "viral-story";
  const nativeCharacterDialogue = viralStoryMode && job.nativeCharacterDialogue === true;
  const nativeDialogueAudioRetry = nativeCharacterDialogue && job.nativeDialogueAudioRetry === true;
  const trashTvReactionBoost = viralStoryMode && job.trashTvReactionBoost === true;
  const postProducedDialogue = !viralStoryMode && job.voiceMode === "dialogue";
  const audioRecoveryFallback = !nativeCharacterDialogue && (job.manualRecoveryAttempts ?? 0) >= 2;
  const selectedAudioDirection = nativeDialogueAudioRetry
    ? "AUDIO-FILTER-SAFE NATIVE CHARACTER DIALOGUE (highest priority): Use clear, emotionally tense but controlled German conversational speech from the visible assigned character with synchronized lips. The physical acting may be extremely dramatic even while the spoken delivery remains controlled. Use quiet neutral room ambience and simple Foley only. No music, narrator, voice-over, off-screen voice, shouting, screaming, crying, whispering, breathy vocalizations, singing, profanity or threats."
    : nativeCharacterDialogue
    ? "NATIVE ON-SCREEN CHARACTER DIALOGUE (highest priority): The visible active character speaks the assigned exact line audibly and naturally in German. Synchronize the voice with that character's mouth, face, emotion and body performance. Only the currently visible assigned character may speak. Voice consistency between separate shots is less important than clear in-scene speech. Never use a narrator, voice-over, off-screen voice, studio commentary, singing or subtitles. Keep ambience and effects quiet underneath the dialogue."
    : audioRecoveryFallback
    ? "RECOVERY AUDIO FALLBACK (highest priority): Generate only clean visual footage with quiet, neutral, non-vocal ambience and simple Foley. Do not generate dialogue, narration, singing, humming, vocalizations or music. Ignore every earlier audio or speech instruction. Exact voices are added during final post-production."
    : viralStoryMode
    ? "POST-PRODUCED CHARACTER DIALOGUE: Generate clean music, ambience and sound effects only. Do not synthesize audible speech in the Veo clip. The visible active character performs the planned sentence with natural facial and mouth movement; a fixed studio voice is mixed in during finishing."
    : postProducedDialogue
    ? "POST-PRODUCED MULTI-SPEAKER DIALOGUE (highest priority): Generate quiet non-vocal ambience, Foley and restrained music only. Do not synthesize audible dialogue, narration, voice-over, off-screen speech, singing or vocalizations. The visible active character performs the exact planned line with natural sentence-paced mouth, jaw, facial and body movement. A distinct fixed studio voice for each character is mixed scene-synchronously during final finishing."
    : buildSelectedAudioDirection(
        job.audioStyle ?? "cinematic",
        job.voiceMode ?? "auto",
        job.spokenLanguage ?? "de",
        job.voiceoverText ?? "",
        job.targetDurationSeconds,
      );
  let dialogueCues: DialogueCue[] = [];

  if (viralStoryMode) {
    if (job.aspectRatio !== "9:16") {
      throw new Error("Der TikTok-Story-Modus benötigt das vertikale Format 9:16.");
    }

    const opening = asRecord(moviePlan.opening);
    const openingDialogue = asRecord(opening.dialogue);
    const openingDialogueTurns = Array.isArray(opening.dialogueTurns)
      ? opening.dialogueTurns.map(asRecord)
      : [];
    const openingDialogues = [openingDialogue, ...openingDialogueTurns];
    const safeOpening = {
      ...opening,
      dialogue: {
        enabled: false,
        speaker: "",
        text: "",
        language: "",
        voiceDirection: "",
      },
      dialogueTurns: [],
      veoPrompt: removeVisibleTextRenderingInstructions(
        readString(opening.veoPrompt, "moviePlan.opening.veoPrompt fehlt."),
      ),
    };
    const shotCount = Math.max(1, Math.ceil(job.targetDurationSeconds / 8));
    const openingPrompt = [
      buildOpeningPrompt(
        safeOpening,
        "9:16",
        "social",
        selectedAudioDirection,
      ),
      buildViralReferenceDirection(story),
      buildViralVisualDialogueDirection(
        openingDialogues,
        nativeCharacterDialogue,
        nativeDialogueAudioRetry,
      ),
      buildViralTrashTvDirection(trashTvReactionBoost),
      buildViralMicrodramaBeatDirection(1, shotCount),
      "SHOT 1: Open with the central conflict visibly understandable within the first two seconds.",
    ].join("\n\n");

    const rawContinuations = Array.isArray(moviePlan.continuations)
      ? moviePlan.continuations
      : [];
    const candidateShots = [
      { prompt: openingPrompt, dialogues: openingDialogues },
      ...rawContinuations.map((item, index) => {
        const continuation = asRecord(item);
        const dialogueTurns = Array.isArray(continuation.dialogueTurns)
          ? continuation.dialogueTurns.map(asRecord)
          : [];
        return {
          prompt: buildViralIndependentShotPrompt(
            story,
            continuation,
            index + 2,
            rawContinuations.length + 1,
            selectedAudioDirection,
            nativeCharacterDialogue,
            nativeDialogueAudioRetry,
            trashTvReactionBoost,
          ),
          dialogues: [asRecord(continuation.dialogue), ...dialogueTurns],
        };
      }),
    ];
    const bibleCharacterNames = Array.isArray(asRecord(story.productionBible).characterBible)
      ? (asRecord(story.productionBible).characterBible as unknown[])
          .map(asRecord)
          .map((character) => typeof character.name === "string" ? character.name.trim() : "")
          .filter(Boolean)
      : [];
    const storyCharacterNames = Array.isArray(story.characters)
      ? story.characters
          .map(asRecord)
          .map((character) => typeof character.name === "string" ? character.name.trim() : "")
          .filter(Boolean)
      : [];
    const selectedCharacterNames = (
      bibleCharacterNames.length >= 2 ? bibleCharacterNames : storyCharacterNames
    ).slice(0, 3);
    const selectedShots = selectViralShotsIncludingCharacters(
      candidateShots,
      shotCount,
      selectedCharacterNames,
    );

    selectedShots.forEach((shot, index) => {
      segments.push({
        chapterNumber: index + 1,
        targetSeconds: 8,
        openingPrompt: shot.prompt,
        continuationPrompts: [],
      });
    });
    dialogueCues = buildViralDialogueCues(
      selectedShots.map((shot) => shot.dialogues),
      job.targetDurationSeconds,
    );
    const requiredSpeakers = Math.min(3, Math.max(2, selectedCharacterNames.length));
    const cueSpeakers = new Set(
      dialogueCues.map((cue) => cue.speaker.toLocaleLowerCase("de-DE")),
    );
    if (
      dialogueCues.length < requiredSpeakers ||
      cueSpeakers.size < requiredSpeakers ||
      !selectedCharacterNames.every((name) => {
        const fullName = name.toLocaleLowerCase("de-DE");
        const shortName = fullName.split(",")[0].trim();
        return cueSpeakers.has(fullName) || cueSpeakers.has(shortName);
      })
    ) {
      throw new Error("Der TikTok-Story-Modus enthält keine vollständigen Figurendialoge.");
    }
  } else if (job.targetDurationSeconds <= 120) {
    const opening = asRecord(moviePlan.opening);
    const openingDialogueTurns = Array.isArray(opening.dialogueTurns)
      ? opening.dialogueTurns.map(asRecord)
      : [];
    const openingDialogues = [asRecord(opening.dialogue), ...openingDialogueTurns];
    const safeOpening = {
      ...opening,
      dialogue: postProducedDialogue
        ? {
            enabled: false,
            speaker: "",
            text: "",
            language: "",
            voiceDirection: "",
          }
        : opening.dialogue,
      dialogueTurns: postProducedDialogue ? [] : opening.dialogueTurns,
      veoPrompt: removeVisibleTextRenderingInstructions(
        readString(opening.veoPrompt, "moviePlan.opening.veoPrompt fehlt."),
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
        ? buildViralVisualDialogueDirection(openingDialogues)
        : "",
    ].filter(Boolean).join("\n\n");
    const rawContinuations = Array.isArray(moviePlan.continuations) ? moviePlan.continuations : [];
    const continuationDialogueShots: Record<string, unknown>[][] = [];
    const continuationPrompts = rawContinuations.map((item) => {
      const continuation = asRecord(item);
      const turns = Array.isArray(continuation.dialogueTurns)
        ? continuation.dialogueTurns.map(asRecord)
        : [];
      const dialogues = [asRecord(continuation.dialogue), ...turns];
      continuationDialogueShots.push(dialogues);
      const safeContinuation = postProducedDialogue
        ? {
            ...continuation,
            dialogue: {
              enabled: false,
              speaker: "",
              text: "",
              language: "",
              voiceDirection: "",
            },
            dialogueTurns: [],
          }
        : continuation;
      return [
        buildMovieContinuationPrompt(
          story as unknown as import("@/types/story").Story,
          safeContinuation as unknown as import("@/types/story").MovieContinuation,
        ),
        postProducedDialogue
          ? buildViralVisualDialogueDirection(dialogues)
          : "",
        selectedAudioDirection,
      ].filter(Boolean).join("\n\n");
    });
    const expected = extensionCountFor(job.targetDurationSeconds);
    if (continuationPrompts.length !== expected) {
      throw new Error(`MoviePlan enthält ${continuationPrompts.length} Extensions; erwartet werden ${expected}.`);
    }
    if (postProducedDialogue) {
      dialogueCues = buildExtensionDialogueCues(
        [openingDialogues, ...continuationDialogueShots],
        job.targetDurationSeconds,
      );
      const dialogueSpeakers = new Set(
        dialogueCues.map((cue) => cue.speaker.toLocaleLowerCase("de-DE")),
      );
      if (dialogueCues.length < 2 || dialogueSpeakers.size < 2) {
        throw new Error("Der Dialogmodus enthält kein vollständiges Gespräch zwischen mindestens zwei Figuren.");
      }
    }
    segments.push({ chapterNumber: 1, targetSeconds: job.targetDurationSeconds, openingPrompt, continuationPrompts });
  } else {
    const rawChapters = Array.isArray(moviePlan.chapters) ? moviePlan.chapters : [];
    if (rawChapters.length !== durationPlan.chapterTargets.length) {
      throw new Error(`MoviePlan enthält ${rawChapters.length} Kapitel; erwartet werden ${durationPlan.chapterTargets.length}.`);
    }
    rawChapters.forEach((rawChapter, index) => {
      const chapter = asRecord(rawChapter);
      const targetSeconds = durationPlan.chapterTargets[index];
      const openingPrompt = [
        readString(chapter.openingPrompt, `Kapitel ${index + 1}: openingPrompt fehlt.`),
        selectedAudioDirection,
      ].join("\n\n");
      const expected = extensionCountFor(targetSeconds);
      const supplied = Array.isArray(chapter.continuationPrompts)
        ? chapter.continuationPrompts.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
        : [];
      const continuationPrompts = Array.from({ length: expected }, (_, extensionIndex) =>
        [
          supplied[extensionIndex] || buildChapterContinuationPrompt(moviePlan, chapter, index + 1, extensionIndex + 1, expected),
          selectedAudioDirection,
        ].join("\n\n"),
      );
      segments.push({ chapterNumber: index + 1, targetSeconds, openingPrompt, continuationPrompts });
    });
  }

  const totalExtensions = segments.reduce((sum, segment) => sum + segment.continuationPrompts.length, 0);
  await jobStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: "planning",
    progressPercent: Math.max(job.progressPercent ?? 0, 2),
    totalChapters: segments.length,
    totalExtensions,
    startedAt: job.startedAt ?? Date.now(),
    errorMessage: undefined,
  });
  return {
    jobId,
    duration: job.targetDurationSeconds,
    aspectRatio: job.aspectRatio,
    segments,
    completedSegmentUris: nativeCharacterDialogue
      ? (job.chapterVideoUris ?? []).slice(0, segments.length)
      : [],
    totalExtensions,
    finishing: {
      voiceoverText: viralStoryMode ? undefined : job.voiceoverText,
      dialogueCues: nativeCharacterDialogue ? undefined : dialogueCues,
      closingText: job.closingText,
      spokenLanguage: job.spokenLanguage,
    },
  };
}

async function markRenderDisabledStep(jobId: string): Promise<void> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) return;
  await jobStore.set(jobId, {
    ...job,
    status: "pending",
    renderStage: "queued",
    progressPercent: 0,
    errorMessage: undefined,
  });
}

async function startOpeningVideoStep(
  jobId: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  plannedRetryDelayMs: number,
): Promise<ProviderStartResult> {
  "use step";
  if (process.env.SEEDANCE_WORKFLOW_RENDER_ENABLED !== "true") {
  throw new Error("Seedance-Rendering ist deaktiviert.");
}
  const { jobStore } = await import("@/lib/store");
  const { startVideoGeneration } = await import("@/lib/seedance");
  const job = await jobStore.get(jobId);
  if (!job || job.paymentStatus !== "paid") throw new Error("Der Render-Job ist nicht bezahlt.");
  assertProviderRenderAllowed(job.targetDurationSeconds);
  const operationType = chapterNumber === 1 && job.generationStrategy !== "chaptered" ? "opening" : "chapter-opening";
  if (
    job.currentOperationName &&
    job.currentOperationType === operationType &&
    (operationType !== "chapter-opening" || job.currentChapter === chapterNumber)
  ) return { started: true, operationName: job.currentOperationName };

  let storedStory: Record<string, unknown> = {};
  try {
    storedStory = JSON.parse(job.prompt) as Record<string, unknown>;
  } catch {
    // prepareRenderJobStep liefert bei ungültigem JSON bereits eine klare Fehlermeldung.
  }
  const viralStoryMode = storedStory.creationMode === "viral-story";
  const referenceImages = viralStoryMode
    ? await (await import("@/lib/video-backend/images")).loadViralCharacterReferences(
        Array.isArray(storedStory.characters)
          ? storedStory.characters
              .map((value) => asRecord(value).name)
              .filter((value): value is string => typeof value === "string")
          : [],
      )
    : undefined;
  const referenceImage =
    !viralStoryMode && chapterNumber === 1 && job.referenceImageUrl
      ? await (await import("@/lib/video-backend/images")).loadStoredPreview(
          job.referenceImageUrl,
          job.referenceImageMimeType,
        )
      : undefined;

  let operationName: string;
  try {
    operationName = await startVideoGeneration(prompt, {
      aspectRatio,
      referenceImage,
      referenceImages,
      maxAttempts: 1,
    });
  } catch (error) {
    const { getRetryableSeedanceStartError } = await import("@/lib/seedance");
    const providerError = getRetryableSeedanceStartError(error);
    if (!providerError || plannedRetryDelayMs <= 0) throw error;

    const retryAfterMs = Math.min(
      12 * 60 * 60_000,
      Math.max(plannedRetryDelayMs, providerError.retryAfterMs ?? 0),
    );
    const nextAttemptAt = Date.now() + retryAfterMs;
    const message = providerError.httpStatus === 429
      ? "Das Google-Kontingent ist vorübergehend erreicht. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht."
      : "Google Veo ist vorübergehend ausgelastet. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht.";

    await jobStore.pauseProvider({
      until: nextAttemptAt,
      reason: message,
      sourceJobId: jobId,
      httpStatus: providerError.httpStatus,
    });
    await jobStore.set(jobId, {
      ...job,
      status: "processing",
      renderStage: "waiting-provider",
      retryCount: (job.retryCount ?? 0) + 1,
      nextAttemptAt,
      errorMessage: message,
    });

    return {
      started: false,
      retryAfterMs,
      httpStatus: providerError.httpStatus,
    };
  }
  const latest = await jobStore.get(jobId);
  if (!latest) throw new Error("Render-Job ist nach dem Veo-Start verschwunden.");
  await jobStore.set(jobId, {
    ...latest,
    status: "processing",
    renderStage: chapterNumber > 1 || latest.generationStrategy === "chaptered" ? "generating-chapter" : "generating-opening",
    currentChapter: chapterNumber,
    currentOperationName: operationName,
    currentOperationType: operationType,
    lastProviderRequestAt: Date.now(),
    nextAttemptAt: undefined,
    errorMessage: undefined,
  });
  await jobStore.clearProviderPause(jobId);
  return { started: true, operationName };
}
startOpeningVideoStep.maxRetries = 0;

async function startExtensionVideoStep(
  jobId: string,
  previousVideoUri: string,
  prompt: string,
  aspectRatio: VideoAspectRatio,
  chapterNumber: number,
  extensionNumber: number,
  plannedRetryDelayMs: number,
): Promise<ProviderStartResult> {
  "use step";
  if (process.env.SEEDANCE_WORKFLOW_RENDER_ENABLED !== "true") {
  throw new Error("Seedance-Rendering ist deaktiviert.");
}
  const { jobStore } = await import("@/lib/store");
  const { startVideoExtension } = await import("@/lib/seedance");
  const job = await jobStore.get(jobId);
  if (!job || job.paymentStatus !== "paid") throw new Error("Der Render-Job ist nicht bezahlt.");
  assertProviderRenderAllowed(job.targetDurationSeconds);
  if (
    job.currentOperationName &&
    job.currentOperationType === "extension" &&
    job.currentChapter === chapterNumber &&
    job.currentExtension === extensionNumber
  ) return { started: true, operationName: job.currentOperationName };

  let operationName: string;
  try {
    operationName = await startVideoExtension(previousVideoUri, prompt, {
      aspectRatio,
      extensionNumber,
      maxAttempts: 1,
    });
  } catch (error) {
    const { getRetryableSeedanceStartError } = await import("@/lib/seedance");
    const providerError = getRetryableSeedanceStartError(error);
    if (!providerError || plannedRetryDelayMs <= 0) throw error;

    const retryAfterMs = Math.min(
      12 * 60 * 60_000,
      Math.max(plannedRetryDelayMs, providerError.retryAfterMs ?? 0),
    );
    const nextAttemptAt = Date.now() + retryAfterMs;
    const message = providerError.httpStatus === 429
      ? "Das Google-Kontingent ist vorübergehend erreicht. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht."
      : "Google Veo ist vorübergehend ausgelastet. Dein bezahlter Auftrag bleibt gespeichert und wird automatisch erneut versucht.";

    await jobStore.pauseProvider({
      until: nextAttemptAt,
      reason: message,
      sourceJobId: jobId,
      httpStatus: providerError.httpStatus,
    });
    await jobStore.set(jobId, {
      ...job,
      status: "processing",
      renderStage: "waiting-provider",
      retryCount: (job.retryCount ?? 0) + 1,
      nextAttemptAt,
      errorMessage: message,
    });

    return {
      started: false,
      retryAfterMs,
      httpStatus: providerError.httpStatus,
    };
  }
  const latest = await jobStore.get(jobId);
  if (!latest) throw new Error("Render-Job ist nach dem Veo-Extension-Start verschwunden.");
  await jobStore.set(jobId, {
    ...latest,
    status: "processing",
    renderStage: "extending",
    currentChapter: chapterNumber,
    currentExtension: extensionNumber,
    currentOperationName: operationName,
    currentOperationType: "extension",
    lastProviderRequestAt: Date.now(),
    nextAttemptAt: undefined,
    errorMessage: undefined,
  });
  await jobStore.clearProviderPause(jobId);
  return { started: true, operationName };
}
startExtensionVideoStep.maxRetries = 0;

async function pollVideoStep(
  jobId: string,
  operationName: string,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
): Promise<PollResult> {
  "use step";
  const { checkVideoStatus, getRestartableSeedanceOperationError } = await import("@/lib/seedance");
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error("Render-Job wurde beim Statusabruf nicht gefunden.");

  let status: PollResult;
  try {
    status = await checkVideoStatus(operationName);
  } catch (error) {
    const restartableFailure = getRestartableSeedanceOperationError(error);
    if (!restartableFailure) throw error;

    await jobStore.set(jobId, {
      ...job,
      status: "processing",
      renderStage: "waiting-provider",
      lastProviderPollAt: Date.now(),
      currentOperationName: undefined,
      currentOperationType: undefined,
      errorMessage:
        "Google Veo hatte einen internen Serverfehler. Dein bezahlter Auftrag wird automatisch neu gestartet.",
    });
    return {
      done: false,
      restartOperation: true,
      providerMessage: restartableFailure.message,
    };
  }

  const completedFraction = totalExtensions > 0
    ? completedExtensions / Math.max(1, totalExtensions)
    : chapterNumber / Math.max(1, job.totalChapters ?? 1);
  const progress = Math.min(88, 5 + Math.round(completedFraction * 80));
  await jobStore.set(jobId, {
    ...job,
    progressPercent: Math.max(job.progressPercent ?? 0, progress),
    currentChapter: chapterNumber,
    lastProviderPollAt: Date.now(),
    videoUri: status.done && status.videoUri ? status.videoUri : job.videoUri,
    currentOperationName: status.done ? undefined : operationName,
    currentOperationType: status.done ? undefined : job.currentOperationType,
  });
  return { done: status.done, videoUri: status.videoUri, mimeType: status.mimeType };
}

async function waitForOperation(
  jobId: string,
  operationName: string,
  chapterNumber: number,
  completedExtensions: number,
  totalExtensions: number,
): Promise<OperationWaitResult> {
  for (let poll = 0; poll < 180; poll += 1) {
    await sleep("10s");
    const status = await pollVideoStep(jobId, operationName, chapterNumber, completedExtensions, totalExtensions);
    if (status.restartOperation) {
      return {
        completed: false,
        providerMessage: status.providerMessage || "Interner Google-Veo-Serverfehler.",
      };
    }
    if (status.done && status.videoUri) return { completed: true, videoUri: status.videoUri };
  }
  throw new Error("Zeitüberschreitung nach 30 Minuten bei der Veo-Generierung.");
}

async function recordChapterStep(
  jobId: string,
  chapterNumber: number,
  chapterUris: string[],
  completedExtensions: number,
  totalExtensions: number,
): Promise<void> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error("Render-Job wurde nach einem Kapitel nicht gefunden.");
  await jobStore.set(jobId, {
    ...job,
    chapterVideoUris: chapterUris,
    currentChapter: chapterNumber,
    currentExtension: completedExtensions,
    progressPercent: Math.min(
      90,
      10 + Math.round(
        (totalExtensions > 0
          ? completedExtensions / Math.max(1, totalExtensions)
          : chapterNumber / Math.max(1, job.totalChapters ?? 1)) * 80,
      ),
    ),
  });
}

async function markFinalizingStep(jobId: string, merging: boolean): Promise<void> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error("Render-Job wurde vor der Finalisierung nicht gefunden.");
  await jobStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: merging ? "merging-chapters" : "trimming",
    progressPercent: 92,
    currentOperationName: undefined,
    currentOperationType: undefined,
  });
}

async function trimFinalVideoStep(
  jobId: string,
  videoUri: string,
  seconds: number,
  finishing: PreparedRender["finishing"],
) {
  "use step";
  const { trimAndStore } = await import("@/lib/video-backend/media");
  return trimAndStore(videoUri, seconds, `finished-videos/${jobId}.mp4`, finishing);
}
trimFinalVideoStep.maxRetries = 0;

async function mergeFinalVideoStep(
  jobId: string,
  chapterUris: string[],
  seconds: number,
  finishing: PreparedRender["finishing"],
) {
  "use step";
  const { mergeAndStore } = await import("@/lib/video-backend/media");
  return mergeAndStore(chapterUris, seconds, `finished-videos/${jobId}.mp4`, finishing);
}
mergeFinalVideoStep.maxRetries = 0;

async function finishRenderJobStep(jobId: string, pathname: string): Promise<void> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) throw new Error("Render-Job wurde beim Abschluss nicht gefunden.");
  await jobStore.set(jobId, {
    ...job,
    status: "done",
    renderStage: "completed",
    progressPercent: 100,
    videoUri: pathname.startsWith("local:") ? pathname : `blob:${pathname}`,
    videoUrl: undefined,
    videoUrls: undefined,
    currentOperationName: undefined,
    currentOperationType: undefined,
    completedAt: Date.now(),
    errorMessage: undefined,
  });
}

async function failRenderJobStep(jobId: string, message: string): Promise<void> {
  "use step";
  const { jobStore } = await import("@/lib/store");
  const job = await jobStore.get(jobId);
  if (!job) return;
  await jobStore.set(jobId, {
    ...job,
    status: "error",
    renderStage: "failed",
    errorMessage: message,
  });
}

function assertProviderRenderAllowed(duration: number | undefined): void {
  if (process.env.SEEDANCE_WORKFLOW_RENDER_ENABLED!== "true") {
    throw new Error("SEEDANCE_WORKFLOW_RENDER_ENABLED ist deaktiviert.");
  }
  if (!duration || duration > CURRENTLY_RELEASED_MAX_DURATION_SECONDS) {
    throw new Error(`Die Videodauer ${duration || "unbekannt"}s ueberschreitet die freigegebene Grenze von ${CURRENTLY_RELEASED_MAX_DURATION_SECONDS}s.`);
  }
}

function readableRenderError(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : "Unbekannter Renderfehler.";

  if (rawMessage.includes("No blob credentials found")) {
    return "Die finale Videodatei konnte nicht gespeichert werden. Das vorhandene Rohvideo kann ohne neue KI-Generierung wiederhergestellt werden.";
  }

  if (/inlineData.*isn(?:'|’)t supported by this model/i.test(rawMessage)) {
    return "Das freigegebene Vorschaubild konnte nicht an die Video-KI übergeben werden. Der Auftrag kann ohne neue Zahlung erneut gestartet werden.";
  }

  return rawMessage;
}

function extensionCountFor(seconds: number): number {
  return seconds <= 8 ? 0 : Math.ceil((seconds - 8) / 7);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown, error: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(error);
  return value.trim();
}

function selectEvenlyIncludingFinal<T>(items: readonly T[], requestedCount: number): T[] {
  if (requestedCount >= items.length) return [...items];
  if (requestedCount <= 1) return items.length > 0 ? [items[0]] : [];

  return [
    ...items.slice(0, requestedCount - 1),
    items[items.length - 1],
  ];
}

function dialogueSpeakerMatches(characterName: string, speakerName: string): boolean {
  const fullName = characterName.toLocaleLowerCase("de-DE");
  const shortName = fullName.split(",")[0].trim();
  const normalizedSpeaker = speakerName.toLocaleLowerCase("de-DE");
  return normalizedSpeaker === fullName || normalizedSpeaker === shortName;
}

function selectViralShotsIncludingCharacters<T extends {
  dialogues: readonly Record<string, unknown>[];
}>(
  items: readonly T[],
  requestedCount: number,
  characterNames: readonly string[],
): T[] {
  if (requestedCount >= items.length) return [...items];
  if (requestedCount <= 1) return items.length > 0 ? [items[0]] : [];

  const lastIndex = items.length - 1;
  const selectedIndices = new Set([
    ...Array.from({ length: requestedCount - 1 }, (_, index) => index),
    lastIndex,
  ]);
  const shotIncludesCharacter = (shotIndex: number, characterName: string) =>
    items[shotIndex].dialogues.some((value) => {
      const dialogue = readViralDialogue(value);
      return dialogue !== null && dialogueSpeakerMatches(characterName, dialogue.speaker);
    });
  const selectionIncludesCharacter = (
    indices: ReadonlySet<number>,
    characterName: string,
  ) => [...indices].some((index) => shotIncludesCharacter(index, characterName));

  for (const missingCharacter of characterNames) {
    if (selectionIncludesCharacter(selectedIndices, missingCharacter)) continue;

    const replacementIndex = items.findIndex((_, index) =>
      !selectedIndices.has(index) && shotIncludesCharacter(index, missingCharacter),
    );
    if (replacementIndex < 0) continue;

    const charactersToKeep = characterNames.filter((characterName) =>
      selectionIncludesCharacter(selectedIndices, characterName),
    );
    const removableIndex = [...selectedIndices]
      .filter((index) => index !== 0 && index !== lastIndex)
      .reverse()
      .find((index) => {
        const candidateIndices = new Set(selectedIndices);
        candidateIndices.delete(index);
        candidateIndices.add(replacementIndex);
        return [...charactersToKeep, missingCharacter].every((characterName) =>
          selectionIncludesCharacter(candidateIndices, characterName),
        );
      });

    if (removableIndex !== undefined) {
      selectedIndices.delete(removableIndex);
      selectedIndices.add(replacementIndex);
    }
  }

  return [...selectedIndices]
    .sort((left, right) => left - right)
    .map((index) => items[index]);
}

function readViralDialogue(value: Record<string, unknown>): {
  speaker: string;
  text: string;
  voiceDirection: string;
} | null {
  if (value.enabled !== true) return null;
  const speaker = typeof value.speaker === "string" ? value.speaker.trim() : "";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const voiceDirection = typeof value.voiceDirection === "string"
    ? value.voiceDirection.trim().slice(0, 180)
    : "Natural, concise and emotionally believable delivery.";
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (!speaker || !text || wordCount > 12 || text.length > 140) return null;
  return { speaker, text, voiceDirection };
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
  assignments: Map<string, string>,
): string {
  const normalized = speaker.toLocaleLowerCase("de-DE");
  const existing = assignments.get(normalized);
  if (existing) return existing;

  const character = VIRAL_CHARACTERS.find((candidate) =>
    candidate.name.toLocaleLowerCase("de-DE") === normalized ||
    candidate.shortName.toLocaleLowerCase("de-DE") === normalized,
  );
  if (character) {
    assignments.set(normalized, character.voiceName);
    return character.voiceName;
  }

  const usedVoices = new Set(assignments.values());
  const unusedVoice = DIALOGUE_VOICES.find((voice) => !usedVoices.has(voice));
  const hash = [...normalized].reduce((sum, characterValue) => sum + characterValue.charCodeAt(0), 0);
  const voiceName = unusedVoice ?? DIALOGUE_VOICES[hash % DIALOGUE_VOICES.length];
  assignments.set(normalized, voiceName);
  return voiceName;
}

function buildViralDialogueCues(
  dialogueShots: readonly (readonly Record<string, unknown>[])[],
  targetDurationSeconds: number,
): DialogueCue[] {
  const cues: DialogueCue[] = [];
  const voiceAssignments = new Map<string, string>();
  dialogueShots.forEach((values, shotIndex) => {
    const dialogues = values
      .map(readViralDialogue)
      .filter((dialogue): dialogue is NonNullable<ReturnType<typeof readViralDialogue>> =>
        dialogue !== null,
      );
    if (dialogues.length === 0) return;

    const shotStartSeconds = shotIndex * 8;
    const firstCueStartSeconds = shotStartSeconds + 0.45;
    const dialogueWindowSeconds = Math.min(
      7.1,
      Math.max(2, targetDurationSeconds + 1.2 - firstCueStartSeconds),
    );
    const turnWindowSeconds = dialogueWindowSeconds / dialogues.length;

    dialogues.forEach((dialogue, turnIndex) => {
      cues.push({
        startSeconds: firstCueStartSeconds + turnIndex * turnWindowSeconds,
        maximumDurationSeconds: Math.min(6.6, Math.max(1.2, turnWindowSeconds - 0.15)),
        speaker: dialogue.speaker,
        text: dialogue.text,
        voiceName: getFixedVoiceName(dialogue.speaker, voiceAssignments),
        voiceDirection: dialogue.voiceDirection,
      });
    });
  });
  return cues;
}

function buildExtensionDialogueCues(
  dialogueShots: readonly (readonly Record<string, unknown>[])[],
  targetDurationSeconds: number,
): DialogueCue[] {
  const cues: DialogueCue[] = [];
  const voiceAssignments = new Map<string, string>();

  dialogueShots.forEach((values, shotIndex) => {
    const dialogues = values
      .map(readViralDialogue)
      .filter((dialogue): dialogue is NonNullable<ReturnType<typeof readViralDialogue>> =>
        dialogue !== null,
      );
    if (dialogues.length === 0) return;

    const shotStartSeconds = shotIndex === 0 ? 0 : 8 + (shotIndex - 1) * 7;
    const shotDurationSeconds = shotIndex === 0 ? 8 : 7;
    const firstCueStartSeconds = shotStartSeconds + 0.45;
    const availableEndSeconds = Math.min(
      shotStartSeconds + shotDurationSeconds - 0.3,
      targetDurationSeconds + 1.2,
    );
    const dialogueWindowSeconds = Math.max(
      1.2,
      availableEndSeconds - firstCueStartSeconds,
    );
    const turnWindowSeconds = dialogueWindowSeconds / dialogues.length;

    dialogues.forEach((dialogue, turnIndex) => {
      cues.push({
        startSeconds: firstCueStartSeconds + turnIndex * turnWindowSeconds,
        maximumDurationSeconds: Math.min(6.2, Math.max(1.1, turnWindowSeconds - 0.12)),
        speaker: dialogue.speaker,
        text: dialogue.text,
        voiceName: getFixedVoiceName(dialogue.speaker, voiceAssignments),
        voiceDirection: dialogue.voiceDirection,
      });
    });
  });

  return cues;
}

function buildDialogueCuesFromStoredPrompt(
  prompt: string,
  targetDurationSeconds: number,
): DialogueCue[] {
  try {
    const story = JSON.parse(prompt) as Record<string, unknown>;
    const moviePlan = asRecord(story.moviePlan);
    const opening = asRecord(moviePlan.opening);
    const continuations = Array.isArray(moviePlan.continuations)
      ? moviePlan.continuations.map(asRecord)
      : [];
    const dialogueShots = [
      [
        asRecord(opening.dialogue),
        ...(Array.isArray(opening.dialogueTurns) ? opening.dialogueTurns.map(asRecord) : []),
      ],
      ...continuations.map((continuation) => [
        asRecord(continuation.dialogue),
        ...(Array.isArray(continuation.dialogueTurns)
          ? continuation.dialogueTurns.map(asRecord)
          : []),
      ]),
    ];
    if (story.creationMode === "viral-story") {
      const shotCount = Math.max(1, Math.ceil(targetDurationSeconds / 8));
      return buildViralDialogueCues(
        selectEvenlyIncludingFinal(dialogueShots, shotCount),
        targetDurationSeconds,
      );
    }
    return buildExtensionDialogueCues(dialogueShots, targetDurationSeconds);
  } catch {
    return [];
  }
}

function buildViralVisualDialogueDirection(
  values: readonly Record<string, unknown>[],
  nativeCharacterDialogue = false,
  nativeDialogueAudioRetry = false,
): string {
  const dialogues = values
    .map(readViralDialogue)
    .filter((dialogue): dialogue is NonNullable<ReturnType<typeof readViralDialogue>> =>
      dialogue !== null,
    );
  const renderedDialogues = dialogues.map((dialogue) => ({
    ...dialogue,
    text: nativeDialogueAudioRetry
      ? buildAudioFilterSafeDramaLine(dialogue.speaker, dialogue.text)
      : dialogue.text,
    voiceDirection: nativeDialogueAudioRetry
      ? "Calm, clear, ordinary conversational German; no shouting, crying, whispering or vocal effects."
      : dialogue.voiceDirection,
  }));
  if (dialogues.length === 0) {
    return "No character speaks in this shot. Use reaction acting and clean background audio only.";
  }
  return [
    nativeCharacterDialogue
      ? "MANDATORY NATIVE ON-SCREEN SPEAKING SEQUENCE:"
      : "VISIBLE SPEAKING SEQUENCE:",
    ...renderedDialogues.map((dialogue, index) =>
      `${index + 1}. ${dialogue.speaker}: \"${dialogue.text}\" — ${dialogue.voiceDirection}`,
    ),
    nativeCharacterDialogue
      ? "The named visible characters themselves must say these exact words audibly, in this order, one at a time. Show each active speaker's face and mouth clearly and synchronize natural mouth, jaw and facial movement to their own voice. Never turn these lines into narration, voice-over, off-screen speech or speech by another character."
      : "Show the currently active character's face and mouth clearly, then shift focus naturally to the next speaker. Create natural mouth, jaw and facial movement paced to each short sentence, but do not synthesize audible words inside the Veo clip. The fixed studio voices are added later.",
  ].join("\n");
}

function buildAudioFilterSafeDramaLine(speaker: string, originalText: string): string {
  const lines = [
    "Warum hast du uns die Wahrheit verschwiegen?",
    "Jetzt erfahren alle, was wirklich passiert ist.",
    "Damit habe ich wirklich nicht gerechnet.",
    "Diese Überraschung verändert jetzt einfach alles.",
  ] as const;
  const seed = `${speaker}:${originalText}`;
  const hash = [...seed].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return lines[hash % lines.length];
}

function buildViralReferenceDirection(story: Record<string, unknown>): string {
  const productionBible = asRecord(story.productionBible);
  const characters = Array.isArray(productionBible.characterBible)
    ? productionBible.characterBible.map(asRecord)
    : [];
  const identityList = characters
    .map((character) => [
      typeof character.name === "string" ? character.name : "Character",
      typeof character.fixedAppearance === "string" ? character.fixedAppearance : "",
      typeof character.clothing === "string" ? `clothing=${character.clothing}` : "",
    ].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("\n");

  return [
    "HIGHEST-PRIORITY VIRAL FRUIT REALITY-TV LOCK:",
    "The supplied asset reference images define the exact immutable identity of the selected adult fruit characters. They are identity references, not a required first frame.",
    "Recompose the characters naturally for this shot while preserving fruit species, head geometry, facial features, body proportions, outfit, colors, shoes and accessories exactly.",
    "CLOSED CAST: show only the selected referenced fruit characters. Never show humans, hosts, extras, bystanders, audiences, unreferenced hands, silhouettes, reflections of other people, crowds or additional fruit characters.",
    "Never merge two characters, swap their outfits, change their fruit type, create a human face or human head, duplicate a character or introduce any unreferenced character. Every visible head remains the exact fruit head from its reference for the entire shot.",
    "WORLD LOCK: every shot takes place in the same luxurious tropical dating-show villa with pool terrace, fire pit, palms and warm evening light. Allowed zones are the fire pit, pool terrace, lounge and bedroom of that same villa. Never use an office, warehouse, classroom, street, studio or generic neutral room.",
    "TEXT-FREE FRAME: absolutely no subtitles, closed captions, lower thirds, title cards, speech bubbles, letters, words, numbers, logos, watermarks, signs, name tags or readable text on phones, screens, luggage, clothing or props. Keep device screens abstract and unreadable; communicate evidence through a plain prop and character reactions.",
    identityList ? `LOCKED IDENTITIES:\n${identityList}` : "",
  ].filter(Boolean).join("\n");
}

function buildViralTrashTvDirection(reactionBoost = false): string {
  return [
    "TIKTOK TRASH-TV DRAMA (mandatory):",
    "Stage an exaggerated interpersonal reality-show confrontation between the fruit characters: accusation, secret, betrayal, jealousy or alliance, escalating reactions, a sharp reveal and a dramatic payoff.",
    "Every shot contains an active visible verbal argument, never a calm explanatory conversation. Characters interrupt each other, point accusingly, throw their hands up, invade personal space without touching, turn away in outrage, snap back, roll their eyes, exchange hostile side-eye, recoil in disbelief and perform huge double-takes.",
    "Include at least two unmistakably exaggerated physical reaction beats in every 8-second shot. Use rapid shot-reverse-shot coverage and tight reaction close-ups so the conflict reads instantly on a phone screen.",
    "Nobody stands neutrally or behaves like a presenter. Keep the dispute non-violent: no hitting, pushing, injury or physical harm.",
    reactionBoost
      ? "MAXIMUM REACTION BOOST: Push facial expressions, gestures, timing and confrontational body language far beyond everyday realism, like the loudest peak moment of sensational reality television. The characters visibly argue throughout the shot and finish on a giant shocked, offended or triumphant reaction."
      : "",
    "This is fictional entertainment, never a documentary, report, educational explainer, interview, presenter segment or observational nature film.",
  ].filter(Boolean).join("\n");
}

function buildViralMicrodramaBeatDirection(
  shotNumber: number,
  totalShots: number,
): string {
  let storyPhase: string;

  if (totalShots <= 1) {
    storyPhase =
      "Compress the full arc into this shot: scandal cold open, visible evidence, direct confrontation, counter-reveal and an unresolved final sting.";
  } else if (shotNumber === 1) {
    storyPhase =
      "COLD OPEN: Start inside the scandal or its consequence. Show the accusation and visible evidence immediately; never begin with backstory, recap or calm setup.";
  } else if (shotNumber === totalShots) {
    storyPhase =
      "CLIFFHANGER: Give one partial answer, then reveal a bigger secret or new piece of evidence. Finish on a huge shocked reaction, an opening door, an incriminating prop or a half-revealed secret. Do not resolve, reconcile or settle into a calm ending.";
  } else if (shotNumber === totalShots - 1) {
    storyPhase =
      "CONFRONTATION: Force a face-to-face accusation, interruption and counter-reveal. Reverse who appears guilty and push reactions to their highest level so far.";
  } else if (shotNumber === 2) {
    storyPhase =
      "DISCOVERY: A character overhears, catches or finds a concrete piece of evidence. Turn suspicion into a direct accusation and end with an unexpected denial or threat to expose more.";
  } else {
    storyPhase =
      "ESCALATION: Break an alliance, expose a contradiction or introduce a witness from the locked cast. Every action must tighten the same central scandal.";
  }

  return [
    `VIRAL MICRODRAMA BEAT ${shotNumber}/${totalShots} (mandatory):`,
    storyPhase,
    "Internal 8-second rhythm: 0.0–1.5s visible hook; 1.5–4.0s accusation or evidence; 4.0–6.0s extreme reaction close-up; 6.0–8.0s escalation or surprise sting.",
    "Keep every spoken line punchy and no longer than eight words. The visible character speaks it directly with synchronized lips; no narrator and no voice-over.",
  ].join("\n");
}

function buildViralIndependentShotPrompt(
  story: Record<string, unknown>,
  continuation: Record<string, unknown>,
  shotNumber: number,
  totalShots: number,
  selectedAudioDirection: string,
  nativeCharacterDialogue: boolean,
  nativeDialogueAudioRetry: boolean,
  trashTvReactionBoost: boolean,
): string {
  const title = typeof story.title === "string" ? story.title : "TikTok story";
  const summary = typeof story.summary === "string" ? story.summary : "";
  const isFinalShot = shotNumber === totalShots;
  const dialogueTurns = Array.isArray(continuation.dialogueTurns)
    ? continuation.dialogueTurns.map(asRecord)
    : [];

  return [
    `INDEPENDENT 8-SECOND TIKTOK STORY SHOT ${shotNumber} OF ${totalShots}.`,
    `STORY TITLE: ${title}`,
    summary ? `COMPLETE STORY CONTEXT: ${summary}` : "",
    buildViralReferenceDirection(story),
    buildViralTrashTvDirection(trashTvReactionBoost),
    buildViralMicrodramaBeatDirection(shotNumber, totalShots),
    typeof continuation.storyBeat === "string" ? `STORY BEAT: ${continuation.storyBeat}` : "",
    typeof continuation.emotionalBeat === "string" ? `EMOTION: ${continuation.emotionalBeat}` : "",
    typeof continuation.actionContinuation === "string" ? `VISIBLE ACTION: ${continuation.actionContinuation}` : "",
    typeof continuation.environmentContinuity === "string" ? `LOCATION: ${continuation.environmentContinuity}` : "",
    typeof continuation.cameraContinuation === "string" ? `CAMERA: ${continuation.cameraContinuation}` : "",
    typeof continuation.performanceContinuation === "string" ? `PERFORMANCE: ${continuation.performanceContinuation}` : "",
    "Any location, cast or prop instruction above that conflicts with the tropical-villa, closed-cast or text-free lock is invalid and must be ignored.",
    buildViralVisualDialogueDirection([
      asRecord(continuation.dialogue),
      ...dialogueTurns,
    ], nativeCharacterDialogue, nativeDialogueAudioRetry),
    "Create a fresh, story-appropriate composition. Do not repeat the neutral reference-card pose or studio backdrop.",
    "The action must be instantly readable on a phone screen and advance the story without a visual reset or repeated beat.",
    isFinalShot
      ? "Deliver one partial payoff, then finish on an unresolved visual cliffhanger and the strongest reaction of the episode. Never use a calm resting frame or complete reconciliation."
      : "End on a strong reaction, reveal or motivated action that cuts cleanly to the next shot.",
    selectedAudioDirection,
    nativeCharacterDialogue
      ? "The assigned visible characters speak their lines with synchronized lips. No narrator, no voice-over, no off-screen speech, no subtitles, no captions, no readable text, no logos and no watermark."
      : "No spoken words, no lip-synced dialogue, no subtitles, no captions, no readable text, no logos and no watermark.",
  ].filter(Boolean).join("\n\n");
}

function buildOpeningDialoguePrompt(value: unknown): string {
  const dialogue = asRecord(value);
  if (dialogue.enabled !== true) return "";

  const speaker = readString(
    dialogue.speaker,
    "moviePlan.opening.dialogue.speaker fehlt.",
  );
  const text = readString(
    dialogue.text,
    "moviePlan.opening.dialogue.text fehlt.",
  );
  const language = readString(
    dialogue.language,
    "moviePlan.opening.dialogue.language fehlt.",
  );
  const voiceDirection = readString(
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
  ].join("\n");
}

function buildOpeningPrompt(
  opening: Record<string, unknown>,
  aspectRatio: VideoAspectRatio,
  editingStyle: string | undefined,
  selectedAudioDirection: string,
): string {
  return [
    readString(opening.veoPrompt, "moviePlan.opening.veoPrompt fehlt."),
    "",
    `ASPECT RATIO: ${aspectRatio}`,
    `EDITING STYLE: ${editingStyle || "auto"}`,
    buildOpeningDialoguePrompt(opening.dialogue),
    typeof opening.audioPrompt === "string" ? `AUDIO DIRECTION:\n${opening.audioPrompt}` : "",
    selectedAudioDirection,
    typeof opening.negativePrompt === "string" ? `NEGATIVE REQUIREMENTS:\n${opening.negativePrompt}` : "",
    "ABSOLUTE TEXT SAFETY: Do not render readable letters, words, numbers, URLs, logos, captions, code or interface text anywhere in the footage. Computer and phone screens use abstract unlettered light patterns only. Exact titles are added later in post-production.",
  ].filter(Boolean).join("\n");
}

function buildChapterContinuationPrompt(
  moviePlan: Record<string, unknown>,
  chapter: Record<string, unknown>,
  chapterNumber: number,
  extensionNumber: number,
  totalExtensions: number,
): string {
  return [
    `Continue chapter ${chapterNumber} seamlessly, extension ${extensionNumber} of ${totalExtensions}.`,
    `Chapter title: ${typeof chapter.title === "string" ? chapter.title : `Chapter ${chapterNumber}`}`,
    typeof chapter.storyGoal === "string" ? `Story goal: ${chapter.storyGoal}` : "",
    typeof chapter.visualGoal === "string" ? `Visual goal: ${chapter.visualGoal}` : "",
    typeof moviePlan.characterContinuityRules === "string" ? `Character continuity: ${moviePlan.characterContinuityRules}` : "",
    typeof moviePlan.visualContinuityRules === "string" ? `Visual continuity: ${moviePlan.visualContinuityRules}` : "",
    "Preserve the same characters, wardrobe, world, camera direction, lighting, audio identity and temporal continuity.",
    extensionNumber === totalExtensions && typeof chapter.transitionOut === "string"
      ? `End transition: ${chapter.transitionOut}`
      : "Advance the action and finish in a continuation-ready state.",
  ].filter(Boolean).join("\n");
}
