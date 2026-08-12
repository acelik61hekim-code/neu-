import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const exec = promisify(execFile);
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
]);

function normalizedMimeType(value: string): string {
  const type = value.toLowerCase().split(";")[0].trim();
  if (!SUPPORTED_AUDIO_TYPES.has(type)) {
    throw new Error("Dieses Audioformat wird nicht unterstützt. Nutze MP3, WAV, M4A, AAC, OGG, FLAC oder eine direkte Aufnahme.");
  }
  return type;
}

async function normalizeAudioForAnalysis(bytes: Buffer, mimeType: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (mimeType !== "audio/webm" && mimeType !== "audio/mp4" && mimeType !== "audio/x-m4a") {
    return { bytes, mimeType };
  }
  if (!ffmpegPath) throw new Error("Diese Handyaufnahme kann momentan nicht verarbeitet werden. Bitte lade stattdessen MP3 oder WAV hoch.");
  const directory = await mkdtemp(join(tmpdir(), "song-voice-idea-"));
  try {
    const input = join(directory, mimeType === "audio/webm" ? "input.webm" : "input.m4a");
    const output = join(directory, "output.mp3");
    await writeFile(input, bytes);
    await exec(ffmpegPath, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", output], { maxBuffer: 8 * 1024 * 1024 });
    return { bytes: await readFile(output), mimeType: "audio/mp3" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  const rateLimit = await checkRateLimit(request, "song-voice-analysis", 20, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Zu viele Audioanalysen in kurzer Zeit. Bitte versuche es später erneut." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Bitte sende eine gültige Audioaufnahme." }, { status: 400 });
    }
    if (formData.get("consent") !== "true") {
      return NextResponse.json({ error: "Bitte bestätige die einmalige KI-Analyse der Aufnahme." }, { status: 400 });
    }
    const value = formData.get("audio");
    if (!(value instanceof File)) {
      return NextResponse.json({ error: "Bitte nimm eine Sprachidee auf oder wähle eine Audiodatei aus." }, { status: 400 });
    }
    if (value.size < 1_000) {
      return NextResponse.json({ error: "Die Aufnahme ist zu kurz oder leer." }, { status: 400 });
    }
    if (value.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Die Aufnahme ist zu groß. Maximal erlaubt sind 12 MB." }, { status: 413 });
    }

    const mimeType = normalizedMimeType(value.type || "audio/mpeg");
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("Die Audioanalyse ist momentan nicht konfiguriert.");

    const ai = new GoogleGenAI({ apiKey });
    const inputAudio = await normalizeAudioForAnalysis(Buffer.from(await value.arrayBuffer()), mimeType);
    const interaction = await ai.interactions.create({
      model: "gemini-3.6-flash",
      input: [
        {
          type: "text",
          text: [
            "Analyze this customer's voice note, hummed melody or rough musical demo as guidance for creating a new original song.",
            "Identify the intended mood, approximate tempo or pace, rhythm/groove, genre influences, vocal delivery, instrumentation, dynamics, and likely song structure.",
            "If the customer speaks, include the useful musical requests they describe. If they hum or sing, describe only general melodic movement, phrasing and energy.",
            "Do not identify, imitate or clone the speaker or any named artist. Do not reproduce a recognizable melody. Convert the idea into safe high-level production guidance for an original composition.",
            "Return only a concise German production brief of 4 to 7 sentences. Do not use Markdown and do not include a transcript.",
          ].join(" "),
        },
        { type: "audio", data: inputAudio.bytes.toString("base64"), mime_type: inputAudio.mimeType },
      ],
    });

    const analysis = interaction.output_text?.trim();
    if (!analysis) throw new Error("Die Aufnahme konnte nicht musikalisch ausgewertet werden.");
    return NextResponse.json({ analysis: analysis.slice(0, 2_500) });
  } catch (error) {
    console.error("Sprachidee konnte nicht analysiert werden:", error);
    const message = error instanceof Error ? error.message : "Die Aufnahme konnte nicht analysiert werden.";
    const blocked = /blocked|safety|sensitive|prohibited/i.test(message);
    return NextResponse.json(
      { error: blocked ? "Die Aufnahme wurde vom Audiodienst abgelehnt. Bitte nimm eine neue, neutrale Musikbeschreibung auf." : message.slice(0, 500) },
      { status: blocked ? 422 : 500 },
    );
  }
}
