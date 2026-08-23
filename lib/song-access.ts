import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { SongJob } from "@/lib/song-store";

export function createSongAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSongAccessToken(token) };
}

export function hashSongAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function canAccessSong(job: SongJob, sessionId?: string | null, accessToken?: string | null): boolean {
  if (sessionId && job.stripeSessionId === sessionId) return true;
  return matchesSongAccessToken(job.accessTokenHash, accessToken);
}

export function matchesSongAccessToken(expectedHash?: string, accessToken?: string | null): boolean {
  if (!accessToken || !expectedHash) return false;
  const supplied = Buffer.from(hashSongAccessToken(accessToken));
  const expected = Buffer.from(expectedHash);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
