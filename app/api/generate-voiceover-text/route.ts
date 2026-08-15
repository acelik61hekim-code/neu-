import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import type {
  VideoDurationSeconds,
  VideoSpokenLanguage,
} from "@/types/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL_NAME = "gemini-3.5-flash-lite";
const SUPPORTED_DURATIONS = [8, 30, 60, 120] as const;
const SUPPORTED_LANGUAGES = ["auto", "de", "en"] as const;

type VoiceoverRequest = {
  story?: unknown;
  targetDurationSeconds?: unknown;
  spokenLanguage?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function storySummary(value: unknown): string {
  let story = value;

  if (typeof value === "string") {
    try {
      story = JSON.parse(value);
    } catch {
      return value.trim().slice(0, 12_000);
    }
  }

  const record = asRecord(story);
  const moviePlan = asRecord(record.moviePlan);
  const opening = asRecord(moviePlan.opening);
  const characters = Array.isArray(record.characters)
    ? record.characters
        .map((character) => {
          const item = asRecord(character);
          return [readString(item.name), readString(item.description)]
            .filter(Boolean)
            .join(": ");
        })
        .filter(Boolean)
        .join(" | ")
    : "";

  return [
    `Titel: ${readString(record.title)}`,
    `Genre: ${readString(record.genre)}`,
    `Stimmung: ${readString(record.mood)}`,
    `Ort: ${readString(record.setting)}`,
    `Figuren: ${characters}`,
    `Geschichte: ${readString(record.summary)}`,
    `Einstieg: ${readString(opening.storyBeat)}`,
    `Schlusspunkt: ${readString(moviePlan.finalPayoff)}`,
  ]
    .filter((line) => !line.endsWith(": "))
    .join("\n")
    .slice(0, 12_000);
}

function cleanVoiceoverText(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:voice-?over|sprechertext|text)\s*:\s*/i, "")
    .trim();
}

export async function POST(request: Request) {
  const rateLimit = await checkRateLimit(
    request,
    "generate-voiceover-text",
    12,
    60 * 60,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "Zu viele Sprechertext-Anfragen in kurzer Zeit. Bitte versuche es später erneut.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Die automatische Sprechertext-Erstellung ist momentan nicht verfügbar." },
      { status: 503 },
    );
  }

  let body: VoiceoverRequest;
  try {
    body = (await request.json()) as VoiceoverRequest;
  } catch {
    return NextResponse.json(
      { error: "Die Anfrage enthält kein gültiges JSON." },
      { status: 400 },
    );
  }

  const targetDurationSeconds = body.targetDurationSeconds;
  if (
    typeof targetDurationSeconds !== "number" ||
    !SUPPORTED_DURATIONS.includes(
      targetDurationSeconds as (typeof SUPPORTED_DURATIONS)[number],
    )
  ) {
    return NextResponse.json(
      { error: "Für diese Videolänge kann kein Sprechertext erstellt werden." },
      { status: 400 },
    );
  }

  const spokenLanguage = body.spokenLanguage;
  if (
    typeof spokenLanguage !== "string" ||
    !SUPPORTED_LANGUAGES.includes(
      spokenLanguage as (typeof SUPPORTED_LANGUAGES)[number],
    )
  ) {
    return NextResponse.json(
      { error: "Bitte wähle eine gültige Sprache." },
      { status: 400 },
    );
  }

  const summary = storySummary(body.story);
  if (summary.length < 10) {
    return NextResponse.json(
      { error: "Erstelle zuerst deine Geschichte mit dem AI Director." },
      { status: 400 },
    );
  }

  const targetWords = Math.max(
    14,
    Math.min(220, Math.floor((targetDurationSeconds + 1) * 1.65)),
  );
  const maximumAcceptedWords = Math.max(
    16,
    Math.floor((targetDurationSeconds + 2) * 1.75),
  );
  const languageDirection: Record<VideoSpokenLanguage, string> = {
    de: "Write natural, polished German.",
    en: "Write natural, polished English.",
    auto:
      "Infer the language from the story and keep that language consistent.",
  };

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Create the exact voice-over narration for this video.\n\n${summary}`,
      config: {
        systemInstruction: [
          "You are a professional advertising and film voice-over writer.",
          languageDirection[spokenLanguage as VideoSpokenLanguage],
          `Write approximately ${targetWords} words that can be spoken naturally within ${targetDurationSeconds} seconds.`,
          "Start with a strong hook, follow the supplied story accurately and finish with a complete final sentence.",
          "Use short, speakable sentences, natural punctuation and pronunciation-friendly wording.",
          "Do not invent prices, guarantees, URLs or product claims that are absent from the story.",
          "Return only the finished spoken text. No heading, speaker label, quotation marks, markdown or notes.",
        ].join("\n"),
        responseMimeType: "text/plain",
        temperature: 0.55,
        maxOutputTokens: 1024,
      },
    });

    const text = cleanVoiceoverText(response.text ?? "");
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (
      !text ||
      text.length > 4_000 ||
      wordCount > Math.min(targetWords + 12, maximumAcceptedWords)
    ) {
      return NextResponse.json(
        { error: "Der automatische Sprechertext war nicht passend. Bitte versuche es erneut." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      text,
      wordCount,
      targetWords,
    });
  } catch (error) {
    console.error("Automatische Voice-over-Erstellung fehlgeschlagen:", error);
    return NextResponse.json(
      { error: "Der Sprechertext konnte gerade nicht automatisch erstellt werden." },
      { status: 502 },
    );
  }
}
