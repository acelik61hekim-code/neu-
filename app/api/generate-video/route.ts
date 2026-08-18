import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VEO_MODEL = "veo-3.1-generate-preview";

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

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const extendedError = error as Error & {
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

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;

    return {
      message:
        typeof record.message === "string"
          ? record.message
          : "Unbekannter Fehler bei der Veo-Anfrage.",
      status: typeof record.status === "number" ? record.status : undefined,
      code:
        typeof record.code === "number" || typeof record.code === "string"
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

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDialogue(value: unknown): ParsedDialogue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const dialogue = value as DialogueInput;

  // Nur enabled === true aktiviert Sprache, damit nie versehentlich
  // Sprache erzeugt wird, wenn der Dialog deaktiviert ist.
  if (dialogue.enabled !== true) {
    return null;
  }

  const speaker = readOptionalString(dialogue.speaker);
  const text = readOptionalString(dialogue.text);
  const language = readOptionalString(dialogue.language);
  const voiceDirection = readOptionalString(dialogue.voiceDirection);

  if (!text) {
    return null;
  }

  return {
    enabled: true,
    speaker: speaker || "the visible speaking character",
    text,
    language: language || "German",
    voiceDirection: voiceDirection || "natural and emotionally fitting",
  };
}

/**
 * GEÄNDERT: Der Dialog wird jetzt als ein natürlicher Satz direkt in die
 * Szenenbeschreibung eingebettet statt als separater Block danach.
 * Das entspricht dem offiziellen Google-Prompting-Muster für Veo 3.1
 * ("A woman says, 'We have to leave now.'" direkt im Fließtext der Szene).
 * So weiß das Modell eindeutig, WER genau spricht, statt es aus einem
 * separaten Metadaten-Block erschließen zu müssen — gerade bei Szenen mit
 * mehreren Figuren/Objekten (z. B. mehreren Früchten) wichtig.
 */
function buildDialogueSentence(dialogue: ParsedDialogue): string {
  return `${dialogue.speaker} looks toward the camera and says, in a ${dialogue.voiceDirection} voice, in ${dialogue.language}: "${dialogue.text}"`;
}

function buildDialogueFollowUp(): string[] {
  return [
    "",
    "The mouth, jaw and facial movement must visibly match the spoken words (accurate lip sync).",
    "Say the line exactly once, with natural pacing and breathing.",
    "Keep the dialogue clearly audible above music and ambience.",
    "Do not show the dialogue as subtitles, captions or on-screen text.",
    "No other character speaks this line.",
  ];
}

function buildNoDialogueSection(): string[] {
  return [
    "",
    "No spoken dialogue, narration, voice-over or unintelligible speech.",
    "Characters may breathe or react nonverbally only when visually natural.",
  ];
}

/**
 * GEÄNDERT: "GLOBAL REQUIREMENTS" von 11 auf 5 Kernregeln reduziert.
 * Viele generische "Do not..."-Zeilen in Serie konkurrieren um Aufmerksamkeit
 * mit deiner eigentlichen Szenenbeschreibung. Weniger, dafür gezieltere
 * Anweisungen werden von Veo erfahrungsgemäß zuverlässiger befolgt.
 */
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
  const scene = dialogue
    ? `${prompt} ${buildDialogueSentence(dialogue)}`
    : prompt;

  const sections: string[] = [
    "Create one cinematic vertical video.",
    "Duration: exactly 8 seconds. Aspect ratio: 9:16. Resolution: 1080p.",
    "",
    "SCENE:",
    scene,
  ];

  if (dialogue) {
    sections.push(...buildDialogueFollowUp());
  } else {
    sections.push(...buildNoDialogueSection());
  }

  if (audioPrompt) {
    sections.push("", "AUDIO DIRECTION:", audioPrompt);
  }

  if (negativePrompt) {
    sections.push("", "NEGATIVE REQUIREMENTS:", negativePrompt);
  }

  sections.push(
    "",
    "REQUIREMENTS:",
    "Keep character identity, face, outfit and the described environment consistent throughout the clip.",
    "Keep camera work, lighting and color grade as described, without inventing unrelated elements.",
    "Keep voices, sound effects and ambience synchronized with the visible action.",
    "Use realistic facial anatomy, hands and physical movement.",
    "No subtitles, captions, watermarks or on-screen interface elements.",
  );

  return sections.join("\n");
}

function getErrorStatus(details: SerializedError): number {
  if (typeof details.status === "number") {
    return details.status;
  }

  if (typeof details.code === "number") {
    return details.code;
  }

  const statusMatch = details.message.match(
    /\b(400|401|403|404|408|429|500|502|503|504)\b/,
  );

  if (statusMatch) {
    return Number(statusMatch[1]);
  }

  return 500;
}

export async function POST(request: Request) {
  if (process.env.LEGACY_VEO_ROUTES_ENABLED !== "true") {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt. Prüfe deine .env.local und starte den Server danach neu.",
      },
      { status: 500 },
    );
  }

  let body: GenerateVideoRequest;

  try {
    body = (await request.json()) as GenerateVideoRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Der Request-Body enthält kein gültiges JSON.",
      },
      { status: 400 },
    );
  }

  const prompt = readOptionalString(body.prompt);
  const audioPrompt = readOptionalString(body.audioPrompt);
  const negativePrompt = readOptionalString(body.negativePrompt);
  const dialogue = parseDialogue(body.dialogue);

  if (!prompt) {
    return NextResponse.json(
      { success: false, error: "Der Video-Prompt fehlt." },
      { status: 400 },
    );
  }

  if (prompt.length < 20) {
    return NextResponse.json(
      { success: false, error: "Der Video-Prompt ist zu kurz." },
      { status: 400 },
    );
  }

  if (prompt.length > 12000) {
    return NextResponse.json(
      { success: false, error: "Der Video-Prompt ist zu lang." },
      { status: 400 },
    );
  }

  if (audioPrompt.length > 5000) {
    return NextResponse.json(
      { success: false, error: "Der Audio-Prompt ist zu lang." },
      { status: 400 },
    );
  }

  if (negativePrompt.length > 5000) {
    return NextResponse.json(
      { success: false, error: "Der Negative-Prompt ist zu lang." },
      { status: 400 },
    );
  }

  if (dialogue && dialogue.text.length > 180) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Dialog ist für ein 8-Sekunden-Video zu lang. Verwende höchstens einen kurzen Satz.",
      },
      { status: 400 },
    );
  }

  const finalPrompt = buildFinalPrompt({
    prompt,
    audioPrompt,
    negativePrompt,
    dialogue,
  });

  try {
    const ai = new GoogleGenAI({ apiKey });

    const operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: finalPrompt,
      config: {
        aspectRatio: "9:16",
        resolution: "1080p",
        numberOfVideos: 1,
      },
    });

    if (!operation.name) {
      return NextResponse.json(
        {
          success: false,
          error: "Veo hat keine Operation-ID zurückgegeben.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Die Veo-Videogenerierung wurde gestartet.",
      model: VEO_MODEL,
      operationName: operation.name,
      done: operation.done ?? false,
      dialogueRequested: Boolean(dialogue),
    });
  } catch (error: unknown) {
    const details = serializeError(error);
    const status = getErrorStatus(details);

    console.error("Veo-Videogenerierung fehlgeschlagen:", {
      model: VEO_MODEL,
      status,
      details,
      error,
    });

    let userMessage = details.message;

    if (status === 429) {
      userMessage =
        "Dein Veo-Kontingent oder Rate-Limit ist aktuell ausgeschöpft. Prüfe dein Google-AI-Billing und deine API-Limits oder versuche es später erneut.";
    } else if (status === 401 || status === 403) {
      userMessage =
        "Die Veo-Anfrage wurde nicht autorisiert. Prüfe deinen GEMINI_API_KEY, das Google-AI-Projekt und die Freigabe des Veo-Modells.";
    } else if (status === 404) {
      userMessage =
        "Das konfigurierte Veo-Modell wurde nicht gefunden oder ist für dein Projekt nicht verfügbar.";
    } else if (status === 503 || status === 504) {
      userMessage =
        "Veo ist momentan ausgelastet oder nicht erreichbar. Bitte versuche es später erneut.";
    }

    return NextResponse.json(
      {
        success: false,
        model: VEO_MODEL,
        error: userMessage,
        details,
      },
      { status: status >= 400 && status <= 599 ? status : 500 },
    );
  }
}
