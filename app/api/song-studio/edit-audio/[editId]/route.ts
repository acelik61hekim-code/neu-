import { get } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { matchesSongAccessToken } from "@/lib/song-access";
import { songEditStore } from "@/lib/song-edit-store";
import { resolveLocalSongPath } from "@/lib/song-generation";
import { songAudioFormatFromMimeType } from "@/lib/song-audio-format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { editId: string } }) {
  const editId = context.params.editId?.trim();
  const url = new URL(request.url);
  const token = url.searchParams.get("edit_token")?.trim();
  const edit = editId ? await songEditStore.get(editId) : undefined;
  if (!edit || edit.status !== "done" || !edit.audioUri || !matchesSongAccessToken(edit.accessTokenHash, token)) {
    return Response.json({ error: "Studioversion nicht gefunden." }, { status: 404 });
  }
  const format = songAudioFormatFromMimeType(edit.audioMimeType);
  const headers = new Headers({
    "Content-Type": format.mimeType,
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="song-studio-${editId}.${format.extension}"`,
  });
  if (edit.audioUri.startsWith("local-song:")) {
    const filename = resolveLocalSongPath(edit.audioUri);
    const file = await stat(filename);
    headers.set("Accept-Ranges", "bytes");
    const range = readByteRange(request.headers.get("range"), file.size);
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(Readable.toWeb(createReadStream(filename, range)) as ReadableStream<Uint8Array>, { status: 206, headers });
    }
    headers.set("Content-Length", String(file.size));
    return new Response(Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>, { headers });
  }
  if (!edit.audioUri.startsWith("blob:")) return Response.json({ error: "Ungültige Studioversion." }, { status: 500 });
  const requestedRange = request.headers.get("range");
  const result = await get(edit.audioUri.slice("blob:".length), {
    access: "private",
    headers: requestedRange ? { Range: requestedRange } : undefined,
  });
  if (!result?.stream) return Response.json({ error: "Studioversion nicht gefunden." }, { status: 404 });
  const contentLength = result.headers.get("content-length");
  const contentRange = result.headers.get("content-range");
  if (contentLength) headers.set("Content-Length", contentLength);
  if (contentRange) headers.set("Content-Range", contentRange);
  headers.set("Accept-Ranges", result.headers.get("accept-ranges") || "bytes");
  return new Response(result.stream, { status: contentRange ? 206 : 200, headers });
}

function readByteRange(value: string | null, size: number): { start: number; end: number } | null {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match) return null;
  const start = match[1] ? Number.parseInt(match[1], 10) : 0;
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end };
}
