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
  DIALOGUE_WRITER_MODEL,
  generateStructuredDialoguePlan,
} from "@/lib/openai-dialogue";

import {
  STUDIO_BRAND_CONTEXT,
  buildStudioAdvertisementDirection,
  isStudioWebsiteAdvertisement,
} from "@/lib/studio-brand";

import {
  buildVideoDurationPlan,
} from "@/lib/veo";

import {
  ensureTimedInternalShotPlan,
} from "@/lib/video-shot-plan";

import type {
  MovieContinuation,
  MusicVideoTrackContext,
  MovieOpening,
  MoviePlan,
  ProductionBible,
  ProvidedDialogueLine,
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
export const maxDuration = 300;

const STORY_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

const VIRAL_STORY_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

const RETRIES_PER_MODEL = 1;
const INITIAL_RETRY_DELAY_MS = 1500;
const STORY_MODEL_TIMEOUT_MS = 20_000;

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
      ? story.characters.length ===
          1
        ? 1
        : 2
      : 1;

  const maximumCharacterCount =
    story.characters.length >
      0
      ? story.characters.length
      : 8;

  const characterCount =
    Math.max(
      fallbackCharacters.length,
      Math.min(
        rawCharacterBible.length,
        8,
        maximumCharacterCount,
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

function applyRequiredInternalShotPlans(
  response: ArchitectResponse,
  story: StoryDraft,
  editingStyle: VideoEditingStyle,
): ArchitectResponse {
  const intentText = [
    story.title,
    story.genre,
    story.mood,
    story.setting,
    story.summary,
  ]
    .filter(Boolean)
    .join("\n");

  const opening =
    response.moviePlan.opening;

  const plannedOpening: MovieOpening = {
    ...opening,
    veoPrompt:
      ensureTimedInternalShotPlan({
        prompt:
          opening.veoPrompt,
        durationSeconds:
          opening.durationSeconds,
        editingStyle,
        intentText,
        sectionLabel:
          "opening",
        narrativeCues: [
          opening.hook,
          opening.action,
          opening.storyBeat,
          opening.emotionalBeat,
          `Complete this beat in ${opening.location} with a clear visual payoff.`,
        ],
      }),
  };

  const plannedContinuations =
    response.moviePlan.continuations.map(
      (continuation) => ({
        ...continuation,
        continuationPrompt:
          ensureTimedInternalShotPlan({
            prompt:
              continuation.continuationPrompt,
            durationSeconds:
              continuation.durationSeconds,
            editingStyle,
            intentText,
            sectionLabel:
              `continuation ${continuation.extensionNumber}`,
            narrativeCues: [
              continuation.actionContinuation,
              continuation.storyBeat,
              continuation.escalationPurpose,
              continuation.emotionalBeat,
              "Finish on a visibly new story state that follows from this action.",
            ],
          }),
      }),
    );

  return {
    ...response,
    moviePlan: {
      ...response.moviePlan,
      opening:
        plannedOpening,
      continuations:
        plannedContinuations,
    },
  };
}

function isInfidelityStory(
  story: StoryDraft,
): boolean {
  return /fremdgeh|fremdgeher|affäre|seitensprung|untreu|betrug|betrüg|betrogen|geliebte|heimliche[rn]?\s+(?:flirt|beziehung)|cheat|infidel/i.test(
    [
      story.title,
      story.genre,
      story.summary,
    ].join(" "),
  );
}

function normalizeProvidedDialogueLines(
  story: StoryDraft,
  expectedSpeakers: readonly string[],
): ProvidedDialogueLine[] {
  if (
    !Array.isArray(
      story.providedDialogue,
    ) ||
    story.providedDialogue.length < 1
  ) {
    return [];
  }

  const normalizeSpeaker =
    (value: string) =>
      value
        .trim()
        .toLocaleLowerCase("de-DE")
        .replace(/[^a-z0-9äöüß]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

  const canonicalSpeakers =
    expectedSpeakers.map(
      (speaker) => ({
        speaker,
        fullKey:
          normalizeSpeaker(
            speaker,
          ),
        shortKey:
          normalizeSpeaker(
            speaker.split(",")[0],
          ),
      }),
    );

  const normalized =
    story.providedDialogue.flatMap(
      (line) => {
        if (
          typeof line !== "object" ||
          line === null ||
          typeof line.speaker !== "string" ||
          typeof line.text !== "string"
        ) {
          return [];
        }

        const speakerKey =
          normalizeSpeaker(
            line.speaker,
          );

        const canonical =
          canonicalSpeakers.find(
            ({
              fullKey,
              shortKey,
            }) =>
              speakerKey === fullKey ||
              speakerKey === shortKey,
          );

        const text =
          line.text.trim();

        if (
          !canonical ||
          !text ||
          text.length > 180
        ) {
          return [];
        }

        return [
          {
            speaker:
              canonical.speaker,
            text,
          },
        ];
      },
    );

  return new Set(
    normalized.map(
      (line) =>
        line.speaker,
    ),
  ).size >=
      (
        expectedSpeakers.length ===
          1
          ? 1
          : 2
      )
    ? normalized
    : [];
}

function extractSupportingEvidenceConcepts(
  text: string,
): Set<string> {
  const concepts =
    new Set<string>();

  const evidencePatterns: Array<[
    string,
    RegExp,
  ]> = [
    ["ring", /\b(?:ring|ringe)\b/i],
    ["armband", /\b(?:armband|armbänder)\b/i],
    ["kette", /\b(?:halskette|kette|ketten)\b/i],
    ["digital", /\b(?:handy|smartphone|chat|nachricht|sprachnachricht|foto|video)\b/i],
    ["reise", /\b(?:koffer|reiseset|ticket|flugticket|buchung|reservierung)\b/i],
    ["zugang", /\b(?:schlüssel|zimmerkarte|hotelkarte)\b/i],
    ["kleidung", /\b(?:hemd|lippenstift|parfüm)\b/i],
    ["dokument", /\b(?:brief|rechnung|quittung|beleg|vertrag)\b/i],
    ["schwangerschaft", /\b(?:ultraschall|schwanger|schwangerschaft|baby)\b/i],
  ];

  for (const [concept, pattern] of evidencePatterns) {
    if (pattern.test(text)) {
      concepts.add(concept);
    }
  }

  return concepts;
}

function hasFocusedInfidelityDialogue(
  dialogueLines: readonly string[],
): boolean {
  if (dialogueLines.length < 2) {
    return false;
  }

  const namesWitnessedBetrayal =
    /küss|kuss|umarm|händchen|hand in hand|eng umschlungen|streichel|zimmer.{0,20}(?:verlassen|gekommen)|erwischt|gesehen/i.test(
      dialogueLines[0],
    );

  const directlyAnswersBetrayal =
    /küss|kuss|umarm|berühr|händchen|stolper|rutsch|auffang|fing|wegzieh|fehler|geküsst|gelogen|stimmt|^\s*(?:ja|nein)\b/i.test(
      dialogueLines[1],
    );

  const evidenceConcepts =
    extractSupportingEvidenceConcepts(
      dialogueLines.join(" "),
    );

  const closingLines =
    dialogueLines
      .slice(-2)
      .join(" ");

  const hasPersonalConsequence =
    dialogueLines.length <= 3 ||
    /vorbei|schluss|trenn|beziehung.{0,18}(?:endet|beendet)|geh(?:e|st)?\b|verlass|auszieh|raus\b|koffer.{0,22}(?:tür|draußen)|verzeih|bleib(?:e|st)?\b|allein\b|chance\b|vertrauen.{0,15}(?:weg|zerstört)|entscheide/i.test(
      closingLines,
    );

  return (
    namesWitnessedBetrayal &&
    directlyAnswersBetrayal &&
    evidenceConcepts.size <= 1 &&
    hasPersonalConsequence
  );
}

function hasAmbiguousThirdPersonReference(
  text: string,
): boolean {
  return (
    /(?:^|[.!?]\s+)(?:er|sie)\b/i.test(
      text,
    ) ||
    /\b(?:ihn|ihm|ihnen|dessen|deren)\b/i.test(
      text,
    )
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

  const narrativeFactPlan = [
    opening.hook,
    opening.storyBeat,
    opening.action,
    ...response.moviePlan.continuations.flatMap(
      (continuation) => [
        continuation.storyBeat,
        continuation.actionContinuation,
      ],
    ),
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

    if (
      extractSupportingEvidenceConcepts(
        narrativeFactPlan,
      ).size > 1
    ) {
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
2. Fortsetzung 15–30: Die beschuldigte Figur beantwortet exakt den Vorwurf. Ort und Zeitpunkt bleiben unverändert; es beginnt kein zweiter Konflikt.
3. Fortsetzung 30–45: Die dritte Figur widerlegt genau diese Antwort mit einem bereits festgelegten Detail oder Teilgeständnis. Ein kurzer echter Gefühlsmoment zeigt, warum der Konflikt persönlich wichtig ist.
4. Fortsetzung 45–60: Eine konkrete Entscheidung hat eine sichtbare Konsequenz. Der letzte Satz verschärft dieselbe Entscheidung; er führt kein neues Beweisstück und keine neue Nebenhandlung ein.

Die Dialoge ergeben zusammen EIN verständliches Gespräch. Jede Zeile erfüllt genau eine Funktion: Vorwurf, Antwort, Widerspruch, Geständnis, Entscheidung oder Enthüllung. Keine Zeile darf aus einer anderen Geschichte stammen.`;
  }

  return `
VERBINDLICHER DIALOGBOGEN

- Plane ${dialogueBeatCount} aufeinander aufbauende 15-Sekunden-Storybeats für ${targetDurationSeconds} Sekunden.
- Beginne mit einem konkret benannten Skandal oder Beweis.
- Lass jede Antwort den unmittelbar vorherigen Vorwurf beantworten und eine neue Information ergänzen.
- Nutze dialogueTurns innerhalb eines 15-Sekunden-Clips, wenn mehrere Figuren unmittelbar reagieren müssen.
- Steigere denselben Konflikt über Antwort, Widerspruch und Konsequenz. Ein Cliffhanger muss aus dieser Konsequenz entstehen und darf keinen neuen Gegenstand einführen.
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

  enforceDialogueSemantics =
    true,
): boolean {
  const isViralDialogue =
    creationMode ===
    "viral-story";

  /*
   * Ein normaler Werbe- oder Presenter-Clip darf bewusst nur eine
   * sichtbare Sprecherfigur haben. Im Viral-Story-Modus bleibt ein
   * echtes Gespräch mit mindestens zwei Figuren verpflichtend.
   */
  const minimumSpeakerCount =
    isViralDialogue
      ? Math.min(
          3,
          Math.max(
            2,
            expectedSpeakers
              .length,
          ),
        )
      : Math.min(
          3,
          Math.max(
            1,
            expectedSpeakers
              .length,
          ),
        );

  if (
    response
      .productionBible
      .characterBible
      .length <
        minimumSpeakerCount ||
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
      : expectedSpeakers.length ===
          1
        ? Math.min(
            (
              1 +
              response
                .moviePlan
                .continuations
                .length
            ) * 4,
            Math.max(
              3,
              Math.ceil(
                targetDurationSeconds /
                  15,
              ) * 2,
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

  const expectedSpeakerNames =
    new Set(
      expectedSpeakers.map(
        (speaker) =>
          speaker
            .trim()
            .toLocaleLowerCase(
              "de-DE",
            ),
      ),
    );

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
      (
        expectedSpeakerNames.size >
          0 &&
        !expectedSpeakerNames.has(
          normalizedSpeaker,
        )
      ) ||
      forbiddenSpeaker.test(
        speaker,
      ) ||
      wordCount < 1 ||
      wordCount >
        maximumWordsPerLine ||
      /\d|[#@/\\]/.test(
        dialogue.text,
      ) ||
      (
        isViralDialogue &&
        /[A-ZÄÖÜ]{2,}/.test(
          dialogue.text,
        )
      ) ||
      dialogue.text.length >
        140 ||
      (
        enforceDialogueSemantics &&
        isViralDialogue &&
        hasAmbiguousThirdPersonReference(
          dialogue.text,
        )
      ) ||
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
      isVagueDramaLine(
        dialogue.text,
      ) ||
      (
        isViralDialogue &&
        consecutiveSpeakerLines >
          2
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
    totalWordCount >
      (
        !isViralDialogue &&
        expectedSpeakers.length ===
          1
          ? 30
          : 24
      )
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
    enforceDialogueSemantics &&
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
      !namesConcreteEvidence ||
      !hasFocusedInfidelityDialogue(
        enabledDialogue.map(
          (dialogue) =>
            dialogue.text,
        ),
      )
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
    ) ||
    message.includes(
      "timeout",
    ) ||
    message.includes(
      "timed out",
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
                httpOptions: {
                  timeout:
                    STORY_MODEL_TIMEOUT_MS,
                },

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

type TerraDialoguePurpose =
  | "discovery"
  | "accusation"
  | "answer"
  | "contradiction"
  | "admission"
  | "decision"
  | "consequence"
  | "cliffhanger";

type TerraDialogueFactKey =
  | "relationship"
  | "witnessedEvent"
  | "location"
  | "accusedResponse"
  | "contradiction"
  | "consequence"
  | "supportingEvidence";

const TERRA_DIALOGUE_PURPOSES =
  new Set<TerraDialoguePurpose>([
    "discovery",
    "accusation",
    "answer",
    "contradiction",
    "admission",
    "decision",
    "consequence",
    "cliffhanger",
  ]);

const TERRA_DIALOGUE_FACT_KEYS =
  new Set<TerraDialogueFactKey>([
    "relationship",
    "witnessedEvent",
    "location",
    "accusedResponse",
    "contradiction",
    "consequence",
    "supportingEvidence",
  ]);

type TerraDialogueContract = {
  relationship: string;
  witnessedEvent: string;
  location: string;
  accusedResponse: string;
  contradiction: string;
  consequence: string;
  supportingEvidence: string;
};

type TerraDialogueTurn = {
  speaker: string;
  text: string;
  voiceDirection: string;
  purpose: TerraDialoguePurpose;
  respondsToTurn: number;
  factKeys: TerraDialogueFactKey[];
};

type TerraDialoguePayload = {
  contract: TerraDialogueContract;
  turns: TerraDialogueTurn[];
};

function readTerraDialoguePayload(
  rawText: string,
  speakerNames: readonly string[],
  minimumTurns: number,
  maximumTurns: number,
): TerraDialoguePayload {
  const parsedResult =
    tryParseJson(
      rawText,
    );

  if (!parsedResult) {
    throw new Error(
      "GPT-5.6 Terra hat kein gültiges Dialog-JSON erzeugt.",
    );
  }

  const root =
    asRecord(
      parsedResult.parsed,
    );

  const contractRecord =
    asRecord(root.contract);

  const contract: TerraDialogueContract = {
    relationship:
      readString(contractRecord.relationship, ""),
    witnessedEvent:
      readString(contractRecord.witnessedEvent, ""),
    location:
      readString(contractRecord.location, ""),
    accusedResponse:
      readString(contractRecord.accusedResponse, ""),
    contradiction:
      readString(contractRecord.contradiction, ""),
    consequence:
      readString(contractRecord.consequence, ""),
    supportingEvidence:
      readString(contractRecord.supportingEvidence, ""),
  };

  const turns =
    Array.isArray(
      root.turns,
    )
      ? root.turns
          .map(
            (turn) => {
              const value =
                asRecord(
                  turn,
                );

              return {
                speaker:
                  readString(
                    value.speaker,
                    "",
                  ).trim(),
                text:
                  readString(
                    value.text,
                    "",
                  ).trim(),
                voiceDirection:
                  readString(
                    value.voiceDirection,
                    "",
                  ).trim(),
                purpose:
                  readString(
                    value.purpose,
                    "",
                  ) as TerraDialoguePurpose,
                respondsToTurn:
                  typeof value.respondsToTurn === "number" &&
                  Number.isInteger(value.respondsToTurn)
                    ? value.respondsToTurn
                    : -1,
                factKeys:
                  Array.isArray(value.factKeys)
                    ? value.factKeys.filter(
                        (factKey): factKey is TerraDialogueFactKey =>
                          typeof factKey === "string" &&
                          TERRA_DIALOGUE_FACT_KEYS.has(
                            factKey as TerraDialogueFactKey,
                          ),
                      )
                    : [],
              };
            },
          )
      : [];

  if (
    turns.length <
      minimumTurns ||
    turns.length >
      maximumTurns ||
    Object.values(contract).some(
      (value) => !value,
    ) ||
    turns.some(
      (turn, index) =>
        !speakerNames.includes(
          turn.speaker,
        ) ||
        !turn.text ||
        !turn.voiceDirection ||
        !TERRA_DIALOGUE_PURPOSES.has(
          turn.purpose,
        ) ||
        turn.respondsToTurn !== index ||
        turn.factKeys.length < 1 ||
        turn.factKeys.length > 2,
    )
  ) {
    throw new Error(
      "GPT-5.6 Terra hat die verbindliche Dialogstruktur nicht eingehalten.",
    );
  }

  return {
    contract,
    turns,
  };
}

function buildTerraDialoguePrompt(
  story: StoryDraft,
  response: ArchitectResponse,
  targetDurationSeconds: VideoDurationSeconds,
  creationMode: VideoCreationMode,
  spokenLanguage: VideoSpokenLanguage,
  speakerNames: readonly string[],
  minimumTurns: number,
  maximumTurns: number,
  correctionNotes: readonly string[] = [],
  previousDraft?: TerraDialoguePayload,
): string {
  const maximumWordsPerLine =
    creationMode ===
      "viral-story"
      ? 9
      : 12;

  const language =
    spokenLanguage ===
      "en"
      ? "English"
      : "natürliches gesprochenes Deutsch";

  const visualBeats = [
    {
      seconds:
        `0–${response.moviePlan.opening.endSecond}`,
      action:
        response.moviePlan.opening.action,
      hook:
        response.moviePlan.opening.hook,
    },
    ...response.moviePlan.continuations.map(
      (continuation) => ({
        seconds:
          `${continuation.startSecond}–${continuation.endSecond}`,
        action:
          continuation.actionContinuation,
        hook:
          continuation.storyBeat,
      }),
    ),
  ];

  const correctionSection =
    correctionNotes.length > 0
      ? `
VORHERIGER ENTWURF WURDE ABGELEHNT

Fehler:
${correctionNotes.map((note) => `- ${note}`).join("\n")}

Ersetze den vorherigen Entwurf vollständig. Übernimm keine problematische Zeile und keinen zusätzlichen Gegenstand daraus.

Abgelehnter Entwurf:
${JSON.stringify(previousDraft)}
`
      : "";
const viralNaturalnessSection =
  creationMode ===
    "viral-story"
    ? `
NATÜRLICHKEITS-GATE FÜR FRUIT STORIES

- Schreibe das Gespräch für die Figuren, niemals für den Zuschauer.
- Keine Figur erklärt Informationen, die beide Gesprächspartner bereits kennen.
- Jede Zeile reagiert unmittelbar auf die vorige Handlung oder Aussage.
- Bevorzuge kurze Alltagssprache, Satzfragmente und spontane Reaktionen.
- Natürliches Deutsch darf Verkürzungen wie „hab“, „glaub“, „komm“ oder „lass“ verwenden.
- Nicht jede Antwort muss ein vollständiger grammatischer Satz sein.
- contract, factKeys und purpose sind nur interne Planungsdaten und dürfen niemals hörbar werden.
- Vermeide künstliche Wörter wie „Konsequenz“, „Fakten“, „Tatsachen“, „Beweisstück“, „nachvollziehbar“ und „endgültige Entscheidung“.
- Kein Erzählertext, keine Therapiesprache und keine Zusammenfassung der Handlung.
- Figuren dürfen widersprechen, stocken, ausweichen oder emotional reagieren.
- Wenn eine Zeile auch von jeder anderen Figur gesprochen werden könnte, schreibe sie neu.
- Namen nur verwenden, wenn es wirklich nötig ist.
- Höchstens eine neue Information pro Zeile.
- Beim lauten Vorlesen muss es wie ein echtes Gespräch klingen.
`
    : "";
  const isSingleSpeakerSpokesperson =
    creationMode ===
      "standard" &&
    speakerNames.length ===
      1;

  if (
    isSingleSpeakerSpokesperson
  ) {
    return `
Schreibe den endgültigen Monolog für ein ${targetDurationSeconds}-Sekunden-Video mit genau einer sichtbaren Sprecherfigur.

SPRECHERFIGUR
${speakerNames[0]}

SPRACHE
${language}

${viralNaturalnessSection}

VERBINDLICHE AUFGABE

- Erzeuge zwischen ${minimumTurns} und ${maximumTurns} kurzen Monologzeilen in genauer zeitlicher Reihenfolge.
- speaker ist in jeder Zeile exakt "${speakerNames[0]}".
- Eine Zeile hat höchstens ${maximumWordsPerLine} kurze, gut aussprechbare Wörter.
- Bei fünfzehn Sekunden haben alle Zeilen zusammen höchstens dreißig Wörter.
- Die erste Zeile ist ein glaubwürdiger Hook und verwendet purpose "discovery".
- Die mittlere Zeile erklärt einen konkreten Nutzen und verwendet purpose "answer".
- Die letzte Zeile endet natürlich mit Vorteil oder Handlungsaufforderung und verwendet purpose "consequence".
- Schreibe wie eine echte deutsche Influencerin oder ein echter Presenter vor der Kamera: direkt, lebendig, konkret und ohne Werbeagentur-Floskeln.
- Keine zweite Figur, kein Streit, kein Interview, keine Frage an eine unsichtbare Person, kein Erzähler und keine Offscreen-Stimme.
- Keine Begrüßung, keine Hashtags, keine Ziffern, keine Schrägstriche und keine Untertitel.
- Verwende ausschließlich belegbare Funktionen aus der STORY und dem sichtbaren Filmplan. Erfinde keine Funktionen, Preise oder Versprechen.
- respondsToTurn ist in der ersten Zeile null. Danach entspricht der Wert der unmittelbar vorherigen einbasierten Zeilennummer.
- voiceDirection beschreibt jeweils kurz Mimik, Energie und natürliche Sprechhaltung.
- Fülle alle contract-Felder. Verwende sie dafür so: relationship = Beziehung zur Zielgruppe; witnessedEvent = Problem oder Hook; location = sichtbarer Drehort; accusedResponse = Produktlösung; contradiction = zu vermeidendes Missverständnis oder "keines"; consequence = konkreter Nutzen oder Handlungsaufforderung; supportingEvidence = sichtbare Funktion oder "keines".
- factKeys enthält pro Zeile eine oder zwei tatsächlich verwendete contract-Fakten.

${correctionSection}

STORY
${JSON.stringify({
  title: story.title,
  genre: story.genre,
  mood: story.mood,
  setting: story.setting,
  summary: story.summary,
  characters:
    story.characters.map(
      (character) => ({
        name:
          character.name,
        description:
          character.description,
      }),
    ),
})}

SICHTBARER FILMPLAN ALS INSZENIERUNGSHILFE
${JSON.stringify(visualBeats)}
`;
  }

  return `
Schreibe den endgültigen Dialog für ein ${targetDurationSeconds}-Sekunden-Video.

GESCHLOSSENE BESETZUNG
${speakerNames.join(", ")}

SPRACHE
${language}

VERBINDLICHE AUFGABE

- Erzeuge zwischen ${minimumTurns} und ${maximumTurns} Dialogzeilen in genauer zeitlicher Reihenfolge.
- Jede genannte Figur spricht mindestens einmal.
- Eine Zeile hat höchstens ${maximumWordsPerLine} kurze, gut aussprechbare Wörter.
- Bei fünfzehn Sekunden dürfen alle Zeilen zusammen höchstens vierundzwanzig Wörter haben.
- Fülle zuerst contract aus. Er ist die einzige Wahrheit des Gesprächs und bleibt danach unverändert.
- contract.witnessedEvent enthält genau eine sichtbare auslösende Handlung. contract.supportingEvidence enthält höchstens ein zusätzliches Beweisstück oder ausdrücklich „keines“.
- Die erste Zeile ist Entdeckung oder Vorwurf und nutzt witnessedEvent. Die zweite Zeile ist eine direkte Antwort auf genau diesen Vorwurf und nutzt accusedResponse.
- Die zweite Zeile wiederholt die zentrale Handlung ausdrücklich als Nomen oder Verb. „Das war nur ein Moment“, „Es war anders“ oder ähnliche Ausweichsätze gelten nicht als Antwort.
- respondsToTurn ist in der ersten Zeile null. Danach verweist es immer auf die unmittelbar vorherige einbasierte Zeilennummer: zweite Zeile eins, dritte Zeile zwei und so weiter.
- factKeys nennt pro Zeile nur die ein oder zwei contract-Fakten, die der hörbare Satz tatsächlich verwendet.
- Jede Antwort reagiert direkt auf die vorige Zeile und ergänzt eine neue konkrete Information.
- Verwende konkrete Handlungen, Orte, Zeitpunkte oder sichtbare Beweise statt allgemeiner Dramawörter.
- Bei drei Figuren sind „er“, „sie“, „ihn“, „ihm“ und „ihr“ als unklare Verweise verboten. Verwende den Namen, „ich“, „du“, „mich“, „dich“, „wir“ oder „euch“ und nenne die konkrete Handlung.
- Ein Vorwurf wird beantwortet. Keine Themenwechsel, keine losen Geheimnisse und keine austauschbaren Standardsätze.
- Schreibe wie tatsächlich gesprochene deutsche Reality-TV-Sprache: kurze Hauptsätze oder Satzfragmente, spontane Reaktionen und klare Unterbrechungen statt höflicher Erklärprosa.
- Nutze im gesprochenen Deutsch Präsens oder Perfekt. Literarisches Präteritum wie „du küsstest“, „ich küsste“ oder „Ora küsste mich“ ist verboten.
- Nach der klaren Benennung darf „Kuss“ oder „küssen“ nicht in fast jeder Zeile wiederholt werden. Sprich danach natürlich über Absicht, Lüge, Vertrauen und die persönliche Entscheidung.
- Formulierungen wie „Der Kuss beendet uns“, „wegen des Kusses?“ oder „Ich gehe wegen des Kusses“ klingen künstlich und sind verboten. Die Schlussreaktion muss wie ein echter Satz über Vertrauen, Trennung oder eine letzte Chance klingen.
- Jede Figur besitzt einen eigenen Wortschatz und eine eigene Haltung. Wenn zwei Sprecher ihre Zeilen tauschen könnten, schreibe beide Zeilen neu.
- Mindestens eine Zeile muss kurz, eigenständig verständlich und zitierfähig sein, ohne wie ein Werbespruch zu klingen.
- Keine Begrüßungen, Zusammenfassungen, Moderation, Therapiesprache oder Kundendienstformulierungen.
- Bei Untreue wird die verbotene Handlung selbst sichtbar entdeckt; ein Handy oder Beleg ist nur eine zusätzliche Bestätigung.
- Bei Untreue bleibt der Dialog bei diesem einen beobachteten Verrat. Kuss, Armband, Ring, Reiseset und Hemd als Kette verschiedener Enthüllungen sind ausdrücklich verboten.
- Nach der direkten Antwort folgt höchstens ein Widerspruch oder Teilgeständnis. Die letzten beiden Zeilen führen zu einer persönlichen Entscheidung oder Konsequenz aus demselben Konflikt.
- Ein Cliffhanger entsteht aus einer bereits genannten Entscheidung oder Lüge. Er führt keinen neuen Gegenstand, keine neue Beziehung und keinen neuen Ort ein.
- Keine Ziffern, Abkürzungen, Hashtags, Schrägstriche, Untertitel, Erzähler oder Offscreen-Sprache.
- speaker ist exakt einer der vorgegebenen Namen.
- voiceDirection beschreibt knapp die konkrete Sprechhaltung und Emotion.
- Erfinde keine Tatsachen, die der Story oder den sichtbaren Szenen widersprechen.

${correctionSection}

STORY
${JSON.stringify({
  title: story.title,
  genre: story.genre,
  mood: story.mood,
  setting: story.setting,
  summary: story.summary,
  characters:
    story.characters.map(
      (character) => ({
        name:
          character.name,
        description:
          character.description,
      }),
    ),
})}

SICHTBARER FILMPLAN ALS REINE INSZENIERUNGSHILFE
${JSON.stringify(visualBeats)}

Falls der sichtbare Filmplan mehrere widersprüchliche Requisiten oder Nebenhandlungen enthält, ignoriere diese. Die STORY und dein unveränderlicher contract haben für den Dialog Vorrang.
`;
}

function getViralDialogueNaturalnessIssues(
  turns: readonly TerraDialogueTurn[],
): string[] {
  const issues: string[] = [];

  const lines =
    turns
      .map(
        (turn) =>
          turn.text.trim(),
      )
      .filter(Boolean);

  const artificialPatterns: Array<{
    pattern: RegExp;
    message: string;
  }> = [
    {
      pattern:
        /\b(?:diese|die|unsere|meine) konsequenz(?:en)?\b/i,
      message:
        "Verwende im gesprochenen Dialog nicht das abstrakte Wort Konsequenz. Die Figur soll konkret sagen, was sie jetzt tut oder fühlt.",
    },
    {
      pattern:
        /\b(?:dieses|unser) gespräch (?:zeigt|bestätigt|beweist|klärt|beendet)\b/i,
      message:
        "Eine Figur darf das Gespräch nicht wie ein Erzähler kommentieren.",
    },
    {
      pattern:
        /\bich akzeptiere (?:deine|diese|die) entscheidung\b/i,
      message:
        "„Ich akzeptiere deine Entscheidung“ klingt zu geschrieben. Reagiere emotional und konkret.",
    },
    {
      pattern:
        /\b(?:dieser|der) verrat verändert (?:unsere|die) beziehung\b/i,
      message:
        "Die Beziehung darf nicht in abstrakter Drehbuchsprache erklärt werden.",
    },
    {
      pattern:
        /\bich schütze (?:ab jetzt )?meine (?:eigene )?würde\b/i,
      message:
        "Vermeide therapeutische oder künstlich bedeutungsschwere Sprache.",
    },
    {
      pattern:
        /\bjetzt muss .{0,35} sichtbar werden\b/i,
      message:
        "Figuren dürfen keine filmische Regie- oder Storysprache sprechen.",
    },
    {
      pattern:
        /\bwir haben (?:alle|die) (?:notwendigen |wichtigen )?(?:fakten|punkte)\b/i,
      message:
        "Figuren dürfen das Geschehen nicht für den Zuschauer zusammenfassen.",
    },
    {
      pattern:
        /\b(?:damit|dadurch) (?:steht|ist) .{0,25} (?:fest|klar)\b/i,
      message:
        "Vermeide erklärende Schlussfolgerungssprache. Lass die Figur unmittelbar reagieren.",
    },
    {
      pattern:
        /\b(?:diese|die) entscheidung (?:beendet|verändert|bestätigt)\b/i,
      message:
        "Die Entscheidung soll ausgesprochen werden, nicht abstrakt beschrieben werden.",
    },
    {
      pattern:
        /\b(?:ich|wir) übernehme[n]? verantwortung für (?:meinen|unseren) anteil\b/i,
      message:
        "Vermeide Coaching-, Therapie- und Managementsprache.",
    },
  ];

  for (const line of lines) {
    for (
      const rule
      of artificialPatterns
    ) {
      if (
        rule.pattern.test(
          line,
        )
      ) {
        issues.push(
          `${rule.message} Problemzeile: "${line}"`,
        );

        break;
      }
    }
  }

  /*
   * Zu viel abstraktes Vokabular ist ein typisches
   * Merkmal künstlicher KI-Dialoge.
   */
  const abstractVocabulary =
    /\b(?:konsequenz|tatsachen?|fakten?|beweisstücke?|nachvollziehbar|vollständig|eindeutig|endgültige entscheidung)\b/i;

  const abstractLineCount =
    lines.filter(
      (line) =>
        abstractVocabulary.test(
          line,
        ),
    ).length;

  if (
    lines.length >= 4 &&
    abstractLineCount >= 2
  ) {
    issues.push(
      "Zu viele Zeilen klingen abstrakt oder erklärend. Schreibe konkrete Alltagssprache, Reaktionen und Handlungen.",
    );
  }

  /*
   * Menschen sprechen sich in einem kurzen Streit
   * nicht in fast jeder Zeile mit Namen an.
   */
  const speakerNames = [
    ...new Set(
      turns
        .map(
          (turn) =>
            turn.speaker
              .split(",")[0]
              .trim()
              .toLocaleLowerCase(
                "de-DE",
              ),
        )
        .filter(
          (name) =>
            name.length >= 3,
        ),
    ),
  ];

  const linesUsingNames =
    lines.filter(
      (line) => {
        const normalized =
          line.toLocaleLowerCase(
            "de-DE",
          );

        return speakerNames.some(
          (name) =>
            normalized.includes(
              name,
            ),
        );
      },
    ).length;

  if (
    lines.length >= 5 &&
    linesUsingNames >
      Math.ceil(
        lines.length * 0.6,
      )
  ) {
    issues.push(
      "Die Figuren nennen sich zu oft gegenseitig beim Namen. Verwende Namen nur, wenn die Emotion oder Verständlichkeit es wirklich verlangt.",
    );
  }

  return [
    ...new Set(
      issues,
    ),
  ];
}

function getTerraDialogueQualityIssues(
  payload: TerraDialoguePayload,
  story: StoryDraft,
  creationMode: VideoCreationMode,
): string[] {
  const issues: string[] = [];
  const { contract, turns } = payload;

  if (creationMode === "viral-story") {
        issues.push(
      ...getViralDialogueNaturalnessIssues(
        turns,
      ),
    );
    if (
      turns.some((turn) =>
        hasAmbiguousThirdPersonReference(
          turn.text,
        ),
      )
    ) {
      issues.push(
        "Der Dialog enthält bei drei Figuren unklare Pronomen. Nenne stattdessen den Namen oder die konkrete Handlung.",
      );
    }

    if (
      turns[0]?.purpose !== "discovery" &&
      turns[0]?.purpose !== "accusation"
    ) {
      issues.push(
        "Die erste Zeile muss die sichtbare Entdeckung oder den konkreten Vorwurf enthalten.",
      );
    }

    if (turns[1]?.purpose !== "answer") {
      issues.push(
        "Die zweite Zeile muss den ersten Vorwurf direkt beantworten.",
      );
    }

    if (
      !turns[0]?.factKeys.includes("witnessedEvent")
    ) {
      issues.push(
        "Die erste Zeile muss ausdrücklich auf witnessedEvent beruhen.",
      );
    }

    if (
      !turns[1]?.factKeys.includes("accusedResponse")
    ) {
      issues.push(
        "Die direkte Antwort muss ausdrücklich accusedResponse verwenden.",
      );
    }

    const closingTurns =
      turns.slice(-2);

    if (
      turns.length > 3 &&
      !closingTurns.some(
        (turn) =>
          turn.purpose === "decision" ||
          turn.purpose === "consequence" ||
          turn.factKeys.includes("consequence"),
      )
    ) {
      issues.push(
        "Die letzten beiden Zeilen benötigen eine persönliche Entscheidung oder Konsequenz.",
      );
    }

    for (
      let index = 1;
      index < turns.length;
      index += 1
    ) {
      if (
        turns[index].speaker ===
        turns[index - 1].speaker
      ) {
        issues.push(
          "Die Sprecher müssen sich ohne zwei direkt aufeinanderfolgende Zeilen derselben Figur abwechseln.",
        );
        break;
      }
    }
  }

  if (isInfidelityStory(story)) {
    const witnessedEventIsConcrete =
      /küss|kuss|umarm|händchen|hand in hand|eng umschlungen|streichel|zimmer.{0,20}(?:verlassen|gekommen)|erwischt/i.test(
        contract.witnessedEvent,
      );

    if (!witnessedEventIsConcrete) {
      issues.push(
        "witnessedEvent muss die tatsächlich beobachtete intime Handlung konkret benennen.",
      );
    }

    const contractAndDialogue = [
      ...Object.values(contract),
      ...turns.map((turn) => turn.text),
    ].join(" ");

    if (
      extractSupportingEvidenceConcepts(
        contractAndDialogue,
      ).size > 1
    ) {
      issues.push(
        "Der Dialog springt zwischen mehreren Beweisstücken. Erlaubt ist höchstens ein einziges zusätzliches Beweisstück.",
      );
    }

    if (
      !hasFocusedInfidelityDialogue(
        turns.map((turn) => turn.text),
      )
    ) {
      issues.push(
        "Die Untreue-Dialogfolge benötigt beobachtete Handlung, direkte Antwort und eine klare persönliche Konsequenz ohne Themenwechsel.",
      );
    }

    const dialogueLines =
      turns.map(
        (turn) =>
          turn.text,
      );

    const unnaturalSpokenGerman =
      dialogueLines.some(
        (line) =>
          /\b(?:ich|du|er|sie|wir|ihr)\s+küsste(?:st|n|t)?\b|\b(?:der|dieser)\s+kuss\s+beendet\s+(?:uns|euch|die beziehung)\b|\bwegen des kusses\??\s*$|\bich gehe wegen des kusses\b/i.test(
            line,
          ),
      );

    if (unnaturalSpokenGerman) {
      issues.push(
        "Der Dialog enthält steifes oder künstliches Deutsch. Nutze natürliches Präsens oder Perfekt und formuliere die Beziehungskonsequenz wie ein echtes Gespräch.",
      );
    }

    const betrayalRepetitionCount =
      dialogueLines.filter(
        (line) =>
          /küss|kuss/i.test(
            line,
          ),
      ).length;

    if (
      dialogueLines.length >= 5 &&
      betrayalRepetitionCount >
        Math.ceil(
          dialogueLines.length *
            0.67,
        )
    ) {
      issues.push(
        "Kuss oder küssen wird zu oft mechanisch wiederholt. Wechsle nach der direkten Antwort zu Absicht, Lüge, Vertrauen und Konsequenz.",
      );
    }

    const naturalClosing =
      dialogueLines
        .slice(-2)
        .join(" ");

    if (
      dialogueLines.length > 3 &&
      !/beziehung|vertrau|lüg|belog|schluss|vorbei|trenn|verlass|chance/i.test(
        naturalClosing,
      )
    ) {
      issues.push(
        "Die letzten beiden Zeilen brauchen eine natürlich ausgesprochene Reaktion über Vertrauen, Trennung oder eine letzte Chance.",
      );
    }
  }

  return [
    ...new Set(issues),
  ];
}

function applyTerraDialogueTurns(
  response: ArchitectResponse,
  turns: readonly TerraDialogueTurn[],
  spokenLanguage: VideoSpokenLanguage,
): ArchitectResponse {
  const beatCount =
    1 +
    response.moviePlan.continuations.length;

  const chunks:
    TerraDialogueTurn[][] = [];

  let cursor =
    0;

  for (
    let index = 0;
    index < beatCount;
    index += 1
  ) {
    const remainingTurns =
      turns.length -
      cursor;

    const remainingBeats =
      beatCount -
      index;

    const take =
      Math.min(
        4,
        Math.max(
          1,
          Math.ceil(
            remainingTurns /
              remainingBeats,
          ),
        ),
      );

    chunks.push(
      turns.slice(
        cursor,
        cursor + take,
      ) as TerraDialogueTurn[],
    );

    cursor +=
      take;
  }

  const dialogueLanguage =
    spokenLanguage ===
      "en"
      ? "English"
      : "German";

  const toDialogue =
    (
      turn:
        TerraDialogueTurn,
    ): SceneDialogue => ({
      enabled: true,
      speaker:
        turn.speaker,
      text:
        turn.text,
      language:
        dialogueLanguage,
      voiceDirection:
        turn.voiceDirection,
    });

  const openingTurns =
    chunks[0];

  const opening = {
    ...response.moviePlan.opening,
    dialogue:
      toDialogue(
        openingTurns[0],
      ),
    dialogueTurns:
      openingTurns
        .slice(1)
        .map(
          toDialogue,
        ),
  };

  const continuations =
    response.moviePlan.continuations.map(
      (
        continuation,
        index,
      ) => {
        const beatTurns =
          chunks[
            index + 1
          ];

        return {
          ...continuation,
          dialogue:
            toDialogue(
              beatTurns[0],
            ),
          dialogueTurns:
            beatTurns
              .slice(1)
              .map(
                toDialogue,
              ),
        };
      },
    );

  return {
    ...response,
    moviePlan: {
      ...response.moviePlan,
      opening,
      continuations,
    },
  };
}

function applyProvidedDialogueLines(
  response: ArchitectResponse,
  lines: readonly ProvidedDialogueLine[],
  spokenLanguage: VideoSpokenLanguage,
): ArchitectResponse {
  const beatCount =
    1 +
    response.moviePlan.continuations.length;

  const chunks =
    Array.from(
      {
        length:
          beatCount,
      },
      () => [] as ProvidedDialogueLine[],
    );

  lines.forEach(
    (line, index) => {
      const beatIndex =
        Math.min(
          beatCount - 1,
          Math.floor(
            index *
              beatCount /
              lines.length,
          ),
        );

      chunks[beatIndex].push(
        line,
      );
    },
  );

  const dialogueLanguage =
    spokenLanguage === "en"
      ? "English"
      : "German";

  const toDialogue =
    (
      line: ProvidedDialogueLine,
    ): SceneDialogue => ({
      enabled: true,
      speaker:
        line.speaker,
      text:
        line.text,
      language:
        dialogueLanguage,
      voiceDirection:
        "Natural, character-specific delivery matching the exact supplied words.",
    });

  const disabledDialogue:
    SceneDialogue = {
      enabled: false,
      speaker: "",
      text: "",
      language:
        dialogueLanguage,
      voiceDirection: "",
    };

  const openingLines =
    chunks[0];

  const opening = {
    ...response.moviePlan.opening,
    dialogue:
      openingLines[0]
        ? toDialogue(
            openingLines[0],
          )
        : disabledDialogue,
    dialogueTurns:
      openingLines
        .slice(1)
        .map(
          toDialogue,
        ),
  };

  const continuations =
    response.moviePlan.continuations.map(
      (
        continuation,
        index,
      ) => {
        const beatLines =
          chunks[index + 1];

        return {
          ...continuation,
          dialogue:
            beatLines[0]
              ? toDialogue(
                  beatLines[0],
                )
              : disabledDialogue,
          dialogueTurns:
            beatLines
              .slice(1)
              .map(
                toDialogue,
              ),
        };
      },
    );

  return {
    ...response,
    moviePlan: {
      ...response.moviePlan,
      opening,
      continuations,
    },
  };
}

function applyStudioSpokespersonFallback(
  response: ArchitectResponse,
  speaker: string,
  spokenLanguage: VideoSpokenLanguage,
  targetDurationSeconds: VideoDurationSeconds,
): ArchitectResponse {
  const beatCount =
    1 +
    response.moviePlan.continuations.length;

  const requiredLineCount =
    targetDurationSeconds <= 8
      ? 3
      : Math.min(
          beatCount * 4,
          Math.max(
            3,
            beatCount * 3,
          ),
        );

  const lines =
    targetDurationSeconds <= 8
      ? [
          "Deine Idee wird sichtbar.",
          "Plane sie mit KI.",
          "Starte mit der Vorschau.",
        ]
      : [
          "Deine Idee verdient mehr als einen gewöhnlichen Entwurf.",
          "KI Video Studio entwickelt daraus einen klaren Filmplan.",
          "Du erstellst Videos, Songs und Bilder an einem Ort.",
          "Vor der Produktion prüfst du zuerst den geplanten Look.",
          "So siehst du früh, ob Stil und Figuren passen.",
          "Danach wählst du das Videomodell passend zu deinem Budget.",
          "Feste Charaktere bleiben über mehrere Szenen klar erkennbar.",
          "Dialoge werden passend zur Handlung und Sprache vorbereitet.",
          "Im Video Studio kannst du einzelne Szenen gezielt erneuern.",
          "Dabei bleibt dein übriges Projekt vollständig erhalten.",
          "Im Sound Studio bearbeitest du Songs und eigene Audiodateien.",
          "Du kannst ausgewählte Stellen mit KI neu gestalten.",
          "Deine bisherigen Projekte findest du gesammelt in deinem Konto.",
          "So behältst du jederzeit den Überblick über deine Inhalte.",
          "Starte mit deiner Idee und prüfe zuerst die Vorschau.",
          "KI Video Studio begleitet dich bis zum fertigen Projekt.",
          "Wähle Hochformat für Reels oder Breitbild für längere Projekte.",
          "Musik, Stimmen und Atmosphäre werden passend zum Video geplant.",
          "Eigene Bilder helfen dir, den gewünschten Look festzulegen.",
          "Auch fertige Songs lassen sich als Musikvideo inszenieren.",
          "Jede Szene folgt einem zusammenhängenden visuellen Konzept.",
          "Nach der Erstellung bearbeitest du dein Projekt im Studio.",
          "So entstehen Inhalte, die zu deiner Idee passen.",
          "Öffne KI Video Studio und beginne dein nächstes Projekt.",
        ];

  return applyProvidedDialogueLines(
    response,
    lines
      .slice(
        0,
        requiredLineCount,
      )
      .map(
        (text) => ({
          speaker,
          text,
        }),
      ),
    spokenLanguage,
  );
}

function applySingleSpeakerFallback(
  response: ArchitectResponse,
  story: StoryDraft,
  speaker: string,
  spokenLanguage: VideoSpokenLanguage,
  targetDurationSeconds: VideoDurationSeconds,
): ArchitectResponse {
  const beatCount =
    1 +
    response.moviePlan.continuations.length;

  const requiredLineCount =
    targetDurationSeconds <= 8
      ? 3
      : Math.min(
          beatCount * 4,
          Math.max(
            3,
            beatCount * 3,
          ),
        );

  const topic =
    story.title
      .replace(/[\d#@/\\]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 7)
      .join(" ") ||
    "meine heutige Geschichte";

  const lines =
    targetDurationSeconds <= 8
      ? [
          "Das ist meine Geschichte.",
          "Jetzt zeige ich warum.",
          "Danach entscheide ich selbst.",
        ]
      : [
          `Heute geht es um ${topic}.`,
          "Ich zeige dir zuerst den entscheidenden Moment.",
          "Danach erkläre ich, was diese Situation für mich bedeutet.",
          "Am Ende treffe ich meine Entscheidung ganz bewusst.",
          "Jeder Schritt bleibt dabei klar und nachvollziehbar.",
          "Du siehst meine Reaktion direkt vor der Kamera.",
          "Ich verschweige keinen wichtigen Teil dieser Geschichte.",
          "Diese Erfahrung bestimmt meinen nächsten Schritt.",
          "Jetzt wird deutlich, warum dieser Moment wichtig ist.",
          "Ich bleibe ehrlich und spreche die Folgen offen aus.",
          "Meine Haltung verändert sich mit jeder neuen Erkenntnis.",
          "Trotzdem verliere ich mein eigentliches Ziel nicht.",
          "Ich prüfe jede Möglichkeit, bevor ich weitergehe.",
          "Dann entscheide ich, welcher Weg wirklich zu mir passt.",
          "Diese Entscheidung beendet den bisherigen Konflikt.",
          "So bekommt meine Geschichte einen klaren Abschluss.",
          "Der nächste Schritt folgt sichtbar aus meiner Entscheidung.",
          "Ich erkläre den Zusammenhang ohne unnötige Umwege.",
          "Dabei bleibt meine Haltung in jeder Szene erkennbar.",
          "Die Kamera begleitet meinen Weg bis zur Konsequenz.",
          "Neue Informationen verändern nur nachvollziehbare Entscheidungen.",
          "Ich reagiere auf jeden Wendepunkt klar und glaubwürdig.",
          "Am Schluss bleibt keine wichtige Frage unbeantwortet.",
          "Damit endet diese Geschichte genau an ihrem Ziel.",
        ];

  return applyProvidedDialogueLines(
    response,
    lines
      .slice(
        0,
        requiredLineCount,
      )
      .map(
        (text) => ({
          speaker,
          text,
        }),
      ),
    spokenLanguage,
  );
}

function applyConversationFallback(
  response: ArchitectResponse,
  story: StoryDraft,
  speakers: readonly string[],
  spokenLanguage: VideoSpokenLanguage,
  targetDurationSeconds: VideoDurationSeconds,
  creationMode: VideoCreationMode,
): ArchitectResponse {
  const activeSpeakers =
    speakers
      .map((speaker) =>
        speaker.trim(),
      )
      .filter(Boolean)
      .slice(0, 3);

  if (activeSpeakers.length < 1) {
    return response;
  }

  const beatCount =
    1 +
    response.moviePlan.continuations.length;

  const requiredLineCount =
    targetDurationSeconds <= 8
      ? activeSpeakers.length
      : targetDurationSeconds <= 15
        ? Math.max(
            3,
            activeSpeakers.length,
          )
        : Math.min(
            24,
            Math.max(
              activeSpeakers.length,
              beatCount * 3,
            ),
          );

  const topic =
    story.title
      .toLocaleLowerCase("de-DE")
      .replace(/[^a-zäöüß\s-]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 3)
      .join(" ") ||
    (
      spokenLanguage === "en"
        ? "today's decision"
        : "die heutige Entscheidung"
    );

  const isEnglish =
    spokenLanguage === "en";

  const briefLines =
    isEnglish
      ? [
          "Today, clarity comes first.",
          "I state my position.",
          "Then we decide together.",
        ]
      : [
          "Heute zählt nur Klarheit.",
          "Ich nenne meinen Standpunkt.",
          "Dann entscheiden wir gemeinsam.",
        ];

  const generalLines =
    isEnglish
      ? [
          `Today we speak openly about ${topic}.`,
          "Then we begin with the central point.",
          "I add the consequences from my perspective.",
          "First, we establish the decisive moment.",
          "I answer clearly and without detours.",
          "This answer changes our shared decision.",
          "Now I explain what matters to me.",
          "I accept responsibility for my part.",
          "That makes our next step clear.",
          "Together, we examine what follows from this.",
          "Every answer stays with the same central issue.",
          "This keeps our conversation clear and credible.",
          "I explain my position in greater detail.",
          "Your reaction reveals the most important question.",
          "I give a concrete and honest answer.",
          "Now we connect the cause with its consequence.",
          "I decide based on the facts presented.",
          "This decision has a visible consequence.",
          "We leave no important point unanswered.",
          "I summarize what has truly changed.",
          "The next step follows directly from our conversation.",
          "Our shared position remains clearly recognizable.",
          "Now we make a decision everyone can understand.",
          "Our conversation ends with a clear result.",
        ]
      : [
          `Heute sprechen wir offen über ${topic}.`,
          "Dann beginnen wir mit dem wichtigsten Punkt.",
          "Ich ergänze die Folgen aus meiner Sicht.",
          "Zuerst halten wir den entscheidenden Moment fest.",
          "Darauf antworte ich klar und ohne Umwege.",
          "Diese Antwort verändert unsere gemeinsame Entscheidung.",
          "Jetzt benenne ich, was für mich zählt.",
          "Ich übernehme Verantwortung für meinen Anteil.",
          "Damit steht unser nächster Schritt eindeutig fest.",
          "Wir prüfen gemeinsam, welche Folge daraus entsteht.",
          "Jede Antwort bleibt beim selben zentralen Thema.",
          "So bleibt das Gespräch verständlich und glaubwürdig.",
          "Ich erkläre meinen Standpunkt jetzt noch genauer.",
          "Deine Reaktion zeigt mir die wichtigste offene Frage.",
          "Darauf gebe ich eine konkrete und ehrliche Antwort.",
          "Nun verbinden wir Ursache und Folge miteinander.",
          "Ich entscheide mich nach den genannten Fakten.",
          "Diese Entscheidung hat eine sichtbare Konsequenz.",
          "Wir lassen keinen wichtigen Punkt unbeantwortet.",
          "Ich fasse zusammen, was sich wirklich verändert.",
          "Der nächste Schritt folgt direkt aus unserem Gespräch.",
          "Dabei bleibt unsere gemeinsame Haltung klar erkennbar.",
          "Jetzt treffen wir eine nachvollziehbare Entscheidung.",
          "Damit endet unser Gespräch mit einem klaren Ergebnis.",
        ];

  const infidelityOpening =
    isEnglish
      ? [
          "I saw you kissing at the pool yesterday.",
          "Yes, I lied, and that was wrong.",
        ]
      : [
          "Ich sah euch gestern am Pool küssen.",
          "Ja, ich habe gelogen, und das war falsch.",
        ];

  const infidelityMiddle =
    isEnglish
      ? [
          "I was there and witnessed the kiss myself.",
          "That kiss was a mistake, not an excuse.",
          "I should have admitted it immediately.",
          "Your explanation arrives far too late.",
          "I understand why trust has disappeared.",
          "An apology cannot undo that moment.",
          "We must face the consequence honestly now.",
          "I will not minimize what happened.",
          "This betrayal changes our relationship completely.",
          "I accept the decision that follows now.",
          "We have said every necessary fact clearly.",
          "Nothing excuses that kiss by the pool.",
          "I hear your answer and remain certain.",
          "This conversation confirms my final decision.",
          "I will protect my dignity from now on.",
          "We cannot continue as if nothing happened.",
          "I understand the damage I caused.",
          "Now the consequence must become visible.",
          "We end this conflict without another excuse.",
          "My trust will not return today.",
        ]
      : [
          "Ich war dabei und sah den Kuss ebenfalls.",
          "Dieser Kuss war ein Fehler, keine Ausrede.",
          "Ich hätte es sofort zugeben müssen.",
          "Deine Erklärung kommt dafür viel zu spät.",
          "Ich verstehe, warum das Vertrauen verschwunden ist.",
          "Eine Entschuldigung macht diesen Moment nicht ungeschehen.",
          "Wir müssen der Konsequenz jetzt ehrlich begegnen.",
          "Ich werde den Kuss nicht länger verharmlosen.",
          "Dieser Verrat verändert unsere Beziehung vollständig.",
          "Ich akzeptiere die Entscheidung, die jetzt folgt.",
          "Wir haben alle notwendigen Fakten klar benannt.",
          "Nichts entschuldigt diesen Kuss am Pool.",
          "Ich höre deine Antwort und bleibe sicher.",
          "Dieses Gespräch bestätigt meine endgültige Entscheidung.",
          "Ich schütze ab jetzt meine eigene Würde.",
          "Wir können nicht einfach weitermachen wie zuvor.",
          "Ich verstehe den Schaden, den ich verursacht habe.",
          "Jetzt muss die Konsequenz sichtbar werden.",
          "Wir beenden diesen Konflikt ohne weitere Ausrede.",
          "Mein Vertrauen kehrt heute nicht zurück.",
        ];

  const infidelityClosing =
    isEnglish
      ? [
          "My trust is gone, and this relationship is over.",
          "I leave now and draw a final line.",
        ]
      : [
          "Mein Vertrauen ist weg, unsere Beziehung ist vorbei.",
          "Ich gehe jetzt und ziehe einen klaren Schlussstrich.",
        ];

  let selectedLines: string[];

  if (targetDurationSeconds <= 8) {
    selectedLines =
      briefLines.slice(
        0,
        requiredLineCount,
      );
  } else if (
    creationMode === "viral-story" &&
    isInfidelityStory(story)
  ) {
    selectedLines = [
      ...infidelityOpening,
      ...infidelityMiddle.slice(
        0,
        Math.max(
          0,
          requiredLineCount - 4,
        ),
      ),
      ...infidelityClosing,
    ].slice(0, requiredLineCount);

    if (requiredLineCount === 3) {
      selectedLines = [
        ...infidelityOpening,
        infidelityClosing[0],
      ];
    }
  } else {
    selectedLines =
      generalLines.slice(
        0,
        requiredLineCount,
      );
  }

  return applyProvidedDialogueLines(
    response,
    selectedLines.map(
      (text, index) => ({
        speaker:
          activeSpeakers[
            index %
              activeSpeakers.length
          ],
        text,
      }),
    ),
    spokenLanguage,
  );
}

function hasExactProvidedDialoguePlan(
  response: ArchitectResponse,
  expectedLines: readonly ProvidedDialogueLine[],
): boolean {
  const actualLines = [
    response.moviePlan.opening.dialogue,
    ...(
      response.moviePlan.opening.dialogueTurns ??
      []
    ),
    ...response.moviePlan.continuations.flatMap(
      (continuation) => [
        continuation.dialogue,
        ...(
          continuation.dialogueTurns ??
          []
        ),
      ],
    ),
  ].filter(
    (dialogue) =>
      dialogue.enabled,
  );

  return (
    actualLines.length ===
      expectedLines.length &&
    actualLines.every(
      (line, index) =>
        line.speaker ===
          expectedLines[index].speaker &&
        line.text ===
          expectedLines[index].text,
    )
  );
}

function buildViralDialogueFallback(
  story: StoryDraft,
  speakerNames: readonly string[],
  turnCount: number,
): TerraDialogueTurn[] | undefined {
  if (
    speakerNames.length < 3 ||
    turnCount < 3
  ) {
    return undefined;
  }

  const [lead, accused, third] =
    speakerNames;

  const shortName =
    (name: string) =>
      name
        .split(",")[0]
        .trim();

  const leadName = shortName(lead);
  const accusedName =
    shortName(accused);
  const thirdName =
    shortName(third);

  const storyContext = [
    story.title,
    story.genre,
    story.summary,
  ]
    .join(" ")
    .toLocaleLowerCase("de-DE");

  let texts: string[];

  if (
    /bombshell|ex-partner|trennungsdatum|ex zieht ein/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, diese Umarmung mit ${thirdName} war eindeutig vertraut.`,
      `${thirdName} ist meine Ex. Wir sind längst getrennt.`,
      "Dann verschweigst du unser Treffen von gestern.",
      "Du hast mir gestern eure Funkstille versprochen.",
      `Das Treffen war ein Fehler, ${leadName}.`,
      "Warum öffnet mein Schlüssel noch dein Schlafzimmer?",
      "Mit diesem Schlüssel ist dein Versprechen wertlos.",
      `${leadName}, ich habe dich belogen. Es ist vorbei.`,
    ];
  } else if (
    /heimliche hochzeit|ehering|verheiratet|trauung/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, warum versteckst du diesen Ehering?`,
      "Dieser Ring bedeutet mir längst nichts mehr.",
      "Unsere Hochzeit war erst letzten Monat.",
      "Du hast uns beide über eure Ehe belogen.",
      `${thirdName}, ich wollte heute die Trennung erklären.`,
      `${leadName}, ich bin die verschwiegene Ehepartnerin.`,
      "Für mich ist diese Beziehung beendet.",
      "Ich habe beide Beziehungen zerstört.",
    ];
  } else if (
    /paarwahl|paarzeremonie|recoupling/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, heute Morgen hast du noch mich gewählt.`,
      `Jetzt wähle ich ${thirdName}. Meine Entscheidung steht.`,
      "Diese Paarwahl planten wir seit drei Tagen.",
      "Dein Morgenversprechen war also bewusst gelogen.",
      `${leadName}, ich habe deine Hoffnung ausgenutzt.`,
      "Der Wohnungsschlüssel gehört jetzt auf den Tisch.",
      "Ich nehme den Schlüssel und gehe.",
      "Damit verliere ich mehr als diese Paarwahl.",
    ];
  } else if (
    /halskette|gestohlene kette|schmuckstück/.test(
      storyContext,
    )
  ) {
    texts = [
      `${thirdName}, meine Kette fiel aus deiner Tasche.`,
      `${accusedName} gab mir die Kette am Pool.`,
      `Nein, ${thirdName} nahm die Kette selbst.`,
      "Wann fand diese Übergabe genau statt?",
      "Gestern Nacht, direkt hinter der Poolterrasse.",
      "Ich wollte den Anhänger nur verstecken.",
      "Der Anhänger öffnet mein verschlossenes Fach.",
      `Im Fach liegt der Beleg für ${accusedName}s Auftrag.`,
    ];
  } else if (
    /geheime allianz|team-symbol|abstimmung/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, ich sah eure Übergabe hinter der Tür.`,
      "Das goldene Symbol war nur geliehen.",
      "Nein, das Symbol besiegelt unsere geheime Allianz.",
      "Wen wolltet ihr bei der Abstimmung treffen?",
      `Wir wollten ${leadName} aus der Villa wählen.`,
      `${leadName} war ursprünglich Teil unseres Plans.`,
      "Dann zerbricht eure Allianz genau jetzt.",
      `Ohne ${leadName} verlieren wir die Abstimmung.`,
    ];
  } else if (
    /koffer|reiseset|ticket für zwei/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, warum liegt ${thirdName}s Kleidung in deinem Koffer?`,
      `${thirdName} hat diese Kleidung gestern hier vergessen.`,
      "Nein, diese Kleidung trug ich letzte Nacht.",
      `Dann war ${thirdName} gestern in deinem Zimmer.`,
      `${leadName}, ich habe dieses Treffen verschwiegen.`,
      "Unter der Kleidung liegt ein Ticket für uns.",
      "Dieses Ticket beendet unsere gemeinsame Reise.",
      "Ich habe euch beide mitgenommen und belogen.",
    ];
  } else if (
    /sabotage|challenge|requisit/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, ich sah dich beim Vertauschen des Requisits.`,
      "Ich habe das Requisit allein vertauscht.",
      "Nein, ich versprach dafür einen klaren Vorteil.",
      "Welches Team sollte durch die Sabotage verlieren?",
      `${leadName}s Team sollte die Challenge verlieren.`,
      "Das manipulierte Requisit war nur eine Falle.",
      "Die echte Entscheidung treffe jetzt ich.",
      "Dann ist unsere Absprache endgültig gescheitert.",
    ];
  } else if (
    /preisgeld|geldumschlag|verschwundene.*geld/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, dieser Geldumschlag lag in deiner Tasche.`,
      "Ich wollte das Preisgeld für alle sichern.",
      "Nein, du wolltest allein damit verschwinden.",
      "Wann hast du den Umschlag heimlich genommen?",
      "Gestern Nacht, direkt nach unserer Abmachung.",
      "Mein größerer Umschlag beweist den geplanten Alleingang.",
      "Du bekommst keinen Anteil mehr.",
      "Dann habe ich eure Loyalität verspielt.",
    ];
  } else if (
    /zwei verlobungen|verlobungsringe|doppelte verlobung/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, dieser Verlobungsring stammt von dir.`,
      `Der Ring für ${thirdName} ist eine Fälschung.`,
      "Unsere Ringe tragen dieselbe Gravur.",
      "Du hast uns dieselbe Zukunft versprochen.",
      `${leadName}, ich habe beide Anträge heimlich geplant.`,
      "An deiner Hand steckt noch ein dritter Ring.",
      "Damit endet jede unserer Verlobungen.",
      "Ich kann keinen dieser Anträge retten.",
    ];
  } else if (
    /fremde jacke|falschen zimmer|aufgeflogene ausrede/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, du kommst aus ${thirdName}s Zimmer.`,
      "Ich suchte dort nur meine Jacke.",
      "Diese Jacke gehört mir seit Jahren.",
      `Warum trägst du dann ${thirdName}s Jacke?`,
      `${leadName}, ich blieb dort über Nacht.`,
      "Die zweite Hälfte liegt noch in meinem Zimmer.",
      "Deine Ausrede passt nicht zu diesem Morgen.",
      "Ich habe unsere Beziehung damit beendet.",
    ];
  } else if (
    /zwei versprechen|doppeltes lieb|dasselbe.*armband/.test(
      storyContext,
    )
  ) {
    texts = [
      `${accusedName}, du hast uns dasselbe Armband geschenkt.`,
      `Das Armband war für ${leadName}, nicht für ${thirdName}.`,
      "Du gabst mir das Armband am Montag.",
      "Mir versprachst du gestern dieselbe Zukunft.",
      "Ich habe beide Versprechen heimlich vermischt.",
      "Dann entscheide dich jetzt vor uns.",
      "Ein drittes Armband fällt aus deiner Tasche.",
      "Das dritte Armband war für jemand anderen.",
    ];
  } else {
    texts = [
      `${accusedName}, ich sah euren Kuss am Pool.`,
      `Ich habe ${thirdName} geküsst. Das war mein Fehler.`,
      `${accusedName} wollte diesen Kuss seit gestern.`,
      "Seit gestern belügst du mich also.",
      `${leadName}, ich habe unser Versprechen gebrochen.`,
      `Ich bekam denselben Ring von ${accusedName}.`,
      "Dann ist unsere Beziehung vorbei.",
      `${leadName}, ich akzeptiere deine Entscheidung.`,
    ];
  }

  const speakers = [
    lead,
    accused,
    third,
    lead,
    accused,
    third,
    lead,
    accused,
  ];

  const purposes:
    TerraDialoguePurpose[] = [
      "discovery",
      "answer",
      "contradiction",
      "accusation",
      "admission",
      "cliffhanger",
      "decision",
      "consequence",
    ];

  const factKeys:
    TerraDialogueFactKey[][] = [
      ["witnessedEvent"],
      ["accusedResponse"],
      ["contradiction"],
      ["relationship"],
      ["accusedResponse"],
      ["supportingEvidence"],
      ["consequence"],
      ["consequence"],
    ];

  const voiceDirections = [
    "direkt, verletzt und kontrolliert",
    "angespannt und ohne Ausflucht",
    "ruhig, bestimmt und konkret",
    "fassungslos und fordernd",
    "ehrlich, leise und unter Druck",
    "klar und enthüllend",
    "fest, ruhig und endgültig",
    "erschüttert und einsichtig",
  ];

  return texts
    .slice(
      0,
      Math.min(
        turnCount,
        texts.length,
      ),
    )
    .map(
      (text, index) => ({
        speaker:
          speakers[index],
        text,
        voiceDirection:
          voiceDirections[index],
        purpose:
          purposes[index],
        respondsToTurn:
          index,
        factKeys:
          factKeys[index],
      }),
    );
}

function buildInfidelityDialogueFallback(
  story: StoryDraft,
  speakerNames: readonly string[],
  turnCount: number,
): TerraDialogueTurn[] | undefined {
  if (
    !isInfidelityStory(story) ||
    speakerNames.length < 3 ||
    turnCount < 3 ||
    turnCount > 12
  ) {
    return undefined;
  }

  const [accuser, accused, witness] =
    speakerNames;

  const shortName =
    (name: string) =>
      name
        .split(",")[0]
        .trim();

  const accuserName =
    shortName(accuser);

  const accusedName =
    shortName(accused);

  const witnessName =
    shortName(witness);

  const makeTurn = (
    speaker: string,
    text: string,
    voiceDirection: string,
    purpose: TerraDialoguePurpose,
    index: number,
    factKeys: TerraDialogueFactKey[],
  ): TerraDialogueTurn => ({
    speaker,
    text,
    voiceDirection,
    purpose,
    respondsToTurn:
      index,
    factKeys,
  });

  const openingTurns: Array<
    Omit<TerraDialogueTurn, "respondsToTurn">
  > = [
    {
      speaker: accuser,
      text: `${accusedName}, ich hab gesehen, wie du ${witnessName} geküsst hast.`,
      voiceDirection: "kontrolliert, verletzt und direkt",
      purpose: "discovery",
      factKeys: ["witnessedEvent"],
    },
    {
      speaker: accused,
      text: `Ich hab ${witnessName} geküsst. Es war mein Fehler.`,
      voiceDirection: "angespannt, aber ohne Ausflucht",
      purpose: "answer",
      factKeys: ["accusedResponse"],
    },
    {
      speaker: witness,
      text: `Nein, ${accusedName}. Du wolltest den Kuss.`,
      voiceDirection: "ruhig, bestimmt und schonungslos ehrlich",
      purpose: "contradiction",
      factKeys: ["contradiction"],
    },
    {
      speaker: accused,
      text: `Ja, ${accuserName}. Ich hab dich danach belogen.`,
      voiceDirection: "leise, beschämt und eindeutig",
      purpose: "admission",
      factKeys: ["relationship", "accusedResponse"],
    },
    {
      speaker: accuser,
      text: "Seit wann lügst du mich deswegen an?",
      voiceDirection: "fassungslos, aber beherrscht",
      purpose: "accusation",
      factKeys: ["relationship", "witnessedEvent"],
    },
    {
      speaker: accused,
      text: "Seit gestern. Ich hatte Angst vor der Wahrheit.",
      voiceDirection: "stockend und schuldbewusst",
      purpose: "answer",
      factKeys: ["accusedResponse"],
    },
    {
      speaker: witness,
      text: `${accuserName}, ${accusedName} versprach mir einen Neuanfang.`,
      voiceDirection: "nüchtern und ohne Triumph",
      purpose: "contradiction",
      factKeys: ["contradiction", "relationship"],
    },
    {
      speaker: accused,
      text: `${witnessName}, dieses Versprechen war falsch.`,
      voiceDirection: "unter Druck und defensiv",
      purpose: "admission",
      factKeys: ["contradiction"],
    },
    {
      speaker: accuser,
      text: "Falsch war der Kuss, nicht nur das Versprechen.",
      voiceDirection: "kalt, klar und endgültig",
      purpose: "accusation",
      factKeys: ["witnessedEvent", "contradiction"],
    },
    {
      speaker: accused,
      text: `${accuserName}, ich bereue diesen Kuss.`,
      voiceDirection: "verzweifelt und aufrichtig",
      purpose: "answer",
      factKeys: ["accusedResponse", "witnessedEvent"],
    },
  ];

  if (turnCount === 3) {
    return openingTurns
      .slice(0, 3)
      .map(
        (turn, index) =>
          makeTurn(
            turn.speaker,
            turn.text,
            turn.voiceDirection,
            turn.purpose,
            index,
            turn.factKeys,
          ),
      );
  }

  const consequenceTurns: Array<
    Omit<TerraDialogueTurn, "respondsToTurn">
  > = [
    {
      speaker: accuser,
      text: "Ich kann dir nicht mehr vertrauen. Es ist vorbei.",
      voiceDirection: "fest, ruhig und endgültig",
      purpose: "decision",
      factKeys: ["relationship", "consequence"],
    },
    {
      speaker: accused,
      text: `${accuserName}, bitte. Gib mir noch eine Chance.`,
      voiceDirection: "leise und erschüttert",
      purpose: "consequence",
      factKeys: ["consequence"],
    },
  ];

  const selectedTurns = [
    ...openingTurns.slice(
      0,
      turnCount - 2,
    ),
    ...consequenceTurns,
  ];

  return selectedTurns.map(
    (turn, index) =>
      makeTurn(
        turn.speaker,
        turn.text,
        turn.voiceDirection,
        turn.purpose,
        index,
        turn.factKeys,
      ),
  );
}

async function writeDialogueWithTerra(
  apiKey: string,
  story: StoryDraft,
  response: ArchitectResponse,
  targetDurationSeconds: VideoDurationSeconds,
  creationMode: VideoCreationMode,
  spokenLanguage: VideoSpokenLanguage,
  speakerNames: readonly string[],
): Promise<ArchitectResponse> {
  const beatCount =
    1 +
    response.moviePlan.continuations.length;

  const viralDialogueTurnCount =
  Math.min(
    12,
    Math.max(
      speakerNames.length,
      Math.ceil(
        targetDurationSeconds / 6,
      ),
    ),
  );

const maximumTurns =
  creationMode === "viral-story"
    ? viralDialogueTurnCount
    : Math.min(
        beatCount * 4,
        Math.max(
          speakerNames.length,
          beatCount * 3,
        ),
      );
  const viralNaturalnessSection =
    creationMode ===
      "viral-story"
      ? `
NATÜRLICHKEITS-GATE FÜR FRUIT STORIES

- Schreibe das Gespräch für die Figuren, niemals für den Zuschauer.
- Keine Figur erklärt Informationen, die beide Gesprächspartner bereits kennen.
- Jede Zeile muss wie eine unmittelbare Reaktion auf die vorige Handlung oder Aussage klingen.
- Bevorzuge Alltagssprache, kurze Satzfragmente und spontane Reaktionen.
- Natürliches gesprochenes Deutsch darf Verkürzungen wie „hab“, „glaub“, „komm“, „lass“ oder „warte“ verwenden, wenn sie zur Figur passen.
- Nicht jede Antwort muss ein vollständiger grammatischer Satz sein.
- Eine kurze Pause, Gegenfrage oder unvollständige Reaktion ist besser als künstliche Erklärprosa.
- contract, factKeys und purpose sind ausschließlich interne Planungsdaten. Ihre Begriffe dürfen niemals hörbar in den Dialog gelangen.
- Wörter wie „Konsequenz“, „Fakten“, „Tatsachen“, „Beweisstück“, „nachvollziehbar“ oder „endgültige Entscheidung“ nur verwenden, wenn ein echter Mensch sie in genau dieser Situation tatsächlich sagen würde.
- Kein Satz darf wie Erzählertext, Therapiesprache, Managementsprache oder eine Zusammenfassung der Handlung klingen.
- Figuren dürfen widersprechen, ausweichen, stocken, unterbrechen oder emotional reagieren.
- Vermeide perfekte Frage-Antwort-Muster. Ein Streit darf unordentlich wirken, muss inhaltlich aber verständlich bleiben.
- Jede Figur braucht eine erkennbare eigene Haltung und Sprechweise.
- Wenn eine Zeile auch problemlos von einer anderen Figur gesprochen werden könnte, schreibe sie neu.
- Namen nur verwenden, wenn es emotional oder zur eindeutigen Zuordnung notwendig ist.
- Höchstens eine neue Information pro Zeile.
- Der Dialog muss beim lauten Vorlesen wie eine echte Unterhaltung klingen.
`
      : "";
  const isSingleSpeakerSpokesperson =
    creationMode ===
      "standard" &&
    speakerNames.length ===
      1;

  const minimumTurns =
    creationMode ===
        "viral-story" ||
      isSingleSpeakerSpokesperson
      ? maximumTurns
      : Math.min(
          maximumTurns,
          Math.max(
            speakerNames.length,
            beatCount * 2,
          ),
        );

  let lastError:
    unknown;

  let correctionNotes:
    string[] = [];

  let previousDraft:
    TerraDialoguePayload | undefined;
  
const maximumAttempts =
  creationMode === "viral-story"
    ? 3
    : isSingleSpeakerSpokesperson
      ? 2
      : 2;

  for (
    let attempt = 1;
    attempt <=
      maximumAttempts;
    attempt += 1
  ) {
    console.log(
      `Story Architect Dialog-Autor: ${DIALOGUE_WRITER_MODEL}, Versuch ${attempt}/${maximumAttempts}`,
    );

    try {
      const rawText =
        await generateStructuredDialoguePlan(
          apiKey,
          buildTerraDialoguePrompt(
            story,
            response,
            targetDurationSeconds,
            creationMode,
            spokenLanguage,
            speakerNames,
            minimumTurns,
            maximumTurns,
            correctionNotes,
            previousDraft,
          ),
          {
            speakerNames: [
              ...speakerNames,
            ],
            minimumTurns,
            maximumTurns,
            style:
  creationMode ===
    "viral-story"
    ? "viral-story"
    : creationMode ===
          "standard" &&
        speakerNames.length ===
          1
      ? "spokesperson"
      : "conversation",
          },
        );

      const payload =
        readTerraDialoguePayload(
          rawText,
          speakerNames,
          minimumTurns,
          maximumTurns,
        );

      previousDraft =
        payload;

      const candidate =
        applyTerraDialogueTurns(
          response,
          payload.turns,
          spokenLanguage,
        );

      const structurallyValid =
        validateArchitectResponse(
          candidate,
        );

      const mandatoryDialogueValid =
        hasMandatoryDialoguePlan(
          candidate,
          speakerNames,
          targetDurationSeconds,
          creationMode,
          story,
        );

      correctionNotes =
        getTerraDialogueQualityIssues(
          payload,
          story,
          creationMode,
        );

      if (!structurallyValid) {
        correctionNotes.push(
          "Der Entwurf hat die technische Dialogstruktur nicht eingehalten.",
        );
      }

      if (!mandatoryDialogueValid) {
        correctionNotes.push(
          "Der Entwurf hat Wortgrenzen, Sprecherabdeckung oder die verbindliche Dialogkontinuität nicht bestanden.",
        );
      }

      if (
        structurallyValid &&
        mandatoryDialogueValid &&
        correctionNotes.length === 0
      ) {
        return candidate;
      }

      console.warn(
        "Story Architect Dialog-Autor Qualitätskorrektur:",
        {
          attempt,
          correctionNotes,
          dialogue:
            payload.turns.map(
              (turn) => ({
                speaker:
                  turn.speaker,
                text:
                  turn.text,
                purpose:
                  turn.purpose,
              }),
            ),
        },
      );

      throw new Error(
        `GPT-5.6 Terra hat die Dialog-Qualitätskontrolle noch nicht bestanden: ${correctionNotes.join(" ")}`,
      );
    } catch (error) {
      lastError =
        error;

      if (
        correctionNotes.length === 0
      ) {
        correctionNotes = [
          "Der vorige Entwurf war technisch unvollständig. Erstelle den Dialog vollständig neu und halte den Faktenvertrag exakt ein.",
        ];
      }
    }
  }

  const fallbackTurns =
    creationMode === "viral-story"
      ? (
          buildViralDialogueFallback(
            story,
            speakerNames,
            maximumTurns,
          ) ??
          buildInfidelityDialogueFallback(
            story,
            speakerNames,
            maximumTurns,
          )
        )
      : undefined;

  if (fallbackTurns) {
        const fallbackNaturalnessIssues =
      creationMode ===
        "viral-story"
        ? getViralDialogueNaturalnessIssues(
            fallbackTurns,
          )
        : [];
    const fallbackCandidate =
      applyTerraDialogueTurns(
        response,
        fallbackTurns,
        spokenLanguage,
      );

    if (
  validateArchitectResponse(
    fallbackCandidate,
  ) &&
  hasMandatoryDialoguePlan(
    fallbackCandidate,
    speakerNames,
    targetDurationSeconds,
    creationMode,
    story,
  ) &&
  fallbackNaturalnessIssues.length ===
    0
) {
      console.warn(
        "Story Architect verwendet einen geprüften fokussierten Untreue-Dialog als Ausfallsicherung.",
      );

      return fallbackCandidate;
    }
  }

  throw (
    lastError ??
    new Error(
      "GPT-5.6 Terra konnte keinen gültigen Dialogplan erzeugen.",
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

  const isSingleSpeakerDialogue =
    voiceMode ===
      "dialogue" &&
    creationMode ===
      "standard" &&
    story.characters.length ===
      1;

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
- Erzähle genau EINEN Konflikt. Für den gesamten Film ist höchstens EIN zusätzliches Beweisstück erlaubt. Kuss plus Armband plus Ring plus Koffer plus Hemd ist ausdrücklich verboten.
- Eine beobachtete Handlung wird zuerst beantwortet. Erst danach darf genau ein bereits festgelegtes Detail die Antwort widerlegen.
- Der Schluss zeigt eine persönliche Entscheidung oder Konsequenz aus demselben Konflikt. Ein plötzlich auftauchender neuer Gegenstand ist kein Cliffhanger.

- Jeder neue Story-Abschnitt dauert grundsätzlich 15 Sekunden und wird anschließend an das ausgewählte Videomodell übergeben.
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
- Namen, Ort, Zeitpunkt und sichtbares Beweisstück bleiben über alle Abschnitte widerspruchsfrei. Pronomen wie „das“, „es“ oder „alles“ dürfen nie einen ungenannten Sachverhalt ersetzen. Bei drei Figuren sind auch „er“, „sie“, „ihn“, „ihm“ und „ihr“ ohne ausdrücklich genannten Bezug verboten.
- Figuren sprechen verschieden: Eine direkte Figur benennt den Vorwurf knapp, eine kontrollierte Figur antwortet präzise, eine ausweichende Figur nennt eine falsifizierbare Ausrede. Tausche niemals beliebige Standardsätze zwischen den Figuren aus.
- SCHLECHT: „Das ändert alles.“ – „Du verstehst das nicht.“ – „Warte ab.“
- Keine Beispielsätze kopieren. Entwickle den Wortlaut ausschließlich aus der konkreten Story und der festgelegten Faktenkette.
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
- Plane innerhalb jedes 15-Sekunden-Provider-Clips mindestens vier klar getrennte, zeitlich markierte Einstellungen.
- Wenn Story, Stimmung oder Nutzerwunsch schnelle Szenenwechsel, schnelle Schnitte oder eine Montage verlangen, plane exakt fünf Einstellungen pro 15 Sekunden: 0–3, 3–6, 6–9, 9–12 und 12–15 Sekunden.
- Ein Wechsel der Brennweite bei unverändert posierenden Figuren zählt nicht als neue Einstellung. Jede Einstellung zeigt eine neue Handlung, Reaktion, Information oder räumliche Phase.
- Keine unnötigen Pausen.
`;

  const selectedAudioDirection =
    creationMode ===
    "viral-story"
      ? "POST-PRODUCED CHARACTER DIALOGUE: Plan exact short German lines and clear sentence-paced mouth, jaw, face and body performance for each visible assigned character. The selected video model creates only restrained non-vocal ambience and music; fixed studio-quality German character voices are mixed scene-synchronously during finishing. No narrator, no voice-over, no off-screen speech and no subtitles."
      : activeMusicTrack
        ? "ORIGINAL UPLOADED SONG: Generate visuals with no audible dialogue, singing, narration or extra music. The complete customer song is added as the only final soundtrack during finishing. Plan visible performance and edit rhythm from the supplied musical analysis."
      : voiceMode ===
          "dialogue"
        ? isSingleSpeakerDialogue
          ? "POST-PRODUCED ON-CAMERA SPOKESPERSON: Plan exact short direct-to-camera lines for the single selected character, with natural sentence-paced mouth, face, hand and body performance. Keep generated footage free of audible speech; the fixed voice is mixed later."
          : "POST-PRODUCED MULTI-SPEAKER DIALOGUE: Plan exact short lines and visible sentence-paced speaking performances, but keep generated footage free of audible speech. Fixed voices are mixed later."
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
      ? isSingleSpeakerDialogue
        ? `
VERBINDLICHER EIN-PERSONEN-SPRECHMODUS – HÖCHSTE PRIORITÄT

- Das Video zeigt ausschließlich ${story.characters[0].name} als sichtbare Sprecherfigur vor der Kamera.
- Es ist ein professioneller Presenter- beziehungsweise Influencer-Auftritt und ausdrücklich kein Gespräch mit einer erfundenen zweiten Person.
- productionBible.characterBible enthält exakt die ausgewählte Figur.
- moviePlan.opening.dialogue.enabled ist true und speaker ist exakt "${story.characters[0].name}".
- opening.dialogue und opening.dialogueTurns bilden zusammen einen flüssigen, natürlich gesprochenen Monolog.
- Beginne mit einem kurzen relevanten Hook, nenne danach konkrete Vorteile aus der Story und ende mit einer glaubwürdigen Handlungsaufforderung.
- Jede Dialogzeile hat höchstens zwölf Wörter; alle Zeilen zusammen haben bei fünfzehn Sekunden höchstens dreißig Wörter.
- Handlung, Mimik, Gestik, Kamera und englischer Video-Prompt folgen exakt dem gesprochenen Inhalt.
- Erfinde keine zweite Figur, keinen Interviewer, keinen Erzähler und keine Offscreen-Stimme.
- Keine Untertitel.
`
        : `
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
- Lege vor dem Schreiben intern eine unveränderliche Faktenkette fest: Beziehung oder Ziel, sichtbare auslösende Handlung, direkte Wahrnehmung, Vorwurf, konkrete Antwort, überprüfbarer Widerspruch, persönliche Konsequenz und gegebenenfalls Cliffhanger.
- Jede Antwort reagiert eindeutig auf die unmittelbar vorherige Zeile. Niemand wechselt grundlos das Thema.
- Jede Zeile nennt bei Bedarf den konkreten Gegenstand, Ort, Zeitpunkt oder die beobachtete Handlung. Vermeide leere Standardsätze wie „Das ändert alles“, „Du verstehst das nicht“ oder „Warte ab“.
- Ein Beweis wird sichtbar ausgespielt: Bei Fremdgehen sieht die betroffene Figur beispielsweise den Kuss oder die vertraute Berührung selbst. Ein Handy darf nur ein zusätzliches Detail bestätigen.
- action, hook, storyBeat und die englischen Video-Prompts müssen genau dieselbe sichtbare Handlung und Faktenkette zeigen wie der Dialog.
- Schreibe genau EINEN verbindlichen Dialogplan. Google Veo 3.1 Standard, Google Veo 3.1 Fast, Seedance 2 Fast und Seedance 2 Original erhalten später denselben Wortlaut, dieselben Sprecher und dieselbe Reihenfolge.
- Kein Narrator.
- Kein Voice-over.
- Kein Off-screen speaker.
- Kein Monolog.
- Keine Untertitel.
`
      : "";

  const suppliedDialogueSection =
    Array.isArray(
      story.providedDialogue,
    ) &&
    story.providedDialogue.length >= 1
      ? `
VOM NUTZER VORGEGEBENER ORIGINALDIALOG – ABSOLUTE PRIORITÄT

${story.providedDialogue
  .map(
    (line, index) =>
      `${index + 1}. ${line.speaker}: „${line.text}“`,
  )
  .join("\n")}

- Diese Sprecher, Texte und Reihenfolge stammen direkt vom Nutzer.
- Ändere, verbessere, kürze oder ergänze kein einziges gesprochenes Wort.
- Richte Handlung, Mundbewegungen, Reaktionen und Kameragegenaufnahmen exakt an diesen Dialogzeilen aus.
- Erzeuge keine zusätzlichen Dialogzeilen. Szenen ohne vorgegebenen Satz bleiben ohne Sprache.
`
      : "";

  return `
Du bist ein professioneller Viral Creative Director, Story Architect,
Character Director, Camera Director, Lighting Director, Performance Director,
Audio Director, Continuity Director und Video Prompt Director.

Du planst EIN zusammenhängendes professionelles Video-Projekt.

Der Filmplan ist modellunabhängig. Er wird unverändert für Google Veo 3.1 Standard,
Google Veo 3.1 Fast, Seedance 2 Fast oder Seedance 2 Original verwendet.
Erzeuge niemals vier Varianten und schreibe Dialoge nie für ein einzelnes Modell um.

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

${suppliedDialogueSection}

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
- bei Social, Musikvideo oder ausdrücklich schnellen Szenenwechseln einen verbindlichen zeitcodierten internen Schnittplan mit mehreren echten Einstellungen innerhalb des Provider-Clips
- bei ausdrücklich schnellen Szenenwechseln exakt fünf unterschiedliche Einstellungen: SHOT 1 (0-3 seconds), SHOT 2 (3-6 seconds), SHOT 3 (6-9 seconds), SHOT 4 (9-12 seconds), SHOT 5 (12-15 seconds)
- jede neue Einstellung muss neue sichtbare Handlung oder Story-Information enthalten; bloßes Umkadrieren derselben statischen Pose ist verboten

FORTSETZUNGEN

Wenn generationStrategy = "extension-chain":

- Erzeuge exakt ${durationPlan.extensionCount} continuations.
- Jede durationSeconds = 15.
- continuationPrompt auf Englisch.
- Jede Fortsetzung ist eine direkte Weiterführung.
- Kein Neustart.
- Identität, Kleidung, Umgebung und Licht bleiben stabil.
- Jede Fortsetzung bringt die Story sichtbar voran.
- Bei Social, Musikvideo oder ausdrücklich schnellen Szenenwechseln enthält auch jeder continuationPrompt einen zeitcodierten internen Schnittplan.
- Schnelle Szenenwechsel bedeuten mehrere echte Einstellungen innerhalb der 15 Sekunden und niemals nur schnellere Kamerabewegung in einem Dauershot.

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
- Social- und Musikvideo-Prompts enthalten mehrere zeitcodierte Einstellungen pro 15-Sekunden-Clip
- Bei ausdrücklich schnellen Szenenwechseln enthält jeder 15-Sekunden-Prompt exakt fünf unterschiedliche Einstellungen mit neuer Handlung oder Information
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

  const geminiApiKey =
    process.env
      .GEMINI_API_KEY;

  const openAiApiKey =
    process.env
      .OPENAI_API_KEY;

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

  if (!geminiApiKey) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "GEMINI_API_KEY fehlt für die visuelle Filmplanung in den Umgebungsvariablen.",
      },

      {
        status:
          500,
      },
    );
  }

  try {
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

    const isSingleSpeakerDialogue =
      voiceMode ===
        "dialogue" &&
      creationMode ===
        "standard" &&
      expectedDialogueSpeakers.length ===
        1;

    const providedDialogue =
      voiceMode === "dialogue"
        ? normalizeProvidedDialogueLines(
            story,
            expectedDialogueSpeakers,
          )
        : [];

    const validateDialogueCandidate =
      (
        candidate: unknown,
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
          providedDialogue.length > 0 ||
          isSingleSpeakerDialogue ||
          /*
           * Der Gemini-Aufruf plant hier Bild, Szenen und Kontinuität.
           * Wenn der spezialisierte OpenAI-Dialogautor verfügbar ist,
           * ersetzt er den vorläufigen Gemini-Dialog unmittelbar danach.
           * Ein unvollständiger Platzhalterdialog darf deshalb nicht den
           * gesamten visuellen Filmplan schon vorher verwerfen.
           */
          Boolean(openAiApiKey) ||
          hasMandatoryDialoguePlan(
            normalizedCandidate,
            expectedDialogueSpeakers,
            targetDurationSeconds,
            creationMode,
            story,
            false,
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
      };

    const ai =
      new GoogleGenAI({
        apiKey:
          geminiApiKey,
      });

    let generationResult:
      GeneratedStory;

    if (
      creationMode ===
        "standard" &&
      providedDialogue.length > 0
    ) {
      /*
       * The user has already supplied the most important creative content:
       * the exact spoken words. The normalizer can build the complete visual
       * production plan around the existing story draft, so a second remote
       * planning call would only add latency and another possible timeout.
       */
      generationResult = {
        rawText:
          "{}",
        model:
          "prepared-original-dialogue-plan",
      };
    } else {
      try {
        generationResult =
          await generateStoryWithFallback(
            ai,
            prompt,
            voiceMode ===
              "dialogue"
              ? validateDialogueCandidate
              : undefined,
            creationMode ===
              "viral-story"
              ? VIRAL_STORY_MODELS
              : STORY_MODELS,
          );
      } catch (
        planningError:
          unknown
      ) {
        if (
          creationMode ===
            "viral-story" ||
          !isRetryableGeminiError(
            planningError,
          )
        ) {
          throw planningError;
        }

        console.warn(
          "Story Architect verwendet nach einem vorübergehenden Modellfehler den vollständigen sicheren Standard-Filmplan.",
          getErrorDetails(
            planningError,
          ),
        );

        generationResult = {
          rawText:
            "{}",
          model:
            "resilient-standard-film-plan",
        };
      }
    }

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

    let normalized =
      normalizeArchitectResponse(
        parsed,
        story,
        targetDurationSeconds,
        aspectRatio,
        editingStyle,
        voiceMode,
      );

    if (
      voiceMode ===
        "dialogue" &&
      providedDialogue.length > 0
    ) {
      const providedDialogueWordCount =
        providedDialogue.reduce(
          (total, line) =>
            total +
            line.text
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .length,
          0,
        );

      /*
       * Kurze Sprecherwechsel sind filmisch deutlich schneller als
       * lange Sätze. Deshalb entscheidet die tatsächliche Wortmenge
       * statt einer pauschalen Zahl von Dialogzeilen. Rund 2,3 Wörter
       * pro Sekunde lassen natürliche deutsche Sprache samt kleinen
       * Reaktionspausen zu.
       */
      const dialogueWordCapacity =
        Math.max(
          12,
          Math.floor(
            targetDurationSeconds *
              2.3,
          ),
        );

      if (
        providedDialogueWordCount >
        dialogueWordCapacity
      ) {
        return NextResponse.json(
          {
            success:
              false,
            error:
              `Dein Originaldialog enthält ${providedDialogueWordCount} Wörter. Für ${targetDurationSeconds} Sekunden passen ungefähr ${dialogueWordCapacity} natürlich gesprochene Wörter. Bitte verlängere das Video oder kürze den Text.`,
          },
          {
            status:
              400,
          },
        );
      }

      normalized =
        applyProvidedDialogueLines(
          normalized,
          providedDialogue,
          spokenLanguage,
        );
    } else if (
      voiceMode ===
        "dialogue" &&
      openAiApiKey
    ) {
      try {
        normalized =
          await writeDialogueWithTerra(
            openAiApiKey,
            story,
            normalized,
            targetDurationSeconds,
            creationMode,
            spokenLanguage,
            expectedDialogueSpeakers,
          );

        generationResult = {
          ...generationResult,
          model:
            DIALOGUE_WRITER_MODEL,
        };
      } catch (terraError) {
        console.error(
          "GPT-5.6 Terra Dialogplanung fehlgeschlagen:",
          getErrorDetails(
            terraError,
          ),
        );

        console.warn(
          "Der geprüfte Gemini-Dialogplan bleibt als Ausfallsicherung aktiv.",
        );
      }
    } else if (
      voiceMode ===
      "dialogue"
    ) {
      console.warn(
        "OPENAI_API_KEY fehlt. Der Dialogplan verwendet vorübergehend den geprüften Gemini-Ersatz.",
      );
    }

    if (
      voiceMode === "dialogue" &&
      providedDialogue.length === 0
    ) {
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

      const automaticDialogueSpeakers =
        expectedDialogueSpeakers.length > 0
          ? expectedDialogueSpeakers
          : normalized.productionBible.characterBible
              .slice(
                0,
                creationMode === "viral-story"
                  ? 2
                  : 1,
              )
              .map(
                (character) =>
                  character.name,
              );

      const automaticDialogueIsValid =
        hasMandatoryDialoguePlan(
          normalized,
          expectedDialogueSpeakers,
          targetDurationSeconds,
          creationMode,
          story,
        ) ||
        hasMandatoryDialoguePlan(
          normalized,
          expectedDialogueSpeakers,
          targetDurationSeconds,
          creationMode,
          story,
          false,
        );

      if (
        studioAdvertisement &&
        automaticDialogueSpeakers.length === 1
      ) {
        normalized =
          applyStudioSpokespersonFallback(
            normalized,
            automaticDialogueSpeakers[0],
            spokenLanguage,
            targetDurationSeconds,
          );
      } else if (
        !automaticDialogueIsValid &&
        automaticDialogueSpeakers.length === 1
      ) {
        normalized =
          applySingleSpeakerFallback(
            normalized,
            story,
            automaticDialogueSpeakers[0],
            spokenLanguage,
            targetDurationSeconds,
          );
      } else if (
        !automaticDialogueIsValid
      ) {
        normalized =
          applyConversationFallback(
            normalized,
            story,
            automaticDialogueSpeakers,
            spokenLanguage,
            targetDurationSeconds,
            creationMode,
          );
      }
    }

    /*
     * Provider clips are fifteen seconds long. Translate pacing requests into
     * an explicit clip-local edit map after every dialogue fallback so the
     * final prompt cannot collapse "fast cuts" into one long camera move.
     */
    normalized =
      applyRequiredInternalShotPlans(
        normalized,
        story,
        editingStyle,
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
      (
        providedDialogue.length > 0
          ? !hasExactProvidedDialoguePlan(
              normalized,
              providedDialogue,
            )
          : !hasMandatoryDialoguePlan(
              normalized,
              expectedDialogueSpeakers,
              targetDurationSeconds,
              creationMode,
              story,
            ) &&
            !hasMandatoryDialoguePlan(
              normalized,
              expectedDialogueSpeakers,
              targetDurationSeconds,
              creationMode,
              story,
              false,
            )
      )
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            providedDialogue.length > 0
              ? "Der vorgegebene Originaldialog konnte nicht vollständig und unverändert in den Filmplan übernommen werden."
              : "Der automatische Dialogplan war noch nicht vollständig. Bitte starte die Story-Erstellung erneut.",
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
            "Der Story-Planer hat innerhalb des sicheren Zeitlimits keine vollständige Antwort erhalten. Es wurde noch kein Video gestartet. Bitte probiere es in wenigen Augenblicken erneut.",
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
