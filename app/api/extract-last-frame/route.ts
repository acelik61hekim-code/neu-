import { randomUUID } from "crypto";
import { execFile } from "child_process";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import ffmpegPath from "ffmpeg-static";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ExtractFrameRequest = {
  videoUri?: unknown;
};

function isAllowedGoogleVideoUri(
  value: string,
): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname ===
        "generativelanguage.googleapis.com" &&
      url.pathname.startsWith(
        "/v1beta/files/",
      ) &&
      url.searchParams.get("alt") ===
        "media"
    );
  } catch {
    return false;
  }
}

async function downloadGoogleVideo(
  videoUri: string,
  destination: string,
  apiKey: string,
): Promise<void> {
  const response = await fetch(videoUri, {
    method: "GET",
    headers: {
      "x-goog-api-key": apiKey,
      Accept: "video/mp4,video/*,*/*",
    },
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok) {
    const responseText =
      await response.text().catch(() => "");

    throw new Error(
      [
        `Google-Video-Download fehlgeschlagen (${response.status}).`,
        responseText,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  if (arrayBuffer.byteLength === 0) {
    throw new Error(
      "Google hat eine leere Videodatei zurückgegeben.",
    );
  }

  await writeFile(
    destination,
    Buffer.from(arrayBuffer),
  );

  const fileInfo = await stat(destination);

  if (fileInfo.size === 0) {
    throw new Error(
      "Die heruntergeladene Videodatei ist leer.",
    );
  }
}

function runFfmpeg(
  executable: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        windowsHide: true,
        timeout: 110_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }

        const details =
          stderr?.trim() ||
          stdout?.trim() ||
          error.message;

        reject(
          new Error(
            `FFmpeg fehlgeschlagen: ${details}`,
          ),
        );
      },
    );
  });
}

/**
 * Schneller Versuch:
 * FFmpeg springt eine halbe Sekunde vor das Ende und
 * extrahiert dort einen vollständig decodierbaren Frame.
 */
async function extractWithEndSeek(
  executable: string,
  videoFile: string,
  imageFile: string,
): Promise<void> {
  await runFfmpeg(executable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",

    "-sseof",
    "-0.5",

    "-i",
    videoFile,

    "-map",
    "0:v:0",

    "-an",

    "-frames:v",
    "1",

    "-update",
    "1",

    imageFile,
  ]);
}

/**
 * Fallback:
 * Falls das MP4 kein zuverlässiges Seeking am Dateiende
 * unterstützt, wird das kurze Video vollständig decodiert,
 * rückwärts verarbeitet und der erste rückwärts gelesene
 * Frame gespeichert.
 */
async function extractWithReverseFallback(
  executable: string,
  videoFile: string,
  imageFile: string,
): Promise<void> {
  await runFfmpeg(executable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",

    "-i",
    videoFile,

    "-map",
    "0:v:0",

    "-an",

    "-vf",
    "reverse",

    "-frames:v",
    "1",

    "-update",
    "1",

    imageFile,
  ]);
}

export async function POST(
  request: Request,
) {
  const apiKey =
    process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
      },
      {
        status: 500,
      },
    );
  }

  if (
    !ffmpegPath ||
    typeof ffmpegPath !== "string"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "FFmpeg wurde nicht gefunden. Prüfe das Paket ffmpeg-static.",
      },
      {
        status: 500,
      },
    );
  }

  let body: ExtractFrameRequest;

  try {
    body =
      (await request.json()) as ExtractFrameRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Request enthält kein gültiges JSON.",
      },
      {
        status: 400,
      },
    );
  }

  const videoUri =
    typeof body.videoUri === "string"
      ? body.videoUri.trim()
      : "";

  if (!videoUri) {
    return NextResponse.json(
      {
        success: false,
        error: "videoUri fehlt.",
      },
      {
        status: 400,
      },
    );
  }

  if (!isAllowedGoogleVideoUri(videoUri)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Die übergebene videoUri ist nicht erlaubt.",
      },
      {
        status: 400,
      },
    );
  }

  const tempDir = join(
    tmpdir(),
    `veo-frame-${randomUUID()}`,
  );

  const videoFile = join(
    tempDir,
    "source-video.mp4",
  );

  const imageFile = join(
    tempDir,
    "last-frame.png",
  );

  try {
    await mkdir(tempDir, {
      recursive: true,
    });

    await downloadGoogleVideo(
      videoUri,
      videoFile,
      apiKey,
    );

    try {
      await extractWithEndSeek(
        ffmpegPath,
        videoFile,
        imageFile,
      );
    } catch (seekError) {
      console.warn(
        "FFmpeg-Ende-Seeking fehlgeschlagen. Fallback wird verwendet:",
        seekError,
      );

      await rm(imageFile, {
        force: true,
      });

      await extractWithReverseFallback(
        ffmpegPath,
        videoFile,
        imageFile,
      );
    }

    const imageInfo =
      await stat(imageFile);

    if (imageInfo.size === 0) {
      throw new Error(
        "FFmpeg hat eine leere Bilddatei erzeugt.",
      );
    }

    const image =
      await readFile(imageFile);

    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length":
          String(image.length),
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error(
      "Last-Frame-Extraktion fehlgeschlagen:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unbekannter Fehler bei der Frame-Extraktion.",
      },
      {
        status: 500,
      },
    );
  } finally {
    await rm(tempDir, {
      recursive: true,
      force: true,
    }).catch((cleanupError) => {
      console.warn(
        "Temporärer Ordner konnte nicht vollständig gelöscht werden:",
        cleanupError,
      );
    });
  }
}