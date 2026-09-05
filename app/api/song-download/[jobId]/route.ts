import { get } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { resolveLocalSongPath } from "@/lib/song-generation";
import {
  getGeneratedSongVersion,
  songStore,
} from "@/lib/song-store";
import { canAccessSong } from "@/lib/song-access";
import { getCurrentUser } from "@/lib/supabase/server";
import { songAudioFormatFromMimeType } from "@/lib/song-audio-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { jobId: string } }) {
  const jobId = context.params.jobId?.trim();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim();
  const accessToken = url.searchParams.get("access_token")?.trim();
  if (!jobId) return Response.json({ error: "Der Songzugang fehlt." }, { status: 400 });

  const job = await songStore.get(jobId);
  const user = await getCurrentUser();
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  if (!job || (!canAccessSong(job, sessionId, accessToken) && !accountOwner)) {
    return Response.json({ error: "Song nicht gefunden." }, { status: 404 });
  }
  const selected =
    getGeneratedSongVersion(
      job,
      url.searchParams.get(
        "version",
      ),
    );

  if (!selected) {
    return Response.json({ error: "Der Song ist noch nicht fertig." }, { status: 409 });
  }

  const {
    version,
    index,
  } = selected;

  const download = url.searchParams.get("download") === "1";
  if (
    download &&
    job.status !== "done"
  ) {
    return Response.json(
      {
        error:
          "Du kannst diese Version bereits anhören. Der Download wird nach der finalen Prüfung freigeschaltet.",
      },
      { status: 409 },
    );
  }
  const format =
    songAudioFormatFromMimeType(
      version.audioMimeType,
    );
  const headers = new Headers({
    "Content-Type": format.mimeType,
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="ki-song-${jobId}-version-${index + 1}.${format.extension}"`,
  });

  if (version.audioUri.startsWith("local-song:")) {
    const filename = resolveLocalSongPath(version.audioUri);
    const file = await stat(filename);
    headers.set("Accept-Ranges", "bytes");
    const range = readByteRange(
      request.headers.get("range"),
      file.size,
    );

    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${file.size}`,
      );
      headers.set(
        "Content-Length",
        String(
          range.end - range.start + 1,
        ),
      );

      return new Response(
        Readable.toWeb(
          createReadStream(
            filename,
            range,
          ),
        ) as ReadableStream<Uint8Array>,
        {
          status: 206,
          headers,
        },
      );
    }

    headers.set("Content-Length", String(file.size));
    return new Response(Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>, { headers });
  }
  if (!version.audioUri.startsWith("blob:")) {
    return Response.json({ error: "Ungültige Songdatei." }, { status: 500 });
  }
  const requestedRange =
    request.headers.get(
      "range",
    );
  const result = await get(version.audioUri.slice("blob:".length), {
    access: "private",
    headers:
      requestedRange
        ? {
            Range:
              requestedRange,
          }
        : undefined,
  });
  if (!result?.stream) return Response.json({ error: "Song nicht gefunden." }, { status: 404 });
  const length = result.headers.get("content-length");
  const contentRange = result.headers.get("content-range");
  if (length) headers.set("Content-Length", length);
  headers.set("Accept-Ranges", result.headers.get("accept-ranges") || "bytes");
  if (contentRange) {
    headers.set("Content-Range", contentRange);
  }
  return new Response(result.stream, {
    status:
      contentRange
        ? 206
        : 200,
    headers,
  });
}

function readByteRange(
  value: string | null,
  size: number,
): {
  start: number;
  end: number;
} | null {
  const match =
    value?.match(
      /^bytes=(\d*)-(\d*)$/u,
    );

  if (!match) {
    return null;
  }

  const start =
    match[1]
      ? Number.parseInt(
          match[1],
          10,
        )
      : 0;
  const requestedEnd =
    match[2]
      ? Number.parseInt(
          match[2],
          10,
        )
      : size - 1;
  const end =
    Math.min(
      requestedEnd,
      size - 1,
    );

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end,
  };
}
