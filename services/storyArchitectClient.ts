import type {
  AudioBible,
  CameraBible,
  CharacterBibleEntry,
  LightingBible,
  MusicVideoTrackContext,
  MovieContinuation,
  MovieOpening,
  MoviePlan,
  PerformanceBible,
  ProductionBible,
  ProductionMemory,
  Scene,
  SceneDialogue,
  Story,
  StoryDraft,
  ViralBible,
  VideoAspectRatio,
  VideoAudioStyle,
  VideoCreationMode,
  VideoChapter,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoGenerationStrategy,
  VisualBible,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

import {
  isVideoAudioStyle,
  isVideoSpokenLanguage,
  isVideoVoiceMode,
} from "@/lib/audio-options";

const SEEDANCE_CLIP_DURATION_SECONDS = 15;

/*
 * 8 Sekunden bleiben ausschließlich für alte,
 * bereits gespeicherte Aufträge gültig.
 *
 * Neue Videolängen beginnen bei 15 Sekunden.
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

type DurationPlan = {
  targetDurationSeconds: VideoDurationSeconds;
  generationStrategy: VideoGenerationStrategy;
  extensionCount: number;
  generatedDurationSeconds: number;
  chapterTargets: VideoDurationSeconds[];
};

type StoryArchitectApiResponse = {
  scenes?: unknown;
  productionBible?: unknown;
  moviePlan?: unknown;
  generationModel?: unknown;
  error?: string;
};

function isVideoAspectRatio(
  value: unknown,
): value is VideoAspectRatio {
  return (
    typeof value === "string" &&
    SUPPORTED_ASPECT_RATIOS.includes(
      value as VideoAspectRatio,
    )
  );
}

function isVideoEditingStyle(
  value: unknown,
): value is VideoEditingStyle {
  return (
    typeof value === "string" &&
    SUPPORTED_EDITING_STYLES.includes(
      value as VideoEditingStyle,
    )
  );
}

function isVideoDurationSeconds(
  value: unknown,
): value is VideoDurationSeconds {
  return (
    typeof value === "number" &&
    SUPPORTED_VIDEO_DURATIONS.includes(
      value as VideoDurationSeconds,
    )
  );
}

function getOpeningDurationSeconds(
  targetDurationSeconds: VideoDurationSeconds,
): number {
  return targetDurationSeconds === 8
    ? 8
    : SEEDANCE_CLIP_DURATION_SECONDS;
}

function getContinuationDurationSeconds(
  targetDurationSeconds: VideoDurationSeconds,
): number {
  /*
   * Für einen 8-Sekunden-Legacy-Auftrag gibt es
   * normalerweise keine Continuation.
   *
   * Die 7 bleibt nur für alte Daten kompatibel.
   */
  return targetDurationSeconds === 8
    ? 7
    : SEEDANCE_CLIP_DURATION_SECONDS;
}

function generatedLengthForSingleChain(
  targetDurationSeconds: VideoDurationSeconds,
): {
  extensionCount: number;
  generatedDurationSeconds: number;
} {
  if (targetDurationSeconds === 8) {
    return {
      extensionCount: 0,
      generatedDurationSeconds: 8,
    };
  }

  if (targetDurationSeconds === 15) {
    return {
      extensionCount: 0,
      generatedDurationSeconds: 15,
    };
  }

  const extensionCount = Math.ceil(
    (targetDurationSeconds - 15) / 15,
  );

  return {
    extensionCount,
    generatedDurationSeconds:
      15 + extensionCount * 15,
  };
}

function buildDurationPlan(
  targetDurationSeconds: VideoDurationSeconds,
): DurationPlan {
  if (targetDurationSeconds <= 120) {
    const singleChain =
      generatedLengthForSingleChain(
        targetDurationSeconds,
      );

    return {
      targetDurationSeconds,

      generationStrategy:
        targetDurationSeconds <= 15
          ? "single-shot"
          : "extension-chain",

      extensionCount:
        singleChain.extensionCount,

      generatedDurationSeconds:
        singleChain.generatedDurationSeconds,

      chapterTargets: [
        targetDurationSeconds,
      ],
    };
  }

  const chapterTargets:
    VideoDurationSeconds[] = [];

  let remaining =
    targetDurationSeconds;

  while (remaining > 120) {
    chapterTargets.push(120);
    remaining -= 120;
  }

  if (remaining > 0) {
    if (
      !isVideoDurationSeconds(
        remaining,
      )
    ) {
      throw new Error(
        `Ungültige Restkapitellänge: ${remaining} Sekunden.`,
      );
    }

    chapterTargets.push(
      remaining,
    );
  }

  const generatedDurationSeconds =
    chapterTargets.reduce(
      (
        sum,
        chapterTarget,
      ) =>
        sum +
        generatedLengthForSingleChain(
          chapterTarget,
        ).generatedDurationSeconds,
      0,
    );

  return {
    targetDurationSeconds,

    generationStrategy:
      "chaptered",

    extensionCount: 0,

    generatedDurationSeconds,

    chapterTargets,
  };
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function isString(
  value: unknown,
): value is string {
  return typeof value === "string";
}

function isSceneDialogue(
  value: unknown,
): value is SceneDialogue {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const dialogue =
    value as Partial<SceneDialogue>;

  if (
    typeof dialogue.enabled !== "boolean" ||
    !isString(dialogue.speaker) ||
    !isString(dialogue.text) ||
    !isString(dialogue.language) ||
    !isString(dialogue.voiceDirection)
  ) {
    return false;
  }

  if (!dialogue.enabled) {
    return true;
  }

  return (
    isNonEmptyString(
      dialogue.speaker,
    ) &&
    isNonEmptyString(
      dialogue.text,
    ) &&
    isNonEmptyString(
      dialogue.language,
    ) &&
    isNonEmptyString(
      dialogue.voiceDirection,
    )
  );
}

function isDialogueTurns(
  value: unknown,
): boolean {
  return (
    value === undefined ||
    (
      Array.isArray(value) &&
      value.length <= 3 &&
      value.every(
        isSceneDialogue,
      )
    )
  );
}

/*
 * =========================================================
 * TEMPORÄRE SCENE-KOMPATIBILITÄT
 * =========================================================
 *
 * Alte Komponenten verwenden teilweise weiterhin
 * story.scenes.
 *
 * Deshalb akzeptieren wir:
 * - alte 8-Sekunden-Szenen
 * - neue 15-Sekunden-Szenen
 */
function isScene(
  value: unknown,
): value is Scene {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const scene =
    value as Partial<Scene>;

  return (
    typeof scene.id === "number" &&

    isNonEmptyString(
      scene.title,
    ) &&

    isNonEmptyString(
      scene.description,
    ) &&

    isNonEmptyString(
      scene.location,
    ) &&

    isNonEmptyString(
      scene.mood,
    ) &&

    isNonEmptyString(
      scene.keyAction,
    ) &&

    isNonEmptyString(
      scene.visualFocus,
    ) &&

    isNonEmptyString(
      scene.startFrame,
    ) &&

    isNonEmptyString(
      scene.endingFrame,
    ) &&

    isNonEmptyString(
      scene.characterStateAtStart,
    ) &&

    isNonEmptyString(
      scene.characterStateAtEnd,
    ) &&

    isNonEmptyString(
      scene.environmentStateAtStart,
    ) &&

    isNonEmptyString(
      scene.environmentStateAtEnd,
    ) &&

    isNonEmptyString(
      scene.cameraStateAtStart,
    ) &&

    isNonEmptyString(
      scene.cameraStateAtEnd,
    ) &&

    isNonEmptyString(
      scene.lightingState,
    ) &&

    isString(
      scene.continuityNotes,
    ) &&

    isSceneDialogue(
      scene.dialogue,
    ) &&

    isDialogueTurns(
      scene.dialogueTurns,
    ) &&

    (
      scene.durationSeconds === 8 ||
      scene.durationSeconds === 15
    )
  );
}

/*
 * =========================================================
 * PRODUCTION BIBLE
 * =========================================================
 */

function isCharacterBibleEntry(
  value: unknown,
): value is CharacterBibleEntry {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const character =
    value as Partial<CharacterBibleEntry>;

  return (
    isNonEmptyString(
      character.id,
    ) &&

    isNonEmptyString(
      character.name,
    ) &&

    isNonEmptyString(
      character.role,
    ) &&

    isNonEmptyString(
      character.fixedAppearance,
    ) &&

    isNonEmptyString(
      character.faceIdentity,
    ) &&

    isNonEmptyString(
      character.hair,
    ) &&

    isNonEmptyString(
      character.eyes,
    ) &&

    isNonEmptyString(
      character.bodyType,
    ) &&

    isNonEmptyString(
      character.clothing,
    ) &&

    isString(
      character.accessories,
    ) &&

    isNonEmptyString(
      character.movementStyle,
    ) &&

    isNonEmptyString(
      character.voiceIdentity,
    )
  );
}

function isVisualBible(
  value: unknown,
): value is VisualBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<VisualBible>;

  return (
    isNonEmptyString(
      bible.visualStyle,
    ) &&

    isNonEmptyString(
      bible.colorGrade,
    ) &&

    isNonEmptyString(
      bible.lightingStyle,
    ) &&

    isNonEmptyString(
      bible.realismLevel,
    ) &&

    isNonEmptyString(
      bible.environmentRules,
    ) &&

    isNonEmptyString(
      bible.continuityRules,
    )
  );
}

function isCameraBible(
  value: unknown,
): value is CameraBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<CameraBible>;

  return (
    isNonEmptyString(
      bible.cameraStyle,
    ) &&

    isNonEmptyString(
      bible.lensStyle,
    ) &&

    isNonEmptyString(
      bible.frameRate,
    ) &&

    isNonEmptyString(
      bible.motionStyle,
    ) &&

    isNonEmptyString(
      bible.compositionRules,
    ) &&

    isNonEmptyString(
      bible.transitionRules,
    )
  );
}

function isAudioBible(
  value: unknown,
): value is AudioBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<AudioBible>;

  return (
    isNonEmptyString(
      bible.dialogueLanguage,
    ) &&

    isNonEmptyString(
      bible.ambienceStyle,
    ) &&

    isNonEmptyString(
      bible.musicStyle,
    ) &&

    isNonEmptyString(
      bible.soundContinuityRules,
    ) &&

    isNonEmptyString(
      bible.dialogueRules,
    )
  );
}

function isViralBible(
  value: unknown,
): value is ViralBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<ViralBible>;

  return (
    isNonEmptyString(
      bible.hookStrategy,
    ) &&

    isNonEmptyString(
      bible.retentionStrategy,
    ) &&

    isNonEmptyString(
      bible.escalationStrategy,
    ) &&

    isNonEmptyString(
      bible.emotionalArc,
    ) &&

    isNonEmptyString(
      bible.payoffStrategy,
    ) &&

    isNonEmptyString(
      bible.cliffhangerStrategy,
    ) &&

    isNonEmptyString(
      bible.pacingRules,
    )
  );
}

function isPerformanceBible(
  value: unknown,
): value is PerformanceBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<PerformanceBible>;

  return (
    isNonEmptyString(
      bible.actingStyle,
    ) &&

    isNonEmptyString(
      bible.facialExpressionStyle,
    ) &&

    isNonEmptyString(
      bible.bodyLanguageStyle,
    ) &&

    isNonEmptyString(
      bible.dialogueDeliveryStyle,
    ) &&

    isNonEmptyString(
      bible.realismRules,
    )
  );
}

function isLightingBible(
  value: unknown,
): value is LightingBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<LightingBible>;

  return (
    isNonEmptyString(
      bible.primaryLightingStyle,
    ) &&

    isNonEmptyString(
      bible.lightDirection,
    ) &&

    isNonEmptyString(
      bible.contrastStyle,
    ) &&

    isNonEmptyString(
      bible.exposureStyle,
    ) &&

    isNonEmptyString(
      bible.practicalLights,
    ) &&

    isNonEmptyString(
      bible.continuityRules,
    )
  );
}

function isProductionBible(
  value: unknown,
): value is ProductionBible {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const bible =
    value as Partial<ProductionBible>;

  return (
    Array.isArray(
      bible.characterBible,
    ) &&

    bible.characterBible.length >
      0 &&

    bible.characterBible.every(
      isCharacterBibleEntry,
    ) &&

    isVisualBible(
      bible.visualBible,
    ) &&

    isCameraBible(
      bible.cameraBible,
    ) &&

    isAudioBible(
      bible.audioBible,
    ) &&

    isViralBible(
      bible.viralBible,
    ) &&

    isPerformanceBible(
      bible.performanceBible,
    ) &&

    isLightingBible(
      bible.lightingBible,
    )
  );
}

/*
 * =========================================================
 * MOVIE PLAN
 * =========================================================
 */

function isMovieOpening(
  value: unknown,
  targetDurationSeconds:
    VideoDurationSeconds,
): value is MovieOpening {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const opening =
    value as Partial<MovieOpening>;

  const expectedDuration =
    getOpeningDurationSeconds(
      targetDurationSeconds,
    );

  return (
    opening.id ===
      "opening" &&

    opening.startSecond ===
      0 &&

    opening.endSecond ===
      expectedDuration &&

    opening.durationSeconds ===
      expectedDuration &&

    isNonEmptyString(
      opening.title,
    ) &&

    isNonEmptyString(
      opening.storyBeat,
    ) &&

    isNonEmptyString(
      opening.hook,
    ) &&

    isNonEmptyString(
      opening.emotionalBeat,
    ) &&

    isNonEmptyString(
      opening.action,
    ) &&

    isNonEmptyString(
      opening.location,
    ) &&

    isNonEmptyString(
      opening.characterState,
    ) &&

    isNonEmptyString(
      opening.environmentState,
    ) &&

    isNonEmptyString(
      opening.cameraPlan,
    ) &&

    isNonEmptyString(
      opening.lightingPlan,
    ) &&

    isNonEmptyString(
      opening.performancePlan,
    ) &&

    isNonEmptyString(
      opening.audioPlan,
    ) &&

    isSceneDialogue(
      opening.dialogue,
    ) &&

    isDialogueTurns(
      opening.dialogueTurns,
    ) &&

    isNonEmptyString(
      opening.veoPrompt,
    ) &&

    isNonEmptyString(
      opening.audioPrompt,
    ) &&

    isNonEmptyString(
      opening.negativePrompt,
    )
  );
}

function isMovieContinuation(
  value: unknown,
  index: number,
  targetDurationSeconds:
    VideoDurationSeconds,
): value is MovieContinuation {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const continuation =
    value as Partial<MovieContinuation>;

  const expectedExtensionNumber =
    index + 1;

  const openingDuration =
    getOpeningDurationSeconds(
      targetDurationSeconds,
    );

  const continuationDuration =
    getContinuationDurationSeconds(
      targetDurationSeconds,
    );

  const expectedStartSecond =
    openingDuration +
    index *
      continuationDuration;

  const expectedEndSecond =
    expectedStartSecond +
    continuationDuration;

  return (
    continuation.id ===
      expectedExtensionNumber &&

    continuation.extensionNumber ===
      expectedExtensionNumber &&

    continuation.startSecond ===
      expectedStartSecond &&

    continuation.endSecond ===
      expectedEndSecond &&

    continuation.durationSeconds ===
      continuationDuration &&

    isNonEmptyString(
      continuation.title,
    ) &&

    isNonEmptyString(
      continuation.storyBeat,
    ) &&

    isNonEmptyString(
      continuation.emotionalBeat,
    ) &&

    isNonEmptyString(
      continuation.escalationPurpose,
    ) &&

    isNonEmptyString(
      continuation.actionContinuation,
    ) &&

    isNonEmptyString(
      continuation.characterContinuity,
    ) &&

    isNonEmptyString(
      continuation.environmentContinuity,
    ) &&

    isNonEmptyString(
      continuation.cameraContinuation,
    ) &&

    isNonEmptyString(
      continuation.lightingContinuation,
    ) &&

    isNonEmptyString(
      continuation.performanceContinuation,
    ) &&

    isNonEmptyString(
      continuation.audioContinuation,
    ) &&

    isSceneDialogue(
      continuation.dialogue,
    ) &&

    isDialogueTurns(
      continuation.dialogueTurns,
    ) &&

    isNonEmptyString(
      continuation.continuationPrompt,
    ) &&

    (
      continuation.audioPrompt ===
        undefined ||
      isString(
        continuation.audioPrompt,
      )
    ) &&

    (
      continuation.negativePrompt ===
        undefined ||
      isString(
        continuation.negativePrompt,
      )
    )
  );
}

function isVideoChapter(
  value: unknown,
  index: number,
  expectedTargets:
    VideoDurationSeconds[],
): value is VideoChapter {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const chapter =
    value as Partial<VideoChapter>;

  const expectedTarget =
    expectedTargets[index];

  if (
    expectedTarget ===
    undefined
  ) {
    return false;
  }

  const expectedStart =
    expectedTargets
      .slice(
        0,
        index,
      )
      .reduce(
        (
          sum,
          duration,
        ) =>
          sum +
          duration,
        0,
      );

  const expectedEnd =
    expectedStart +
    expectedTarget;

  return (
    chapter.id ===
      index + 1 &&

    chapter.startSecond ===
      expectedStart &&

    chapter.endSecond ===
      expectedEnd &&

    chapter.targetDurationSeconds ===
      expectedTarget &&

    isNonEmptyString(
      chapter.title,
    ) &&

    isNonEmptyString(
      chapter.storyGoal,
    ) &&

    isNonEmptyString(
      chapter.visualGoal,
    )
  );
}

function isMoviePlan(
  value: unknown,
): value is MoviePlan {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const plan =
    value as Partial<MoviePlan>;

  if (
    !isVideoDurationSeconds(
      plan.targetDurationSeconds,
    )
  ) {
    return false;
  }

  const targetDurationSeconds =
    plan.targetDurationSeconds;

  const expected =
    buildDurationPlan(
      targetDurationSeconds,
    );

  if (
    plan.generatedDurationSeconds !==
      expected.generatedDurationSeconds ||

    !isVideoAspectRatio(
      plan.aspectRatio,
    ) ||

    !isVideoEditingStyle(
      plan.editingStyle,
    ) ||

    plan.provider !==
      "auto" ||

    plan.generationStrategy !==
      expected.generationStrategy ||

    !isMovieOpening(
      plan.opening,
      targetDurationSeconds,
    ) ||

    !Array.isArray(
      plan.continuations,
    )
  ) {
    return false;
  }

  if (
    expected.generationStrategy ===
    "chaptered"
  ) {
    if (
      plan.continuations.length !==
        0 ||

      !Array.isArray(
        plan.chapters,
      ) ||

      plan.chapters.length !==
        expected.chapterTargets.length ||

      !plan.chapters.every(
        (
          chapter,
          index,
        ) =>
          isVideoChapter(
            chapter,
            index,
            expected.chapterTargets,
          ),
      )
    ) {
      return false;
    }
  } else {
    if (
      plan.continuations.length !==
        expected.extensionCount ||

      !plan.continuations.every(
        (
          continuation,
          index,
        ) =>
          isMovieContinuation(
            continuation,
            index,
            targetDurationSeconds,
          ),
      )
    ) {
      return false;
    }
  }

  return (
    isNonEmptyString(
      plan.endingStrategy,
    ) &&

    isNonEmptyString(
      plan.finalPayoff,
    ) &&

    isNonEmptyString(
      plan.finalCliffhanger,
    ) &&

    isNonEmptyString(
      plan.characterContinuityRules,
    ) &&

    isNonEmptyString(
      plan.visualContinuityRules,
    ) &&

    isNonEmptyString(
      plan.cameraContinuityRules,
    ) &&

    isNonEmptyString(
      plan.lightingContinuityRules,
    ) &&

    isNonEmptyString(
      plan.audioContinuityRules,
    ) &&

    isNonEmptyString(
      plan.storyContinuityRules,
    )
  );
}

/*
 * =========================================================
 * PRODUCTION MEMORY
 * =========================================================
 */

function createLocationId(
  location: string,
): string {
  const normalized =
    location
      .toLowerCase()
      .trim()
      .replace(
        /[^a-z0-9äöüß]+/g,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      );

  return (
    normalized ||
    "location"
  );
}

function createProductionMemory(
  productionBible:
    ProductionBible,

  moviePlan:
    MoviePlan,
): ProductionMemory {
  const opening =
    moviePlan.opening;

  return {
    characters:
      productionBible
        .characterBible
        .map(
          (
            character,
          ) => ({
            characterId:
              character.id,

            name:
              character.name,

            faceIdentity:
              character.faceIdentity,

            hair:
              character.hair,

            eyes:
              character.eyes,

            bodyType:
              character.bodyType,

            clothing:
              character.clothing,

            accessories:
              character.accessories,

            movementStyle:
              character.movementStyle,

            voiceIdentity:
              character.voiceIdentity,

            visibleInSceneIds:
              [],
          }),
        ),

    locations: [
      {
        id:
          createLocationId(
            opening.location,
          ),

        name:
          opening.location,

        description:
          opening.environmentState,

        environmentState:
          opening.environmentState,

        timeOfDay:
          "As defined by the movie plan",

        weather:
          "As defined by the movie plan",

        lighting:
          opening.lightingPlan,

        permanentObjects:
          [],

        activeProps:
          [],
      },
    ],

    props: [],

    /*
     * Alte Scene-Pipeline.
     */
    sceneContinuity:
      [],

    currentSceneId:
      undefined,

    lastCompletedSceneId:
      undefined,

    /*
     * Neue Seedance-15-Sekunden-Pipeline.
     */
    movieExtensions:
      [],

    currentExtensionNumber:
      0,

    lastCompletedExtensionNumber:
      undefined,

    currentVideoUri:
      undefined,

    approximateVideoDurationSeconds:
      0,

    targetDurationSeconds:
      moviePlan.targetDurationSeconds,

    currentChapterNumber:
      moviePlan.generationStrategy ===
      "chaptered"
        ? 1
        : undefined,

    lastCompletedChapterNumber:
      undefined,

    provider:
      moviePlan.provider ??
      "auto",

    aspectRatio:
      moviePlan.aspectRatio,

    editingStyle:
      moviePlan.editingStyle ??
      "social",

    globalVisualStyle:
      productionBible
        .visualBible
        .visualStyle,

    globalColorGrade:
      productionBible
        .visualBible
        .colorGrade,

    globalCameraLanguage: [
      productionBible
        .cameraBible
        .cameraStyle,

      productionBible
        .cameraBible
        .lensStyle,

      productionBible
        .cameraBible
        .motionStyle,
    ]
      .filter(Boolean)
      .join("; "),

    globalLightingStyle:
      productionBible
        .lightingBible
        ?.primaryLightingStyle ||
      productionBible
        .visualBible
        .lightingStyle,

    globalAudioStyle: [
      productionBible
        .audioBible
        .ambienceStyle,

      productionBible
        .audioBible
        .musicStyle,
    ]
      .filter(Boolean)
      .join("; "),

    currentLocation:
      opening.location,

    currentTimeOfDay:
      "As defined by the movie plan",

    currentWeather:
      "As defined by the movie plan",

    previousLastFrameUrl:
      undefined,

    updatedAt:
      new Date()
        .toISOString(),
  };
}

/*
 * =========================================================
 * STORY ARCHITECT REQUEST
 * =========================================================
 */

export async function requestStoryArchitect(
  storyDraft: StoryDraft,

  targetDurationSeconds:
    VideoDurationSeconds =
    60,

  aspectRatio:
    VideoAspectRatio =
    "9:16",

  editingStyle:
    VideoEditingStyle =
    "social",

  audioStyle:
    VideoAudioStyle =
    "cinematic",

  voiceMode:
    VideoVoiceMode =
    "auto",

  spokenLanguage:
    VideoSpokenLanguage =
    "de",

  voiceoverText =
    "",

  closingText =
    "",

  creationMode:
    VideoCreationMode =
    "standard",

  musicTrack?:
    MusicVideoTrackContext,
): Promise<Story> {
  if (
    !isVideoDurationSeconds(
      targetDurationSeconds,
    )
  ) {
    throw new Error(
      "Ungültige Videolänge. Erlaubt sind 15, 30, 60, 120, 180, 240 oder 300 Sekunden. 8 Sekunden werden nur noch für bestehende Legacy-Aufträge unterstützt.",
    );
  }

  if (
    !isVideoAspectRatio(
      aspectRatio,
    )
  ) {
    throw new Error(
      'Ungültiges Bildformat. Erlaubt sind "9:16" oder "16:9".',
    );
  }

  if (
    !isVideoEditingStyle(
      editingStyle,
    )
  ) {
    throw new Error(
      'Ungültiger Schnittstil. Erlaubt sind "auto", "social", "cinematic" oder "music-video".',
    );
  }

  if (
    !isVideoAudioStyle(
      audioStyle,
    )
  ) {
    throw new Error(
      "Ungültiger KI-Musikstil.",
    );
  }

  if (
    !isVideoVoiceMode(
      voiceMode,
    )
  ) {
    throw new Error(
      "Ungültige Stimmen-Option.",
    );
  }

  if (
    !isVideoSpokenLanguage(
      spokenLanguage,
    )
  ) {
    throw new Error(
      "Ungültige gesprochene Sprache.",
    );
  }

  const response =
    await fetch(
      "/api/story-architect",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            story:
              storyDraft,

            targetDurationSeconds,

            aspectRatio,

            editingStyle,

            audioStyle,

            voiceMode,

            spokenLanguage,

            voiceoverText,

            closingText,

            creationMode,

            musicTrack,
          }),
      },
    );

  let data:
    StoryArchitectApiResponse;

  try {
    data =
      await response
        .json() as StoryArchitectApiResponse;
  } catch {
    if (
      response.status ===
      504
    ) {
      throw new Error(
        "Die Filmplanung hat das Zeitlimit erreicht. Es wurde noch kein Video gestartet und keine Videominute verbraucht. Bitte sende die Idee erneut.",
      );
    }

    throw new Error(
      `Der Story Architect hat keine gültige JSON-Antwort geliefert. HTTP ${response.status}`,
    );
  }

  if (
    !response.ok
  ) {
    throw new Error(
      data.error ||
        "Der Story Architect konnte keinen Filmplan für die gewählte Videolänge erstellen.",
    );
  }

  if (
    !isProductionBible(
      data.productionBible,
    )
  ) {
    throw new Error(
      "Der Story Architect hat keine vollständige Production Bible zurückgegeben.",
    );
  }

  if (
    !isMoviePlan(
      data.moviePlan,
    )
  ) {
    throw new Error(
      "Der Story Architect hat keinen gültigen MoviePlan für die gewählte Videolänge zurückgegeben.",
    );
  }

  /*
   * story.scenes bleibt nur für ältere Komponenten.
   *
   * Es bestimmt NICHT die aktive Seedance-Pipeline.
   */
  const compatibilityScenes =
    Array.isArray(
      data.scenes,
    )
      ? data.scenes.filter(
          isScene,
        )
      : [];

  const orderedScenes =
    [
      ...compatibilityScenes,
    ].sort(
      (
        firstScene,
        secondScene,
      ) =>
        firstScene.id -
        secondScene.id,
    );

  const productionMemory =
    createProductionMemory(
      data.productionBible,
      data.moviePlan,
    );

  return {
    ...storyDraft,

    productionBible:
      data.productionBible,

    productionMemory,

    moviePlan:
      data.moviePlan,

    scenes:
      orderedScenes,

    generationModel:
      isString(
        data.generationModel,
      )
        ? data.generationModel
        : undefined,

    creationMode,
  };
}
