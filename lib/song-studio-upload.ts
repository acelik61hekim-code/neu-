import { createHmac, timingSafeEqual } from "node:crypto";

export const SONG_STUDIO_UPLOAD_PREFIX = "song-studio-uploads/";
export const SONG_STUDIO_MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export const SONG_STUDIO_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
] as const;

function signingSecret(): string {
  const secret =
    process.env.SONG_STUDIO_PROXY_SECRET?.trim() ||
    process.env.ACEDATA_API_KEY?.trim();

  if (!secret) {
    throw new Error("Der sichere Audiozugang für die Musik-KI ist nicht konfiguriert.");
  }

  return secret;
}

export function isSongStudioUploadPathname(pathname: string): boolean {
  return (
    pathname.startsWith(SONG_STUDIO_UPLOAD_PREFIX) &&
    !pathname.includes("..") &&
    !pathname.includes("\\") &&
    pathname.length <= 320
  );
}

function signatureFor(pathname: string, expires: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${pathname}:${expires}`)
    .digest("base64url");
}

export function createSignedProviderAudioUrl(
  origin: string,
  pathname: string,
): string {
  if (!isSongStudioUploadPathname(pathname)) {
    throw new Error("Der Speicherpfad der Audiodatei ist ungültig.");
  }

  const expires = Math.floor(Date.now() / 1_000) + 2 * 60 * 60;
  const url = new URL(
    "/api/song-studio/provider-audio/reference.mp3",
    origin,
  );
  url.searchParams.set("source", pathname);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signatureFor(pathname, expires));
  return url.toString();
}

export function verifyProviderAudioUrl(
  pathname: string,
  expires: number,
  signature: string,
): boolean {
  if (
    !isSongStudioUploadPathname(pathname) ||
    !Number.isInteger(expires) ||
    expires < Math.floor(Date.now() / 1_000) ||
    expires > Math.floor(Date.now() / 1_000) + 24 * 60 * 60 ||
    !signature
  ) {
    return false;
  }

  const expected = Buffer.from(signatureFor(pathname, expires));
  const supplied = Buffer.from(signature);

  return (
    expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
  );
}
