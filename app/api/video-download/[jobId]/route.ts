import { get } from "@vercel/blob";
import { jobStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { jobId: string } }) {
  const jobId = context.params.jobId?.trim();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim();

  if (!jobId || !sessionId) {
    return Response.json({ error: "jobId und session_id fehlen." }, { status: 400 });
  }

  const job = await jobStore.get(jobId);
  if (!job || !job.stripeSessionId || job.stripeSessionId !== sessionId) {
    return Response.json({ error: "Video nicht gefunden." }, { status: 404 });
  }
  if (job.status !== "done" || !job.videoUri?.startsWith("blob:")) {
    return Response.json({ error: "Video ist noch nicht fertig." }, { status: 409 });
  }

  const range = request.headers.get("range");
  const result = await get(job.videoUri.slice("blob:".length), {
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
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  headers.set("Content-Disposition", `${disposition}; filename="video-${jobId}.mp4"`);

  return new Response(result.stream, {
    status: contentRange ? 206 : 200,
    headers,
  });
}
