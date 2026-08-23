import { get } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { matchesSongAccessToken } from "@/lib/song-access";
import { songEditStore } from "@/lib/song-edit-store";
import { resolveLocalSongPath } from "@/lib/song-generation";

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
  const headers = new Headers({
    "Content-Type": edit.audioMimeType || "audio/mpeg",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="song-studio-${editId}.mp3"`,
  });
  if (edit.audioUri.startsWith("local-song:")) {
    const filename = resolveLocalSongPath(edit.audioUri);
    const file = await stat(filename);
    headers.set("Content-Length", String(file.size));
    return new Response(Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>, { headers });
  }
  if (!edit.audioUri.startsWith("blob:")) return Response.json({ error: "Ungültige Studioversion." }, { status: 500 });
  const result = await get(edit.audioUri.slice("blob:".length), { access: "private" });
  if (!result?.stream) return Response.json({ error: "Studioversion nicht gefunden." }, { status: 404 });
  return new Response(result.stream, { headers });
}
