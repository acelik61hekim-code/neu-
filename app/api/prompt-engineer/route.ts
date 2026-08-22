import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

import type {
  ProductionMemory,
  PromptEngineerRequest,
  PromptEngineerResult,
  Scene,
  Story,
} from "@/types/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROMPT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
] as const;

const RETRIES_PER_MODEL = 2;
const INITIAL_RETRY_DELAY_MS = 1200;

type ErrorDetails = {
  status?: number;
  code?: number;
  message: string;
};

type PromptEngineerApiRequest = {
  story?: Story;
  scene?: Scene;
  previousScene?: Scene | null;
  nextScene?: Scene | null;
  productionMemory?: ProductionMemory;
};

type GeneratedPromptResult =
  PromptEngineerResult & {
    generationModel?: string;
  };

const promptResponseSchema = {
  type: "object",

  properties: {
    sceneId: {
      type: "integer",
    },

    veoPrompt: {
      type: "string",
    },

    audioPrompt: {
      type: "string",
    },

    negativePrompt: {
      type: "string",
    },

    dialogue: {
      type: "object",

      properties: {
        enabled: {
          type: "boolean",
        },

        speaker: {
          type: "string",
        },

        text: {
          type: "string",
        },

        language: {
          type: "string",
        },

        voiceDirection: {
          type: "string",
        },
      },

      required: [
        "enabled",
        "speaker",
        "text",
        "language",
        "voiceDirection",
      ],

      additionalProperties:
        false,
    },

    camera: {
      type: "string",
    },

    lighting: {
      type: "string",
    },

    style: {
      type: "string",
    },

    transition: {
      type: "string",
    },
  },

  required: [
    "sceneId",
    "veoPrompt",
    "audioPrompt",
    "negativePrompt",
    "dialogue",
    "camera",
    "lighting",
    "style",
    "transition",
  ],

  additionalProperties:
    false,
};

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value ===
      "string" &&
    value.trim().length >
      0
  );
}

function isString(
  value: unknown,
): value is string {
  return typeof value ===
    "string";
}

function readSceneDuration(
  value: unknown,
): number {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return NaN;
  }

  const record =
    value as Record<
      string,
      unknown
    >;

  return Number(
    record.durationSeconds,
  );
}

function isSupportedSceneDuration(
  durationSeconds: number,
): boolean {
  /*
   * 8 Sekunden bleiben für alte
   * Legacy-Szenen gültig.
   *
   * Neue Seedance-Szenen verwenden
   * 15 Sekunden.
   */
  return (
    durationSeconds ===
      8 ||
    durationSeconds ===
      15
  );
}

function isScene(
  value: unknown,
): value is Scene {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const scene =
    value as Partial<Scene>;

  const durationSeconds =
    readSceneDuration(
      value,
    );

  return (
    typeof scene.id ===
      "number" &&

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

    isNonEmptyString(
      scene.continuityNotes,
    ) &&

    typeof scene.dialogue ===
      "object" &&

    scene.dialogue !==
      null &&

    isSupportedSceneDuration(
      durationSeconds,
    )
  );
}

function isStory(
  value: unknown,
): value is Story {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const story =
    value as Partial<Story>;

  return (
    isNonEmptyString(
      story.title,
    ) &&

    isNonEmptyString(
      story.genre,
    ) &&

    isNonEmptyString(
      story.mood,
    ) &&

    isNonEmptyString(
      story.setting,
    ) &&

    isNonEmptyString(
      story.summary,
    ) &&

    Array.isArray(
      story.characters,
    ) &&

    typeof story.productionBible ===
      "object" &&

    story.productionBible !==
      null &&

    Array.isArray(
      story.scenes,
    )
  );
}

function isProductionMemory(
  value: unknown,
): value is ProductionMemory {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Array.isArray(
      value,
    )
  ) {
    return false;
  }

  const memory =
    value as Partial<ProductionMemory>;

  return (
    Array.isArray(
      memory.characters,
    ) &&

    Array.isArray(
      memory.locations,
    ) &&

    Array.isArray(
      memory.props,
    ) &&

    Array.isArray(
      memory.sceneContinuity,
    ) &&

    isString(
      memory.globalVisualStyle,
    ) &&

    isString(
      memory.globalColorGrade,
    ) &&

    isString(
      memory.globalCameraLanguage,
    ) &&

    isString(
      memory.globalLightingStyle,
    ) &&

    isString(
      memory.globalAudioStyle,
    )
  );
}

function isPromptEngineerResult(
  value: unknown,
): value is PromptEngineerResult {
  if (
    typeof value !==
      "object" ||
    value === null
  ) {
    return false;
  }

  const result =
    value as Partial<PromptEngineerResult>;

  if (
    typeof result.sceneId !==
      "number" ||

    !isNonEmptyString(
      result.veoPrompt,
    ) ||

    !isNonEmptyString(
      result.audioPrompt,
    ) ||

    !isNonEmptyString(
      result.negativePrompt,
    ) ||

    !isNonEmptyString(
      result.camera,
    ) ||

    !isNonEmptyString(
      result.lighting,
    ) ||

    !isNonEmptyString(
      result.style,
    ) ||

    !isNonEmptyString(
      result.transition,
    )
  ) {
    return false;
  }

  if (
    typeof result.dialogue !==
      "object" ||
    result.dialogue ===
      null
  ) {
    return false;
  }

  const dialogue =
    result.dialogue;

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

function cleanJsonText(
  text: string,
): string {
  return text
    .trim()
    .replace(
      /^```json\s*/i,
      "",
    )
    .replace(
      /^```\s*/i,
      "",
    )
    .replace(
      /\s*```$/i,
      "",
    )
    .trim();
}

function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (
      resolve,
    ) => {
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
      const nestedRecord =
        nestedError as Record<
          string,
          unknown
        >;

      if (
        typeof nestedRecord.status ===
        "number"
      ) {
        status =
          nestedRecord.status;
      }

      if (
        typeof nestedRecord.code ===
        "number"
      ) {
        code =
          nestedRecord.code;
      }

      if (
        typeof nestedRecord.message ===
        "string"
      ) {
        message =
          nestedRecord.message;
      }
    }
  }

  const statusMatch =
    message.match(
      /\b(400|401|403|404|408|429|500|502|503|504)\b/,
    );

  if (
    !status &&
    statusMatch
  ) {
    status =
      Number(
        statusMatch[1],
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

  const retryableStatuses = [
    408,
    429,
    500,
    502,
    503,
    504,
  ];

  if (
    details.status &&
    retryableStatuses.includes(
      details.status,
    )
  ) {
    return true;
  }

  if (
    details.code &&
    retryableStatuses.includes(
      details.code,
    )
  ) {
    return true;
  }

  const normalizedMessage =
    details.message.toLowerCase();

  return (
    normalizedMessage.includes(
      "unavailable",
    ) ||

    normalizedMessage.includes(
      "high demand",
    ) ||

    normalizedMessage.includes(
      "overloaded",
    ) ||

    normalizedMessage.includes(
      "temporarily",
    ) ||

    normalizedMessage.includes(
      "resource exhausted",
    ) ||

    normalizedMessage.includes(
      "too many requests",
    ) ||

    normalizedMessage.includes(
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

  const normalizedMessage =
    details.message.toLowerCase();

  return (
    normalizedMessage.includes(
      "model not found",
    ) ||

    normalizedMessage.includes(
      "not found for api version",
    ) ||

    normalizedMessage.includes(
      "is not supported",
    )
  );
}

function createRetryDelay(
  attempt: number,
): number {
  const exponentialDelay =
    INITIAL_RETRY_DELAY_MS *
    2 ** (
      attempt -
      1
    );

  const jitter =
    Math.floor(
      Math.random() *
      500,
    );

  return (
    exponentialDelay +
    jitter
  );
}

async function generatePromptWithFallback(
  ai: GoogleGenAI,
  prompt: string,
): Promise<{
  text: string;
  model: string;
}> {
  let lastError:
    unknown;

  for (
    const model of
    PROMPT_MODELS
  ) {
    for (
      let attempt = 1;
      attempt <=
        RETRIES_PER_MODEL;
      attempt += 1
    ) {
      try {
        console.log(
          `Prompt Engineer: ${model}, Versuch ${attempt}/${RETRIES_PER_MODEL}`,
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

                responseJsonSchema:
                  promptResponseSchema,

                temperature:
                  0.2,

                maxOutputTokens:
                  8192,
              },
            });

        const text =
          response.text
            ?.trim();

        if (
          !text
        ) {
          throw new Error(
            "Gemini hat keine Prompt-Antwort zurückgegeben.",
          );
        }

        return {
          text,
          model,
        };
      } catch (
        error:
          unknown
      ) {
        lastError =
          error;

        console.warn(
          `Prompt Engineer fehlgeschlagen: ${model}, Versuch ${attempt}`,
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

function buildSegmentTimeline(
  durationSeconds: number,
): string {
  if (
    durationSeconds <=
    8
  ) {
    return [
      "- 0.0 to 1.0 seconds",
      "- 1.0 to 3.0 seconds",
      "- 3.0 to 6.0 seconds",
      "- 6.0 to 8.0 seconds",
    ].join("\n");
  }

  return [
    "- 0.0 to 3.0 seconds",
    "- 3.0 to 7.0 seconds",
    "- 7.0 to 11.0 seconds",
    `- 11.0 to ${durationSeconds.toFixed(1)} seconds`,
  ].join("\n");
}

function buildPromptEngineerPrompt({
  story,
  scene,
  previousScene,
  nextScene,
  productionMemory,
}: PromptEngineerRequest): string {
  const previousSceneText =
    previousScene
      ? JSON.stringify(
          previousScene,
          null,
          2,
        )
      : "Keine vorherige Szene. Dies ist der Beginn des Films.";

  const nextSceneText =
    nextScene
      ? JSON.stringify(
          nextScene,
          null,
          2,
        )
      : "Keine nächste Szene. Dies ist das Ende des Films.";

  const productionMemoryText =
    productionMemory
      ? JSON.stringify(
          productionMemory,
          null,
          2,
        )
      : "No runtime production memory exists yet. Use the production bible and planned scene continuity.";

  const segmentDuration =
    readSceneDuration(
      scene,
    );

  const segmentTimeline =
    buildSegmentTimeline(
      segmentDuration,
    );

  return `
You are a professional continuity-focused prompt engineer for Seedance 2.0 Fast.

You are not creating an isolated video.

You are creating one ${segmentDuration}-second segment of a single continuous movie that may be split into multiple separately generated clips.

The viewer should not notice that the clips were generated separately.

Your output must strictly preserve the production bible and the exact continuity state from the surrounding scenes.

STORY

Title:
${story.title}

Genre:
${story.genre}

Mood:
${story.mood}

Setting:
${story.setting}

Summary:
${story.summary}

PRODUCTION BIBLE

${JSON.stringify(
  story.productionBible,
  null,
  2,
)}

CURRENT PRODUCTION MEMORY

${productionMemoryText}

PRODUCTION MEMORY RULES

- Treat ProductionMemory as the latest authoritative runtime state.
- The Production Bible remains authoritative for permanent identity and style rules.
- When runtime state and the original scene plan differ because of an already completed scene, preserve the newer runtime state.
- Never restore an older character position, pose, expression or visible condition.
- Never restore outdated clothing, accessories, dirt, damage, moisture or carried objects.
- Never move a prop back to an older owner or location.
- Never restore an outdated environment, lighting, weather or time-of-day state.
- Never restore an outdated camera position or movement state.
- Use previousLastFrameUrl and sceneContinuity metadata as continuity references when present.
- Never claim that the video model can see a URL unless that image or video is actually supplied to the provider request as reference media.
- If no runtime memory exists yet, follow the Production Bible and the planned scene states exactly.

PREVIOUS SCENE

${previousSceneText}

CURRENT SCENE

${JSON.stringify(
  scene,
  null,
  2,
)}

NEXT SCENE

${nextSceneText}

CORE CONTINUITY RULES

- Treat every scene as part of one uninterrupted movie.
- Do not redesign any character.
- Do not change any face.
- Do not change facial proportions.
- Do not change age.
- Do not change hairstyle.
- Do not change hair color.
- Do not change eye color.
- Do not change body type.
- Do not change clothing.
- Do not change shoes.
- Do not change accessories.
- Do not change held objects.
- Do not change dirt, damage, blood, moisture or wear unless explicitly shown.
- Do not change voice identity.
- Do not change environment without a visible cause.
- Do not change weather without a visible cause.
- Do not change time of day.
- Do not change light direction.
- Do not change color grade.
- Do not change camera language.
- Do not create an unrelated establishing shot.
- Do not invent new people, objects or architecture.

The current scene must begin exactly from its startFrame.

If a previous scene exists, the first visible frame must reproduce the previous scene's endingFrame as closely as possible.

The current scene must end exactly at its endingFrame.

If a next scene exists, the final frame must be suitable as the exact visual starting frame of the next clip.

CHARACTER CONSISTENCY

Use the exact character descriptions from productionBible.characterBible.

Repeat all visually important identity traits directly inside veoPrompt.

Do not summarize them with phrases such as:

- same character
- same person as before
- unchanged clothing
- consistent appearance

Each separately generated provider request must be understandable on its own.

Therefore, write the exact face, hair, body, clothing, accessories, movement style and visible condition again in the prompt.

Do not invent details that contradict the character bible.

CAMERA CONTINUITY

Use productionBible.cameraBible.

The camera state at the beginning must match scene.cameraStateAtStart.

The camera state at the end must match scene.cameraStateAtEnd.

If the previous camera was moving, continue that movement naturally.

Do not introduce a hard cut unless the scene explicitly requires one.

Prefer continuous camera motion, motivated reframing or hidden cuts through darkness, foreground objects, whip movement or occlusion.

VISUAL CONTINUITY

Use productionBible.visualBible.

Preserve:

- realism level
- texture detail
- color grading
- contrast
- lighting character
- shadows
- atmosphere
- weather
- environmental materials
- depth of field
- cinematic style

Do not use generic phrases alone.

Describe the visible continuity concretely.

AUDIO CONTINUITY

Use productionBible.audioBible.

The audioPrompt must preserve continuous ambience, music character, environmental sounds and volume relationships.

If a sound is active at the end of the previous scene, it must continue naturally at the beginning of this scene.

If a sound continues into the next scene, describe how it remains active at the ending frame.

Avoid abrupt resets of ambience or music.

DIALOGUE

Use the dialogue object from the current scene.

If dialogue.enabled is false:

- return enabled: false
- speaker: ""
- text: ""
- language: ""
- voiceDirection: ""
- do not invent speech
- do not add narration

If dialogue.enabled is true:

- preserve the exact speaker
- preserve the exact text
- preserve the exact language
- preserve the exact voice direction
- do not rewrite the spoken sentence
- do not translate it
- do not add extra words
- request clear natural speech
- request accurate synchronized lip movement
- keep the spoken line short enough for the ${segmentDuration}-second segment
- keep dialogue louder than music
- do not create subtitles

VIDEO PROMPT REQUIREMENTS

The field is still called veoPrompt for backward compatibility inside the application, but the content must be a production-ready English Seedance 2.0 Fast prompt.

veoPrompt must be fully written in English.

It must include:

1. exact ${segmentDuration}-second duration
2. the exact project composition and intended aspect ratio
3. exact starting frame
4. complete visible character identities
5. exact character positions and poses
6. exact environment state
7. exact lighting
8. exact camera position and movement
9. second-by-second action progression
10. exact ending frame
11. continuity into the next scene
12. realistic anatomy and motion
13. realistic facial expressions
14. realistic hand and finger behavior
15. no visible text

Use a clear timeline such as:

${segmentTimeline}

The timeline must not add unrelated actions.

The opening moment must immediately preserve continuity from the previous clip.

The final moment must settle into the precise ending frame or a natural continuation state for the next segment.

For a 15-second Seedance segment, use the extra duration for meaningful action progression, reactions, camera movement and continuity rather than stretching a single static action.

Seedance may support multiple motivated shots inside one generation, but every cut must preserve character identity, wardrobe, environment, screen direction, lighting and story continuity.

AUDIO PROMPT REQUIREMENTS

audioPrompt must be written in English.

It must describe:

- continuous ambience
- sound effects synchronized with visible actions
- music continuity
- dialogue when enabled
- voice identity
- speech emotion
- speech volume
- lip synchronization
- audio state at the beginning
- audio state at the ending
- no narrator unless explicitly required
- no subtitles
- no spoken text beyond the defined dialogue

NEGATIVE PROMPT REQUIREMENTS

negativePrompt must explicitly forbid:

- identity drift
- face changes
- hairstyle changes
- clothing changes
- accessory changes
- age changes
- body changes
- voice changes
- duplicated characters
- extra people
- disappearing objects
- teleportation
- spatial discontinuity
- lighting jumps
- weather changes
- color-grade changes
- camera discontinuity
- reversed movement direction
- malformed hands
- extra fingers
- facial distortion
- lip-sync mismatch
- subtitles
- captions
- logos
- watermarks
- visible text
- interface elements
- abrupt audio changes

OUTPUT FIELDS

sceneId:
Return the exact current scene ID.

veoPrompt:
A production-ready English Seedance 2.0 Fast video prompt. The legacy field name veoPrompt must remain unchanged.

audioPrompt:
A production-ready English audio prompt.

negativePrompt:
A detailed English negative prompt.

dialogue:
Return the current scene dialogue unchanged.

camera:
Summarize the exact camera setup and camera movement.

lighting:
Summarize the fixed lighting state.

style:
Summarize the fixed visual identity from the production bible.

transition:
Describe precisely how this clip begins from the previous ending frame and how its ending frame connects into the next scene.

FINAL INTERNAL CHECK

Before returning JSON, verify:

- sceneId matches the current scene
- veoPrompt is in English
- veoPrompt is written for a ${segmentDuration}-second Seedance segment
- audioPrompt is in English
- all character identity traits match the production bible
- clothing and accessories are preserved
- startFrame is explicitly represented
- endingFrame is explicitly represented
- camera continuity is preserved
- lighting continuity is preserved
- environment continuity is preserved
- dialogue is copied exactly
- dialogue is not invented when disabled
- no subtitles or visible text are requested
- the clip can connect directly to the surrounding clips

Return only valid JSON matching the required schema.
`;
}

export async function POST(
  request: Request,
) {
  const apiKey =
    process.env
      .GEMINI_API_KEY;

  if (
    !apiKey
  ) {
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
    PromptEngineerApiRequest;

  try {
    body =
      (
        await request.json()
      ) as PromptEngineerApiRequest;
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
    !isStory(
      body.story,
    )
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Die vollständige Story einschließlich productionBible fehlt oder ist ungültig.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    !isScene(
      body.scene,
    )
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Die übergebene Szene ist unvollständig oder ungültig. Unterstützt werden 15-Sekunden-Szenen sowie alte 8-Sekunden-Legacy-Szenen.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    body.previousScene !==
      undefined &&
    body.previousScene !==
      null &&
    !isScene(
      body.previousScene,
    )
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Die vorherige Szene ist ungültig.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    body.nextScene !==
      undefined &&
    body.nextScene !==
      null &&
    !isScene(
      body.nextScene,
    )
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Die nächste Szene ist ungültig.",
      },
      {
        status:
          400,
      },
    );
  }

  const story =
    body.story;

  const scene =
    body.scene;

  const previousScene =
    body.previousScene ??
    null;

  const nextScene =
    body.nextScene ??
    null;

  const productionMemory =
    body.productionMemory ??
    story.productionMemory;

  if (
    productionMemory !==
      undefined &&
    !isProductionMemory(
      productionMemory,
    )
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Der Production Memory ist ungültig.",
      },
      {
        status:
          400,
      },
    );
  }

  const expectedScene =
    story.scenes.find(
      (
        storyScene,
      ) =>
        storyScene.id ===
        scene.id,
    );

  if (
    !expectedScene
  ) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "Die Szene gehört nicht zur übergebenen Story.",
      },
      {
        status:
          400,
      },
    );
  }

  const prompt =
    buildPromptEngineerPrompt({
      story,
      scene,
      previousScene,
      nextScene,
      productionMemory,
    });

  try {
    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const generationResult =
      await generatePromptWithFallback(
        ai,
        prompt,
      );

    const cleanedText =
      cleanJsonText(
        generationResult.text,
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
        "Ungültige Prompt-Engineer-Antwort:",
        {
          model:
            generationResult.model,

          parseError,

          rawText:
            generationResult.text,
        },
      );

      return NextResponse.json(
        {
          success:
            false,

          error:
            "Der Prompt Engineer hat ungültiges JSON erzeugt. Bitte versuche es erneut.",
        },
        {
          status:
            502,
        },
      );
    }

    if (
      !isPromptEngineerResult(
        parsed,
      )
    ) {
      console.error(
        "Prompt-Engineer-Antwort hat ein ungültiges Format:",
        {
          model:
            generationResult.model,

          parsed,
        },
      );

      return NextResponse.json(
        {
          success:
            false,

          error:
            "Der Prompt Engineer hat unvollständige Produktionsanweisungen erzeugt.",
        },
        {
          status:
            502,
        },
      );
    }

    /*
     * Die aktuelle Szene wird vom Server
     * vorgegeben.
     *
     * Falls Gemini versehentlich eine
     * falsche sceneId zurückgibt,
     * normalisieren wir sie auf die
     * bereits validierte Szenen-ID.
     */
    if (
      parsed.sceneId !==
      scene.id
    ) {
      console.warn(
        "Prompt Engineer hat eine abweichende Szenen-ID zurückgegeben:",
        {
          model:
            generationResult.model,

          expectedSceneId:
            scene.id,

          returnedSceneId:
            parsed.sceneId,
        },
      );
    }

    const normalizedResult:
      PromptEngineerResult = {
      ...parsed,

      sceneId:
        scene.id,
    };

    /*
     * Der Dialog wird bewusst wieder
     * aus dem Story Architect übernommen.
     *
     * Dadurch darf der Prompt Engineer
     * Wörter, Sprecher oder Sprache
     * nicht verändern.
     */
    const finalResult:
      GeneratedPromptResult = {
      ...normalizedResult,

      dialogue: {
        ...scene.dialogue,
      },

      generationModel:
        generationResult.model,
    };

    return NextResponse.json(
      finalResult,
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
      "Prompt-Engineer-Fehler:",
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
            "Die Gemini-Modelle sind momentan ausgelastet. Mehrere Modelle und automatische Wiederholungen wurden bereits versucht. Bitte probiere es gleich erneut.",
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
          details.status >=
            400 &&
          details.status <=
            599
            ? details.status
            : 500,
      },
    );
  }
}