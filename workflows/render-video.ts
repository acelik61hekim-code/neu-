import { sleep } from "workflow";
import { CURRENTLY_RELEASED_MAX_DURATION_SECONDS } from "@/lib/pricing";
import type { VideoAspectRatio, VideoDurationSeconds } from "@/types/story";

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
  totalExtensions: number;
  finishing: {
    voiceoverText?: string;
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
};

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

export async function renderVideoWorkflow(jobId: string): Promise<RenderResult> {
  "use workflow";

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

  try {
    const chapterUris: string[] = [];
    let completedExtensions = 0;

    for (const segment of prepared.segments) {
      const openingOperation = await startOpeningWithProviderRetry(
        jobId,
        segment.openingPrompt,
        prepared.aspectRatio,
        segment.chapterNumber,
      );
      let currentUri = await waitForOperation(
        jobId,
        openingOperation,
        segment.chapterNumber,
        completedExtensions,
        prepared.totalExtensions,
      );

      for (let index = 0; index < segment.continuationPrompts.length; index += 1) {
        const globalExtensionNumber = completedExtensions + 1;
        const operation = await startExtensionWithProviderRetry(
          jobId,
          currentUri,
          segment.continuationPrompts[index],
          prepared.aspectRatio,
          segment.chapterNumber,
          globalExtensionNumber,
        );
        currentUri = await waitForOperation(
          jobId,
          operation,
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
  return {
    videoUri: job.videoUri,
    duration: job.targetDurationSeconds,
    finishing: {
      voiceoverText: job.voiceoverText,
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
      reason: error instanceof Error ? error.message : "Veo-Rendering ist deaktiviert.",
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
  const selectedAudioDirection = buildSelectedAudioDirection(
    job.audioStyle ?? "cinematic",
    job.voiceMode ?? "auto",
    job.spokenLanguage ?? "de",
    job.voiceoverText ?? "",
    job.targetDurationSeconds,
  );

  const viralStoryMode = story.creationMode === "viral-story";

  if (viralStoryMode) {
    if (job.aspectRatio !== "9:16") {
      throw new Error("Der TikTok-Story-Modus benötigt das vertikale Format 9:16.");
    }

    if (!job.voiceoverText?.trim()) {
      throw new Error("Für die TikTok-Story fehlt der automatisch erzeugte Sprechertext.");
    }

    const opening = asRecord(moviePlan.opening);
    const safeOpening = {
      ...opening,
      veoPrompt: removeVisibleTextRenderingInstructions(
        readString(opening.veoPrompt, "moviePlan.opening.veoPrompt fehlt."),
      ),
    };
    const openingPrompt = [
      buildOpeningPrompt(
        safeOpening,
        "9:16",
        "social",
        selectedAudioDirection,
      ),
      buildViralReferenceDirection(story),
      "SHOT 1: Open with the central conflict visibly understandable within the first two seconds.",
    ].join("\n\n");

    const rawContinuations = Array.isArray(moviePlan.continuations)
      ? moviePlan.continuations
      : [];
    const candidatePrompts = [
      openingPrompt,
      ...rawContinuations.map((item, index) =>
        buildViralIndependentShotPrompt(
          story,
          asRecord(item),
          index + 2,
          rawContinuations.length + 1,
          selectedAudioDirection,
        ),
      ),
    ];
    const shotCount = Math.max(1, Math.ceil(job.targetDurationSeconds / 8));
    const selectedPrompts = selectEvenlyIncludingFinal(candidatePrompts, shotCount);

    selectedPrompts.forEach((shotPrompt, index) => {
      segments.push({
        chapterNumber: index + 1,
        targetSeconds: 8,
        openingPrompt: shotPrompt,
        continuationPrompts: [],
      });
    });
  } else if (job.targetDurationSeconds <= 120) {
    const opening = asRecord(moviePlan.opening);
    const safeOpening = {
      ...opening,
      veoPrompt: removeVisibleTextRenderingInstructions(
        readString(opening.veoPrompt, "moviePlan.opening.veoPrompt fehlt."),
      ),
    };
    const openingPrompt = buildOpeningPrompt(
      safeOpening,
      job.aspectRatio,
      job.editingStyle,
      selectedAudioDirection,
    );
    const rawContinuations = Array.isArray(moviePlan.continuations) ? moviePlan.continuations : [];
    const continuationPrompts = rawContinuations.map((item) => [
      buildMovieContinuationPrompt(
        story as unknown as import("@/types/story").Story,
        item as import("@/types/story").MovieContinuation,
      ),
      selectedAudioDirection,
    ].join("\n\n"));
    const expected = extensionCountFor(job.targetDurationSeconds);
    if (continuationPrompts.length !== expected) {
      throw new Error(`MoviePlan enthält ${continuationPrompts.length} Extensions; erwartet werden ${expected}.`);
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
    totalExtensions,
    finishing: {
      voiceoverText: job.voiceoverText,
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
  if (process.env.VEO_WORKFLOW_RENDER_ENABLED !== "true") throw new Error("Veo-Rendering ist deaktiviert.");
  const { jobStore } = await import("@/lib/store");
  const { startVideoGeneration } = await import("@/lib/veo");
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
    const { getRetryableVeoStartError } = await import("@/lib/veo");
    const providerError = getRetryableVeoStartError(error);
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
  if (process.env.VEO_WORKFLOW_RENDER_ENABLED !== "true") throw new Error("Veo-Rendering ist deaktiviert.");
  const { jobStore } = await import("@/lib/store");
  const { startVideoExtension } = await import("@/lib/veo");
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
    const { getRetryableVeoStartError } = await import("@/lib/veo");
    const providerError = getRetryableVeoStartError(error);
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
  const { checkVideoStatus } = await import("@/lib/veo");
  const { jobStore } = await import("@/lib/store");
  const status = await checkVideoStatus(operationName);
  const job = await jobStore.get(jobId);
  if (!job) throw new Error("Render-Job wurde beim Statusabruf nicht gefunden.");
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
): Promise<string> {
  for (let poll = 0; poll < 180; poll += 1) {
    await sleep("10s");
    const status = await pollVideoStep(jobId, operationName, chapterNumber, completedExtensions, totalExtensions);
    if (status.done && status.videoUri) return status.videoUri;
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
  if (process.env.VEO_WORKFLOW_RENDER_ENABLED !== "true") {
    throw new Error("VEO_WORKFLOW_RENDER_ENABLED ist deaktiviert.");
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
  if (requestedCount <= 1) return items.length > 0 ? [items[items.length - 1]] : [];

  const selectedIndexes = new Set<number>();
  for (let index = 0; index < requestedCount; index += 1) {
    selectedIndexes.add(
      Math.round((index * (items.length - 1)) / (requestedCount - 1)),
    );
  }

  return [...selectedIndexes]
    .sort((first, second) => first - second)
    .map((index) => items[index]);
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
    "VIRAL CHARACTER REFERENCE MODE:",
    "The supplied asset reference images define the exact immutable identity of the selected adult fruit characters. They are identity references, not a required first frame.",
    "Recompose the characters naturally for this shot while preserving fruit species, head geometry, facial features, body proportions, outfit, colors, shoes and accessories exactly.",
    "Never merge two characters, swap their outfits, change their fruit type, create a human head, duplicate a character or introduce an unreferenced main character.",
    identityList ? `LOCKED IDENTITIES:\n${identityList}` : "",
  ].filter(Boolean).join("\n");
}

function buildViralIndependentShotPrompt(
  story: Record<string, unknown>,
  continuation: Record<string, unknown>,
  shotNumber: number,
  totalShots: number,
  selectedAudioDirection: string,
): string {
  const title = typeof story.title === "string" ? story.title : "TikTok story";
  const summary = typeof story.summary === "string" ? story.summary : "";
  const isFinalShot = shotNumber === totalShots;

  return [
    `INDEPENDENT 8-SECOND TIKTOK STORY SHOT ${shotNumber} OF ${totalShots}.`,
    `STORY TITLE: ${title}`,
    summary ? `COMPLETE STORY CONTEXT: ${summary}` : "",
    buildViralReferenceDirection(story),
    typeof continuation.storyBeat === "string" ? `STORY BEAT: ${continuation.storyBeat}` : "",
    typeof continuation.emotionalBeat === "string" ? `EMOTION: ${continuation.emotionalBeat}` : "",
    typeof continuation.actionContinuation === "string" ? `VISIBLE ACTION: ${continuation.actionContinuation}` : "",
    typeof continuation.environmentContinuity === "string" ? `LOCATION: ${continuation.environmentContinuity}` : "",
    typeof continuation.cameraContinuation === "string" ? `CAMERA: ${continuation.cameraContinuation}` : "",
    typeof continuation.performanceContinuation === "string" ? `PERFORMANCE: ${continuation.performanceContinuation}` : "",
    "Create a fresh, story-appropriate composition. Do not repeat the neutral reference-card pose or studio backdrop.",
    "The action must be instantly readable on a phone screen and advance the story without a visual reset or repeated beat.",
    isFinalShot
      ? "Deliver the complete visual payoff early in this shot and end on a stable, emotionally clear resting frame."
      : "End on a strong reaction, reveal or motivated action that cuts cleanly to the next shot.",
    selectedAudioDirection,
    "No spoken words, no lip-synced dialogue, no subtitles, no captions, no readable text, no logos and no watermark.",
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
