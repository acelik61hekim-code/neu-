import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VEO_MODEL = "veo-3.1-fast-generate-preview";

function serializeError(error: unknown) {
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

  return {
    message: String(error),
  };
}

export async function POST() {
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
          "GEMINI_API_KEY fehlt. PrÃ¼fe deine .env.local und starte npm run dev danach neu.",
      },
      { status: 500 },
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
    });

    const operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: [
        "Create a cinematic vertical video.",
        "A small friendly robot stands on a wet rooftop at night.",
        "It looks across a futuristic city filled with neon lights.",
        "The camera slowly pushes toward the robot.",
        "Soft wind and distant city ambience.",
        "No dialogue, no subtitles, no visible text, no logos.",
      ].join(" "),
      config: {
        aspectRatio: "9:16",
        resolution: "720p",
      },
    });

    return NextResponse.json({
      success: true,
      message: "Die Veo-Videogenerierung wurde gestartet.",
      model: VEO_MODEL,
      operationName: operation.name ?? null,
      done: operation.done ?? false,
    });
  } catch (error: unknown) {
    const details = serializeError(error);

    console.error("Veo-Test fehlgeschlagen:", error);

    return NextResponse.json(
      {
        success: false,
        model: VEO_MODEL,
        error: details.message,
        details,
      },
      { status: 500 },
    );
  }
}