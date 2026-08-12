import { randomUUID } from "crypto";
import { execFile } from "child_process";
import {
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import ffmpegPath from "ffmpeg-static";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gibt der Route mehr Zeit für Download und Zusammenführung.
export const maxDuration = 300;

type MergeVideosRequest = {
  videoUris?: unknown;
  filename?: unknown;
};

type CommandResult = {
  stdout: string;
  stderr: string;
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
      url.pathname.startsWith("/v1beta/files/") &&
      url.searchParams.get("alt") === "media"
    );
  } catch {
    return false;
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function createSafeFilename(
  requestedFilename: unknown,
): string {
  if (typeof requestedFilename !== "string") {
    return "komplettes-video.mp4";
  }

  const cleanedFilename = requestedFilename
    .trim()
    .replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "-")
    .replace(/-+/g, "-");

  if (!cleanedFilename) {
    return "komplettes-video.mp4";
  }

  return cleanedFilename.toLowerCase().endsWith(".mp4")
    ? cleanedFilename
    : `${cleanedFilename}.mp4`;
}

function escapeConcatPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const escapedPath = normalizedPath.replace(
    /'/g,
    "'\\''",
  );

  return `file '${escapedPath}'`;
}

function runFfmpeg(
  executablePath: string,
  argumentsList: string[],
  timeoutMs = 10 * 60 * 1000,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executablePath,
      argumentsList,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const commandError = new Error(
            stderr ||
              error.message ||
              "FFmpeg konnte nicht ausgeführt werden.",
          );

          commandError.name = "FfmpegError";

          reject(commandError);
          return;
        }

        resolve({
          stdout,
          stderr,
        });
      },
    );
  });
}

async function downloadGoogleVideo(
  videoUri: string,
  destinationPath: string,
  apiKey: string,
): Promise<void> {
  const googleResponse = await fetch(videoUri, {
    method: "GET",
    headers: {
      "x-goog-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!googleResponse.ok) {
    const googleError =
      await googleResponse.text();

    throw new Error(
      [
        "Ein Veo-Video konnte nicht heruntergeladen werden.",
        `Google-Status: ${googleResponse.status}`,
        googleError,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const videoData =
    await googleResponse.arrayBuffer();

  if (videoData.byteLength === 0) {
    throw new Error(
      "Google hat eine leere Videodatei zurückgegeben.",
    );
  }

  await writeFile(
    destinationPath,
    Buffer.from(videoData),
  );
}

async function mergeWithStreamCopy(
  executablePath: string,
  concatFilePath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg(executablePath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function mergeWithReencoding(
  executablePath: string,
  concatFilePath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg(executablePath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt. Prüfe deine .env.local und starte den Server neu.",
      },
      {
        status: 500,
      },
    );
  }

  if (!ffmpegPath) {
    return NextResponse.json(
      {
        success: false,
        error:
          "FFmpeg wurde nicht gefunden. Prüfe die Installation von ffmpeg-static.",
      },
      {
        status: 500,
      },
    );
  }

  let body: MergeVideosRequest;

  try {
    body =
      (await request.json()) as MergeVideosRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Request-Body enthält kein gültiges JSON.",
      },
      {
        status: 400,
      },
    );
  }

  if (!Array.isArray(body.videoUris)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "videoUris muss eine Liste mit Video-Adressen sein.",
      },
      {
        status: 400,
      },
    );
  }

  const videoUris = body.videoUris
    .filter(
      (value): value is string =>
        typeof value === "string",
    )
    .map((value) => value.trim())
    .filter(Boolean);

  if (videoUris.length < 2) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Zum Zusammenfügen werden mindestens zwei Videos benötigt.",
      },
      {
        status: 400,
      },
    );
  }

  if (videoUris.length > 12) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Es können höchstens zwölf Videos gleichzeitig zusammengefügt werden.",
      },
      {
        status: 400,
      },
    );
  }

  const invalidVideoUri = videoUris.find(
    (videoUri) =>
      !isAllowedGoogleVideoUri(videoUri),
  );

  if (invalidVideoUri) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Mindestens eine videoUri ist keine gültige Google-Veo-Datei-URL.",
      },
      {
        status: 400,
      },
    );
  }

  const downloadFilename = createSafeFilename(
    body.filename,
  );

  const temporaryDirectory = join(
    tmpdir(),
    `ki-video-merge-${randomUUID()}`,
  );

  const concatFilePath = join(
    temporaryDirectory,
    "videos.txt",
  );

  const outputPath = join(
    temporaryDirectory,
    "komplettes-video.mp4",
  );

  try {
    await mkdir(temporaryDirectory, {
      recursive: true,
    });

    const videoPaths: string[] = [];

    // Die Clips werden absichtlich nacheinander
    // heruntergeladen, damit der Arbeitsspeicher
    // nicht unnötig belastet wird.
    for (
      let index = 0;
      index < videoUris.length;
      index += 1
    ) {
      const videoPath = join(
        temporaryDirectory,
        `szene-${String(index + 1).padStart(
          2,
          "0",
        )}.mp4`,
      );

      await downloadGoogleVideo(
        videoUris[index],
        videoPath,
        apiKey,
      );

      videoPaths.push(videoPath);
    }

    const concatFileContent = videoPaths
      .map(escapeConcatPath)
      .join("\n");

    await writeFile(
      concatFilePath,
      concatFileContent,
      "utf8",
    );

    try {
      // Zuerst versuchen wir eine schnelle
      // Zusammenführung ohne erneute Kodierung.
      await mergeWithStreamCopy(
        ffmpegPath,
        concatFilePath,
        outputPath,
      );
    } catch (streamCopyError) {
      console.warn(
        "Schnelle FFmpeg-Zusammenführung fehlgeschlagen. Starte erneute Kodierung:",
        streamCopyError,
      );

      try {
        await unlink(outputPath);
      } catch {
        // Die Ausgabedatei wurde möglicherweise
        // noch nicht erstellt.
      }

      // Falls die Clips technisch leicht
      // unterschiedlich sind, werden sie neu kodiert.
      await mergeWithReencoding(
        ffmpegPath,
        concatFilePath,
        outputPath,
      );
    }

    const mergedVideo = await readFile(outputPath);

    if (mergedVideo.byteLength === 0) {
      throw new Error(
        "FFmpeg hat eine leere Videodatei erzeugt.",
      );
    }

    return new Response(mergedVideo, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition":
          `attachment; filename="${downloadFilename}"`,
        "Content-Length": String(
          mergedVideo.byteLength,
        ),
        "Cache-Control":
          "private, no-store, max-age=0",
      },
    });
  } catch (error: unknown) {
    const details = serializeError(error);

    console.error(
      "Video-Zusammenführung fehlgeschlagen:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          details.message ||
          "Die Videos konnten nicht zusammengefügt werden.",
        details,
      },
      {
        status: 500,
      },
    );
  } finally {
    try {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    } catch (cleanupError) {
      console.warn(
        "Temporäre Merge-Dateien konnten nicht vollständig gelöscht werden:",
        cleanupError,
      );
    }
  }
}