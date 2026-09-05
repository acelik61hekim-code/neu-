import { get, head } from "@vercel/blob";

import { verifyProviderAudioUrl } from "@/lib/song-studio-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readAccess(request: Request): {
  pathname: string;
  valid: boolean;
} {
  const url = new URL(request.url);
  const pathname = url.searchParams.get("source")?.trim() || "";
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature")?.trim() || "";

  return {
    pathname,
    valid: verifyProviderAudioUrl(pathname, expires, signature),
  };
}

export async function GET(request: Request) {
  const access = readAccess(request);
  if (!access.valid) {
    return Response.json({ error: "Audiozugang abgelaufen." }, { status: 403 });
  }

  const range = request.headers.get("range");
  const result = await get(access.pathname, {
    access: "private",
    headers: range ? { Range: range } : undefined,
  });

  if (!result?.stream) {
    return Response.json({ error: "Audiodatei nicht gefunden." }, { status: 404 });
  }

  const contentType = result.blob.contentType || "audio/mpeg";
  const extension = providerAudioExtension(contentType, access.pathname);
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="reference.${extension}"`,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": result.headers.get("accept-ranges") || "bytes",
  });
  const contentLength = result.headers.get("content-length");
  const contentRange = result.headers.get("content-range");
  const etag = result.headers.get("etag");
  if (contentLength) headers.set("Content-Length", contentLength);
  if (contentRange) headers.set("Content-Range", contentRange);
  if (etag) headers.set("ETag", etag);

  return new Response(result.stream, {
    status: contentRange ? 206 : 200,
    headers,
  });
}

export async function HEAD(request: Request) {
  const access = readAccess(request);
  if (!access.valid) {
    return new Response(null, { status: 403 });
  }

  try {
    const metadata = await head(access.pathname);
    return new Response(null, {
      headers: {
        "Content-Type": metadata.contentType || "audio/mpeg",
        "Content-Length": String(metadata.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function providerAudioExtension(
  contentType: string,
  pathname: string,
): string {
  const normalized = contentType.toLowerCase();

  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("aac")) return "aac";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("flac")) return "flac";

  const pathnameExtension = pathname.split(".").pop()?.toLowerCase();
  if (pathnameExtension && ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(pathnameExtension)) {
    return pathnameExtension;
  }

  return "mp3";
}
