import { get } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { jobStore } from "@/lib/store";
import { resolveLocalVideoPath } from "@/lib/video-backend/media";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { jobId: string } }) {
  const jobId = context.params.jobId?.trim();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim();
  const versionId = url.searchParams.get("version")?.trim();

  if (!jobId) {
    return Response.json({ error: "Video-ID fehlt." }, { status: 400 });
  }

  const job = await jobStore.get(jobId);
  const user = await getCurrentUser();
  const validSession = Boolean(sessionId && job?.stripeSessionId === sessionId);
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  if (!job || (!validSession && !accountOwner)) {
    return Response.json({ error: "Video nicht gefunden." }, { status: 404 });
  }
  const selectedVersion = versionId
    ? job.studioVersions?.find((version) => version.id === versionId)
    : undefined;
  const videoUri = versionId ? selectedVersion?.videoUri : job.videoUri;

  if (
    job.status !== "done" ||
    (!videoUri?.startsWith("blob:") && !videoUri?.startsWith("local:"))
  ) {
    return Response.json({ error: versionId ? "Diese Studio-Version wurde nicht gefunden." : "Video ist noch nicht fertig." }, { status: versionId ? 404 : 409 });
  }

  const range = request.headers.get("range");
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";

  if (videoUri.startsWith("local:")) {
    const filename = resolveLocalVideoPath(videoUri);
    const file = await stat(filename);
    let start = 0;
    let end = file.size - 1;
    let status = 200;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) return new Response(null, { status: 416 });
      if (match[1]) start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), file.size - 1);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= file.size) {
        return new Response(null, { status: 416 });
      }
      status = 206;
    }

    const headers = new Headers({
      "Content-Type": "video/mp4",
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Content-Disposition": `${disposition}; filename="video-${versionId || jobId}.mp4"`,
    });
    if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);

    const stream = createReadStream(filename, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
  }

  const result = await get(videoUri.slice("blob:".length), {
    access: "private",
    headers: range ? { Range: range } : undefined,
  });
  if (!result?.stream) return Response.json({ error: "Video nicht gefunden." }, { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", result.headers.get("content-type") || "video/mp4");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", result.headers.get("accept-ranges") || "bytes");
  const contentLength = result.headers.get("content-length");
  const contentRange = result.headers.get("content-range");
  const etag = result.headers.get("etag");
  if (contentLength) headers.set("Content-Length", contentLength);
  if (contentRange) headers.set("Content-Range", contentRange);
  if (etag) headers.set("ETag", etag);
  headers.set("Content-Disposition", `${disposition}; filename="video-${versionId || jobId}.mp4"`);

  return new Response(result.stream, {
    status: contentRange ? 206 : 200,
    headers,
  });
}
