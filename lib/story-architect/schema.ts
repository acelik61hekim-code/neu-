import type { StoryDraft } from "@/types/story";

export type StoryArchitectRequest = {
  story: StoryDraft;
  targetDurationSeconds?: unknown;
  aspectRatio?: unknown;
  editingStyle?: unknown;
  audioStyle?: unknown;
  voiceMode?: unknown;
  speechContentMode?: unknown;
  spokenLanguage?: unknown;
  voiceoverText?: unknown;
  exactDialogueText?: unknown;
  closingText?: unknown;
  creationMode?: unknown;
  musicTrack?: unknown;
};

export type StoryArchitectRequestIssue = {
  path: string;
  message: string;
};

export type StoryArchitectRequestResult =
  | {
      success: true;
      data: StoryArchitectRequest;
    }
  | {
      success: false;
      issues: StoryArchitectRequestIssue[];
    };

const DURATION_VALUES = new Set([
  8,
  15,
  30,
  60,
  120,
  180,
  240,
  300,
]);

const ENUM_FIELDS = {
  aspectRatio: new Set(["9:16", "16:9"]),
  editingStyle: new Set([
    "auto",
    "social",
    "cinematic",
    "music-video",
  ]),
  audioStyle: new Set([
    "cinematic",
    "emotional",
    "upbeat",
    "electronic",
    "ambient",
    "no-music",
  ]),
  voiceMode: new Set([
    "auto",
    "dialogue",
    "voiceover",
    "no-voice",
  ]),
  speechContentMode: new Set([
    "exact",
    "generate",
  ]),
  spokenLanguage: new Set([
    "auto",
    "de",
    "en",
  ]),
  creationMode: new Set([
    "standard",
    "viral-story",
  ]),
} as const;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validateRequiredString(
  value: unknown,
  path: string,
  maximumLength: number,
  issues: StoryArchitectRequestIssue[],
): value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    issues.push({
      path,
      message: "Pflichttext fehlt.",
    });
    return false;
  }

  if (value.length > maximumLength) {
    issues.push({
      path,
      message: `Text ist länger als ${maximumLength} Zeichen.`,
    });
    return false;
  }

  return true;
}

function validateOptionalString(
  value: unknown,
  path: string,
  maximumLength: number,
  issues: StoryArchitectRequestIssue[],
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string") {
    issues.push({
      path,
      message: "Muss Text sein.",
    });
    return;
  }

  if (value.length > maximumLength) {
    issues.push({
      path,
      message: `Text ist länger als ${maximumLength} Zeichen.`,
    });
  }
}

export function parseStoryArchitectRequest(
  value: unknown,
): StoryArchitectRequestResult {
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [
        {
          path: "$",
          message: "Request muss ein JSON-Objekt sein.",
        },
      ],
    };
  }

  const issues: StoryArchitectRequestIssue[] = [];
  const story = value.story;

  if (!isRecord(story)) {
    issues.push({
      path: "story",
      message: "Geschichte fehlt oder ist ungültig.",
    });
  } else {
    validateRequiredString(
      story.title,
      "story.title",
      200,
      issues,
    );
    validateRequiredString(
      story.genre,
      "story.genre",
      100,
      issues,
    );
    validateRequiredString(
      story.mood,
      "story.mood",
      200,
      issues,
    );
    validateRequiredString(
      story.setting,
      "story.setting",
      1_000,
      issues,
    );
    validateRequiredString(
      story.summary,
      "story.summary",
      12_000,
      issues,
    );

    if (
      !Array.isArray(story.characters) ||
      story.characters.length === 0 ||
      story.characters.length > 9
    ) {
      issues.push({
        path: "story.characters",
        message: "Es werden ein bis neun Figuren benötigt.",
      });
    } else {
      story.characters.forEach(
        (character, index) => {
          if (!isRecord(character)) {
            issues.push({
              path: `story.characters[${index}]`,
              message: "Figur muss ein Objekt sein.",
            });
            return;
          }

          validateRequiredString(
            character.id,
            `story.characters[${index}].id`,
            120,
            issues,
          );
          validateRequiredString(
            character.name,
            `story.characters[${index}].name`,
            120,
            issues,
          );
          validateRequiredString(
            character.description,
            `story.characters[${index}].description`,
            4_000,
            issues,
          );
        },
      );
    }
  }

  if (
    value.targetDurationSeconds !== undefined &&
    !DURATION_VALUES.has(
      value.targetDurationSeconds as number,
    )
  ) {
    issues.push({
      path: "targetDurationSeconds",
      message: "Nicht unterstützte Videolänge.",
    });
  }

  for (const [field, values] of Object.entries(
    ENUM_FIELDS,
  )) {
    const fieldValue = value[field];

    if (
      fieldValue !== undefined &&
      (
        typeof fieldValue !== "string" ||
        !values.has(fieldValue as never)
      )
    ) {
      issues.push({
        path: field,
        message: "Nicht unterstützter Wert.",
      });
    }
  }

  validateOptionalString(
    value.voiceoverText,
    "voiceoverText",
    4_000,
    issues,
  );
  validateOptionalString(
    value.exactDialogueText,
    "exactDialogueText",
    4_000,
    issues,
  );
  validateOptionalString(
    value.closingText,
    "closingText",
    160,
    issues,
  );

  if (
    value.musicTrack !== undefined &&
    !isRecord(value.musicTrack)
  ) {
    issues.push({
      path: "musicTrack",
      message: "Musikreferenz muss ein Objekt sein.",
    });
  }

  if (issues.length > 0) {
    return {
      success: false,
      issues,
    };
  }

  return {
    success: true,
    data: value as StoryArchitectRequest,
  };
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function parseStoryArchitectJson(
  text: string,
): {
  parsed: unknown;
  cleanedText: string;
} | null {
  const unfenced = stripJsonFence(text);
  const objectText =
    extractFirstJsonObject(unfenced) ??
    unfenced;
  const cleanedText = objectText.replace(
    /,\s*([}\]])/g,
    "$1",
  );

  try {
    return {
      parsed: JSON.parse(cleanedText),
      cleanedText,
    };
  } catch {
    return null;
  }
}

const requiredString = {
  type: "string",
  minLength: 1,
} as const;

const dialogueSchema = {
  type: "object",
  required: [
    "enabled",
    "speaker",
    "text",
    "language",
    "voiceDirection",
  ],
  properties: {
    enabled: { type: "boolean" },
    speaker: { type: "string" },
    text: { type: "string" },
    language: { type: "string" },
    voiceDirection: { type: "string" },
  },
} as const;

/**
 * The model still receives the detailed creative contract in the prompt. This
 * schema makes malformed top-level responses and missing executable shot data
 * impossible at the transport boundary.
 */
export const STORY_ARCHITECT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  required: ["productionBible", "moviePlan"],
  properties: {
    productionBible: {
      type: "object",
      required: [
        "characterBible",
        "visualBible",
        "cameraBible",
        "audioBible",
      ],
      properties: {
        characterBible: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: [
              "id",
              "name",
              "role",
              "fixedAppearance",
              "faceIdentity",
              "hair",
              "eyes",
              "bodyType",
              "clothing",
              "accessories",
              "movementStyle",
              "voiceIdentity",
            ],
            properties: {
              id: requiredString,
              name: requiredString,
              role: requiredString,
              fixedAppearance: requiredString,
              faceIdentity: requiredString,
              hair: requiredString,
              eyes: requiredString,
              bodyType: requiredString,
              clothing: requiredString,
              accessories: { type: "string" },
              movementStyle: requiredString,
              voiceIdentity: requiredString,
            },
          },
        },
        visualBible: { type: "object" },
        cameraBible: { type: "object" },
        audioBible: { type: "object" },
        viralBible: { type: "object" },
        performanceBible: { type: "object" },
        lightingBible: { type: "object" },
      },
    },
    moviePlan: {
      type: "object",
      required: [
        "targetDurationSeconds",
        "generatedDurationSeconds",
        "aspectRatio",
        "opening",
        "continuations",
        "endingStrategy",
        "finalPayoff",
        "finalCliffhanger",
        "characterContinuityRules",
        "visualContinuityRules",
        "cameraContinuityRules",
        "lightingContinuityRules",
        "audioContinuityRules",
        "storyContinuityRules",
      ],
      properties: {
        targetDurationSeconds: { type: "number" },
        generatedDurationSeconds: { type: "number" },
        aspectRatio: {
          type: "string",
          enum: ["9:16", "16:9"],
        },
        editingStyle: { type: "string" },
        provider: { type: "string" },
        videoModel: { type: "string" },
        generationStrategy: { type: "string" },
        opening: {
          type: "object",
          required: [
            "title",
            "durationSeconds",
            "storyBeat",
            "hook",
            "action",
            "dialogue",
            "veoPrompt",
            "audioPrompt",
            "negativePrompt",
          ],
          properties: {
            id: { type: "string" },
            title: requiredString,
            startSecond: { type: "number" },
            endSecond: { type: "number" },
            durationSeconds: { type: "number" },
            storyBeat: requiredString,
            hook: requiredString,
            emotionalBeat: { type: "string" },
            action: requiredString,
            location: { type: "string" },
            characterState: { type: "string" },
            environmentState: { type: "string" },
            cameraPlan: { type: "string" },
            lightingPlan: { type: "string" },
            performancePlan: { type: "string" },
            audioPlan: { type: "string" },
            dialogue: dialogueSchema,
            dialogueTurns: {
              type: "array",
              items: dialogueSchema,
            },
            veoPrompt: requiredString,
            audioPrompt: requiredString,
            negativePrompt: requiredString,
          },
        },
        continuations: {
          type: "array",
          items: {
            type: "object",
            required: [
              "id",
              "extensionNumber",
              "durationSeconds",
              "storyBeat",
              "actionContinuation",
              "dialogue",
              "continuationPrompt",
            ],
            properties: {
              id: { type: "number" },
              title: { type: "string" },
              extensionNumber: { type: "number" },
              startSecond: { type: "number" },
              endSecond: { type: "number" },
              durationSeconds: { type: "number" },
              storyBeat: requiredString,
              emotionalBeat: { type: "string" },
              escalationPurpose: { type: "string" },
              actionContinuation: requiredString,
              characterContinuity: { type: "string" },
              environmentContinuity: { type: "string" },
              cameraContinuation: { type: "string" },
              lightingContinuation: { type: "string" },
              performanceContinuation: { type: "string" },
              audioContinuation: { type: "string" },
              dialogue: dialogueSchema,
              dialogueTurns: {
                type: "array",
                items: dialogueSchema,
              },
              continuationPrompt: requiredString,
              audioPrompt: { type: "string" },
              negativePrompt: { type: "string" },
            },
          },
        },
        chapters: {
          type: "array",
          items: { type: "object" },
        },
        endingStrategy: requiredString,
        finalPayoff: requiredString,
        finalCliffhanger: { type: "string" },
        characterContinuityRules: requiredString,
        visualContinuityRules: requiredString,
        cameraContinuityRules: requiredString,
        lightingContinuityRules: requiredString,
        audioContinuityRules: requiredString,
        storyContinuityRules: requiredString,
      },
    },
  },
} as const;
