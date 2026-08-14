import { get, put } from "@vercel/blob";
import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const exec = promisify(execFile);

export type VideoFinishingOptions = {
  voiceoverText?: string;
  closingText?: string;
  spokenLanguage?: "auto" | "de" | "en";
};

type GeneratedNarration = {
  pathname: string;
  mimeType: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
};

const MAX_FINISHING_GRACE_SECONDS = 2;
const NARRATION_START_DELAY_SECONDS = 0.65;
const NARRATION_TAIL_SECONDS = 0.35;
// Gemini narration is 24 kHz PCM. Some clips contain a narrow-band whistle at
// its 12 kHz Nyquist edge, so notch that tone and keep the cutoff safely below it.
const NARRATION_WHISTLE_HZ = 12_000;
const NARRATION_WHISTLE_WIDTH_HZ = 300;
const NARRATION_LOWPASS_HZ = 10_500;
const localOutputRoot = resolve(
  process.cwd(),
  ".video-backend-backups",
  "local-output",
);

export function resolveLocalVideoPath(value: string): string {
  const pathname = value.startsWith("local:")
    ? value.slice("local:".length)
    : value;
  const normalized = pathname.replace(/\\/g, "/").replace(/^\/+/, "");
  const destination = resolve(localOutputRoot, normalized);
  if (!destination.startsWith(`${localOutputRoot}${sep}`)) {
    throw new Error("Ungültiger lokaler Videopfad.");
  }
  return destination;
}

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-backend-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function saveWebStream(stream: ReadableStream<Uint8Array>, destination: string) {
  await pipeline(Readable.fromWeb(stream as never), createWriteStream(destination));
}

async function download(source: string, destination: string) {
  if (source.startsWith("local:")) {
    await pipeline(createReadStream(resolveLocalVideoPath(source)), createWriteStream(destination));
    return;
  }

  if (source.startsWith("blob:")) {
    const result = await get(source.slice("blob:".length), { access: "private" });
    if (!result?.stream) throw new Error("Private Blob konnte nicht gelesen werden.");
    await saveWebStream(result.stream, destination);
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const url = new URL(source);
  if (apiKey && !url.searchParams.has("key")) url.searchParams.set("key", apiKey);
  const response = await fetch(url, {
    headers: apiKey ? { "x-goog-api-key": apiKey } : undefined,
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Video-Download fehlgeschlagen (HTTP ${response.status}).`);
  }
  await saveWebStream(response.body, destination);
}

async function upload(pathname: string, filename: string) {
  const hasBlobCredentials = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );

  if (process.env.NODE_ENV === "development" && !hasBlobCredentials) {
    const destination = resolveLocalVideoPath(pathname);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(filename, destination);
    return { pathname: `local:${pathname}`, url: `local:${pathname}` };
  }

  const body = Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>;
  const blob = await put(pathname, body, {
    access: "private",
    contentType: "video/mp4",
    multipart: true,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { pathname: blob.pathname, url: blob.url };
}

function escapeFilterPath(pathname: string): string {
  return pathname
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function wrapOverlayText(value: string): string {
  const lines: string[] = [];
  for (const requestedLine of value.replace(/\r/g, "").split("\n")) {
    const words = requestedLine.trim().split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > 30 && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.slice(0, 4).join("\n");
}

function readDurationFromFfmpegOutput(value: string): number | undefined {
  const match = value.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

async function inspectContainerDuration(
  binary: string,
  pathname: string,
): Promise<number | undefined> {
  try {
    const result = await exec(binary, ["-hide_banner", "-i", pathname], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return readDurationFromFfmpegOutput(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    return readDurationFromFfmpegOutput(`${details.stdout ?? ""}\n${details.stderr ?? ""}`);
  }
}

function buildAtempoFilters(rate: number): string[] {
  const filters: string[] = [];
  let remaining = Math.max(1, rate);
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  if (remaining > 1.0005) filters.push(`atempo=${remaining.toFixed(5)}`);
  return filters;
}

async function generateNarration(
  dir: string,
  text: string,
  seconds: number,
  language: VideoFinishingOptions["spokenLanguage"],
): Promise<GeneratedNarration> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Für das exakte Voice-over fehlt der Google-AI-Schlüssel.");

  const languageDirection = language === "en"
    ? "Speak natural English."
    : language === "auto"
      ? "Use the language of the supplied script."
      : "Sprich natürliches, klares Hochdeutsch. Sprich KI als K-I aus.";
  const maximumSeconds = Math.max(2, seconds - 2);
  const client = new GoogleGenAI({ apiKey });
  const stream = await client.interactions.create({
    model: "gemini-3.1-flash-tts-preview",
    input: [
      languageDirection,
      "Read the supplied script exactly once without adding, removing, translating or paraphrasing words.",
      `Use a professional, warm and confident studio voice. Finish naturally within ${maximumSeconds} seconds.`,
      "SCRIPT:",
      text,
    ].join("\n"),
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: "Kore" }] },
    stream: true,
  });

  const chunks: Buffer[] = [];
  let mimeType = "audio/l16";
  let sampleRate = 24_000;
  let channels = 1;
  for await (const event of stream) {
    if (event.event_type !== "step.delta" || event.delta.type !== "audio") continue;
    if (event.delta.mime_type) mimeType = event.delta.mime_type;
    if (event.delta.sample_rate) sampleRate = event.delta.sample_rate;
    if (event.delta.channels) channels = event.delta.channels;
    if (event.delta.data) chunks.push(Buffer.from(event.delta.data, "base64"));
  }
  if (chunks.length === 0) throw new Error("Die Sprach-KI hat keine Tonspur zurückgegeben.");

  const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : "pcm";
  const pathname = join(dir, `voiceover.${extension}`);
  const audio = Buffer.concat(chunks);
  await writeFile(pathname, audio);
  const isRawPcm = mimeType.includes("l16") || extension === "pcm";
  const durationSeconds = isRawPcm
    ? audio.length / Math.max(1, sampleRate * channels * 2)
    : await inspectContainerDuration(ffmpegPath as string, pathname);
  if (!durationSeconds || !Number.isFinite(durationSeconds)) {
    throw new Error("Die Länge des erzeugten Voice-overs konnte nicht geprüft werden.");
  }
  return { pathname, mimeType, sampleRate, channels, durationSeconds };
}

async function finishVideo(
  input: string,
  output: string,
  dir: string,
  seconds: number,
  options: VideoFinishingOptions = {},
): Promise<void> {
  const binary = ffmpegPath;
  if (!binary) throw new Error("ffmpeg-static ist auf dieser Plattform nicht verfügbar.");

  const voiceoverText = options.voiceoverText?.trim() ?? "";
  const closingText = options.closingText?.trim() ?? "";
  const args: string[] = ["-y", "-i", input];
  const sourceDuration = await inspectContainerDuration(binary, input);
  let narration: GeneratedNarration | undefined;
  if (voiceoverText) {
    narration = await generateNarration(
      dir,
      voiceoverText,
      seconds,
      options.spokenLanguage,
    );
    if (narration.mimeType.includes("l16") || narration.pathname.endsWith(".pcm")) {
      args.push(
        "-f", "s16le",
        "-ar", String(narration.sampleRate),
        "-ac", String(narration.channels),
        "-i", narration.pathname,
      );
    } else {
      args.push("-i", narration.pathname);
    }
  }

  const maximumOutputSeconds = seconds + MAX_FINISHING_GRACE_SECONDS;
  const naturalVideoEnd = Math.min(maximumOutputSeconds, Math.max(seconds, sourceDuration ?? seconds));
  const naturalNarrationEnd = narration
    ? NARRATION_START_DELAY_SECONDS + narration.durationSeconds + NARRATION_TAIL_SECONDS
    : seconds;
  const outputSeconds = Math.min(
    maximumOutputSeconds,
    Math.max(naturalVideoEnd, naturalNarrationEnd),
  );
  const availableNarrationSeconds = Math.max(
    1,
    outputSeconds - NARRATION_START_DELAY_SECONDS - NARRATION_TAIL_SECONDS,
  );
  const narrationTempo = narration
    ? Math.max(1, narration.durationSeconds / availableNarrationSeconds)
    : 1;

  const filters: string[] = [];
  let videoMap = "0:v:0";
  let audioMap = "0:a:0?";
  const needsVideoPadding = outputSeconds > (sourceDuration ?? seconds) + 0.02;
  if (closingText || needsVideoPadding || outputSeconds > seconds + 0.02) {
    const videoFilters: string[] = [];
    if (needsVideoPadding) {
      videoFilters.push(
        `tpad=stop_mode=clone:stop_duration=${MAX_FINISHING_GRACE_SECONDS}`,
      );
    }
    const textFile = join(dir, "closing-text.txt");
    if (closingText) {
      await writeFile(textFile, wrapOverlayText(closingText), "utf8");
      const startSecond = Math.max(0, outputSeconds - 6);
      videoFilters.push(
        `drawbox=x=w*0.04:y=h*0.64:w=w*0.92:h=h*0.30:color=black@0.84:t=fill:enable='between(t,${startSecond},${outputSeconds})'`,
        `drawtext=font='Sans':textfile='${escapeFilterPath(textFile)}':fontcolor=white:fontsize=h/24:line_spacing=18:x=(w-text_w)/2:y=h*0.72:enable='between(t,${startSecond},${outputSeconds})'`,
      );
    }
    videoFilters.push(`trim=duration=${outputSeconds}`, "setpts=PTS-STARTPTS", "format=yuv420p");
    filters.push(`[0:v]${videoFilters.join(",")}[v]`);
    videoMap = "[v]";
  }
  if (narration) {
    const voiceFilters = [
      `adelay=${Math.round(NARRATION_START_DELAY_SECONDS * 1000)}:all=1`,
      ...buildAtempoFilters(narrationTempo),
      "volume=1.30",
      "highpass=f=80",
      `bandreject=f=${NARRATION_WHISTLE_HZ}:t=h:w=${NARRATION_WHISTLE_WIDTH_HZ}`,
      `lowpass=f=${NARRATION_LOWPASS_HZ}:p=2`,
    ];
    filters.push(
      `[0:a]volume=0.16,apad=pad_dur=${MAX_FINISHING_GRACE_SECONDS},atrim=duration=${outputSeconds}[background]`,
      `[1:a]${voiceFilters.join(",")}[voice]`,
      `[background][voice]amix=inputs=2:duration=longest:dropout_transition=2,atrim=duration=${outputSeconds},loudnorm=I=-15:TP=-1.5:LRA=9[a]`,
    );
    audioMap = "[a]";
  }

  if (filters.length > 0) args.push("-filter_complex", filters.join(";"));
  args.push(
    "-map", videoMap,
    "-map", audioMap,
    "-t", String(outputSeconds),
    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", output,
  );
  await exec(binary, args, { maxBuffer: 32 * 1024 * 1024 });
}

async function copyAndStore(source: string, pathname: string) {
  return withTemp(async (dir) => {
    const input = join(dir, "input.mp4");
    await download(source, input);
    return upload(pathname, input);
  });
}

export async function trimAndStore(
  source: string,
  seconds: number,
  pathname: string,
  finishing: VideoFinishingOptions = {},
) {
  // Veo opening videos are already exactly 8 seconds. Avoid an unnecessary
  // native FFmpeg process and persist the provider file directly in Blob.
  if (seconds === 8 && !finishing.voiceoverText && !finishing.closingText) {
    return copyAndStore(source, pathname);
  }

  const binary = ffmpegPath;
  if (!binary) throw new Error("ffmpeg-static ist auf dieser Plattform nicht verfügbar.");
  return withTemp(async (dir) => {
    const input = join(dir, "input.mp4");
    const output = join(dir, "output.mp4");
    await download(source, input);
    await finishVideo(input, output, dir, seconds, finishing);
    return upload(pathname, output);
  });
}

export async function mergeAndStore(
  sources: string[],
  seconds: number,
  pathname: string,
  finishing: VideoFinishingOptions = {},
) {
  const binary = ffmpegPath;
  if (!binary) throw new Error("ffmpeg-static ist auf dieser Plattform nicht verfügbar.");
  if (sources.length === 0) throw new Error("Für das Zusammenfügen fehlen Kapitelvideos.");
  return withTemp(async (dir) => {
    const files: string[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      const file = join(dir, `chapter-${index + 1}.mp4`);
      await download(sources[index], file);
      files.push(file);
    }
    const list = join(dir, "concat.txt");
    await writeFile(
      list,
      files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );
    const output = join(dir, "output.mp4");
    const merged = join(dir, "merged.mp4");
    await exec(
      binary,
      [
        "-y", "-f", "concat", "-safe", "0", "-i", list,
        "-c", "copy", merged,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    await finishVideo(merged, output, dir, seconds, finishing);
    return upload(pathname, output);
  });
}
