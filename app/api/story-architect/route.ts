import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

import {
  buildSelectedAudioDirection,
  normalizeVideoAudioStyle,
  normalizeVideoSpokenLanguage,
  normalizeVideoVoiceMode,
} from "@/lib/audio-options";

import type {
  MovieContinuation,
  MovieOpening,
  MoviePlan,
  ProductionBible,
  Scene,
  SceneDialogue,
  Story,
  StoryDraft,
  VideoAspectRatio,
  VideoAudioStyle,
  VideoChapter,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoGenerationStrategy,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STORY_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
] as const;

const RETRIES_PER_MODEL = 2;
const INITIAL_RETRY_DELAY_MS = 1500;

type StoryArchitectRequest = {
  story?: StoryDraft;
  targetDurationSeconds?: unknown;
  aspectRatio?: unknown;
  editingStyle?: unknown;
  audioStyle?: unknown;
  voiceMode?: unknown;
  spokenLanguage?: unknown;
};

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

function normalizeAspectRatio(
  value: unknown,
): VideoAspectRatio {
  return (
    typeof value === "string" &&
    SUPPORTED_ASPECT_RATIOS.includes(
      value as VideoAspectRatio,
    )
  )
    ? (value as VideoAspectRatio)
    : "9:16";
}

function normalizeEditingStyle(
  value: unknown,
): VideoEditingStyle {
  return (
    typeof value === "string" &&
    SUPPORTED_EDITING_STYLES.includes(
      value as VideoEditingStyle,
    )
  )
    ? (value as VideoEditingStyle)
    : "social";
}

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

type DurationPlan = {
  targetDurationSeconds: VideoDurationSeconds;
  generationStrategy: VideoGenerationStrategy;
  extensionCount: number;
  generatedDurationSeconds: number;
  chapterTargets: VideoDurationSeconds[];
};

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

function normalizeTargetDuration(
  value: unknown,
): VideoDurationSeconds {
  /*
   * 60 Sekunden bleiben vorerst der Default,
   * damit bestehende Client-Aufrufe ohne das neue Feld
   * weiterhin exakt wie bisher funktionieren.
   */
  return isVideoDurationSeconds(value)
    ? value
    : 60;
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

  const extensionCount =
    Math.ceil(
      (targetDurationSeconds - 8) / 7,
    );

  return {
    extensionCount,
    generatedDurationSeconds:
      8 + extensionCount * 7,
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
        targetDurationSeconds === 8
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

  /*
   * Für 3–5 Minuten planen wir mehrere Kapitel.
   * Ein Kapitel ist maximal 120 Sekunden lang.
   *
   * 180 s -> 120 + 60
   * 240 s -> 120 + 120
   * 300 s -> 120 + 120 + 60
   *
   * Die detaillierten Extension-Prompts der späteren
   * Kapitel werden später "just in time" erzeugt.
   * Dadurch explodiert die Story-Architect-Antwort
   * nicht auf zigtausende zusätzliche JSON-Zeichen.
   */
  const chapterTargets: VideoDurationSeconds[] = [];
  let remaining =
    targetDurationSeconds;

  while (remaining > 120) {
    chapterTargets.push(120);
    remaining -= 120;
  }

  if (remaining > 0) {
    chapterTargets.push(
      remaining as VideoDurationSeconds,
    );
  }

  const generatedDurationSeconds =
    chapterTargets.reduce(
      (sum, chapterTarget) =>
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

type GeneratedStory = {
  rawText: string;
  model: string;
};

type ErrorDetails = {
  status?: number;
  code?: number;
  message: string;
};

type ArchitectResponse = {
  productionBible: ProductionBible;
  moviePlan: MoviePlan;
};

type CompleteStoryResponse = Story & {
  productionBible: ProductionBible;
  moviePlan: MoviePlan;
  generationModel: string;
};

/*
 * WICHTIG:
 * Wir verwenden hier bewusst KEIN responseJsonSchema.
 *
 * Der MoviePlan ist sehr groß und tief verschachtelt.
 * Gemini kann komplexe Structured-Output-Schemas bereits
 * beim Request mit INVALID_ARGUMENT ablehnen.
 *
 * Stattdessen erzwingen wir JSON über responseMimeType
 * und prüfen die Antwort anschließend mit unseren eigenen
 * validate...()-Funktionen.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStoryDraft(value: unknown): value is StoryDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const draft = value as Partial<StoryDraft>;

  return (
    typeof draft.title === "string" &&
    typeof draft.genre === "string" &&
    typeof draft.mood === "string" &&
    typeof draft.setting === "string" &&
    typeof draft.summary === "string" &&
    Array.isArray(draft.characters)
  );
}

function cleanJsonText(text: string): string {
  let cleaned = text
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  /*
   * Falls Gemini trotz JSON-Modus noch einen kurzen
   * Einleitungssatz vor oder nach dem Objekt ausgibt,
   * schneiden wir auf das äußerste JSON-Objekt zu.
   */
  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace >= 0 &&
    lastBrace > firstBrace
  ) {
    cleaned =
      cleaned.slice(
        firstBrace,
        lastBrace + 1,
      );
  }

  /*
   * Häufiger kleiner JSON-Fehler:
   * ein überflüssiges Komma direkt vor } oder ].
   * Das können wir sicher reparieren, ohne Inhalte
   * oder Werte umzuschreiben.
   */
  cleaned =
    cleaned.replace(
      /,\s*([}\]])/g,
      "$1",
    );

  return cleaned.trim();
}

function tryParseJson(
  text: string,
): {
  parsed: unknown;
  cleanedText: string;
} | null {
  const cleanedText =
    cleanJsonText(text);

  try {
    return {
      parsed:
        JSON.parse(cleanedText),
      cleanedText,
    };
  } catch {
    return null;
  }
}


function asRecord(
  value: unknown,
): Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  value: unknown,
  fallback: string,
): string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  )
    ? value.trim()
    : fallback;
}

function readLooseString(
  value: unknown,
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeDialogue(
  value: unknown,
): SceneDialogue {
  const record = asRecord(value);
  const enabled =
    record.enabled === true;

  if (!enabled) {
    return {
      enabled: false,
      speaker: "",
      text: "",
      language: "",
      voiceDirection: "",
    };
  }

  return {
    enabled: true,
    speaker: readString(
      record.speaker,
      "Main character",
    ),
    text: readString(
      record.text,
      "Was passiert hier?",
    ),
    language: readString(
      record.language,
      "German",
    ),
    voiceDirection: readString(
      record.voiceDirection,
      "Natural, believable, concise delivery.",
    ),
  };
}

function normalizeProductionBible(
  value: unknown,
  story: StoryDraft,
  aspectRatio: VideoAspectRatio,
  editingStyle: VideoEditingStyle,
): ProductionBible {
  const root = asRecord(value);

  const rawCharacterBible =
    Array.isArray(root.characterBible)
      ? root.characterBible
      : [];

  const fallbackCharacters =
    story.characters.length > 0
      ? story.characters
      : [
          {
            id: "main-subject",
            name: "Main Subject",
            description:
              "The principal visible subject of the story.",
          },
        ];

  const characterBible =
    fallbackCharacters.map(
      (fallbackCharacter, index) => {
        const source =
          asRecord(
            rawCharacterBible[index],
          );

        const baseDescription =
          fallbackCharacter.description ||
          "Consistent realistic appearance.";

        return {
          id: readString(
            source.id,
            fallbackCharacter.id ||
              `character-${index + 1}`,
          ),

          name: readString(
            source.name,
            fallbackCharacter.name ||
              `Character ${index + 1}`,
          ),

          role: readString(
            source.role,
            index === 0
              ? "Main character"
              : "Supporting character",
          ),

          fixedAppearance: readString(
            source.fixedAppearance,
            baseDescription,
          ),

          faceIdentity: readString(
            source.faceIdentity,
            `Stable recognizable facial identity based on: ${baseDescription}`,
          ),

          hair: readString(
            source.hair,
            "Keep hair exactly consistent throughout the film.",
          ),

          eyes: readString(
            source.eyes,
            "Keep eye appearance exactly consistent throughout the film.",
          ),

          bodyType: readString(
            source.bodyType,
            "Natural, anatomically plausible and consistent body proportions.",
          ),

          clothing: readString(
            source.clothing,
            "Keep the same story-appropriate clothing throughout the film.",
          ),

          accessories:
            readLooseString(
              source.accessories,
            ),

          movementStyle: readString(
            source.movementStyle,
            "Natural realistic movement with consistent body language.",
          ),

          voiceIdentity: readString(
            source.voiceIdentity,
            "Consistent natural voice throughout the film.",
          ),
        };
      },
    );

  const visual =
    asRecord(root.visualBible);

  const camera =
    asRecord(root.cameraBible);

  const audio =
    asRecord(root.audioBible);

  const viral =
    asRecord(root.viralBible);

  const performance =
    asRecord(
      root.performanceBible,
    );

  const lighting =
    asRecord(root.lightingBible);

  const isCinematic =
    editingStyle === "cinematic";

  const isMusicVideo =
    editingStyle === "music-video";

  const cameraStyleFallback =
    isCinematic
      ? "Cinematic feature-film camera language with motivated coverage, establishing shots, medium shots, close-ups, reaction shots, controlled camera movement and deliberate visual storytelling."
      : isMusicVideo
        ? "Dynamic music-video camera language with beat-aware shot changes, performance coverage, expressive movement and visually motivated transitions."
        : "Fast, clear social-video camera language with immediate readable framing, energetic but controlled movement and strong visual clarity.";

  const compositionFallback =
    aspectRatio === "16:9"
      ? "Compose natively for cinematic 16:9 widescreen. Use foreground, midground and background depth, balanced negative space and screen-direction continuity."
      : "Compose natively for vertical 9:16. Keep important faces and action readable on mobile screens without making every shot a close-up.";

  const transitionFallback =
    isCinematic
      ? "Use motivated film editing: continuity cuts, match-on-action, reaction cuts, shot-reverse-shot when appropriate, consistent eyelines and screen direction. Avoid arbitrary jump cuts."
      : isMusicVideo
        ? "Use visually motivated and rhythm-aware transitions that can follow musical sections or beats without becoming random."
        : "Use concise motivated transitions and faster pacing while preserving spatial and character continuity.";

  const hookFallback =
    isCinematic
      ? "Open with a compelling cinematic image, action or dramatic question. The hook may breathe naturally instead of forcing a TikTok-style cut every second."
      : isMusicVideo
        ? "Create an immediate visual or musical identity in the opening moments and establish a strong recurring visual motif."
        : "Create a clear visual or emotional hook within the first two seconds.";

  const pacingFallback =
    isCinematic
      ? "Use deliberate cinematic pacing. Allow shots to breathe when dramatically useful, vary shot length, and cut for story, performance, emotion and continuity rather than constant speed."
      : isMusicVideo
        ? "Shape pacing around musical structure, sections, accents and emotional changes. Do not cut randomly on every beat."
        : "Keep social-video pacing tight with frequent meaningful progress and no dead time.";

  return {
    characterBible,

    visualBible: {
      visualStyle: readString(
        visual.visualStyle,
        "Premium photorealistic cinematic live-action look.",
      ),

      colorGrade: readString(
        visual.colorGrade,
        "Restrained professional cinematic color grade with natural skin tones.",
      ),

      lightingStyle: readString(
        visual.lightingStyle,
        "Physically plausible cinematic lighting with stable exposure.",
      ),

      realismLevel: readString(
        visual.realismLevel,
        "High photorealism with believable anatomy, materials, reflections and motion.",
      ),

      environmentRules: readString(
        visual.environmentRules,
        `Maintain one coherent environment appropriate to ${story.setting}.`,
      ),

      continuityRules: readString(
        visual.continuityRules,
        "No unexplained identity, wardrobe, weather, prop, spatial or style changes.",
      ),
    },

    cameraBible: {
      cameraStyle: readString(
        camera.cameraStyle,
        cameraStyleFallback,
      ),

      lensStyle: readString(
        camera.lensStyle,
        "Realistic cinematic lens behavior with restrained depth of field.",
      ),

      frameRate: readString(
        camera.frameRate,
        "24 fps cinematic motion cadence.",
      ),

      motionStyle: readString(
        camera.motionStyle,
        "Smooth motivated motion that can continue seamlessly across extensions.",
      ),

      compositionRules: readString(
        camera.compositionRules,
        compositionFallback,
      ),

      transitionRules: readString(
        camera.transitionRules,
        transitionFallback,
      ),
    },

    audioBible: {
      dialogueLanguage: readString(
        audio.dialogueLanguage,
        "German",
      ),

      ambienceStyle: readString(
        audio.ambienceStyle,
        "Natural continuous ambience matching the environment.",
      ),

      musicStyle: readString(
        audio.musicStyle,
        "Subtle cinematic music supporting tension without overpowering dialogue.",
      ),

      soundContinuityRules: readString(
        audio.soundContinuityRules,
        "Continuous ambience, music and ongoing sound sources must not reset between extensions.",
      ),

      dialogueRules: readString(
        audio.dialogueRules,
        "Short natural dialogue, stable speaker voices, no subtitles or captions.",
      ),
    },

    viralBible: {
      hookStrategy: readString(
        viral.hookStrategy,
        hookFallback,
      ),

      retentionStrategy: readString(
        viral.retentionStrategy,
        "Introduce meaningful visual or narrative progress every few seconds.",
      ),

      escalationStrategy: readString(
        viral.escalationStrategy,
        "Escalate conflict, stakes, surprise or emotion throughout the film.",
      ),

      emotionalArc: readString(
        viral.emotionalArc,
        `Build a clear emotional arc matching the mood: ${story.mood}.`,
      ),

      payoffStrategy: readString(
        viral.payoffStrategy,
        "Deliver the main payoff clearly before the final seconds of the selected video length.",
      ),

      cliffhangerStrategy: readString(
        viral.cliffhangerStrategy,
        "If appropriate, end with a final unanswered visual question after the main payoff.",
      ),

      pacingRules: readString(
        viral.pacingRules,
        pacingFallback,
      ),
    },

    performanceBible: {
      actingStyle: readString(
        performance.actingStyle,
        "Natural restrained screen acting.",
      ),

      facialExpressionStyle: readString(
        performance.facialExpressionStyle,
        "Believable subtle facial expressions with stable identity.",
      ),

      bodyLanguageStyle: readString(
        performance.bodyLanguageStyle,
        "Anatomically plausible body language that supports the emotion.",
      ),

      dialogueDeliveryStyle: readString(
        performance.dialogueDeliveryStyle,
        "Natural concise spoken delivery with synchronized visible performance.",
      ),

      realismRules: readString(
        performance.realismRules,
        "Avoid exaggerated animation, impossible gestures and facial distortion.",
      ),
    },

    lightingBible: {
      primaryLightingStyle: readString(
        lighting.primaryLightingStyle,
        readString(
          visual.lightingStyle,
          "Physically plausible cinematic lighting.",
        ),
      ),

      lightDirection: readString(
        lighting.lightDirection,
        "Keep the established key-light direction spatially consistent.",
      ),

      contrastStyle: readString(
        lighting.contrastStyle,
        "Controlled cinematic contrast with preserved facial detail.",
      ),

      exposureStyle: readString(
        lighting.exposureStyle,
        "Natural stable exposure without abrupt brightness shifts.",
      ),

      practicalLights: readString(
        lighting.practicalLights,
        "Use only motivated practical light sources appropriate to the environment.",
      ),

      continuityRules: readString(
        lighting.continuityRules,
        "Preserve light direction, color temperature and exposure across extensions unless a visible event changes them.",
      ),
    },
  };
}

function normalizeMoviePlan(
  value: unknown,
  story: StoryDraft,
  productionBible: ProductionBible,
  targetDurationSeconds: VideoDurationSeconds,
  aspectRatio: VideoAspectRatio,
  editingStyle: VideoEditingStyle,
): MoviePlan {
  const root =
    asRecord(value);

  const durationPlan =
    buildDurationPlan(
      targetDurationSeconds,
    );

  const rawOpening =
    asRecord(root.opening);

  const fallbackCharacterState =
    productionBible.characterBible
      .map(
        (character) =>
          `${character.name}: ${character.fixedAppearance}; clothing: ${character.clothing}`,
      )
      .join(" | ");

  const openingDialogue =
    normalizeDialogue(
      rawOpening.dialogue,
    );

  const opening: MovieOpening = {
    id: "opening",
    title: readString(
      rawOpening.title,
      story.title ||
        "Opening",
    ),
    startSecond: 0,
    endSecond: 8,
    durationSeconds: 8,
    storyBeat: readString(
      rawOpening.storyBeat,
      `Immediately establish the central situation of ${story.summary}`,
    ),
    hook: readString(
      rawOpening.hook,
      "Create an immediate visual or emotional hook within the first two seconds.",
    ),
    emotionalBeat: readString(
      rawOpening.emotionalBeat,
      story.mood ||
        "Immediate curiosity and tension.",
    ),
    action: readString(
      rawOpening.action,
      story.summary ||
        "Begin the main story action immediately.",
    ),
    location: readString(
      rawOpening.location,
      story.setting ||
        "The story's primary location.",
    ),
    characterState: readString(
      rawOpening.characterState,
      fallbackCharacterState ||
        "The main subject is already clearly visible and ready for the opening action.",
    ),
    environmentState: readString(
      rawOpening.environmentState,
      `Environment matches the setting: ${story.setting}.`,
    ),
    cameraPlan: readString(
      rawOpening.cameraPlan,
      productionBible.cameraBible
        .cameraStyle,
    ),
    lightingPlan: readString(
      rawOpening.lightingPlan,
      productionBible.visualBible
        .lightingStyle,
    ),
    performancePlan: readString(
      rawOpening.performancePlan,
      productionBible.performanceBible
        ?.actingStyle ||
        "Natural believable performance.",
    ),
    audioPlan: readString(
      rawOpening.audioPlan,
      productionBible.audioBible
        .ambienceStyle,
    ),
    dialogue:
      openingDialogue,
    veoPrompt: readString(
      rawOpening.veoPrompt,
      [
        `${aspectRatio} ${editingStyle === "cinematic" ? "cinematic feature-film" : editingStyle === "music-video" ? "cinematic music-video" : "social-video"} live-action shot. Compose natively for this aspect ratio.`,
        `Story: ${story.summary}`,
        `Setting: ${story.setting}`,
        `Characters: ${fallbackCharacterState}`,
        "Begin immediately with a strong hook in the first two seconds.",
        "Maintain realistic anatomy, natural motion, stable identity, stable wardrobe and physically plausible lighting.",
        targetDurationSeconds === 8
          ? "Create a complete satisfying 8-second micro-story with a clear ending."
          : "End in a movement and camera state that can continue seamlessly into the next video extension.",
        "No subtitles, captions, logos, watermarks or visible interface text.",
      ].join(" "),
    ),
    audioPrompt: readString(
      rawOpening.audioPrompt,
      "Natural continuous ambience matching the scene, subtle cinematic sound design, stable voices, no narration unless required.",
    ),
    negativePrompt: readString(
      rawOpening.negativePrompt,
      "No identity drift, no face changes, no wardrobe changes, no duplicated characters, no malformed hands, no extra fingers, no teleportation, no spatial discontinuity, no lighting jumps, no camera resets, no subtitles, no captions, no logos, no watermarks, no visible UI text.",
    ),
  };

  const rawContinuations =
    Array.isArray(
      root.continuations,
    )
      ? root.continuations
      : [];

  const beatFallbacks = [
    "Advance the established journey with a clear new spatial or narrative step.",
    "Continue the current action and reveal visible progress toward the goal.",
    "Develop the established situation through a fresh but motivated visual beat.",
    "Create a clear emotional or visual turning point without changing the world rules.",
    "Move the subject closer to the established destination or payoff.",
    "Build momentum through continuous, physically plausible action.",
    "Deliver a meaningful visual development rooted in the established story.",
    "Create a new consequence that follows naturally from the current action.",
    "Deepen emotional engagement while visibly advancing the journey.",
    "Add a motivated discovery or decision without repeating earlier beats.",
    "Guide the subject naturally toward the central payoff.",
    "Increase visual momentum without introducing an unrelated obstacle.",
    "Prepare the decisive emotional or visual turning point.",
    "Deliver a strong late-story development that follows from prior motion.",
    "Move directly into the final payoff with no dead time.",
    "Complete the chapter with a clear payoff and a stable final state.",
  ];

  const continuations:
    MovieContinuation[] =
    Array.from(
      {
        length:
          durationPlan.extensionCount,
      },
      (_, index) => {
        const source =
          asRecord(
            rawContinuations[
              index
            ],
          );

        const extensionNumber =
          index + 1;

        const startSecond =
          8 + index * 7;

        const endSecond =
          startSecond + 7;

        const fallbackBeat =
          beatFallbacks[
            index %
              beatFallbacks.length
          ];

        const dialogue =
          normalizeDialogue(
            source.dialogue,
          );

        return {
          id:
            extensionNumber,

          title: readString(
            source.title,
            `Fortsetzung ${extensionNumber}`,
          ),

          extensionNumber,

          startSecond,
          endSecond,

          durationSeconds: 7,

          storyBeat: readString(
            source.storyBeat,
            fallbackBeat,
          ),

          emotionalBeat: readString(
            source.emotionalBeat,
            story.mood ||
              "Increase emotional engagement.",
          ),

          escalationPurpose: readString(
            source.escalationPurpose,
            fallbackBeat,
          ),

          actionContinuation: readString(
            source.actionContinuation,
            `Continue the existing action seamlessly and visibly advance the story: ${fallbackBeat}`,
          ),

          characterContinuity: readString(
            source.characterContinuity,
            `Keep all visible characters identical to the existing video. ${fallbackCharacterState}`,
          ),

          environmentContinuity: readString(
            source.environmentContinuity,
            `Continue the same established environment and spatial layout from ${opening.location}.`,
          ),

          cameraContinuation: readString(
            source.cameraContinuation,
            "Continue naturally from the current camera position, movement direction, framing and lens behavior without resetting.",
          ),

          lightingContinuation: readString(
            source.lightingContinuation,
            "Preserve established light direction, exposure, color temperature, shadows and practical lights.",
          ),

          performanceContinuation: readString(
            source.performanceContinuation,
            "Continue the current physical and emotional performance naturally without pose or identity reset.",
          ),

          audioContinuation: readString(
            source.audioContinuation,
            "Continue all active ambience, music and sound sources naturally without an audible reset.",
          ),

          dialogue,

          continuationPrompt: readString(
            source.continuationPrompt,
            [
              "Continue seamlessly from the exact current motion and final video state.",
              fallbackBeat,
              "Do not restart or reintroduce the scene.",
              "Keep character identity, face, body, clothing, props, environment, lighting, camera direction and audio continuous.",
              "Use natural physically plausible motion.",
              "No subtitles, captions, logos, watermarks or visible interface text.",
            ].join(" "),
          ),

          audioPrompt:
            readLooseString(
              source.audioPrompt,
            ) ||
            "Continue the established ambience and sound design naturally.",

          negativePrompt:
            readLooseString(
              source.negativePrompt,
            ) ||
            "No identity drift, face changes, wardrobe changes, duplicated characters, teleportation, malformed anatomy, spatial discontinuity, camera reset, lighting reset, subtitles, captions, logos or watermarks.",
        };
      },
    );

  const rawChapters =
    Array.isArray(root.chapters)
      ? root.chapters
      : [];

  let chapterStartSecond = 0;

  const chapters: VideoChapter[] =
    durationPlan.generationStrategy ===
    "chaptered"
      ? durationPlan.chapterTargets.map(
          (
            chapterTarget,
            index,
          ) => {
            const source =
              asRecord(
                rawChapters[index],
              );

            const startSecond =
              chapterStartSecond;

            const endSecond =
              startSecond +
              chapterTarget;

            chapterStartSecond =
              endSecond;

            const generatedChapter =
              generatedLengthForSingleChain(
                chapterTarget,
              );

            const chapterNumber =
              index + 1;

            return {
              id: chapterNumber,

              title: readString(
                source.title,
                `Kapitel ${chapterNumber}`,
              ),

              startSecond,
              endSecond,

              targetDurationSeconds:
                chapterTarget,

              generatedDurationSeconds:
                generatedChapter
                  .generatedDurationSeconds,

              storyGoal: readString(
                source.storyGoal,
                index === 0
                  ? `Establish the story, characters and central conflict: ${story.summary}`
                  : index ===
                      durationPlan.chapterTargets
                        .length -
                        1
                    ? "Resolve the central conflict and deliver the final emotional or visual payoff."
                    : "Advance and escalate the same story with meaningful new developments.",
              ),

              visualGoal: readString(
                source.visualGoal,
                `Maintain the established visual identity, character continuity and cinematic style in ${story.setting}.`,
              ),

              openingPrompt:
                index === 0
                  ? opening.veoPrompt
                  : readString(
                      source.openingPrompt,
                      [
                        `Begin chapter ${chapterNumber} as a natural continuation of the same film.`,
                        "Preserve established character identity, wardrobe, visual style, world rules and emotional continuity.",
                        `Story goal: ${readString(
                          source.storyGoal,
                          "Continue and escalate the same story.",
                        )}`,
                        "Start with a visually strong, immediately readable action.",
                        "No subtitles, captions, logos, watermarks or visible interface text.",
                      ].join(" "),
                    ),

              /*
               * Absichtlich leer:
               * Für 3–5 Minuten erzeugen wir die konkreten
               * Extension-Prompts später kapitelweise.
               * Das hält diesen ersten Story-Architect-Aufruf
               * klein, stabil und provider-unabhängig.
               */
              continuationPrompts: [],

              transitionIn: readString(
                source.transitionIn,
                index === 0
                  ? "Start immediately with the opening hook."
                  : "Continue the same story with a motivated cinematic transition from the previous chapter.",
              ),

              transitionOut: readString(
                source.transitionOut,
                index ===
                  durationPlan.chapterTargets
                    .length -
                    1
                  ? "End with the final payoff and a clean finish."
                  : "End on a strong continuation-ready story state for the next chapter.",
              ),

              completed: false,
            };
          },
        )
      : [];

  const finalStorySecond =
    Math.max(
      7,
      targetDurationSeconds - 1,
    );

  return {
    targetDurationSeconds:
      durationPlan.targetDurationSeconds,

    generatedDurationSeconds:
      durationPlan.generatedDurationSeconds,

    aspectRatio,

    editingStyle,

    provider: "auto",

    generationStrategy:
      durationPlan.generationStrategy,

    opening,

    continuations,

    chapters:
      chapters.length > 0
        ? chapters
        : undefined,

    endingStrategy: readString(
      root.endingStrategy,
      `Resolve the main dramatic question before approximately second ${finalStorySecond}, leaving only a short visual tail if trimming is required.`,
    ),

    finalPayoff: readString(
      root.finalPayoff,
      `Deliver a clear emotionally or visually satisfying payoff before approximately second ${finalStorySecond}.`,
    ),

    finalCliffhanger: readString(
      root.finalCliffhanger,
      "If the story supports it, leave one concise final unanswered visual question after the main payoff.",
    ),

    characterContinuityRules: readString(
      root.characterContinuityRules,
      "Preserve exact character identity, face, hair, body proportions, clothing, accessories, movement style and voice throughout the entire project.",
    ),

    visualContinuityRules: readString(
      root.visualContinuityRules,
      productionBible.visualBible
        .continuityRules,
    ),

    cameraContinuityRules: readString(
      root.cameraContinuityRules,
      productionBible.cameraBible
        .transitionRules,
    ),

    lightingContinuityRules: readString(
      root.lightingContinuityRules,
      productionBible.lightingBible
        ?.continuityRules ||
        "Preserve light direction, color temperature, exposure and practical sources across continuations and chapters.",
    ),

    audioContinuityRules: readString(
      root.audioContinuityRules,
      productionBible.audioBible
        .soundContinuityRules,
    ),

    storyContinuityRules: readString(
      root.storyContinuityRules,
      "Every continuation and every chapter must move the same story forward without restarting or repeating prior beats.",
    ),
  };
}


function normalizeArchitectResponse(
  parsed: unknown,
  story: StoryDraft,
  targetDurationSeconds: VideoDurationSeconds,
  aspectRatio: VideoAspectRatio,
  editingStyle: VideoEditingStyle,
): ArchitectResponse {
  const root =
    asRecord(parsed);

  const productionBible =
    normalizeProductionBible(
      root.productionBible,
      story,
      aspectRatio,
      editingStyle,
    );

  const moviePlan =
    normalizeMoviePlan(
      root.moviePlan,
      story,
      productionBible,
      targetDurationSeconds,
      aspectRatio,
      editingStyle,
    );

  return {
    productionBible,
    moviePlan,
  };
}


function validateDialogue(value: unknown): value is SceneDialogue {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const dialogue = value as Partial<SceneDialogue>;

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
    isNonEmptyString(dialogue.speaker) &&
    isNonEmptyString(dialogue.text) &&
    isNonEmptyString(dialogue.language) &&
    isNonEmptyString(dialogue.voiceDirection)
  );
}

function validateProductionBible(value: unknown): value is ProductionBible {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const bible = value as Partial<ProductionBible>;

  return (
    Array.isArray(bible.characterBible) &&
    bible.characterBible.length > 0 &&
    bible.characterBible.every((character) =>
      Boolean(
        character &&
          isNonEmptyString(character.id) &&
          isNonEmptyString(character.name) &&
          isNonEmptyString(character.role) &&
          isNonEmptyString(character.fixedAppearance) &&
          isNonEmptyString(character.faceIdentity) &&
          isNonEmptyString(character.hair) &&
          isNonEmptyString(character.eyes) &&
          isNonEmptyString(character.bodyType) &&
          isNonEmptyString(character.clothing) &&
          isString(character.accessories) &&
          isNonEmptyString(character.movementStyle) &&
          isNonEmptyString(character.voiceIdentity),
      ),
    ) &&
    typeof bible.visualBible === "object" &&
    bible.visualBible !== null &&
    typeof bible.cameraBible === "object" &&
    bible.cameraBible !== null &&
    typeof bible.audioBible === "object" &&
    bible.audioBible !== null &&
    typeof bible.viralBible === "object" &&
    bible.viralBible !== null &&
    typeof bible.performanceBible === "object" &&
    bible.performanceBible !== null &&
    typeof bible.lightingBible === "object" &&
    bible.lightingBible !== null
  );
}

function validateOpening(value: unknown): value is MovieOpening {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const opening = value as Partial<MovieOpening>;

  return (
    opening.id === "opening" &&
    opening.startSecond === 0 &&
    opening.endSecond === 8 &&
    opening.durationSeconds === 8 &&
    isNonEmptyString(opening.title) &&
    isNonEmptyString(opening.storyBeat) &&
    isNonEmptyString(opening.hook) &&
    isNonEmptyString(opening.emotionalBeat) &&
    isNonEmptyString(opening.action) &&
    isNonEmptyString(opening.location) &&
    isNonEmptyString(opening.characterState) &&
    isNonEmptyString(opening.environmentState) &&
    isNonEmptyString(opening.cameraPlan) &&
    isNonEmptyString(opening.lightingPlan) &&
    isNonEmptyString(opening.performancePlan) &&
    isNonEmptyString(opening.audioPlan) &&
    validateDialogue(opening.dialogue) &&
    isNonEmptyString(opening.veoPrompt) &&
    isNonEmptyString(opening.audioPrompt) &&
    isNonEmptyString(opening.negativePrompt)
  );
}

function validateContinuation(
  value: unknown,
  index: number,
): value is MovieContinuation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const continuation = value as Partial<MovieContinuation>;
  const extensionNumber = index + 1;
  const expectedStart = 8 + index * 7;
  const expectedEnd = expectedStart + 7;

  return (
    continuation.id === extensionNumber &&
    continuation.extensionNumber === extensionNumber &&
    continuation.startSecond === expectedStart &&
    continuation.endSecond === expectedEnd &&
    continuation.durationSeconds === 7 &&
    isNonEmptyString(continuation.title) &&
    isNonEmptyString(continuation.storyBeat) &&
    isNonEmptyString(continuation.emotionalBeat) &&
    isNonEmptyString(continuation.escalationPurpose) &&
    isNonEmptyString(continuation.actionContinuation) &&
    isNonEmptyString(continuation.characterContinuity) &&
    isNonEmptyString(continuation.environmentContinuity) &&
    isNonEmptyString(continuation.cameraContinuation) &&
    isNonEmptyString(continuation.lightingContinuation) &&
    isNonEmptyString(continuation.performanceContinuation) &&
    isNonEmptyString(continuation.audioContinuation) &&
    validateDialogue(continuation.dialogue) &&
    isNonEmptyString(continuation.continuationPrompt) &&
    isString(continuation.audioPrompt) &&
    isString(continuation.negativePrompt)
  );
}

function validateVideoChapter(
  value: unknown,
  index: number,
  expectedTargets: VideoDurationSeconds[],
): value is VideoChapter {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const chapter =
    value as Partial<VideoChapter>;

  const expectedTarget =
    expectedTargets[index];

  const expectedStart =
    expectedTargets
      .slice(0, index)
      .reduce(
        (sum, duration) =>
          sum + duration,
        0,
      );

  const expectedEnd =
    expectedStart +
    expectedTarget;

  return (
    chapter.id === index + 1 &&
    chapter.startSecond ===
      expectedStart &&
    chapter.endSecond ===
      expectedEnd &&
    chapter.targetDurationSeconds ===
      expectedTarget &&
    isNonEmptyString(chapter.title) &&
    isNonEmptyString(chapter.storyGoal) &&
    isNonEmptyString(chapter.visualGoal)
  );
}

function validateMoviePlan(
  value: unknown,
): value is MoviePlan {
  if (
    typeof value !== "object" ||
    value === null
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

  const expected =
    buildDurationPlan(
      plan.targetDurationSeconds,
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
    plan.provider !== "auto" ||
    plan.generationStrategy !==
      expected.generationStrategy ||
    !validateOpening(plan.opening) ||
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
      plan.continuations.length !== 0 ||
      !Array.isArray(plan.chapters) ||
      plan.chapters.length !==
        expected.chapterTargets.length ||
      !plan.chapters.every(
        (chapter, index) =>
          validateVideoChapter(
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
        validateContinuation,
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


function validateArchitectResponse(parsed: unknown): parsed is ArchitectResponse {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  const value = parsed as Partial<ArchitectResponse>;

  return (
    validateProductionBible(value.productionBible) &&
    validateMoviePlan(value.moviePlan)
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getErrorDetails(error: unknown): ErrorDetails {
  let status: number | undefined;
  let code: number | undefined;
  let message = "Unbekannter Fehler bei der Gemini-Anfrage.";

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;

    if (typeof record.status === "number") {
      status = record.status;
    }

    if (typeof record.code === "number") {
      code = record.code;
    }

    if (typeof record.message === "string") {
      message = record.message;
    }

    const nestedError = record.error;

    if (typeof nestedError === "object" && nestedError !== null) {
      const nested = nestedError as Record<string, unknown>;

      if (typeof nested.status === "number") {
        status = nested.status;
      }

      if (typeof nested.code === "number") {
        code = nested.code;
      }

      if (typeof nested.message === "string") {
        message = nested.message;
      }
    }
  }

  const match = message.match(
    /\b(404|408|429|500|502|503|504)\b/,
  );

  if (!status && match) {
    status = Number(match[1]);
  }

  return { status, code, message };
}

function isRetryableGeminiError(error: unknown): boolean {
  const details = getErrorDetails(error);
  const statuses = [408, 429, 500, 502, 503, 504];

  if (
    details.status &&
    statuses.includes(details.status)
  ) {
    return true;
  }

  if (
    details.code &&
    statuses.includes(details.code)
  ) {
    return true;
  }

  const message = details.message.toLowerCase();

  return (
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("temporarily") ||
    message.includes("resource exhausted") ||
    message.includes("too many requests") ||
    message.includes("deadline exceeded")
  );
}

function isModelUnavailableError(error: unknown): boolean {
  const details = getErrorDetails(error);

  if (details.status === 404 || details.code === 404) {
    return true;
  }

  const message = details.message.toLowerCase();

  return (
    message.includes("model not found") ||
    message.includes("not found for api version") ||
    message.includes("is not supported")
  );
}

function createRetryDelay(attempt: number): number {
  return (
    INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1) +
    Math.floor(Math.random() * 500)
  );
}

async function generateStoryWithFallback(
  ai: GoogleGenAI,
  prompt: string,
): Promise<GeneratedStory> {
  let lastError: unknown;

  for (const model of STORY_MODELS) {
    for (
      let attempt = 1;
      attempt <= RETRIES_PER_MODEL;
      attempt += 1
    ) {
      try {
        console.log(
          `Story Architect: ${model}, Versuch ${attempt}/${RETRIES_PER_MODEL}`,
        );

        const response =
          await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType:
                "application/json",
              temperature: 0.25,

              /*
               * Der MoviePlan ist groß:
               * Production Bible + Opening +
               * acht Continuations.
               *
               * Gemini 3.5 Flash-Lite erlaubt
               * deutlich mehr Output als 16k.
               * 32k gibt uns Reserve, damit JSON
               * nicht mitten im Objekt abgeschnitten
               * wird.
               */
              maxOutputTokens: 32000,
            },
          });

        const rawText =
          response.text?.trim();

        const finishReason =
          response.candidates?.[0]
            ?.finishReason;

        console.log(
          "Story Architect Antwort:",
          {
            model,
            attempt,
            finishReason,
            characterCount:
              rawText?.length ?? 0,
          },
        );

        if (!rawText) {
          throw new Error(
            "Gemini hat keinen Filmplan zurückgegeben.",
          );
        }

        /*
         * Ganz wichtig:
         * Vorher wurde eine nicht-leere Antwort sofort
         * zurückgegeben. Erst später kam JSON.parse().
         * Dadurch wurde bei ungültigem oder abgeschnittenem
         * JSON KEIN zweiter Gemini-Versuch ausgelöst.
         *
         * Jetzt prüfen wir das JSON bereits hier.
         */
        const parsedResult =
          tryParseJson(rawText);

        if (!parsedResult) {
          const malformedError =
            new Error(
              `Story Architect lieferte ungültiges JSON. finishReason=${String(
                finishReason ?? "unknown",
              )}`,
            );

          lastError =
            malformedError;

          console.warn(
            `Story Architect JSON ungültig: ${model}, Versuch ${attempt}/${RETRIES_PER_MODEL}`,
            {
              finishReason,
              characterCount:
                rawText.length,
              preview:
                rawText.slice(
                  0,
                  500,
                ),
              ending:
                rawText.slice(
                  -500,
                ),
            },
          );

          if (
            attempt <
            RETRIES_PER_MODEL
          ) {
            await sleep(
              createRetryDelay(
                attempt,
              ),
            );

            continue;
          }

          /*
           * Beide Versuche dieses Modells waren
           * syntaktisch ungültig -> nächstes Modell.
           */
          break;
        }

        return {
          rawText:
            parsedResult.cleanedText,
          model,
        };
      } catch (error: unknown) {
        lastError = error;

        console.warn(
          `Story Architect fehlgeschlagen: ${model}, Versuch ${attempt}`,
          getErrorDetails(error),
        );

        if (
          isModelUnavailableError(
            error,
          )
        ) {
          break;
        }

        if (
          !isRetryableGeminiError(
            error,
          )
        ) {
          throw error;
        }

        if (
          attempt <
          RETRIES_PER_MODEL
        ) {
          await sleep(
            createRetryDelay(
              attempt,
            ),
          );
        }
      }
    }
  }

  throw (
    lastError ??
    new Error(
      "Alle Gemini-Modelle sind momentan nicht erreichbar.",
    )
  );
}

function buildStoryPrompt(
  story: StoryDraft,
  targetDurationSeconds: VideoDurationSeconds,
  aspectRatio: VideoAspectRatio,
  editingStyle: VideoEditingStyle,
  audioStyle: VideoAudioStyle,
  voiceMode: VideoVoiceMode,
  spokenLanguage: VideoSpokenLanguage,
): string {
  const characterDescription =
    story.characters
      .map(
        (character, index) =>
          `${index + 1}. ${character.name}: ${character.description}`,
      )
      .join("\n");

  const durationPlan =
    buildDurationPlan(
      targetDurationSeconds,
    );

  const extensionWindows =
    durationPlan.generationStrategy ===
    "extension-chain"
      ? Array.from(
          {
            length:
              durationPlan.extensionCount,
          },
          (_, index) => {
            const start =
              8 + index * 7;
            const end =
              start + 7;

            return `${index + 1} = ${start}–${end}`;
          },
        ).join("\n")
      : "Keine detaillierten globalen Extensions in diesem Story-Architect-Schritt.";

  let absoluteChapterStart = 0;

  const chapterDescription =
    durationPlan.chapterTargets
      .map(
        (chapterTarget, index) => {
          const start =
            absoluteChapterStart;
          const end =
            start +
            chapterTarget;

          absoluteChapterStart =
            end;

          return `Kapitel ${index + 1}: ${start}–${end} Sekunden, Ziel ${chapterTarget} Sekunden`;
        },
      )
      .join("\n");

  const technicalStructure =
    durationPlan.generationStrategy ===
    "single-shot"
      ? `
- Ziel des Produkts: exakt 8 Sekunden.
- Erzeuge moviePlan.opening für genau diese 8 Sekunden.
- moviePlan.continuations muss ein leeres Array sein.
- moviePlan.chapters soll nicht benötigt werden.
- Das Opening muss bereits eine vollständige Mini-Geschichte mit einem sauberen Ende liefern.
`
      : durationPlan.generationStrategy ===
          "extension-chain"
        ? `
- Ziel des Produkts: exakt ${targetDurationSeconds} Sekunden.
- Das erste Video dauert 8 Sekunden.
- Danach folgen exakt ${durationPlan.extensionCount} direkte Video-Extensions.
- Jede Extension fügt ungefähr 7 Sekunden hinzu.
- Generierte Roh-Länge: ungefähr ${durationPlan.generatedDurationSeconds} Sekunden.
- Falls die Roh-Länge über der Ziel-Länge liegt, wird später technisch auf exakt ${targetDurationSeconds} Sekunden getrimmt.
- moviePlan.continuations muss exakt ${durationPlan.extensionCount} Einträge enthalten.
- moviePlan.chapters ist für diese Länge nicht erforderlich.

Zeitbereiche der Extensions:
${extensionWindows}
`
        : `
- Ziel des Produkts: exakt ${targetDurationSeconds} Sekunden.
- Diese Länge wird als mehrere Kapitel geplant.
- Ein Kapitel ist maximal 120 Sekunden lang.
- moviePlan.generationStrategy muss "chaptered" sein.
- moviePlan.continuations muss in diesem ersten Plan ein LEERES Array sein.
- Erzeuge moviePlan.chapters mit exakt ${durationPlan.chapterTargets.length} Kapiteln.
- Die späteren detaillierten Extension-Prompts werden kapitelweise erzeugt, nicht alle in diesem ersten JSON.
- Dadurch bleibt die Planung stabil, skalierbar und unabhängig vom später verwendeten Video-Provider.
- moviePlan.opening beschreibt weiterhin die ersten 8 Sekunden des gesamten Films.
- Für jedes Kapitel genügen jetzt: title, storyGoal, visualGoal, openingPrompt, transitionIn und transitionOut.
- continuationPrompts der Kapitel dürfen leer sein.

Kapitelstruktur:
${chapterDescription}

Voraussichtliche technische Roh-Länge über alle Kapitel:
ungefähr ${durationPlan.generatedDurationSeconds} Sekunden.
Nach Generierung und Zusammenfügen wird auf exakt ${targetDurationSeconds} Sekunden getrimmt.
`;

  const finalStorySecond =
    Math.max(
      7,
      targetDurationSeconds - 1,
    );

  const formatDirection =
    aspectRatio === "16:9"
      ? `
BILDFORMAT: 16:9 KINO / WIDESCREEN
- Komponiere jede Einstellung nativ für 16:9.
- Nutze Bildtiefe, Vordergrund, Mittelgrund und Hintergrund.
- Nutze negative Fläche und räumliche Beziehungen bewusst.
- Keine vertikale TikTok-Komposition in ein breites Bild quetschen.
`
      : `
BILDFORMAT: 9:16 VERTIKAL
- Komponiere jede Einstellung nativ für 9:16.
- Hauptmotive müssen auf mobilen Displays klar lesbar bleiben.
- Vermeide trotzdem monotone Dauer-Nahaufnahmen.
`;

  const editingDirection =
    editingStyle === "cinematic"
      ? `
SCHNITTSTIL: KINO / FILM
- Erzähle wie ein echter Kurz- oder Spielfilm, nicht wie ein TikTok-Clip.
- Nutze Establishing Shots, Master Shots, Medium Shots, Close-ups,
  Inserts und Reaction Shots dramaturgisch.
- Nutze Shot-Reverse-Shot bei Dialogen, wenn sinnvoll.
- Bewahre 180-Grad-Regel, Blickachsen und Screen Direction.
- Schneide auf Handlung, Blick, Emotion und Bewegung.
- Nutze Match-on-Action und motivierte Übergänge.
- Einstellungen dürfen länger stehen, wenn Schauspiel oder Spannung davon profitieren.
- Keine Pflicht zu einem Schnitt alle 1–2 Sekunden.
- Keine zufälligen Jump Cuts nur um Tempo zu erzeugen.
- Kamera und Schnitt sollen eine zusammenhängende Filmsprache haben.
`
      : editingStyle === "music-video"
        ? `
SCHNITTSTIL: MUSIKVIDEO
- Plane starke wiedererkennbare Bildmotive.
- Schnitte und Übergänge dürfen auf musikalische Abschnitte,
  Akzente, Drops und emotionale Wechsel reagieren.
- Kombiniere Performance-, Narrative- und Atmosphären-Shots.
- Nicht stumpf auf jeden Beat schneiden; Rhythmus und Bildidee müssen zusammenpassen.
`
        : editingStyle === "auto"
          ? `
SCHNITTSTIL: AUTO
- Wähle anhand von Genre, Story, gewünschtem Bildformat und Länge
  zwischen filmischer, sozialer oder musikvideoartiger Filmsprache.
- Bleibe nach der Wahl innerhalb des Projekts konsistent.
`
          : `
SCHNITTSTIL: SOCIAL / REELS
- Starker Hook sehr früh.
- Kürzere Einstellungen und schnellere visuelle Entwicklung.
- Häufige, aber motivierte Informations- oder Bildwechsel.
- Keine unnötigen Pausen oder Wiederholungen.
- Trotz Tempo müssen Identität, Raum, Blickachsen und Bewegung verständlich bleiben.
`;

  const selectedAudioDirection = buildSelectedAudioDirection(
    audioStyle,
    voiceMode,
    spokenLanguage,
  );

  return `
Du bist ein professioneller Viral Creative Director, Story Architect,
Character Director, Camera Director, Lighting Director, Performance Director,
Audio Director, Continuity Director und Video Prompt Director.

Du planst EIN zusammenhängendes professionelles Video-Projekt.
Der Plan darf NICHT fest auf 60 Sekunden, TikTok/Vertical oder einen
einzelnen Video-Provider zugeschnitten sein.

AUSGEWÄHLTE VIDEO-LÄNGE

${targetDurationSeconds} Sekunden

AUSGEWÄHLTES FORMAT

${aspectRatio}

AUSGEWÄHLTER SCHNITTSTIL

${editingStyle}

AUSGEWÄHLTE KI-AUDIO-EINSTELLUNGEN

${selectedAudioDirection}

${formatDirection}

${editingDirection}

TECHNISCHE STRUKTUR

${technicalStructure}

STORY

Titel:
${story.title}

Genre:
${story.genre}

Stimmung:
${story.mood}

Setting:
${story.setting}

Zusammenfassung:
${story.summary}

Charaktere:
${characterDescription}

STORY- UND RETENTION-REGELN

- Beginne mit einem starken, genrepassenden Einstieg.
- Bei Social darf der Hook extrem schnell sein.
- Bei Kino darf Spannung über Bild, Handlung, Atmosphäre oder Performance aufgebaut werden,
  ohne künstlich auf TikTok-Geschwindigkeit zu schneiden.
- Die Handlung muss sich sichtbar und verständlich weiterentwickeln.
- Vermeide Leerlauf und unbegründete Wiederholung.
- Nutze Konflikt, Überraschung, Emotion, neue Information oder Konsequenz.
- Bei längeren Videos darf die Dramaturgie mehr Raum bekommen.
- Das gesamte Projekt braucht einen klaren Höhepunkt und einen verständlichen Payoff.
- Der wichtigste Payoff muss spätestens ungefähr bis Sekunde ${finalStorySecond} verständlich sein.

REALISMUS

Wenn der Nutzer keinen Animationsstil verlangt, plane fotorealistisches
Live-Action-Material.

Bevorzuge:
photorealistic live-action footage,
physically plausible materials,
natural surface imperfections,
real-world lens behavior,
natural exposure,
realistic reflections,
subtle cinematic depth of field,
realistic motion cadence,
believable facial muscle movement,
anatomically plausible hands and body motion,
restrained professional cinematic color grading.

Vermeide standardmäßig:
Pixar,
Disney,
cartoon,
anime,
game-render look,
overprocessed CGI appearance.

CHARACTER BIBLE

Jeder Charakter erhält eine eindeutige unveränderliche Identität.

Definiere konkret:
Gesicht, Proportionen, Haare, Augen, Körperbau, Kleidung, Schuhe,
Accessoires, Bewegungsstil, Haltung und Stimme.

Keine spontanen Änderungen zwischen Shots, Extensions oder Kapiteln.

VISUAL BIBLE

Definiere einen einzigen Filmlook, Farblook, Realismusgrad,
Atmosphäre, Wetter, Materialverhalten und Umgebungsregeln.

CAMERA BIBLE

Definiere Kamerasprache, Objektivcharakter, Bildrate, Komposition
und Bewegungsstil. Kamerabewegungen sollen logisch weiterlaufen
und nicht unbegründet neu starten.

LIGHTING BIBLE

Definiere Lichtrichtung, Kontrast, Belichtung, praktische Lichtquellen
und Kontinuitätsregeln.

PERFORMANCE BIBLE

Definiere natürlichen Schauspielstil, Mimik, Körpersprache und
realistische Dialogdarstellung.

AUDIO BIBLE

Definiere Dialogsprache, feste Stimmen, Ambience, Musik und
Audio-Kontinuität. Dauerhafte Sounds dürfen nicht bei jedem
neuen Abschnitt unbegründet neu starten.

DIALOG

Wenn niemand spricht:
enabled=false und alle Textfelder leer.

Wenn gesprochen wird:
- kurzer natürlich sprechbarer Satz
- exakter Charaktername als speaker
- konkrete Sprache
- konkrete Stimme und Emotion
- keine Untertitel
- keine sichtbare Transkription

OPENING 0–8

moviePlan.opening muss den ersten Video-Auftrag vollständig beschreiben.

veoPrompt auf Englisch:
- aspect ratio ${aspectRatio}
- compose natively for ${aspectRatio}
- editing language ${editingStyle}
- exakt 8 Sekunden
- starker genrepassender Einstieg
- genaue Figuren
- Umgebung
- Kamera
- Licht
- Handlung
- natürliche Bewegung
- Dialog falls aktiviert
- bei längeren Videos ein Ende, das direkt fortgesetzt werden kann
- bei 8 Sekunden ein echtes abgeschlossenes Ende

audioPrompt auf Englisch.
negativePrompt auf Englisch.

FORTSETZUNGEN

Wenn generationStrategy = "extension-chain":
- Erzeuge exakt ${durationPlan.extensionCount} continuations.
- Jede durationSeconds = 7.
- continuationPrompt muss auf Englisch sein.
- Jede Fortsetzung beschreibt eine direkte Weiterführung, keinen Neustart.
- Bewahre aktuelle Bewegung, Momentum, Figurenidentität, Kleidung,
  Umgebung, Licht, Kamera und Audio.
- Die ersten Frames jeder Fortsetzung müssen exakt zum letzten Frame
  des vorhandenen Videos passen: Position, Maßstab, Silhouette,
  Objektgeometrie, Kamera, Hintergrund, Licht und Bewegungsrichtung.
- Nicht-menschliche Figuren und Objekte dürfen Form, Größe, Faltung,
  Material oder Farbe niemals verändern.
- Reale Orte behalten plausible Geografie: Gebäude, Straßen,
  Gewässer und Landmarken dürfen nicht räumlich versetzt werden.
- Jede Fortsetzung muss die Story sichtbar voranbringen.
- Keine unnötigen neuen Elemente.
- Wenn die letzte Fortsetzung über targetDurationSeconds hinausreicht,
  muss der finale Payoff innerhalb des sichtbaren Reststücks vor dem
  Schnitt liegen. Wichtige Handlung darf nicht erst danach passieren.

Wenn generationStrategy = "single-shot":
- continuations = [].

Wenn generationStrategy = "chaptered":
- continuations = [].
- Plane stattdessen nur die oben definierte Kapitelstruktur.
- Die detaillierten Extension-Prompts der späteren Kapitel werden
  in einem separaten Schritt erzeugt.

KAPITEL

${chapterDescription}

Bei mehreren Kapiteln:
- Die Kapitel gehören zu EINER Geschichte.
- Kein Kapitel darf wie ein Neustart derselben Geschichte wirken.
- Character Bible, Visual Bible, Camera Bible, Lighting Bible
  und Audio Bible gelten über alle Kapitel hinweg.
- Jeder Übergang muss dramaturgisch motiviert sein.
- Spätere Kapitel dürfen neue Orte oder Situationen einführen,
  aber nur wenn es die Story verlangt.
- Der visuelle Stil und die Identitäten bleiben stabil.

KEINE:
- Identitätswechsel
- unbegründeten Gesichtswechsel
- unbegründeten Kleidungswechsel
- Teleportation ohne Storygrund
- neue Personen ohne Storygrund
- unmotivierte Kamerarezets
- unmotivierte Lichtresets
- Untertitel
- Logos
- Wasserzeichen
- sichtbaren Interface-Texte

QUALITÄTSKONTROLLE

Prüfe vor der Ausgabe:
- targetDurationSeconds = ${targetDurationSeconds}
- generatedDurationSeconds = ${durationPlan.generatedDurationSeconds}
- aspectRatio = "${aspectRatio}"
- editingStyle = "${editingStyle}"
- provider = "auto"
- generationStrategy = "${durationPlan.generationStrategy}"
- opening ist exakt 0–8 Sekunden
- erwartete globale continuations = ${durationPlan.extensionCount}
- jedes continuation durationSeconds = 7
- korrekte IDs und Zeitbereiche
- Hook innerhalb der ersten 2 Sekunden
- keine Story-Wiederholungen
- Charaktere bleiben identisch
- Stimmen bleiben identisch
- Kamera, Licht und Umgebung bleiben plausibel
- Payoff spätestens ungefähr bis Sekunde ${finalStorySecond}
- alles wirkt wie EIN zusammenhängendes Projekt

Gib ausschließlich gültiges JSON zurück.
`;
}


/*
 * Temporärer Kompatibilitätsmodus.
 * Alte Komponenten verlangen noch story.scenes.
 * Sobald storyArchitectClient.ts und Chat.tsx auf moviePlan umgestellt sind,
 * kann dieses Array vollständig entfernt werden.
 */
function createCompatibilityScenes(
  plan: MoviePlan,
): Scene[] {
  const beats = [
    {
      title: plan.opening.title,
      description: plan.opening.action,
      location: plan.opening.location,
      mood: plan.opening.emotionalBeat,
      keyAction: plan.opening.action,
      visualFocus: plan.opening.hook,
      dialogue: plan.opening.dialogue,
      prompt: plan.opening.veoPrompt,
      audio: plan.opening.audioPrompt,
      negative: plan.opening.negativePrompt,
      camera: plan.opening.cameraPlan,
      lighting: plan.opening.lightingPlan,
      characterState: plan.opening.characterState,
      environmentState: plan.opening.environmentState,
    },
    ...plan.continuations.slice(0, 5).map((item) => ({
      title: item.title,
      description: item.actionContinuation,
      location: plan.opening.location,
      mood: item.emotionalBeat,
      keyAction: item.actionContinuation,
      visualFocus: item.storyBeat,
      dialogue: item.dialogue,
      prompt: item.continuationPrompt,
      audio: item.audioPrompt ?? "",
      negative: item.negativePrompt ?? "",
      camera: item.cameraContinuation,
      lighting: item.lightingContinuation,
      characterState: item.characterContinuity,
      environmentState: item.environmentContinuity,
    })),
  ];

  return beats.map((beat, index) => ({
    id: index + 1,
    title: beat.title,
    description: beat.description,
    location: beat.location,
    mood: beat.mood,
    keyAction: beat.keyAction,
    visualFocus: beat.visualFocus,
    startFrame:
      index === 0
        ? "Opening frame defined by the movie opening prompt."
        : "Direct continuation of the already existing video.",
    endingFrame:
      "Stable continuation-ready final frame.",
    characterStateAtStart: beat.characterState,
    characterStateAtEnd: beat.characterState,
    environmentStateAtStart: beat.environmentState,
    environmentStateAtEnd: beat.environmentState,
    cameraStateAtStart: beat.camera,
    cameraStateAtEnd: beat.camera,
    lightingState: beat.lighting,
    continuityNotes:
      "Preserve identity, wardrobe, environment, camera direction, lighting and audio continuity.",
    dialogue: beat.dialogue,
    durationSeconds: 8,
    veoPrompt: beat.prompt,
    audioPrompt: beat.audio,
    negativePrompt: beat.negative,
    camera: beat.camera,
    lighting: beat.lighting,
    transition:
      "Continue seamlessly into the next part of the same movie.",
    style:
      "Use the fixed visual identity from the production bible.",
  }));
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
      },
      { status: 500 },
    );
  }

  let body: StoryArchitectRequest;

  try {
    body =
      (await request.json()) as StoryArchitectRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Request enthält kein gültiges JSON.",
      },
      { status: 400 },
    );
  }

  if (!isStoryDraft(body.story)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Die übergebene Geschichte ist unvollständig oder ungültig.",
      },
      { status: 400 },
    );
  }

  const story = body.story;

  const targetDurationSeconds =
    normalizeTargetDuration(
      body.targetDurationSeconds,
    );

  const aspectRatio =
    normalizeAspectRatio(
      body.aspectRatio,
    );

  const editingStyle =
    normalizeEditingStyle(
      body.editingStyle,
    );

  const audioStyle =
    normalizeVideoAudioStyle(
      body.audioStyle,
    );

  const voiceMode =
    normalizeVideoVoiceMode(
      body.voiceMode,
    );

  const spokenLanguage =
    normalizeVideoSpokenLanguage(
      body.spokenLanguage,
    );

  const prompt =
    buildStoryPrompt(
      story,
      targetDurationSeconds,
      aspectRatio,
      editingStyle,
      audioStyle,
      voiceMode,
      spokenLanguage,
    );

  try {
    const ai = new GoogleGenAI({
      apiKey,
    });

    const generationResult =
      await generateStoryWithFallback(
        ai,
        prompt,
      );

    const cleanedText = cleanJsonText(
      generationResult.rawText,
    );

    let parsed: unknown;

    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error(
        "Ungültige Story-Architect-Antwort:",
        {
          model: generationResult.model,
          parseError,
          rawText:
            generationResult.rawText,
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Der Story Architect hat ungültiges JSON erzeugt. Bitte versuche es erneut.",
        },
        { status: 502 },
      );
    }

    /*
     * Gemini darf bei großen kreativen JSON-Antworten
     * kleine Felder auslassen oder Zahlen leicht anders
     * zurückgeben. Deshalb normalisieren wir die Antwort
     * zuerst serverseitig und validieren DANACH.
     */
    const normalized =
      normalizeArchitectResponse(
        parsed,
        story,
        targetDurationSeconds,
        aspectRatio,
        editingStyle,
      );

    if (!validateArchitectResponse(normalized)) {
      console.error(
        "Normalisierter Story-Architect-Filmplan ist weiterhin ungültig:",
        {
          model: generationResult.model,
          parsed,
          normalized,
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Der Story Architect konnte den Filmplan nicht zuverlässig normalisieren.",
        },
        { status: 502 },
      );
    }

    const completeStory = {
      ...story,
      productionBible:
        normalized.productionBible,
      moviePlan:
        normalized.moviePlan,

      /*
       * Vorübergehend noch vorhanden,
       * bis die Client-Seite vollständig
       * auf moviePlan umgestellt ist.
       */
      scenes:
        createCompatibilityScenes(
          normalized.moviePlan,
        ),

      generationModel:
        generationResult.model,
    } as CompleteStoryResponse;

    return NextResponse.json(
      completeStory,
    );
  } catch (error: unknown) {
    const details =
      getErrorDetails(error);

    console.error(
      "Story-Architect-Fehler:",
      {
        details,
        error,
      },
    );

    if (
      isRetryableGeminiError(error)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Die Gemini-Modelle sind momentan stark ausgelastet. Mehrere Modelle und automatische Wiederholungen wurden bereits versucht. Bitte probiere es in wenigen Augenblicken erneut.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: details.message,
      },
      {
        status:
          details.status &&
          details.status >= 400 &&
          details.status <= 599
            ? details.status
            : 500,
      },
    );
  }
}
