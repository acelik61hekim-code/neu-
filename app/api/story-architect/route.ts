import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

import {
  buildSelectedAudioDirection,
  normalizeVideoAudioStyle,
  normalizeVideoSpokenLanguage,
  normalizeVideoVoiceMode,
} from "@/lib/audio-options";

import { checkRateLimit } from "@/lib/rate-limit";
import { isMusicVideoTrackContext } from "@/lib/music-video";

import {
  STUDIO_BRAND_CONTEXT,
  buildStudioAdvertisementDirection,
  isStudioWebsiteAdvertisement,
} from "@/lib/studio-brand";

import {
  buildVideoDurationPlan,
} from "@/lib/veo";

import type {
  MovieContinuation,
  MusicVideoTrackContext,
  MovieOpening,
  MoviePlan,
  ProductionBible,
  Scene,
  SceneDialogue,
  Story,
  StoryDraft,
  VideoAspectRatio,
  VideoAudioStyle,
  VideoCreationMode,
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

const VIRAL_STORY_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const RETRIES_PER_MODEL = 2;
const INITIAL_RETRY_DELAY_MS = 1500;

const SEEDANCE_CLIP_DURATION_SECONDS = 15;

type StoryArchitectRequest = {
  story?: StoryDraft;
  targetDurationSeconds?: unknown;
  aspectRatio?: unknown;
  editingStyle?: unknown;
  audioStyle?: unknown;
  voiceMode?: unknown;
  spokenLanguage?: unknown;
  voiceoverText?: unknown;
  closingText?: unknown;
  creationMode?: unknown;
  musicTrack?: unknown;
};

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

function isStoryDraft(
  value: unknown,
): value is StoryDraft {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const draft =
    value as Partial<StoryDraft>;

  return (
    typeof draft.title === "string" &&
    typeof draft.genre === "string" &&
    typeof draft.mood === "string" &&
    typeof draft.setting === "string" &&
    typeof draft.summary === "string" &&
    Array.isArray(draft.characters)
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

function normalizeTargetDuration(
  value: unknown,
): VideoDurationSeconds {
  return isVideoDurationSeconds(value)
    ? value
    : 60;
}

function normalizeAspectRatio(
  value: unknown,
): VideoAspectRatio {
  return isVideoAspectRatio(value)
    ? value
    : "9:16";
}

function normalizeEditingStyle(
  value: unknown,
): VideoEditingStyle {
  return isVideoEditingStyle(value)
    ? value
    : "social";
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
  return targetDurationSeconds === 8
    ? 7
    : SEEDANCE_CLIP_DURATION_SECONDS;
}

function buildDurationPlan(
  targetDurationSeconds: VideoDurationSeconds,
): DurationPlan {
  return buildVideoDurationPlan(
    targetDurationSeconds,
  );
}

function cleanJsonText(
  text: string,
): string {
  let cleaned = text
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

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
    ? value as Record<string, unknown>
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
  allowSpeech = true,
): SceneDialogue {
  const record =
    asRecord(value);

  const enabled =
    allowSpeech &&
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

    speaker:
      readString(
        record.speaker,
        "Main character",
      ),

    text:
      readString(
        record.text ??
          record.line,
        "Was passiert hier?",
      ),

    language:
      readString(
        record.language,
        "German",
      ),

    voiceDirection:
      readString(
        record.voiceDirection ??
          record.deliveryStyle ??
          record.emotion,
        "Natural, believable, concise delivery.",
      ),
  };
}

function normalizeDialogueTurns(
  value: unknown,
  allowSpeech = true,
): SceneDialogue[] {
  if (
    !allowSpeech ||
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .map((turn) => {
      const record =
        asRecord(turn);

      const hasSpokenLine =
        readLooseString(
          record.speaker,
        ).length > 0 &&
        readLooseString(
          record.text ??
            record.line,
        ).length > 0;

      return normalizeDialogue(
        {
          ...record,

          enabled:
            record.enabled !== false &&
            hasSpokenLine,

          voiceDirection:
            record.voiceDirection ??
            record.emotion ??
            "Natural, believable, concise delivery.",
        },
        true,
      );
    })
    .filter(
      (turn) =>
        turn.enabled,
    )
    .slice(0, 3);
}

function normalizeProductionBible(
  value: unknown,
  story: StoryDraft,
  aspectRatio: VideoAspectRatio,
  editingStyle: VideoEditingStyle,
  voiceMode: VideoVoiceMode,
): ProductionBible {
  const root =
    asRecord(value);

  const rawCharacterBible =
    Array.isArray(
      root.characterBible,
    )
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

  const requiredCharacterCount =
    voiceMode === "dialogue"
      ? 2
      : 1;

  const characterCount =
    Math.max(
      fallbackCharacters.length,
      Math.min(
        rawCharacterBible.length,
        8,
      ),
      requiredCharacterCount,
    );

  const characterBible =
    Array.from(
      {
        length:
          characterCount,
      },

      (_, index) => {
        const source =
          asRecord(
            rawCharacterBible[
              index
            ],
          );

        const fallbackCharacter =
          fallbackCharacters[
            index
          ] ?? {
            id:
              readString(
                source.id,
                `dialogue-character-${index + 1}`,
              ),

            name:
              readString(
                source.name,
                index === 1
                  ? "Conversation Partner"
                  : `Character ${index + 1}`,
              ),

            description:
              readString(
                source.fixedAppearance,
                "A clearly visible, realistic on-screen conversation partner.",
              ),
          };

        const baseDescription =
          fallbackCharacter.description ||
          "Consistent realistic appearance.";

        return {
          id:
            readString(
              source.id,
              fallbackCharacter.id ||
                `character-${index + 1}`,
            ),

          name:
            readString(
              source.name,
              fallbackCharacter.name ||
                `Character ${index + 1}`,
            ),

          role:
            readString(
              source.role,
              index === 0
                ? "Main character"
                : "Supporting character",
            ),

          fixedAppearance:
            readString(
              source.fixedAppearance,
              baseDescription,
            ),

          faceIdentity:
            readString(
              source.faceIdentity,
              `Stable recognizable facial identity based on: ${baseDescription}`,
            ),

          hair:
            readString(
              source.hair,
              "Keep hair exactly consistent throughout the film.",
            ),

          eyes:
            readString(
              source.eyes,
              "Keep eye appearance exactly consistent throughout the film.",
            ),

          bodyType:
            readString(
              source.bodyType,
              "Natural, anatomically plausible and consistent body proportions.",
            ),

          clothing:
            readString(
              source.clothing,
              "Keep the same story-appropriate clothing throughout the film.",
            ),

          accessories:
            readLooseString(
              source.accessories,
            ),

          movementStyle:
            readString(
              source.movementStyle,
              "Natural realistic movement with consistent body language.",
            ),

          voiceIdentity:
            readString(
              source.voiceIdentity,
              "Consistent natural voice throughout the film.",
            ),
        };
      },
    );

  const visual =
    asRecord(
      root.visualBible,
    );

  const camera =
    asRecord(
      root.cameraBible,
    );

  const audio =
    asRecord(
      root.audioBible,
    );

  const viral =
    asRecord(
      root.viralBible,
    );

  const performance =
    asRecord(
      root.performanceBible,
    );

  const lighting =
    asRecord(
      root.lightingBible,
    );

  const isCinematic =
    editingStyle ===
    "cinematic";

  const isMusicVideo =
    editingStyle ===
    "music-video";

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
      visualStyle:
        readString(
          visual.visualStyle,
          "Premium photorealistic cinematic live-action look.",
        ),

      colorGrade:
        readString(
          visual.colorGrade,
          "Restrained professional cinematic color grade with natural skin tones.",
        ),

      lightingStyle:
        readString(
          visual.lightingStyle,
          "Physically plausible cinematic lighting with stable exposure.",
        ),

      realismLevel:
        readString(
          visual.realismLevel,
          "High photorealism with believable anatomy, materials, reflections and motion.",
        ),

      environmentRules:
        readString(
          visual.environmentRules,
          `Maintain one coherent environment appropriate to ${story.setting}.`,
        ),

      continuityRules:
        readString(
          visual.continuityRules,
          "No unexplained identity, wardrobe, weather, prop, spatial or style changes.",
        ),
    },

    cameraBible: {
      cameraStyle:
        readString(
          camera.cameraStyle,
          cameraStyleFallback,
        ),

      lensStyle:
        readString(
          camera.lensStyle,
          "Realistic cinematic lens behavior with restrained depth of field.",
        ),

      frameRate:
        readString(
          camera.frameRate,
          "24 fps cinematic motion cadence.",
        ),

      motionStyle:
        readString(
          camera.motionStyle,
          "Smooth motivated motion that can continue seamlessly across extensions.",
        ),

      compositionRules:
        readString(
          camera.compositionRules,
          compositionFallback,
        ),

      transitionRules:
        readString(
          camera.transitionRules,
          transitionFallback,
        ),
    },

    audioBible: {
      dialogueLanguage:
        readString(
          audio.dialogueLanguage,
          "German",
        ),

      ambienceStyle:
        readString(
          audio.ambienceStyle,
          "Natural continuous ambience matching the environment.",
        ),

      musicStyle:
        readString(
          audio.musicStyle,
          "Subtle cinematic music supporting tension without overpowering dialogue.",
        ),

      soundContinuityRules:
        readString(
          audio.soundContinuityRules,
          "Continuous ambience, music and ongoing sound sources must not reset between extensions.",
        ),

      dialogueRules:
        readString(
          audio.dialogueRules,
          "Short natural dialogue, stable speaker voices, no subtitles or captions.",
        ),
    },

    viralBible: {
      hookStrategy:
        readString(
          viral.hookStrategy,
          hookFallback,
        ),

      retentionStrategy:
        readString(
          viral.retentionStrategy,
          "Introduce meaningful visual or narrative progress every few seconds.",
        ),

      escalationStrategy:
        readString(
          viral.escalationStrategy,
          "Escalate conflict, stakes, surprise or emotion throughout the film.",
        ),

      emotionalArc:
        readString(
          viral.emotionalArc,
          `Build a clear emotional arc matching the mood: ${story.mood}.`,
        ),

      payoffStrategy:
        readString(
          viral.payoffStrategy,
          "Deliver the main payoff clearly before the final seconds of the selected video length.",
        ),

      cliffhangerStrategy:
        readString(
          viral.cliffhangerStrategy,
          "If appropriate, end with a final unanswered visual question after the main payoff.",
        ),

      pacingRules:
        readString(
          viral.pacingRules,
          pacingFallback,
        ),
    },

    performanceBible: {
      actingStyle:
        readString(
          performance.actingStyle,
          "Natural restrained screen acting.",
        ),

      facialExpressionStyle:
        readString(
          performance.facialExpressionStyle,
          "Believable subtle facial expressions with stable identity.",
        ),

      bodyLanguageStyle:
        readString(
          performance.bodyLanguageStyle,
          "Anatomically plausible body language that supports the emotion.",
        ),

      dialogueDeliveryStyle:
        readString(
          performance.dialogueDeliveryStyle,
          "Natural concise spoken delivery with synchronized visible performance.",
        ),

      realismRules:
        readString(
          performance.realismRules,
          "Avoid exaggerated animation, impossible gestures and facial distortion.",
        ),
    },

    lightingBible: {
      primaryLightingStyle:
        readString(
          lighting.primaryLightingStyle,

          readString(
            visual.lightingStyle,
            "Physically plausible cinematic lighting.",
          ),
        ),

      lightDirection:
        readString(
          lighting.lightDirection,
          "Keep the established key-light direction spatially consistent.",
        ),

      contrastStyle:
        readString(
          lighting.contrastStyle,
          "Controlled cinematic contrast with preserved facial detail.",
        ),

      exposureStyle:
        readString(
          lighting.exposureStyle,
          "Natural stable exposure without abrupt brightness shifts.",
        ),

      practicalLights:
        readString(
          lighting.practicalLights,
          "Use only motivated practical light sources appropriate to the environment.",
        ),

      continuityRules:
        readString(
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
  voiceMode: VideoVoiceMode,
): MoviePlan {
  const root =
    asRecord(value);

  const studioAdvertisement =
    isStudioWebsiteAdvertisement(
      [
        story.title,
        story.genre,
        story.mood,
        story.setting,
        story.summary,
      ].join("\n"),
    );

  const studioAdvertisementDirection =
    studioAdvertisement
      ? buildStudioAdvertisementDirection()
      : "";

  const studioAdvertisementNegativePrompt =
    "No identity drift, no face changes, no wardrobe changes, no duplicated characters, no malformed hands, no extra fingers, no teleportation, no spatial discontinuity, no lighting jumps, no camera resets, no subtitles, no captions, no watermarks, no fake websites, no invented interface, no abstract neon replacement screen and no unrelated logos. The authentic KI Video Studio interface from the supplied reference is required and allowed.";

  const durationPlan =
    buildDurationPlan(
      targetDurationSeconds,
    );

  const openingDurationSeconds =
    getOpeningDurationSeconds(
      targetDurationSeconds,
    );

  const continuationDurationSeconds =
    getContinuationDurationSeconds(
      targetDurationSeconds,
    );

  const rawOpening =
    asRecord(
      root.opening,
    );

  const fallbackCharacterState =
    productionBible
      .characterBible
      .map(
        (character) =>
          `${character.name}: ${character.fixedAppearance}; clothing: ${character.clothing}`,
      )
      .join(" | ");

  const openingDialogue =
    normalizeDialogue(
      rawOpening.dialogue,
      voiceMode === "dialogue",
    );

  const opening:
    MovieOpening = {
    id:
      "opening",

    title:
      readString(
        rawOpening.title,
        story.title ||
          "Opening",
      ),

    startSecond:
      0,

    endSecond:
      openingDurationSeconds,

    durationSeconds:
      openingDurationSeconds,

    storyBeat:
      readString(
        rawOpening.storyBeat,
        `Immediately establish the central situation of ${story.summary}`,
      ),

    hook:
      readString(
        rawOpening.hook,
        "Create an immediate visual or emotional hook within the first two seconds.",
      ),

    emotionalBeat:
      readString(
        rawOpening.emotionalBeat,
        story.mood ||
          "Immediate curiosity and tension.",
      ),

    action:
      readString(
        rawOpening.action,
        story.summary ||
          "Begin the main story action immediately.",
      ),

    location:
      readString(
        rawOpening.location,
        story.setting ||
          "The story's primary location.",
      ),

    characterState:
      readString(
        rawOpening.characterState,

        fallbackCharacterState ||
          "The main subject is already clearly visible and ready for the opening action.",
      ),

    environmentState:
      readString(
        rawOpening.environmentState,
        `Environment matches the setting: ${story.setting}.`,
      ),

    cameraPlan:
      readString(
        rawOpening.cameraPlan,
        productionBible
          .cameraBible
          .cameraStyle,
      ),

    lightingPlan:
      readString(
        rawOpening.lightingPlan,
        productionBible
          .visualBible
          .lightingStyle,
      ),

    performancePlan:
      readString(
        rawOpening.performancePlan,

        productionBible
          .performanceBible
          ?.actingStyle ||
          "Natural believable performance.",
      ),

    audioPlan:
      readString(
        rawOpening.audioPlan,
        productionBible
          .audioBible
          .ambienceStyle,
      ),

    dialogue:
      openingDialogue,

    dialogueTurns:
      normalizeDialogueTurns(
        rawOpening.dialogueTurns ??
          asRecord(
            rawOpening.dialogue,
          ).dialogueTurns,
        voiceMode === "dialogue",
      ),

    veoPrompt: [
      readString(
        rawOpening.veoPrompt,

        [
          `${aspectRatio} ${
            editingStyle === "cinematic"
              ? "cinematic feature-film"
              : editingStyle === "music-video"
                ? "cinematic music-video"
                : "social-video"
          } live-action shot. Compose natively for this aspect ratio.`,

          `Story: ${story.summary}`,

          `Setting: ${story.setting}`,

          `Characters: ${fallbackCharacterState}`,

          "Begin immediately with a strong hook in the first two seconds.",

          "Maintain realistic anatomy, natural motion, stable identity, stable wardrobe and physically plausible lighting.",

          targetDurationSeconds <= 15
            ? `Create a complete satisfying ${openingDurationSeconds}-second micro-story with a clear ending.`
            : "End in a movement and camera state that can continue seamlessly into the next video continuation.",

          studioAdvertisement
            ? studioAdvertisementDirection
            : "No subtitles, captions, logos, watermarks or visible interface text.",
        ].join(" "),
      ),

      studioAdvertisementDirection,
    ]
      .filter(Boolean)
      .join(" "),

    audioPrompt:
      readString(
        rawOpening.audioPrompt,
        "Natural continuous ambience matching the scene, subtle cinematic sound design, stable voices, no narration unless required.",
      ),

    negativePrompt:
      studioAdvertisement
        ? studioAdvertisementNegativePrompt
        : readString(
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
          durationPlan
            .extensionCount,
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
          openingDurationSeconds +
          index *
            continuationDurationSeconds;

        const endSecond =
          startSecond +
          continuationDurationSeconds;

        const fallbackBeat =
          beatFallbacks[
            index %
              beatFallbacks.length
          ];

        const dialogue =
          normalizeDialogue(
            source.dialogue,
            voiceMode === "dialogue",
          );

        return {
          id:
            extensionNumber,

          title:
            readString(
              source.title,
              `Fortsetzung ${extensionNumber}`,
            ),

          extensionNumber,

          startSecond,
          endSecond,

          durationSeconds:
            continuationDurationSeconds,

          storyBeat:
            readString(
              source.storyBeat,
              fallbackBeat,
            ),

          emotionalBeat:
            readString(
              source.emotionalBeat,
              story.mood ||
                "Increase emotional engagement.",
            ),

          escalationPurpose:
            readString(
              source.escalationPurpose,
              fallbackBeat,
            ),

          actionContinuation:
            readString(
              source.actionContinuation,

              `Continue the existing action seamlessly and visibly advance the story: ${fallbackBeat}`,
            ),

          characterContinuity:
            readString(
              source.characterContinuity,

              `Keep all visible characters identical to the existing video. ${fallbackCharacterState}`,
            ),

          environmentContinuity:
            readString(
              source.environmentContinuity,

              `Continue the same established environment and spatial layout from ${opening.location}.`,
            ),

          cameraContinuation:
            readString(
              source.cameraContinuation,

              "Continue naturally from the current camera position, movement direction, framing and lens behavior without resetting.",
            ),

          lightingContinuation:
            readString(
              source.lightingContinuation,

              "Preserve established light direction, exposure, color temperature, shadows and practical lights.",
            ),

          performanceContinuation:
            readString(
              source.performanceContinuation,

              "Continue the current physical and emotional performance naturally without pose or identity reset.",
            ),

          audioContinuation:
            readString(
              source.audioContinuation,

              "Continue all active ambience, music and sound sources naturally without an audible reset.",
            ),

          dialogue,

          dialogueTurns:
            normalizeDialogueTurns(
              source.dialogueTurns ??
                asRecord(
                  source.dialogue,
                ).dialogueTurns,
              voiceMode === "dialogue",
            ),

          continuationPrompt: [
            readString(
              source.continuationPrompt,

              [
                "Continue seamlessly from the exact current motion and final video state.",

                fallbackBeat,

                "Do not restart or reintroduce the scene.",

                "Keep character identity, face, body, clothing, props, environment, lighting, camera direction and audio continuous.",

                "Use natural physically plausible motion.",

                studioAdvertisement
                  ? studioAdvertisementDirection
                  : "No subtitles, captions, logos, watermarks or visible interface text.",
              ].join(" "),
            ),

            studioAdvertisementDirection,
          ]
            .filter(Boolean)
            .join(" "),

          audioPrompt:
            readLooseString(
              source.audioPrompt,
            ) ||
            "Continue the established ambience and sound design naturally.",

          negativePrompt:
            studioAdvertisement
              ? studioAdvertisementNegativePrompt
              : (
                  readLooseString(
                    source.negativePrompt,
                  ) ||
                  "No identity drift, face changes, wardrobe changes, duplicated characters, teleportation, malformed anatomy, spatial discontinuity, camera reset, lighting reset, subtitles, captions, logos or watermarks."
                ),
        };
      },
    );

  const rawChapters =
    Array.isArray(
      root.chapters,
    )
      ? root.chapters
      : [];

  let chapterStartSecond =
    0;

  const chapters:
    VideoChapter[] =
    durationPlan
      .generationStrategy ===
      "chaptered"
      ? durationPlan
          .chapterTargets
          .map(
            (
              chapterTarget,
              index,
            ) => {
              const source =
                asRecord(
                  rawChapters[
                    index
                  ],
                );

              const startSecond =
                chapterStartSecond;

              const endSecond =
                startSecond +
                chapterTarget;

              chapterStartSecond =
                endSecond;

              const generatedChapter =
                buildVideoDurationPlan(
                  chapterTarget,
                );

              const chapterNumber =
                index + 1;

              return {
                id:
                  chapterNumber,

                title:
                  readString(
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

                storyGoal:
                  readString(
                    source.storyGoal,

                    index === 0
                      ? `Establish the story, characters and central conflict: ${story.summary}`
                      : index ===
                          durationPlan
                            .chapterTargets
                            .length -
                            1
                        ? "Resolve the central conflict and deliver the final emotional or visual payoff."
                        : "Advance and escalate the same story with meaningful new developments.",
                  ),

                visualGoal:
                  readString(
                    source.visualGoal,

                    `Maintain the established visual identity, character continuity and cinematic style in ${story.setting}.`,
                  ),

                openingPrompt:
                  index === 0
                    ? opening.veoPrompt
                    : [
                        readString(
                          source.openingPrompt,

                          [
                            `Begin chapter ${chapterNumber} as a natural continuation of the same film.`,

                            "Preserve established character identity, wardrobe, visual style, world rules and emotional continuity.",

                            `Story goal: ${readString(
                              source.storyGoal,
                              "Continue and escalate the same story.",
                            )}`,

                            "Start with a visually strong, immediately readable action.",

                            studioAdvertisement
                              ? studioAdvertisementDirection
                              : "No subtitles, captions, logos, watermarks or visible interface text.",
                          ].join(" "),
                        ),

                        studioAdvertisementDirection,
                      ]
                        .filter(Boolean)
                        .join(" "),

                continuationPrompts:
                  [],

                transitionIn:
                  readString(
                    source.transitionIn,

                    index === 0
                      ? "Start immediately with the opening hook."
                      : "Continue the same story with a motivated cinematic transition from the previous chapter.",
                  ),

                transitionOut:
                  readString(
                    source.transitionOut,

                    index ===
                      durationPlan
                        .chapterTargets
                        .length -
                        1
                      ? "End with the final payoff and a clean finish."
                      : "End on a strong continuation-ready story state for the next chapter.",
                  ),

                completed:
                  false,
              };
            },
          )
      : [];

  const protectedOutputSecond =
    Math.min(
      durationPlan
        .generatedDurationSeconds,

      targetDurationSeconds +
        2,
    );

  const minimumFinalSecond =
    targetDurationSeconds === 8
      ? 7
      : 14;

  const finalStorySecond =
    Math.max(
      minimumFinalSecond,

      protectedOutputSecond -
        1,
    );

  return {
    targetDurationSeconds:
      durationPlan
        .targetDurationSeconds,

    generatedDurationSeconds:
      durationPlan
        .generatedDurationSeconds,

    aspectRatio,

    editingStyle,

    provider:
      "auto",

    generationStrategy:
      durationPlan
        .generationStrategy,

    opening,

    continuations,

    chapters:
      chapters.length > 0
        ? chapters
        : undefined,

    endingStrategy:
      readString(
        root.endingStrategy,

        `Resolve the main dramatic question before approximately second ${finalStorySecond}, then hold a calm visual tail so no sentence, gesture or camera move is cut off.`,
      ),

    finalPayoff:
      readString(
        root.finalPayoff,

        `Deliver a clear emotionally or visually satisfying payoff before approximately second ${finalStorySecond}.`,
      ),

    finalCliffhanger:
      readString(
        root.finalCliffhanger,

        "If the story supports it, leave one concise final unanswered visual question after the main payoff.",
      ),

    characterContinuityRules:
      readString(
        root.characterContinuityRules,

        "Preserve exact character identity, face, hair, body proportions, clothing, accessories, movement style and voice throughout the entire project.",
      ),

    visualContinuityRules:
      readString(
        root.visualContinuityRules,

        productionBible
          .visualBible
          .continuityRules,
      ),

    cameraContinuityRules:
      readString(
        root.cameraContinuityRules,

        productionBible
          .cameraBible
          .transitionRules,
      ),

    lightingContinuityRules:
      readString(
        root.lightingContinuityRules,

        productionBible
          .lightingBible
          ?.continuityRules ||
          "Preserve light direction, color temperature, exposure and practical sources across continuations and chapters.",
      ),

    audioContinuityRules:
      readString(
        root.audioContinuityRules,

        productionBible
          .audioBible
          .soundContinuityRules,
      ),

    storyContinuityRules:
      readString(
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
  voiceMode: VideoVoiceMode,
): ArchitectResponse {
  const root =
    asRecord(parsed);

  const productionBible =
    normalizeProductionBible(
      root.productionBible,
      story,
      aspectRatio,
      editingStyle,
      voiceMode,
    );

  const moviePlan =
    normalizeMoviePlan(
      root.moviePlan,
      story,
      productionBible,
      targetDurationSeconds,
      aspectRatio,
      editingStyle,
      voiceMode,
    );

  return {
    productionBible,
    moviePlan,
  };
}

function isInfidelityStory(
  story: StoryDraft,
): boolean {
  return /fremdgeh|fremdgeher|affäre|seitensprung|untreu|betrüg|betrogen|geliebte|heimliche[rn]?\s+(?:flirt|beziehung)|cheat|infidel/i.test(
    [
      story.title,
      story.genre,
      story.summary,
    ].join(" "),
  );
}

function hasMandatoryViralVisualPlan(
  response: ArchitectResponse,
  story: StoryDraft,
): boolean {
  const opening =
    response.moviePlan.opening;

  const openingVisualPlan = [
    opening.hook,
    opening.storyBeat,
    opening.action,
    opening.veoPrompt,
  ].join(" ");

  const continuationVisualPlans =
    response.moviePlan.continuations.map(
      (continuation) => [
        continuation.storyBeat,
        continuation.actionContinuation,
        continuation.continuationPrompt,
      ].join(" "),
    );

  const completeVisualPlan = [
    openingVisualPlan,
    ...continuationVisualPlans,
  ].join(" ");

  const namesVisibleAction =
    /sieht|beobachtet|erwischt|öffnet|betritt|fällt|zeigt|hält|trägt|übergibt|nimmt|vertauscht|küss|umarm|entdeckt|catches|sees|witnesses|opens|enters|falls|reveals|holds|wears|hands over|swaps|kisses|embraces|discovers/i.test(
      openingVisualPlan,
    );

  if (
    openingVisualPlan.length < 80 ||
    !namesVisibleAction ||
    continuationVisualPlans.some(
      (plan) => plan.length < 50,
    )
  ) {
    return false;
  }

  if (
    isInfidelityStory(story)
  ) {
    const showsBetrayalItself =
      /küss|kuss|umarm|händchen|hand in hand|eng umschlungen|streichel|verlässt.{0,30}(?:zimmer|schlafzimmer)|kommt.{0,30}(?:zimmer|schlafzimmer)|kiss|embrac|holding hands|caress|leaves?.{0,30}bedroom|walks?.{0,30}out of.{0,20}(?:room|bedroom)/i.test(
        completeVisualPlan,
      );

    if (!showsBetrayalItself) {
      return false;
    }
  }

  return true;
}

function isVagueDramaLine(
  text: string,
): boolean {
  const normalized =
    text
      .trim()
      .toLocaleLowerCase(
        "de-DE",
      )
      .replace(
        /[„“"'!?.,…:;]+/g,
        "",
      )
      .replace(
        /\s+/g,
        " ",
      );

  const exactPlaceholder = [
    /^das ist (?:doch )?(?:alles )?(?:völlig |ganz )?anders$/,
    /^du verstehst das nicht$/,
    /^frag .{0,24} nicht(?: zu viel)?$/,
    /^(?:und )?das ist erst der anfang$/,
    /^warte (?:nur )?ab$/,
    /^ich kann das erklären$/,
    /^es ist nicht so(?: wie du denkst)?$/,
    /^du weißt gar nichts$/,
    /^glaub mir$/,
    /^(?:bitte )?sag (?:mir )?(?:endlich )?die wahrheit$/,
    /^(?:hör auf zu lügen|du lügst|du bist ein lügner)$/,
    /^(?:wie konntest du|ich habe dir vertraut)$/,
    /^(?:was soll das|was ist hier los)$/,
    /^(?:das kann nicht sein|das glaub ich nicht)$/,
    /^was machst du (?:mit .+ )?hier$/,
    /^das gehört (?:niemals )?(?:nicht )?(?:euch|dir|ihm|ihr)(?: beiden)?$/,
    /^(?:aber )?(?:das|dies|das hier|dies hier) (?:ändert|verändert|beweist|erklärt) (?:einfach )?(?:alles|nichts)$/,
  ].some(
    (pattern) =>
      pattern.test(
        normalized,
      ),
  );

  if (
    exactPlaceholder
  ) {
    return true;
  }

  const containsGenericReaction =
    /(?:lüg|wahrheit|wie konntest|verstehst (?:mich|das) nicht|sag .{0,20}nichts|glaub(?:e)? .{0,12}(?:mir|dir)|was ist hier los|was soll das|kann das erklären|nicht wie es aussieht|ändert alles)/i.test(
      normalized,
    );

  const containsConcreteDetail =
    /(?:küss|kuss|umarm|zimmer|pool|terrasse|feuerkorb|ring|armband|kette|schmuck|jacke|koffer|ticket|schlüssel|umschlag|geld|preis|challenge|requisit|team|allianz|hochzeit|ehe|verlob|wohnung|geschenk|treffen|nacht|morgen|gestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|woche|monat|jahr|seit|vorabend|uhr|gesehen|erwischt|getragen|gegeben|genommen|vertauscht|versprochen|geküsst|verlassen)/i.test(
      normalized,
    );

  return (
    containsGenericReaction &&
    !containsConcreteDetail
  );
}

function buildViralDialogueArc(
  targetDurationSeconds:
    VideoDurationSeconds,
): string {
  const dialogueBeatCount =
    targetDurationSeconds <= 15
      ? 1
      : 1 +
        Math.ceil(
          (
            targetDurationSeconds -
            15
          ) /
            15,
        );

  if (
    targetDurationSeconds ===
    60
  ) {
    return `
VERBINDLICHER EINMINÜTIGER DIALOGBOGEN – VIER 15-SEKUNDEN-BEATS

1. Opening 0–15: Zeige zuerst die verbotene Handlung selbst oder wie sie unmittelbar entdeckt wird. Die betroffene Figur benennt konkret, was sie gerade gesehen hat. Die Antwort nennt ein überprüfbares Detail statt einer leeren Ausrede.
2. Fortsetzung 15–30: Ein klares Ziel kollidiert mit dem Gegeninteresse. Ort, Zeitpunkt oder Besitz eines Gegenstands machen die Aussage überprüfbar.
3. Fortsetzung 30–45: Die dritte Figur enthüllt einen Widerspruch oder ein Teilgeständnis. Ein kurzer echter Gefühlsmoment zeigt, warum der Konflikt persönlich wichtig ist.
4. Fortsetzung 45–60: Eine konkrete Entscheidung hat eine sichtbare Konsequenz. Der letzte Satz benennt ein neues Beweisstück, Ereignis oder Geheimnis als Cliffhanger.

Die Dialoge ergeben zusammen EIN verständliches Gespräch. Jede Zeile erfüllt genau eine Funktion: Vorwurf, Antwort, Widerspruch, Geständnis, Entscheidung oder Enthüllung. Keine Zeile darf aus einer anderen Geschichte stammen.`;
  }

  return `
VERBINDLICHER DIALOGBOGEN

- Plane ${dialogueBeatCount} aufeinander aufbauende 15-Sekunden-Storybeats für ${targetDurationSeconds} Sekunden.
- Beginne mit einem konkret benannten Skandal oder Beweis.
- Lass jede Antwort den unmittelbar vorherigen Vorwurf beantworten und eine neue Information ergänzen.
- Nutze dialogueTurns innerhalb eines 15-Sekunden-Clips, wenn mehrere Figuren unmittelbar reagieren müssen.
- Steigere über Geständnis, Widerspruch und Konsequenz zu einem konkret benannten Cliffhanger.
- Gib jeder Figur eine erkennbare Sprechhaltung: direkt, kontrolliert, ausweichend, trocken oder verletzlich. Vertauschte Zeilen dürfen nicht gleich gut funktionieren.`;
}

function hasMandatoryDialoguePlan(
  response:
    ArchitectResponse,

  expectedSpeakers:
    readonly string[] = [],

  targetDurationSeconds =
    30,

  creationMode:
    VideoCreationMode =
    "standard",

  story?:
    StoryDraft,
): boolean {
  if (
    response
      .productionBible
      .characterBible
      .length < 2 ||
    (
      targetDurationSeconds >
        15 &&
      response
        .moviePlan
        .continuations
        .length < 1
    )
  ) {
    return false;
  }

  const plannedDialogue = [
    response
      .moviePlan
      .opening
      .dialogue,

    ...(
      response
        .moviePlan
        .opening
        .dialogueTurns ??
      []
    ),

    ...response
      .moviePlan
      .continuations
      .flatMap(
        (
          continuation,
        ) => [
          continuation
            .dialogue,

          ...(
            continuation
              .dialogueTurns ??
            []
          ),
        ],
      ),
  ];

  const enabledDialogue =
    plannedDialogue
      .filter(
        (dialogue) =>
          dialogue.enabled,
      );

  const minimumSpeakerCount =
    Math.min(
      3,

      Math.max(
        2,
        expectedSpeakers
          .length,
      ),
    );

  const isViralDialogue =
    creationMode ===
    "viral-story";

  const minimumDialogueCount =
    isViralDialogue
      ? Math.min(
          plannedDialogue.length,

          targetDurationSeconds <=
            15
            ? minimumSpeakerCount
            : Math.max(
                minimumSpeakerCount,

                Math.ceil(
                  targetDurationSeconds /
                    15,
                ),
              ),
        )
      : minimumSpeakerCount;

  if (
    !plannedDialogue[
      0
    ]?.enabled ||
    enabledDialogue.length <
      minimumDialogueCount
  ) {
    return false;
  }

  const forbiddenSpeaker =
    /narrat|voice[ -]?over|off[ -]?screen|erz(?:ae|ä)hl|sprecher(?:in)?$/i;

  const speakers =
    new Set<string>();

  let totalWordCount =
    0;

  let previousSpeaker =
    "";

  let consecutiveSpeakerLines =
    0;

  const usedDialogueLines =
    new Set<string>();

  const maximumWordsPerLine =
    isViralDialogue
      ? 9
      : 12;

  for (
    const dialogue
    of enabledDialogue
  ) {
    const speaker =
      dialogue
        .speaker
        .trim();

    const normalizedSpeaker =
      speaker
        .toLocaleLowerCase(
          "de-DE",
        );

    const wordCount =
      dialogue
        .text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;

    const normalizedDialogueLine =
      dialogue.text
        .trim()
        .toLocaleLowerCase("de-DE")
        .replace(/[„“"'!?.,…:;]+/g, "")
        .replace(/\s+/g, " ");

    if (
      !speaker ||
      forbiddenSpeaker.test(
        speaker,
      ) ||
      wordCount < 1 ||
      wordCount >
        maximumWordsPerLine ||
      /\d|[#@/\\]|[A-ZÄÖÜ]{2,}/.test(
        dialogue.text,
      ) ||
      dialogue.text.length >
        140 ||
      usedDialogueLines.has(
        normalizedDialogueLine,
      )
    ) {
      return false;
    }

    usedDialogueLines.add(
      normalizedDialogueLine,
    );

    consecutiveSpeakerLines =
      normalizedSpeaker ===
      previousSpeaker
        ? consecutiveSpeakerLines +
          1
        : 1;

    if (
      isViralDialogue &&
      (
        consecutiveSpeakerLines >
          2 ||
        isVagueDramaLine(
          dialogue.text,
        )
      )
    ) {
      return false;
    }

    speakers.add(
      normalizedSpeaker,
    );

    previousSpeaker =
      normalizedSpeaker;

    totalWordCount +=
      wordCount;
  }

  if (
    speakers.size <
    minimumSpeakerCount
  ) {
    return false;
  }

  if (
    targetDurationSeconds ===
      15 &&
    totalWordCount > 24
  ) {
    return false;
  }

  if (
    targetDurationSeconds ===
      8 &&
    totalWordCount > 12
  ) {
    return false;
  }

  if (
    isViralDialogue &&
    story &&
    isInfidelityStory(
      story,
    )
  ) {
    const completeDialogue =
      enabledDialogue
        .map(
          (dialogue) =>
            dialogue.text,
        )
        .join(" ");

    const namesConcreteConflict =
      /fremdgeh|affäre|betrüg|betrogen|untreu|küss|kuss|lüg|heimlich|hintergangen|verrat|hochzeit|verlob|beziehung/i.test(
        completeDialogue,
      );

    const namesConcreteEvidence =
      /foto|nachricht|chat|video|hotel|rechnung|kuss|küss|bett|schlüssel|ticket|ring|ultraschall|schwanger|baby|parfüm|handy|beweis|gesehen|erwischt/i.test(
        completeDialogue,
      );

    if (
      !namesConcreteConflict ||
      !namesConcreteEvidence
    ) {
      return false;
    }
  }

  if (
    expectedSpeakers.length >
    0
  ) {
    const expected =
      expectedSpeakers
        .slice(0, 3)
        .map(
          (speaker) => {
            const fullName =
              speaker
                .trim()
                .toLocaleLowerCase(
                  "de-DE",
                );

            const shortName =
              fullName
                .split(",")[0]
                .trim();

            return {
              fullName,
              shortName,
            };
          },
        );

    if (
      !expected.every(
        ({
          fullName,
          shortName,
        }) =>
          speakers.has(
            fullName,
          ) ||
          speakers.has(
            shortName,
          ),
      )
    ) {
      return false;
    }
  }

  return true;
}

function validateDialogue(
  value: unknown,
): value is SceneDialogue {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const dialogue =
    value as Partial<SceneDialogue>;

  if (
    typeof dialogue.enabled !==
      "boolean" ||
    !isString(
      dialogue.speaker,
    ) ||
    !isString(
      dialogue.text,
    ) ||
    !isString(
      dialogue.language,
    ) ||
    !isString(
      dialogue.voiceDirection,
    )
  ) {
    return false;
  }

  if (
    !dialogue.enabled
  ) {
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

function validateDialogueTurns(
  value: unknown,
): boolean {
  return (
    value === undefined ||
    (
      Array.isArray(value) &&
      value.length <= 3 &&
      value.every(
        validateDialogue,
      )
    )
  );
}

function validateProductionBible(
  value: unknown,
): value is ProductionBible {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const bible =
    value as Partial<ProductionBible>;

  return (
    Array.isArray(
      bible.characterBible,
    ) &&

    bible
      .characterBible
      .length > 0 &&

    bible
      .characterBible
      .every(
        (character) =>
          Boolean(
            character &&

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
            ),
          ),
      ) &&

    typeof bible.visualBible ===
      "object" &&

    bible.visualBible !==
      null &&

    typeof bible.cameraBible ===
      "object" &&

    bible.cameraBible !==
      null &&

    typeof bible.audioBible ===
      "object" &&

    bible.audioBible !==
      null &&

    typeof bible.viralBible ===
      "object" &&

    bible.viralBible !==
      null &&

    typeof bible.performanceBible ===
      "object" &&

    bible.performanceBible !==
      null &&

    typeof bible.lightingBible ===
      "object" &&

    bible.lightingBible !==
      null
  );
}

function validateOpening(
  value: unknown,
  targetDurationSeconds:
    VideoDurationSeconds,
): value is MovieOpening {
  if (
    typeof value !==
      "object" ||
    value === null
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

    validateDialogue(
      opening.dialogue,
    ) &&

    validateDialogueTurns(
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

function validateContinuation(
  value: unknown,
  index: number,
  targetDurationSeconds:
    VideoDurationSeconds,
): value is MovieContinuation {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const continuation =
    value as Partial<MovieContinuation>;

  const extensionNumber =
    index + 1;

  const openingDuration =
    getOpeningDurationSeconds(
      targetDurationSeconds,
    );

  const continuationDuration =
    getContinuationDurationSeconds(
      targetDurationSeconds,
    );

  const expectedStart =
    openingDuration +
    index *
      continuationDuration;

  const expectedEnd =
    expectedStart +
    continuationDuration;

  return (
    continuation.id ===
      extensionNumber &&

    continuation.extensionNumber ===
      extensionNumber &&

    continuation.startSecond ===
      expectedStart &&

    continuation.endSecond ===
      expectedEnd &&

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

    validateDialogue(
      continuation.dialogue,
    ) &&

    validateDialogueTurns(
      continuation.dialogueTurns,
    ) &&

    isNonEmptyString(
      continuation.continuationPrompt,
    ) &&

    isString(
      continuation.audioPrompt,
    ) &&

    isString(
      continuation.negativePrompt,
    )
  );
}

function validateVideoChapter(
  value: unknown,
  index: number,
  expectedTargets:
    VideoDurationSeconds[],
): value is VideoChapter {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const chapter =
    value as Partial<VideoChapter>;

  const expectedTarget =
    expectedTargets[
      index
    ];

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

function validateMoviePlan(
  value: unknown,
): value is MoviePlan {
  if (
    typeof value !==
      "object" ||
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

    !validateOpening(
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
    expected
      .generationStrategy ===
    "chaptered"
  ) {
    if (
      plan.continuations.length !==
        0 ||

      !Array.isArray(
        plan.chapters,
      ) ||

      plan.chapters.length !==
        expected
          .chapterTargets
          .length ||

      !plan.chapters.every(
        (
          chapter,
          index,
        ) =>
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
        (
          continuation,
          index,
        ) =>
          validateContinuation(
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

function validateArchitectResponse(
  parsed: unknown,
): parsed is ArchitectResponse {
  if (
    typeof parsed !==
      "object" ||
    parsed === null
  ) {
    return false;
  }

  const value =
    parsed as Partial<ArchitectResponse>;

  return (
    validateProductionBible(
      value.productionBible,
    ) &&

    validateMoviePlan(
      value.moviePlan,
    )
  );
}

function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function getErrorDetails(
  error: unknown,
): ErrorDetails {
  let status:
    number |
    undefined;

  let code:
    number |
    undefined;

  let message =
    "Unbekannter Fehler bei der Gemini-Anfrage.";

  if (
    error instanceof
    Error
  ) {
    message =
      error.message;
  } else if (
    typeof error ===
    "string"
  ) {
    message =
      error;
  }

  if (
    typeof error ===
      "object" &&
    error !== null
  ) {
    const record =
      error as Record<
        string,
        unknown
      >;

    if (
      typeof record.status ===
      "number"
    ) {
      status =
        record.status;
    }

    if (
      typeof record.code ===
      "number"
    ) {
      code =
        record.code;
    }

    if (
      typeof record.message ===
      "string"
    ) {
      message =
        record.message;
    }

    const nestedError =
      record.error;

    if (
      typeof nestedError ===
        "object" &&
      nestedError !== null
    ) {
      const nested =
        nestedError as Record<
          string,
          unknown
        >;

      if (
        typeof nested.status ===
        "number"
      ) {
        status =
          nested.status;
      }

      if (
        typeof nested.code ===
        "number"
      ) {
        code =
          nested.code;
      }

      if (
        typeof nested.message ===
        "string"
      ) {
        message =
          nested.message;
      }
    }
  }

  const match =
    message.match(
      /\b(404|408|429|500|502|503|504)\b/,
    );

  if (
    !status &&
    match
  ) {
    status =
      Number(
        match[1],
      );
  }

  return {
    status,
    code,
    message,
  };
}

function isRetryableGeminiError(
  error: unknown,
): boolean {
  const details =
    getErrorDetails(
      error,
    );

  const statuses = [
    408,
    429,
    500,
    502,
    503,
    504,
  ];

  if (
    details.status &&
    statuses.includes(
      details.status,
    )
  ) {
    return true;
  }

  if (
    details.code &&
    statuses.includes(
      details.code,
    )
  ) {
    return true;
  }

  const message =
    details.message
      .toLowerCase();

  return (
    message.includes(
      "unavailable",
    ) ||
    message.includes(
      "high demand",
    ) ||
    message.includes(
      "overloaded",
    ) ||
    message.includes(
      "temporarily",
    ) ||
    message.includes(
      "resource exhausted",
    ) ||
    message.includes(
      "too many requests",
    ) ||
    message.includes(
      "deadline exceeded",
    )
  );
}

function isModelUnavailableError(
  error: unknown,
): boolean {
  const details =
    getErrorDetails(
      error,
    );

  if (
    details.status ===
      404 ||
    details.code ===
      404
  ) {
    return true;
  }

  const message =
    details.message
      .toLowerCase();

  return (
    message.includes(
      "model not found",
    ) ||
    message.includes(
      "not found for api version",
    ) ||
    message.includes(
      "is not supported",
    )
  );
}

function createRetryDelay(
  attempt: number,
): number {
  return (
    INITIAL_RETRY_DELAY_MS *
      2 **
        (
          attempt -
          1
        ) +
    Math.floor(
      Math.random() *
        500,
    )
  );
}

async function generateStoryWithFallback(
  ai: GoogleGenAI,
  prompt: string,
  validateCandidate?:
    (
      parsed: unknown,
    ) => boolean,
  models:
    readonly string[] =
      STORY_MODELS,
): Promise<GeneratedStory> {
  let lastError:
    unknown;

  for (
    const model
    of models
  ) {
    for (
      let attempt = 1;
      attempt <=
        RETRIES_PER_MODEL;
      attempt += 1
    ) {
      try {
        console.log(
          `Story Architect: ${model}, Versuch ${attempt}/${RETRIES_PER_MODEL}`,
        );

        const response =
          await ai.models
            .generateContent({
              model,

              contents:
                prompt,

              config: {
                responseMimeType:
                  "application/json",

                temperature:
                  0.25,

                maxOutputTokens:
                  32000,
              },
            });

        const rawText =
          response.text
            ?.trim();

        const finishReason =
          response
            .candidates?.[0]
            ?.finishReason;

        console.log(
          "Story Architect Antwort:",
          {
            model,
            attempt,
            finishReason,

            characterCount:
              rawText?.length ??
              0,
          },
        );

        if (
          !rawText
        ) {
          throw new Error(
            "Gemini hat keinen Filmplan zurückgegeben.",
          );
        }

        const parsedResult =
          tryParseJson(
            rawText,
          );

        if (
          !parsedResult
        ) {
          const malformedError =
            new Error(
              `Story Architect lieferte ungültiges JSON. finishReason=${String(
                finishReason ??
                  "unknown",
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

          break;
        }

        if (
          validateCandidate &&
          !validateCandidate(
            parsedResult.parsed,
          )
        ) {
          lastError =
            new Error(
              "Der Filmplan enthält keinen zuverlässig ausführbaren Dialog mit mindestens zwei sichtbaren Personen.",
            );

          console.warn(
            `Story Architect Dialogprüfung fehlgeschlagen: ${model}, Versuch ${attempt}/${RETRIES_PER_MODEL}`,
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

          break;
        }

        return {
          rawText:
            parsedResult
              .cleanedText,

          model,
        };
      } catch (
        error:
          unknown
      ) {
        lastError =
          error;

        console.warn(
          `Story Architect fehlgeschlagen: ${model}, Versuch ${attempt}`,

          getErrorDetails(
            error,
          ),
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
  targetDurationSeconds:
    VideoDurationSeconds,
  aspectRatio:
    VideoAspectRatio,
  editingStyle:
    VideoEditingStyle,
  audioStyle:
    VideoAudioStyle,
  voiceMode:
    VideoVoiceMode,
  spokenLanguage:
    VideoSpokenLanguage,
  voiceoverText:
    string,
  closingText:
    string,
  creationMode:
    VideoCreationMode,
  musicTrack?:
    MusicVideoTrackContext,
): string {
  const studioAdvertisement =
    isStudioWebsiteAdvertisement(
      [
        story.title,
        story.genre,
        story.mood,
        story.setting,
        story.summary,
      ].join("\n"),
    );

  const studioAdvertisementSection =
    studioAdvertisement
      ? `
${STUDIO_BRAND_CONTEXT}

VERBINDLICHE REGELN FÜR DIESE MARKENWERBUNG

- Dies ist Werbung für die echte, bereits veröffentlichte Webseite KI Video Studio.
- Das beworbene Produkt ist die Webseite selbst, nicht irgendein erfundenes KI-Produkt.
- Zeige die echte dunkle Benutzeroberfläche mit violetten Akzenten und den Bereichen Video, Songs und Bilder auf dem Gerätedisplay.
- Ein hochgeladenes oder automatisch beigefügtes Bild der echten Webseite ist eine verbindliche Produktreferenz.
- Ersetze diese Referenz niemals durch abstrakte Neonwellen, Fantasieschrift, eine erfundene App oder eine andere Marke.
- Das KI-Video darf die echte KI-Video-Studio-Oberfläche und das echte Logo aus der Referenz zeigen.
- Untertitel, Wasserzeichen, zusätzliche erfundene Logos und zusätzliche Fantasieschrift bleiben verboten.
`
      : "";

  const visibleInterfaceRestriction =
    studioAdvertisement
      ? [
          "- Untertitel",
          "- Wasserzeichen",
          "- erfundene oder fremde Logos",
          "- erfundene Interface-Texte außerhalb der echten KI-Video-Studio-Referenz",
        ].join("\n")
      : [
          "- Untertitel",
          "- Logos",
          "- Wasserzeichen",
          "- sichtbare Interface-Texte",
        ].join("\n");

  const characterDescription =
    story.characters
      .map(
        (
          character,
          index,
        ) =>
          `${index + 1}. ${character.name}: ${character.description}`,
      )
      .join("\n");

  const durationPlan =
    buildDurationPlan(
      targetDurationSeconds,
    );

  const activeMusicTrack =
    editingStyle === "music-video" &&
    musicTrack
      ? musicTrack
      : undefined;

  const finalOutputSeconds =
    activeMusicTrack?.durationSeconds ??
    targetDurationSeconds;

  const musicTrackSection =
    activeMusicTrack
      ? `
VERBINDLICHER ORIGINALSONG

- Dateiname: ${activeMusicTrack.name}
- Exakte finale Videolänge: ${activeMusicTrack.durationSeconds.toFixed(2)} Sekunden.
- Musikalische Analyse: ${activeMusicTrack.analysis}
- Die hochgeladene Audiodatei bleibt von Sekunde null bis zum vollständigen Ende die einzige finale Tonspur.
- Plane Bildwechsel, Bewegungsintensität, Performance und Übergänge passend zu den analysierten Songabschnitten.
- Wiederkehrende Refrains erhalten ein wiedererkennbares visuelles Leitmotiv; Strophen entwickeln Handlung oder Performance weiter; Bridge und Outro bekommen eigene Bildideen.
- Keine zusätzliche Musik, keine Dialoge, keine Sprecherstimme und keine hörbaren Seedance-Vocals.
- Der technische Renderblock reicht bis ${targetDurationSeconds} Sekunden. Alles nach Sekunde ${activeMusicTrack.durationSeconds.toFixed(2)} wird verworfen. Höhepunkt, Auflösung und finales Bild müssen deshalb spätestens bis zum tatsächlichen Songende abgeschlossen sein.
`
      : "";

  const openingDurationSeconds =
    getOpeningDurationSeconds(
      targetDurationSeconds,
    );

  const continuationDurationSeconds =
    getContinuationDurationSeconds(
      targetDurationSeconds,
    );

  const viralStorySection =
    creationMode ===
    "viral-story"
      ? `
VERBINDLICHER TIKTOK-STORY-MODUS MIT FESTEN FIGUREN

AUTORENRAUM VOR DER AUSGABE

- Lege intern zuerst diese sieben Fakten fest und ändere sie danach nicht mehr: bestehende Beziehung, verbotene Handlung, direkter Zeuge, genaue Lüge, widerlegendes Detail, persönliche Konsequenz und konkreter Cliffhanger.
- Schreibe danach den Dialog einmal vollständig in zeitlicher Reihenfolge. Prüfe, ob jede Antwort ohne zusätzliches Wissen verständlich auf die vorige Zeile reagiert.
- Streiche jede Zeile, die weder den Konflikt voranbringt noch eine Figur erkennbar macht. Erfinde während des Gesprächs keine neuen Gegenstände, Beziehungen oder Orte, die nicht zur Faktenkette gehören.

- Jeder neue Seedance-Abschnitt dauert grundsätzlich 15 Sekunden.
- In jedem 15-Sekunden-Abschnitt geschieht eine neue konkrete Handlung oder Enthüllung; Streit und ein kurzer echter Gefühlsmoment wechseln sich sinnvoll ab.
- Plane klare übertriebene Reaktionen: anklagendes Zeigen, Unterbrechen, Augenrollen, empörtes Wegdrehen, entsetztes Zurückweichen, feindselige Seitenblicke oder große Doppeltakes.
- Niemand steht ruhig erklärend herum.
- Nutze schnelle Gegenaufnahmen und enge Reaktionsbilder.
- Der Streit bleibt ohne körperliche Gewalt.
- Dies ist ausdrücklich eine vertikale Social-Story für TikTok, Reels und Shorts.
- Keine Dokumentation, keine Reportage, keine Wissensvermittlung, kein Interviewformat und kein Moderatorstil.
- Die angegebenen Figuren sind eine geschlossene Besetzung.
- Keine zusätzlichen Menschen, Statisten oder Figuren.
- Alle Abschnitte spielen in derselben luxuriösen tropischen Dating-Show-Villa.
- Ein Fruchtkopf wird niemals durch einen menschlichen Kopf ersetzt.
- Keine Verschmelzung, Verdopplung oder spontane Verwandlung.
- Fruchtart, Kopfform, Gesicht, Augen, Körperbau, Outfit, Farben, Schuhe und Accessoires bleiben unverändert.
- Nutze maximal drei sichtbare Hauptfiguren pro Einstellung.
- Die ersten zwei Sekunden beginnen mitten im Skandal.
- Der zentrale Verrat oder Regelbruch wird als sichtbare Handlung gezeigt. Bei Fremdgehen sieht die betrogene Figur den Kuss, die vertraute Umarmung, das Händchenhalten oder das gemeinsame Verlassen eines Zimmers selbst.
- Ein Handy, Chat, Foto, Brief, Beleg oder Bildschirm darf nur ein zusätzliches Detail bestätigen und niemals der einzige oder primäre Beweis sein.
- Plane visuelle Kausalität: konkrete Handlung, direkte Entdeckung, unmittelbare Reaktion, Vorwurf, Antwort und Gegenenthüllung.
- opening.hook, opening.action und opening.veoPrompt müssen diese sichtbare Handlung oder Entdeckung konkret beschreiben.

INTERNE DRAMATURGIE EINES 15-SEKUNDEN-CLIPS

- 0–2 Sekunden: schockierender Cold Open.
- 2–5 Sekunden: weite Einstellung der konkreten Handlung oder Entdeckung.
- 5–9 Sekunden: beschuldigte Figur mit direkter Antwort.
- 9–12 Sekunden: Zeuge, Widerspruch oder Gegenreaktion.
- 12–15 Sekunden: neue sichtbare Enthüllung oder Sting.

${buildViralDialogueArc(
  targetDurationSeconds,
)}

DIALOGSTRUKTUR

- moviePlan.opening.dialogue.enabled ist true.
- opening.dialogue ist die erste Zeile.
- opening.dialogueTurns darf bis zu drei zusätzliche Sprecherwechsel enthalten.
- Jede Fortsetzung darf dialogue plus dialogueTurns verwenden.
- Jede ausgewählte Figur muss mindestens einmal sprechen.
- Jede einzelne Dialogzeile hat höchstens neun gut sprechbare Wörter.
- Nutze kurze deutsche Hauptsätze, Alltagswörter und ausgeschriebene Zahlen. Keine Abkürzungen, Ziffern, Hashtags, Schrägstriche oder künstlichen Wortzusammensetzungen.
- Jede Zeile hat genau eine Aufgabe: konkreter Vorwurf, direkte Antwort, überprüfbarer Widerspruch, Teilgeständnis, Entscheidung oder neue Enthüllung.
- Die beschuldigte Figur beantwortet die gestellte Frage tatsächlich. Ein Themenwechsel, eine allgemeine Empörung oder ein plötzliches neues Geheimnis ohne Verbindung ist verboten.
- Namen, Ort, Zeitpunkt und sichtbares Beweisstück bleiben über alle Abschnitte widerspruchsfrei. Pronomen wie „das“, „es“ oder „alles“ dürfen nie einen ungenannten Sachverhalt ersetzen.
- Figuren sprechen verschieden: Eine direkte Figur benennt den Vorwurf knapp, eine kontrollierte Figur antwortet präzise, eine ausweichende Figur nennt eine falsifizierbare Ausrede. Tausche niemals beliebige Standardsätze zwischen den Figuren aus.
- SCHLECHT: „Das ändert alles.“ – „Du verstehst das nicht.“ – „Warte ab.“
- GUT: „Ich sah euren Kuss am Pool.“ – „Ora küsste mich, ich wich sofort zurück.“ – „Nein, du trägst meinen Ring seit Montag.“
- Kein Erzähler.
- Kein Voice-over.
- Keine Offscreen-Sprache.
- Keine Untertitel.

EXAKTES JSON-DIALOGFORMAT

- opening.dialogue und jede continuation.dialogue sind Objekte mit exakt diesen Feldern: enabled, speaker, text, language, voiceDirection.
- opening.dialogueTurns und jede continuation.dialogueTurns sind eigenständige Arrays direkt neben dialogue, niemals innerhalb von dialogue.
- Jeder Eintrag in dialogueTurns nutzt ebenfalls enabled, speaker, text, language und voiceDirection.
- Nutze immer das Feld text, niemals line. Nutze voiceDirection, niemals deliveryStyle.
`
      : "";

  const extensionWindows =
    durationPlan
      .generationStrategy ===
      "extension-chain"
      ? Array.from(
          {
            length:
              durationPlan
                .extensionCount,
          },

          (_, index) => {
            const start =
              openingDurationSeconds +
              index *
                continuationDurationSeconds;

            const end =
              start +
              continuationDurationSeconds;

            return `${index + 1} = ${start}–${end}`;
          },
        ).join("\n")
      : "Keine detaillierten globalen Extensions in diesem Story-Architect-Schritt.";

  let absoluteChapterStart =
    0;

  const chapterDescription =
    durationPlan
      .chapterTargets
      .map(
        (
          chapterTarget,
          index,
        ) => {
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
    durationPlan
      .generationStrategy ===
      "single-shot"
      ? `
- Ziel des Produkts: exakt ${targetDurationSeconds} Sekunden.
- Erzeuge moviePlan.opening für genau diese ${openingDurationSeconds} Sekunden.
- moviePlan.continuations muss ein leeres Array sein.
- moviePlan.chapters wird für diese Länge nicht benötigt.
- Das Opening muss eine vollständige Mini-Geschichte liefern.
`
      : durationPlan
            .generationStrategy ===
          "extension-chain"
        ? `
- Gebuchte Ziellänge: exakt ${targetDurationSeconds} Sekunden.
- Das erste Seedance-Video dauert 15 Sekunden.
- Danach folgen exakt ${durationPlan.extensionCount} direkte Video-Fortsetzungen.
- Jede Fortsetzung erzeugt weitere 15 Sekunden.
- Generierte Roh-Länge: ${durationPlan.generatedDurationSeconds} Sekunden.
- moviePlan.continuations muss exakt ${durationPlan.extensionCount} Einträge enthalten.
- moviePlan.chapters ist für diese Länge nicht erforderlich.

Zeitbereiche der Fortsetzungen:
${extensionWindows}
`
        : `
- Gebuchte Ziellänge: ungefähr ${targetDurationSeconds} Sekunden.
- Diese Länge wird als mehrere Kapitel geplant.
- Ein Kapitel ist maximal 120 Sekunden lang.
- moviePlan.generationStrategy muss "chaptered" sein.
- moviePlan.continuations muss ein leeres Array sein.
- Erzeuge moviePlan.chapters mit exakt ${durationPlan.chapterTargets.length} Kapiteln.
- Die späteren 15-Sekunden-Fortsetzungen werden kapitelweise erzeugt.

Kapitelstruktur:
${chapterDescription}
`;

  const protectedOutputSecond =
    Math.min(
      durationPlan
        .generatedDurationSeconds,

      finalOutputSeconds +
        2,
    );

  const minimumFinalSecond =
    targetDurationSeconds === 8
      ? 7
      : 14;

  const finalStorySecond =
    Math.max(
      minimumFinalSecond,

      protectedOutputSecond -
        1,
    );

  const formatDirection =
    aspectRatio ===
    "16:9"
      ? `
BILDFORMAT: 16:9 KINO / WIDESCREEN

- Komponiere jede Einstellung nativ für 16:9.
- Nutze Bildtiefe, Vordergrund, Mittelgrund und Hintergrund.
- Nutze negative Fläche bewusst.
`
      : `
BILDFORMAT: 9:16 VERTIKAL

- Komponiere jede Einstellung nativ für 9:16.
- Hauptmotive müssen auf mobilen Displays klar lesbar bleiben.
`;

  const editingDirection =
    editingStyle ===
    "cinematic"
      ? `
SCHNITTSTIL: KINO / FILM

- Erzähle wie ein echter Kurzfilm.
- Nutze Establishing Shots, Medium Shots, Close-ups und Reaction Shots.
- Nutze Shot-Reverse-Shot bei Dialogen.
- Bewahre Blickachsen und Screen Direction.
- Schneide auf Handlung, Blick, Emotion und Bewegung.
`
      : editingStyle ===
          "music-video"
        ? `
SCHNITTSTIL: MUSIKVIDEO

- Plane wiedererkennbare Bildmotive.
- Übergänge und Bewegungen reagieren gezielt auf Takt, Akzente, Refrains, Drops, Bridge und Outro.
- Kombiniere Performance-, Narrative- und Atmosphären-Shots.
- Jeder 15-Sekunden-Abschnitt erhält mehrere klar geplante interne Einstellungen statt eines statischen Dauershots.
- Schnelle Songteile nutzen motivierte kurze Einstellungen; ruhige Teile längere Kamerabewegungen und emotionale Close-ups.
`
        : editingStyle ===
            "auto"
          ? `
SCHNITTSTIL: AUTO

- Wähle anhand von Genre, Story, Bildformat und Länge den passenden Stil.
- Bleibe danach konsistent.
`
          : `
SCHNITTSTIL: SOCIAL / REELS

- Starker Hook sehr früh.
- Schnelle visuelle Entwicklung.
- Häufige, aber motivierte Bildwechsel.
- Keine unnötigen Pausen.
`;

  const selectedAudioDirection =
    creationMode ===
    "viral-story"
      ? "POST-PRODUCED CHARACTER DIALOGUE: Plan exact short German lines and clear sentence-paced mouth, jaw, face and body performance for each visible assigned character. Seedance creates only restrained non-vocal ambience and music; fixed studio-quality German character voices are mixed scene-synchronously during finishing. No narrator, no voice-over, no off-screen speech and no subtitles."
      : activeMusicTrack
        ? "ORIGINAL UPLOADED SONG: Generate visuals with no audible dialogue, singing, narration or extra music. The complete customer song is added as the only final soundtrack during finishing. Plan visible performance and edit rhythm from the supplied musical analysis."
      : voiceMode ===
          "dialogue"
        ? "POST-PRODUCED MULTI-SPEAKER DIALOGUE: Plan exact short lines and visible sentence-paced speaking performances, but keep generated footage free of audible speech. Fixed voices are mixed later."
        : buildSelectedAudioDirection(
            audioStyle,
            voiceMode,
            spokenLanguage,
            voiceoverText,
            targetDurationSeconds,
          );

  const mandatoryDialogueSection =
    voiceMode ===
    "dialogue"
      ? `
VERBINDLICHER DIALOGMODUS – HÖCHSTE PRIORITÄT

- Das Video MUSS ein sichtbares Gespräch zwischen mindestens zwei benannten Personen sein.
- productionBible.characterBible muss alle Gesprächspartner enthalten.
- moviePlan.opening.dialogue.enabled muss true sein.
${
  targetDurationSeconds <= 15
    ? "- moviePlan.opening.dialogueTurns enthält die direkten Antworten."
    : "- Spätestens moviePlan.continuations[0] enthält eine direkte Antwort."
}
- Danach wechseln sich die Sprecher natürlich ab.
- Jeder Dialogtext umfasst höchstens zwölf Wörter.
- speaker enthält exakt den Namen der Figur.
- Kein Narrator.
- Kein Voice-over.
- Kein Off-screen speaker.
- Kein Monolog.
- Keine Untertitel.
`
      : "";

  return `
Du bist ein professioneller Viral Creative Director, Story Architect,
Character Director, Camera Director, Lighting Director, Performance Director,
Audio Director, Continuity Director und Video Prompt Director.

Du planst EIN zusammenhängendes professionelles Video-Projekt.

Die aktive Video-Pipeline verwendet Seedance 2.0 Fast.

Neue Zeitarchitektur:

15 Sekunden = 1 Clip
30 Sekunden = 2 Clips
60 Sekunden = 4 Clips
120 Sekunden = 8 Clips

${studioAdvertisementSection}

${viralStorySection}

${musicTrackSection}

AUSGEWÄHLTE VIDEO-LÄNGE

${targetDurationSeconds} Sekunden

AUSGEWÄHLTES FORMAT

${aspectRatio}

AUSGEWÄHLTER SCHNITTSTIL

${editingStyle}

AUSGEWÄHLTE KI-AUDIO-EINSTELLUNGEN

${selectedAudioDirection}

${mandatoryDialogueSection}

EXAKTER SPRECHERTEXT

${voiceoverText || "Kein separater Sprechertext angegeben."}

SCHLUSS-EINBLENDUNG

${closingText || "Keine separate Schluss-Einblendung angegeben."}

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

STORY-REGELN

- Beginne mit einem starken Einstieg.
- Die Handlung muss sich sichtbar weiterentwickeln.
- Vermeide Leerlauf und Wiederholung.
- Nutze Konflikt, Überraschung, Emotion oder Konsequenz.
- Das Projekt braucht einen klaren Höhepunkt.
- Der Payoff muss spätestens ungefähr bis Sekunde ${finalStorySecond} verständlich sein.

CHARACTER BIBLE

Jeder Charakter erhält eine feste Identität:
Gesicht, Haare, Augen, Körperbau, Kleidung, Accessoires,
Bewegungsstil und Stimme.

VISUAL BIBLE

Definiere einen konsistenten Filmlook, Farblook und Realismusgrad.

CAMERA BIBLE

Definiere Kamerasprache, Objektivcharakter, Komposition und Bewegung.

LIGHTING BIBLE

Definiere Lichtrichtung, Kontrast, Belichtung und Kontinuität.

PERFORMANCE BIBLE

Definiere natürlichen Schauspielstil, Mimik und Körpersprache.

AUDIO BIBLE

Definiere Dialogsprache, Stimmen, Ambience und Musik.

OPENING 0–${openingDurationSeconds}

moviePlan.opening beschreibt den ersten Provider-Clip vollständig.

veoPrompt bleibt nur aus Kompatibilitätsgründen der Feldname.

Der Prompt muss auf Englisch enthalten:
- aspect ratio ${aspectRatio}
- compose natively for ${aspectRatio}
- editing language ${editingStyle}
- exakt ${openingDurationSeconds} Sekunden
- Figuren
- Umgebung
- Kamera
- Licht
- Handlung
- natürliche Bewegung

FORTSETZUNGEN

Wenn generationStrategy = "extension-chain":

- Erzeuge exakt ${durationPlan.extensionCount} continuations.
- Jede durationSeconds = 15.
- continuationPrompt auf Englisch.
- Jede Fortsetzung ist eine direkte Weiterführung.
- Kein Neustart.
- Identität, Kleidung, Umgebung und Licht bleiben stabil.
- Jede Fortsetzung bringt die Story sichtbar voran.

Wenn generationStrategy = "single-shot":
- continuations = [].

Wenn generationStrategy = "chaptered":
- continuations = [].
- Plane die Kapitelstruktur.
- Detaillierte 15-Sekunden-Prompts werden später erzeugt.

KAPITEL

${chapterDescription}

KEINE:
- Identitätswechsel
- Gesichtswechsel
- unbegründeten Kleidungswechsel
- Teleportation
- neue Personen ohne Storygrund
- Kamerarezets
- Lichtresets

${visibleInterfaceRestriction}

QUALITÄTSKONTROLLE

- targetDurationSeconds = ${targetDurationSeconds}
- generatedDurationSeconds = ${durationPlan.generatedDurationSeconds}
- aspectRatio = "${aspectRatio}"
- editingStyle = "${editingStyle}"
- provider = "auto"
- generationStrategy = "${durationPlan.generationStrategy}"
- opening = 0–${openingDurationSeconds}
- opening.durationSeconds = ${openingDurationSeconds}
- continuations = ${durationPlan.extensionCount}
- jede neue continuation.durationSeconds = 15
- korrekte Zeitbereiche
- Hook innerhalb der ersten 2 Sekunden
- keine Story-Wiederholungen
- stabile Charaktere
- stabile Kamera und Beleuchtung

Gib ausschließlich gültiges JSON zurück.
`;
}

function createCompatibilityScenes(
  plan: MoviePlan,
): Scene[] {
  const beats = [
    {
      title:
        plan.opening.title,

      description:
        plan.opening.action,

      location:
        plan.opening.location,

      mood:
        plan.opening
          .emotionalBeat,

      keyAction:
        plan.opening.action,

      visualFocus:
        plan.opening.hook,

      dialogue:
        plan.opening.dialogue,

      prompt:
        plan.opening.veoPrompt,

      audio:
        plan.opening.audioPrompt,

      negative:
        plan.opening
          .negativePrompt,

      camera:
        plan.opening.cameraPlan,

      lighting:
        plan.opening
          .lightingPlan,

      characterState:
        plan.opening
          .characterState,

      environmentState:
        plan.opening
          .environmentState,

      durationSeconds:
        plan.opening
          .durationSeconds,
    },

    ...plan.continuations
      .slice(0, 5)
      .map(
        (item) => ({
          title:
            item.title,

          description:
            item
              .actionContinuation,

          location:
            plan.opening
              .location,

          mood:
            item
              .emotionalBeat,

          keyAction:
            item
              .actionContinuation,

          visualFocus:
            item.storyBeat,

          dialogue:
            item.dialogue,

          prompt:
            item
              .continuationPrompt,

          audio:
            item.audioPrompt ??
            "",

          negative:
            item
              .negativePrompt ??
            "",

          camera:
            item
              .cameraContinuation,

          lighting:
            item
              .lightingContinuation,

          characterState:
            item
              .characterContinuity,

          environmentState:
            item
              .environmentContinuity,

          durationSeconds:
            item
              .durationSeconds,
        }),
      ),
  ];

  return beats.map(
    (
      beat,
      index,
    ) => ({
      id:
        index + 1,

      title:
        beat.title,

      description:
        beat.description,

      location:
        beat.location,

      mood:
        beat.mood,

      keyAction:
        beat.keyAction,

      visualFocus:
        beat.visualFocus,

      startFrame:
        index === 0
          ? "Opening frame defined by the movie opening prompt."
          : "Direct continuation of the already existing video.",

      endingFrame:
        "Stable continuation-ready final frame.",

      characterStateAtStart:
        beat.characterState,

      characterStateAtEnd:
        beat.characterState,

      environmentStateAtStart:
        beat.environmentState,

      environmentStateAtEnd:
        beat.environmentState,

      cameraStateAtStart:
        beat.camera,

      cameraStateAtEnd:
        beat.camera,

      lightingState:
        beat.lighting,

      continuityNotes:
        "Preserve identity, wardrobe, environment, camera direction, lighting and audio continuity.",

      dialogue:
        beat.dialogue,

      durationSeconds:
        beat.durationSeconds,

      veoPrompt:
        beat.prompt,

      audioPrompt:
        beat.audio,

      negativePrompt:
        beat.negative,

      camera:
        beat.camera,

      lighting:
        beat.lighting,

      transition:
        "Continue seamlessly into the next part of the same movie.",

      style:
        "Use the fixed visual identity from the production bible.",
    }),
  );
}

export async function POST(
  request: Request,
) {
  const rateLimit =
    await checkRateLimit(
      request,
      "story-architect",
      12,
      60 * 60,
    );

  if (
    !rateLimit.allowed
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Zu viele Filmplan-Anfragen in kurzer Zeit. Bitte versuche es später erneut.",
      },

      {
        status:
          429,

        headers: {
          "Retry-After":
            String(
              rateLimit
                .retryAfterSeconds,
            ),
        },
      },
    );
  }

  const apiKey =
    process.env
      .GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
      },

      {
        status:
          500,
      },
    );
  }

  let body:
    StoryArchitectRequest;

  try {
    body =
      await request
        .json() as StoryArchitectRequest;
  } catch {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Der Request enthält kein gültiges JSON.",
      },

      {
        status:
          400,
      },
    );
  }

  if (
    !isStoryDraft(
      body.story,
    )
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Die übergebene Geschichte ist unvollständig oder ungültig.",
      },

      {
        status:
          400,
      },
    );
  }

  const story =
    body.story;

  const creationMode:
    VideoCreationMode =
    body.creationMode ===
    "viral-story"
      ? "viral-story"
      : "standard";

  const targetDurationSeconds =
    normalizeTargetDuration(
      body.targetDurationSeconds,
    );

  const aspectRatio =
    creationMode ===
    "viral-story"
      ? "9:16"
      : normalizeAspectRatio(
          body.aspectRatio,
        );

  const editingStyle =
    creationMode ===
    "viral-story"
      ? "social"
      : normalizeEditingStyle(
          body.editingStyle,
        );

  const audioStyle =
    normalizeVideoAudioStyle(
      body.audioStyle,
    );

  const voiceMode =
    creationMode ===
    "viral-story"
      ? "dialogue"
      : normalizeVideoVoiceMode(
          body.voiceMode,
        );

  const spokenLanguage =
    normalizeVideoSpokenLanguage(
      body.spokenLanguage,
    );

  const voiceoverText =
    typeof body.voiceoverText ===
      "string"
      ? body.voiceoverText
          .trim()
          .slice(
            0,
            4_000,
          )
      : "";

  const closingText =
    typeof body.closingText ===
      "string"
      ? body.closingText
          .trim()
          .slice(
            0,
            160,
          )
      : "";

  const musicTrack =
    isMusicVideoTrackContext(
      body.musicTrack,
    )
      ? body.musicTrack
      : undefined;

  const prompt =
    buildStoryPrompt(
      story,
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
    );

  try {
    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const expectedDialogueSpeakers =
      voiceMode ===
      "dialogue"
        ? story.characters
            .slice(0, 3)
            .map(
              (character) =>
                character.name,
            )
        : [];

    const generationResult =
      await generateStoryWithFallback(
        ai,
        prompt,

        voiceMode ===
          "dialogue"
          ? (
              candidate,
            ) => {
              const normalizedCandidate =
                normalizeArchitectResponse(
                  candidate,
                  story,
                  targetDurationSeconds,
                  aspectRatio,
                  editingStyle,
                  voiceMode,
                );

              const structurallyValid =
                validateArchitectResponse(
                  normalizedCandidate,
                );

              const dialogueValid =
                hasMandatoryDialoguePlan(
                  normalizedCandidate,
                  expectedDialogueSpeakers,
                  targetDurationSeconds,
                  creationMode,
                  story,
                );

              const visualPlanValid =
                creationMode !==
                  "viral-story" ||
                hasMandatoryViralVisualPlan(
                  normalizedCandidate,
                  story,
                );

              return (
                structurallyValid &&
                dialogueValid &&
                visualPlanValid
              );
            }
          : undefined,
        creationMode ===
          "viral-story"
          ? VIRAL_STORY_MODELS
          : STORY_MODELS,
      );

    const cleanedText =
      cleanJsonText(
        generationResult
          .rawText,
      );

    let parsed:
      unknown;

    try {
      parsed =
        JSON.parse(
          cleanedText,
        );
    } catch (
      parseError
    ) {
      console.error(
        "Ungültige Story-Architect-Antwort:",

        {
          model:
            generationResult
              .model,

          parseError,

          rawText:
            generationResult
              .rawText,
        },
      );

      return NextResponse.json(
        {
          success:
            false,

          error:
            "Der Story Architect hat ungültiges JSON erzeugt. Bitte versuche es erneut.",
        },

        {
          status:
            502,
        },
      );
    }

    const normalized =
      normalizeArchitectResponse(
        parsed,
        story,
        targetDurationSeconds,
        aspectRatio,
        editingStyle,
        voiceMode,
      );

    if (
      !validateArchitectResponse(
        normalized,
      )
    ) {
      console.error(
        "Normalisierter Story-Architect-Filmplan ist weiterhin ungültig:",

        {
          model:
            generationResult
              .model,

          parsed,
          normalized,
        },
      );

      return NextResponse.json(
        {
          success:
            false,

          error:
            "Der Story Architect konnte den Filmplan nicht zuverlässig normalisieren.",
        },

        {
          status:
            502,
        },
      );
    }

    if (
      voiceMode ===
        "dialogue" &&

      !hasMandatoryDialoguePlan(
        normalized,
        expectedDialogueSpeakers,
        targetDurationSeconds,
        creationMode,
        story,
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Der automatische Dialogplan war noch nicht vollständig. Bitte starte die Story-Erstellung erneut.",
        },

        {
          status:
            502,
        },
      );
    }

    if (
      creationMode ===
        "viral-story" &&
      !hasMandatoryViralVisualPlan(
        normalized,
        story,
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Die Story hat den zentralen Konflikt noch nicht eindeutig im Bild gezeigt. Bitte starte die automatische Planung erneut.",
        },

        {
          status:
            502,
        },
      );
    }

    const completeStory = {
      ...story,

      productionBible:
        normalized
          .productionBible,

      moviePlan:
        normalized
          .moviePlan,

      scenes:
        createCompatibilityScenes(
          normalized
            .moviePlan,
        ),

      generationModel:
        generationResult
          .model,

      creationMode,
    } as CompleteStoryResponse;

    return NextResponse.json(
      completeStory,
    );
  } catch (
    error:
      unknown
  ) {
    const details =
      getErrorDetails(
        error,
      );

    console.error(
      "Story-Architect-Fehler:",

      {
        details,
        error,
      },
    );

    if (
      isRetryableGeminiError(
        error,
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Die Gemini-Modelle sind momentan stark ausgelastet. Mehrere Modelle und automatische Wiederholungen wurden bereits versucht. Bitte probiere es in wenigen Augenblicken erneut.",
        },

        {
          status:
            503,
        },
      );
    }

    return NextResponse.json(
      {
        success:
          false,

        error:
          details.message,
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
