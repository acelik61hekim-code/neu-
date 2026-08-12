import { get } from "@vercel/blob";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveLocalGeneratedImagePath } from "@/lib/image-generation";
import { imageStore } from "@/lib/image-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: { jobId: string } }) {
  const jobId = context.params.jobId?.trim();
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim();
  if (!jobId || !sessionId) return Response.json({ error: "Bild- und Zahlungs-ID fehlen." }, { status: 400 });
  const job = await imageStore.get(jobId);
  if (!job || job.stripeSessionId !== sessionId) return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });
  if (job.status !== "done" || !job.imageUri) return Response.json({ error: "Das Bild ist noch nicht fertig." }, { status: 409 });
  const mime = job.imageMimeType || "image/jpeg";
  const ext = mime.includes("png") ? "png" : "jpg";
  const headers = new Headers({ "Content-Type": mime, "Cache-Control": "private, no-store", "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="ki-bild-${jobId}.${ext}"` });
  if (job.imageUri.startsWith("local-image:")) {
    const file = resolveLocalGeneratedImagePath(job.imageUri); const info = await stat(file); headers.set("Content-Length", String(info.size));
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, { headers });
  }
  if (!job.imageUri.startsWith("blob:")) return Response.json({ error: "Ungültige Bilddatei." }, { status: 500 });
  const result = await get(job.imageUri.slice(5), { access: "private" });
  if (!result?.stream) return Response.json({ error: "Bild nicht gefunden." }, { status: 404 });
  const length = result.headers.get("content-length"); if (length) headers.set("Content-Length", length);
  return new Response(result.stream, { headers });
}
