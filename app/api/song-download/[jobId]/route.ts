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

  if (
    job.status !== "done" ||
    !selected
  ) {
    return Response.json({ error: "Der Song ist noch nicht fertig." }, { status: 409 });
  }

  const {
    version,
    index,
  } = selected;

  const download = url.searchParams.get("download") === "1";
  const headers = new Headers({
    "Content-Type": version.audioMimeType || "audio/mpeg",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="ki-song-${jobId}-version-${index + 1}.mp3"`,
  });

  if (version.audioUri.startsWith("local-song:")) {
    const filename = resolveLocalSongPath(version.audioUri);
    const file = await stat(filename);
    headers.set("Content-Length", String(file.size));
    headers.set("Accept-Ranges", "bytes");
    return new Response(Readable.toWeb(createReadStream(filename)) as ReadableStream<Uint8Array>, { headers });
  }
  if (!version.audioUri.startsWith("blob:")) {
    return Response.json({ error: "Ungültige Songdatei." }, { status: 500 });
  }
  const result = await get(version.audioUri.slice("blob:".length), { access: "private" });
  if (!result?.stream) return Response.json({ error: "Song nicht gefunden." }, { status: 404 });
  const length = result.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  headers.set("Accept-Ranges", result.headers.get("accept-ranges") || "bytes");
  return new Response(result.stream, { headers });
}
