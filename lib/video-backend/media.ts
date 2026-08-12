import { get, put } from "@vercel/blob";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const exec = promisify(execFile);

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

export async function trimAndStore(source: string, seconds: number, pathname: string) {
  const binary = ffmpegPath;
  if (!binary) throw new Error("ffmpeg-static ist auf dieser Plattform nicht verfügbar.");
  return withTemp(async (dir) => {
    const input = join(dir, "input.mp4");
    const output = join(dir, "output.mp4");
    await download(source, input);
    await exec(
      binary,
      [
        "-y", "-i", input, "-t", String(seconds),
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "aac", "-movflags", "+faststart", output,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return upload(pathname, output);
  });
}

export async function mergeAndStore(sources: string[], seconds: number, pathname: string) {
  const binary = ffmpegPath;
  if (!binary) throw new Error("ffmpeg-static ist auf dieser Plattform nicht verfügbar.");
  if (sources.length === 0) throw new Error("Für das Zusammenführen fehlen Kapitelvideos.");
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
    await exec(
      binary,
      [
        "-y", "-f", "concat", "-safe", "0", "-i", list,
        "-t", String(seconds), "-c:v", "libx264", "-preset", "fast",
        "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", output,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return upload(pathname, output);
  });
}
