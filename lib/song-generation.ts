import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { FatalError } from "workflow";

import { buildSongPrompt, songDurationMinutes, songModel, type SongLanguage, type SongLength } from "@/lib/song";
import { songStore } from "@/lib/song-store";

const localSongRoot = resolve(process.cwd(), ".video-backend-backups", "local-song-output");
const exec = promisify(execFile);

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

async function inspectAudio(audio: Buffer): Promise<{ durationSeconds: number; sampleRate: number; channels: number }> {
  if (!ffmpegPath) throw new Error("Die technische Songprüfung ist nicht verfügbar.");
  const directory = await mkdtemp(join(tmpdir(), "song-quality-"));
  try {
    const filename = join(directory, "song.mp3");
    await writeFile(filename, audio);
    const result = await exec(ffmpegPath, ["-hide_banner", "-i", filename, "-f", "null", "-"], { maxBuffer: 12 * 1024 * 1024 }).catch((error: unknown) => {
      const details = error as { stderr?: string };
      if (details.stderr) return { stderr: details.stderr };
      throw error;
    });
    const output = result.stderr || "";
    const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    const audioMatch = output.match(/Audio:[^,]*,\s*(\d+)\s*Hz,\s*(mono|stereo|\d+ channels?)/i);
    if (!durationMatch || !audioMatch) throw new Error("Die erzeugte MP3 konnte technisch nicht geprüft werden.");
    const durationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
    const channels = audioMatch[2].toLowerCase() === "stereo" ? 2 : audioMatch[2].toLowerCase() === "mono" ? 1 : Number.parseInt(audioMatch[2], 10);
    return { durationSeconds, sampleRate: Number(audioMatch[1]), channels };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function permanentProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b400\b|blocked|safety|sensitive|prohibited|copyright|artist/i.test(message);
}

function lyricLanguage(language: SongLanguage): string {
  if (language === "tr") return "Turkish";
  if (language === "de") return "German";
  if (language === "en") return "English";
  return "the natural language of the customer's description";
}

function targetLyricsWords(length: SongLength): number {
  if (length === "clip") return 45;
  if (length === "full2") return 120;
  if (length === "full3") return 175;
  return 220;
}

function safeFallbackGenre(style: string): string {
  const normalized = style.toLocaleLowerCase("de-DE");
  if (normalized.includes("rap") || normalized.includes("hip-hop")) {
    return "modern melodic hip-hop and rap with crisp drums, warm bass, clear rhythmic verses and a memorable original hook";
  }
  if (normalized.includes("arabesk") || normalized.includes("fantezi")) {
    return "original Turkish arabesk-pop with expressive vocals, bağlama, warm strings and restrained percussion";
  }
  if (normalized.includes("r&b")) return "modern melodic R&B with a warm groove and expressive vocals";
  if (normalized.includes("afro")) return "modern Afrobeats with a warm danceable groove and melodic vocals";
  if (normalized.includes("rock")) return "modern melodic rock with organic drums, guitars and expressive vocals";
  if (normalized.includes("elektr")) return "modern electronic pop with polished synthesizers and a memorable vocal hook";
  if (normalized.includes("akust")) return "warm acoustic pop with guitar, piano and intimate vocals";
  return "modern polished pop with a coherent melody, natural vocals and a memorable original hook";
}

function safeFallbackPrompt(job: NonNullable<Awaited<ReturnType<typeof songStore.get>>>): string {
  const durationMinutes = songDurationMinutes(job.length);
  const language = lyricLanguage(job.language);
  const singer = job.vocalStyle === "female"
    ? "one consistent natural female lead singer"
    : job.vocalStyle === "male"
      ? "one consistent natural male lead singer"
      : job.vocalStyle === "duet"
        ? "a consistent female and male duet"
        : job.vocalStyle === "choir"
          ? "one natural lead singer with a choir in the choruses"
          : "one consistent natural lead singer";

  return [
    `Create a complete original ${durationMinutes}-minute song in ${safeFallbackGenre(job.style)}.`,
    `Use ${singer}. Write all lyrics entirely in ${language}.`,
    "Write fresh, harmless, positive, family-friendly lyrics about perseverance, self-belief and a hopeful new beginning.",
    "Do not refer to real people, performers, brands or existing works. Give the composition its own melody, arrangement and vocal identity.",
    "Use this structure: [Intro] -> [Verse 1] -> [Chorus] -> [Verse 2 with completely new lines] -> [Bridge] -> [Final Chorus] -> [Outro].",
    "Keep the singer, language, tempo and genre consistent. Deliver a polished 44.1 kHz stereo mix with clear diction and a clean ending.",
  ].join("\n\n");
}

async function generatePlannedLyrics(
  ai: GoogleGenAI,
  job: Awaited<ReturnType<typeof songStore.get>>,
  safetyRewrite = false,
): Promise<string | undefined> {
  if (!job || job.lyricsMode !== "ai") return undefined;
  const language = lyricLanguage(job.language);
  const response = await ai.interactions.create({
    model: "gemini-3.6-flash",
    input: [
      `Write original, release-ready song lyrics in ${language}.`,
      `Target about ${targetLyricsWords(job.length)} words for a ${songDurationMinutes(job.length)}-minute song.`,
      `Song topic and wishes: ${job.description}`,
      `Genre: ${job.style}. Mood: ${job.mood}.`,
      job.title ? `Title: ${job.title}.` : "",
      "Output only the lyrics with clear section tags: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro].",
      "Every verse must contain new lines that advance the story. The chorus must be short and memorable and may appear twice, but do not duplicate a verse.",
      "Use natural grammar, meaningful imagery, singable line lengths and correct spelling. Do not invent words, stretch spelling or include production notes.",
      safetyRewrite
        ? "A previous music-generation attempt was rejected by an automated safety filter. Rewrite the lyrics with clearly harmless, family-friendly wording. Avoid graphic violence, weapons, drugs, self-harm, sexual content, insults, threats, crime instructions and ambiguous slang. Preserve the general emotion and topic without risky wording."
        : "Keep all wording suitable for a general audience so a music-generation model can perform it safely.",
      job.language === "tr" ? "Doğal ve doğru Türkçe kullan. Her dize anlamlı olsun; uydurma kelime ve başka dil kullanma." : "",
      safetyRewrite && job.language === "tr"
        ? "Sözleri tamamen güvenli ve aile dostu ifadelerle yeniden yaz. Şiddet, silah, uyuşturucu, tehdit, hakaret, kendine zarar verme, cinsel içerik ve belirsiz argo kullanma."
        : "",
    ].filter(Boolean).join("\n\n"),
  });
  const lyrics = response.output_text
    ?.trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!lyrics || lyrics.length < 80) throw new Error("Die KI konnte keinen vollständigen Songtext vorbereiten.");
  return lyrics.slice(0, 12_000);
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
  let plannedLyrics: string | undefined;
  let interaction: Awaited<ReturnType<typeof ai.interactions.create>>;
  try {
    plannedLyrics = await generatePlannedLyrics(ai, job);
    const generationInput = plannedLyrics
      ? { ...job, lyricsMode: "custom" as const, lyrics: plannedLyrics }
      : job;
    try {
      interaction = await ai.interactions.create({
        model: songModel(job.length),
        input: buildSongPrompt(generationInput),
      });
    } catch (error) {
      if (!permanentProviderError(error) || job.lyricsMode !== "ai") throw error;
      plannedLyrics = await generatePlannedLyrics(ai, job, true);
      try {
        interaction = await ai.interactions.create({
          model: songModel(job.length),
          input: buildSongPrompt({
            ...job,
            title: undefined,
            description: `A new original ${job.style} song with a ${job.mood} mood, based only on the safe rewritten lyrics below.`,
            lyricsMode: "custom",
            lyrics: plannedLyrics,
            voiceIdeaAnalysis: undefined,
          }),
        });
      } catch (safeLyricsError) {
        if (!permanentProviderError(safeLyricsError)) throw safeLyricsError;
        plannedLyrics = undefined;
        interaction = await ai.interactions.create({
          model: songModel(job.length),
          input: safeFallbackPrompt(job),
        });
      }
    }
  } catch (error) {
    if (permanentProviderError(error)) {
      throw new FatalError(error instanceof Error ? error.message : "Der Musikdienst hat die Songanfrage abgelehnt.");
    }
    throw error;
  }
  const generatedAudio = findAudioData(interaction);
  if (!generatedAudio) throw new Error("Der Musikdienst hat keine Audiodatei zurückgegeben.");

  await songStore.update(jobId, (current) => ({
    ...current,
    renderStage: "uploading",
    progressPercent: 85,
  }));

  const audio = Buffer.from(generatedAudio.data, "base64");
  if (audio.length < 10_000) throw new Error("Die erzeugte Audiodatei ist unvollständig.");
  const quality = await inspectAudio(audio);
  const expectedSeconds = songDurationMinutes(job.length) * 60;
  const minimumSeconds = job.length === "clip" ? 28 : expectedSeconds - 20;
  const maximumSeconds = job.length === "clip" ? 32 : expectedSeconds + 15;
  if (quality.durationSeconds < minimumSeconds || quality.durationSeconds > maximumSeconds) {
    throw new Error(`Die erzeugte Songlänge liegt außerhalb des gebuchten Bereichs (${quality.durationSeconds.toFixed(1)} Sekunden).`);
  }
  if (quality.sampleRate < 44_100 || quality.channels < 2) {
    throw new Error("Die erzeugte Audiodatei erfüllt die Qualitätsanforderungen nicht.");
  }
  const audioUri = await storeAudio(jobId, audio, generatedAudio.mimeType);
  const generatedLyrics = typeof interaction.output_text === "string"
    ? interaction.output_text.slice(0, 30_000)
    : plannedLyrics;

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
