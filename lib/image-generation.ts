import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { buildProfessionalImagePrompt, imageModel, imageSize } from "@/lib/image-product";
import { imageStore } from "@/lib/image-store";

const localRoot = resolve(process.cwd(), ".video-backend-backups", "local-image-output");

export function resolveLocalGeneratedImagePath(value: string): string {
  const relative = value.startsWith("local-image:") ? value.slice(12) : value;
  const destination = resolve(localRoot, relative.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!destination.startsWith(`${localRoot}${sep}`)) throw new Error("Ungültiger lokaler Bildpfad.");
  return destination;
}

async function storeImage(jobId: string, data: Buffer, mimeType: string): Promise<string> {
  const extension = mimeType.includes("jpeg") ? "jpg" : "png";
  const pathname = `generated-images/${jobId}.${extension}`;
  const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
  if (process.env.NODE_ENV === "development" && !hasBlob) {
    const file = resolveLocalGeneratedImagePath(pathname);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    return `local-image:${pathname}`;
  }
  const blob = await put(pathname, data, { access: "private", contentType: mimeType, addRandomSuffix: false, allowOverwrite: true });
  return `blob:${blob.pathname}`;
}

export async function generateAndStoreProfessionalImage(jobId: string): Promise<void> {
  const job = await imageStore.get(jobId);
  if (!job) throw new Error("Bildauftrag wurde nicht gefunden.");
  if (job.paymentStatus !== "paid") throw new Error("Bildauftrag ist nicht bezahlt.");
  if (job.status === "done" && job.imageUri) return;

  await imageStore.update(jobId, (current) => ({ ...current, status: "processing", renderStage: "generating", progressPercent: 20, startedAt: current.startedAt ?? Date.now(), errorMessage: undefined }));
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Der Bilddienst ist nicht konfiguriert.");
  const ai = new GoogleGenAI({ apiKey });
  const interaction = await ai.interactions.create({
    model: imageModel(job.quality),
    input: buildProfessionalImagePrompt(job),
    response_format: {
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: job.aspectRatio,
      image_size: imageSize(job.quality),
    },
  });
  const output = interaction.output_image;
  if (!output?.data) throw new Error("Der Bilddienst hat keine Bilddatei zurückgegeben.");
  await imageStore.update(jobId, (current) => ({ ...current, renderStage: "uploading", progressPercent: 85 }));
  const data = Buffer.from(output.data, "base64");
  if (data.length < 10_000) throw new Error("Die erzeugte Bilddatei ist unvollständig.");
  const mimeType = output.mime_type || "image/jpeg";
  const imageUri = await storeImage(jobId, data, mimeType);
  await imageStore.update(jobId, (current) => ({ ...current, status: "done", renderStage: "completed", progressPercent: 100, imageUri, imageMimeType: mimeType, completedAt: Date.now() }));
}
