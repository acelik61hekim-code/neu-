import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VEO_MODEL =
  "veo-3.1-fast-generate-preview";

type DialogueInput = {
  enabled?: unknown;
  speaker?: unknown;
  text?: unknown;
  language?: unknown;
  voiceDirection?: unknown;
};

type GenerateVideoRequest = {
  prompt?: unknown;
  audioPrompt?: unknown;
  negativePrompt?: unknown;
  dialogue?: unknown;
};

type ParsedDialogue = {
  enabled: true;
  speaker: string;
  text: string;
  language: string;
  voiceDirection: string;
};

type SerializedError = {
  name?: string;
  message: string;
  status?: number;
  code?: number | string;
  response?: unknown;
  cause?: unknown;
};

function serializeError(
  error: unknown,
): SerializedError {
  if (error instanceof Error) {
    const extendedError =
      error as Error & {
        status?: number;
        code?: number | string;
        response?: unknown;
        cause?: unknown;
      };

    return {
      name: extendedError.name,
      message: extendedError.message,
      status: extendedError.status,
      code: extendedError.code,
      response: extendedError.response,
      cause: extendedError.cause,
    };
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const record =
      error as Record<string, unknown>;

    return {
      message:
        typeof record.message === "string"
          ? record.message
          : "Unbekannter Fehler bei der Veo-Anfrage.",
      status:
        typeof record.status === "number"
          ? record.status
          : undefined,
      code:
        typeof record.code === "number" ||
        typeof record.code === "string"
          ? record.code
          : undefined,
      response: record.response,
      cause: record.cause,
    };
  }

  return {
    message: String(error),
  };
}

function readOptionalString(
  value: unknown,
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function parseDialogue(
  value: unknown,
): ParsedDialogue | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const dialogue =
    value as DialogueInput;

  /*
   * Nur enabled === true aktiviert Sprache.
   * Dadurch wird bei deaktiviertem Dialog
   * niemals versehentlich Sprache erzeugt.
   */
  if (dialogue.enabled !== true) {
    return null;
  }

  const speaker =
    readOptionalString(
      dialogue.speaker,
    );

  const text =
    readOptionalString(
      dialogue.text,
    );

  const language =
    readOptionalString(
      dialogue.language,
    );

  const voiceDirection =
    readOptionalString(
      dialogue.voiceDirection,
    );

  if (!text) {
    return null;
  }

  return {
    enabled: true,
    speaker:
      speaker ||
      "The visible speaking character",
    text,
    language:
      language || "German",
    voiceDirection:
      voiceDirection ||
      "Natural, clearly audible and emotionally appropriate.",
  };
}

function buildDialogueSection(
  dialogue: ParsedDialogue,
): string[] {
  return [
    "",
    "SPOKEN DIALOGUE:",
    `Speaker: ${dialogue.speaker}`,
    `Language: ${dialogue.language}`,
    `Exact spoken words: "${dialogue.text}"`,
    `Voice direction: ${dialogue.voiceDirection}`,
    "",
    "The visible speaker must say exactly the defined words once.",
    "Use natural pronunciation, realistic breathing and accurate synchronized lip movement.",
    "The mouth, jaw and facial movement must visibly match the spoken dialogue.",
    "Preserve the speaker's voice identity throughout the clip.",
    "Keep the dialogue clearly audible above music and background ambience.",
    "Do not replace the dialogue with narration or voice-over.",
    "Do not paraphrase, translate, repeat or add spoken words.",
    "Do not let another character speak the defined line.",
    "Do not display the dialogue as subtitles, captions or visible text.",
  ];
}

function buildNoDialogueSection(): string[] {
  return [
    "",
    "DIALOGUE RESTRICTIONS:",
    "No spoken dialogue.",
    "No narration.",
    "No voice-over.",
    "No whispering.",
    "No unintelligible speech.",
    "No background conversations.",
    "No vocalized words.",
    "Characters may breathe or make natural nonverbal reactions only when visually appropriate.",
  ];
}

function buildFinalPrompt({
  prompt,
  audioPrompt,
  negativePrompt,
  dialogue,
}: {
  prompt: string;
  audioPrompt: string;
  negativePrompt: string;
  dialogue: ParsedDialogue | null;
}): string {
  const sections: string[] = [
    "Create one cinematic vertical video that belongs to a continuous multi-scene film.",
    "Duration: exactly 8 seconds.",
    "Aspect ratio: 9:16.",
    "Resolution: 720p.",
    "",
    "VISUAL DIRECTION:",
    prompt,
  ];

  if (dialogue) {
    sections.push(
      ...buildDialogueSection(
        dialogue,
      ),
    );
  } else {
    sections.push(
      ...buildNoDialogueSection(),
    );
  }

  if (audioPrompt) {
    sections.push(
      "",
      "AUDIO DIRECTION:",
      audioPrompt,
    );
  }

  if (negativePrompt) {
    sections.push(
      "",
      "NEGATIVE REQUIREMENTS:",
      negativePrompt,
    );
  }

  sections.push(
    "",
    "GLOBAL REQUIREMENTS:",
    "Follow the visual direction exactly without inventing unrelated actions, characters or objects.",
    "Maintain the exact character identity, face, hairstyle, body type, clothing and accessories described in the prompt.",
    "Maintain the exact environment, lighting, weather, color grade and camera language described in the prompt.",
    "Maintain realistic facial anatomy and natural facial expressions.",
    "Maintain realistic hands, fingers, body proportions and physical movement.",
    "Keep character and object positions spatially continuous throughout the clip.",
    "Do not teleport characters or objects.",
    "Do not reverse established movement direction unless explicitly requested.",
    "Keep voices, ambience and sound effects temporally synchronized with the visible action.",
    "Avoid abrupt audio resets at the beginning or ending of the clip.",
    "Do not add subtitles, captions, logos, watermarks, interface elements or visible text.",
  );

  return sections.join("\n");
}

function getErrorStatus(
  details: SerializedError,
): number {
  if (
    typeof details.status === "number"
  ) {
    return details.status;
  }

  if (
    typeof details.code === "number"
  ) {
    return details.code;
  }

  const statusMatch =
    details.message.match(
      /\b(400|401|403|404|408|429|500|502|503|504)\b/,
    );

  if (statusMatch) {
    return Number(statusMatch[1]);
  }

  return 500;
}

export async function POST(
  request: Request,
) {
  if (process.env.LEGACY_VEO_ROUTES_ENABLED !== "true") {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 },
    );
  }
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt. PrÃ¼fe deine .env.local und starte den Server danach neu.",
      },
      {
        status: 500,
      },
    );
  }

  let body: GenerateVideoRequest;

  try {
    body =
      (await request.json()) as GenerateVideoRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Request-Body enthÃ¤lt kein gÃ¼ltiges JSON.",
      },
      {
        status: 400,
      },
    );
  }

  const prompt =
    readOptionalString(
      body.prompt,
    );

  const audioPrompt =
    readOptionalString(
      body.audioPrompt,
    );

  const negativePrompt =
    readOptionalString(
      body.negativePrompt,
    );

  const dialogue =
    parseDialogue(
      body.dialogue,
    );

  if (!prompt) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Video-Prompt fehlt.",
      },
      {
        status: 400,
      },
    );
  }

  if (prompt.length < 20) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Video-Prompt ist zu kurz.",
      },
      {
        status: 400,
      },
    );
  }

  if (prompt.length > 12000) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Video-Prompt ist zu lang.",
      },
      {
        status: 400,
      },
    );
  }

  if (audioPrompt.length > 5000) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Audio-Prompt ist zu lang.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    negativePrompt.length >
    5000
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Negative-Prompt ist zu lang.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    dialogue &&
    dialogue.text.length > 180
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Dialog ist fÃ¼r ein 8-Sekunden-Video zu lang. Verwende hÃ¶chstens einen kurzen Satz.",
      },
      {
        status: 400,
      },
    );
  }

  const finalPrompt =
    buildFinalPrompt({
      prompt,
      audioPrompt,
      negativePrompt,
      dialogue,
    });

  try {
    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const operation =
      await ai.models.generateVideos({
        model: VEO_MODEL,
        prompt: finalPrompt,
        config: {
          aspectRatio: "9:16",
          resolution: "720p",
          numberOfVideos: 1,
        },
      });

    if (!operation.name) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Veo hat keine Operation-ID zurÃ¼ckgegeben.",
        },
        {
          status: 502,
        },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Die Veo-Videogenerierung wurde gestartet.",
      model: VEO_MODEL,
      operationName:
        operation.name,
      done:
        operation.done ?? false,
      dialogueRequested:
        Boolean(dialogue),
    });
  } catch (error: unknown) {
    const details =
      serializeError(error);

    const status =
      getErrorStatus(details);

    console.error(
      "Veo-Videogenerierung fehlgeschlagen:",
      {
        model: VEO_MODEL,
        status,
        details,
        error,
      },
    );

    let userMessage =
      details.message;

    if (status === 429) {
      userMessage =
        "Dein Veo-Kontingent oder Rate-Limit ist aktuell ausgeschÃ¶pft. PrÃ¼fe dein Google-AI-Billing und deine API-Limits oder versuche es spÃ¤ter erneut.";
    } else if (
      status === 401 ||
      status === 403
    ) {
      userMessage =
        "Die Veo-Anfrage wurde nicht autorisiert. PrÃ¼fe deinen GEMINI_API_KEY, das Google-AI-Projekt und die Freigabe des Veo-Modells.";
    } else if (
      status === 404
    ) {
      userMessage =
        "Das konfigurierte Veo-Modell wurde nicht gefunden oder ist fÃ¼r dein Projekt nicht verfÃ¼gbar.";
    } else if (
      status === 503 ||
      status === 504
    ) {
      userMessage =
        "Veo ist momentan ausgelastet oder nicht erreichbar. Bitte versuche es spÃ¤ter erneut.";
    }

    return NextResponse.json(
      {
        success: false,
        model: VEO_MODEL,
        error: userMessage,
        details,
      },
      {
        status:
          status >= 400 &&
          status <= 599
            ? status
            : 500,
      },
    );
  }
}