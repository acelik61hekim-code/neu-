import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { buildSongPrompt, songModel } from "@/lib/song";
import { songStore } from "@/lib/song-store";

const localSongRoot = resolve(process.cwd(), ".video-backend-backups", "local-song-output");

export function resolveLocalSongPath(value: string): string {
  const relative = value.startsWith("local-song:")
    ? value.slice("local-song:".length)
    : value;
  const destination = resolve(localSongRoot, relative.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!destination.startsWith(`${localSongRoot}${sep}`)) {
    throw new Error("Ungültiger lokaler Songpfad.");
  }
  return destination;
}

function findAudioData(interaction: unknown): { data: string; mimeType: string } | null {
  const response = interaction as {
    output_audio?: { data?: string; mime_type?: string };
    steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string; mime_type?: string }> }>;
  };
  if (response.output_audio?.data) {
    return {
      data: response.output_audio.data,
      mimeType: response.output_audio.mime_type || "audio/mpeg",
    };
  }
  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block.type === "audio" && block.data) {
        return { data: block.data, mimeType: block.mime_type || "audio/mpeg" };
      }
    }
  }
  return null;
}

async function storeAudio(jobId: string, audio: Buffer, mimeType: string): Promise<string> {
  const pathname = `songs/${jobId}.mp3`;
  const hasBlobCredentials = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );

  if (process.env.NODE_ENV === "development" && !hasBlobCredentials) {
    const filename = resolveLocalSongPath(pathname);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, audio);
    return `local-song:${pathname}`;
  }

  const blob = await put(pathname, audio, {
    access: "private",
    contentType: mimeType || "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return `blob:${blob.pathname}`;
}

export async function generateAndStoreSong(jobId: string): Promise<void> {
  const job = await songStore.get(jobId);
  if (!job) throw new Error(`Songauftrag ${jobId} wurde nicht gefunden.`);
  if (job.paymentStatus !== "paid") throw new Error("Songauftrag ist nicht bezahlt.");
  if (job.status === "done" && job.audioUri) return;

  await songStore.update(jobId, (current) => ({
    ...current,
    status: "processing",
    renderStage: "generating",
    progressPercent: 20,
    startedAt: current.startedAt ?? Date.now(),
    errorMessage: undefined,
  }));

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Der Musikdienst ist nicht konfiguriert.");

  const ai = new GoogleGenAI({ apiKey });
  const interaction = await ai.interactions.create({
    model: songModel(job.length),
    input: buildSongPrompt(job),
  });
  const generatedAudio = findAudioData(interaction);
  if (!generatedAudio) throw new Error("Der Musikdienst hat keine Audiodatei zurückgegeben.");

  await songStore.update(jobId, (current) => ({
    ...current,
    renderStage: "uploading",
    progressPercent: 85,
  }));

  const audio = Buffer.from(generatedAudio.data, "base64");
  if (audio.length < 10_000) throw new Error("Die erzeugte Audiodatei ist unvollständig.");
  const audioUri = await storeAudio(jobId, audio, generatedAudio.mimeType);
  const generatedLyrics = typeof interaction.output_text === "string"
    ? interaction.output_text.slice(0, 30_000)
    : undefined;

  await songStore.update(jobId, (current) => ({
    ...current,
    status: "done",
    renderStage: "completed",
    progressPercent: 100,
    audioUri,
    audioMimeType: generatedAudio.mimeType,
    generatedLyrics,
    completedAt: Date.now(),
  }));
}
