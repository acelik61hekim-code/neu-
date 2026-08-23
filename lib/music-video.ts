import type {
  MusicVideoTrackContext,
  VideoDurationSeconds,
} from "@/types/story";

export const MUSIC_VIDEO_MAX_DURATION_SECONDS = 300;
export const MUSIC_VIDEO_MAX_AUDIO_BYTES = 70 * 1024 * 1024;

export const MUSIC_VIDEO_DURATION_BUCKETS = [
  15,
  30,
  60,
  120,
  180,
  240,
  300,
] as const satisfies readonly VideoDurationSeconds[];

export const MUSIC_VIDEO_AUDIO_TYPES = [
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

export function getMusicVideoDurationBucket(
  durationSeconds: number,
): VideoDurationSeconds {
  const roundedDuration =
    Math.max(15, Math.ceil(durationSeconds));

  const bucket =
    MUSIC_VIDEO_DURATION_BUCKETS.find(
      (candidate) => candidate >= roundedDuration,
    );

  if (!bucket) {
    throw new Error(
      "Der Song darf höchstens fünf Minuten lang sein.",
    );
  }

  return bucket;
}

export function formatTrackDuration(
  durationSeconds: number,
): string {
  const safeSeconds =
    Math.max(0, Math.round(durationSeconds));

  const minutes =
    Math.floor(safeSeconds / 60);

  const seconds =
    safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")} Min.`;
}

export function isMusicVideoTrackContext(
  value: unknown,
): value is MusicVideoTrackContext {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const track =
    value as Partial<MusicVideoTrackContext>;

  return (
    typeof track.name === "string" &&
    track.name.trim().length > 0 &&
    track.name.length <= 180 &&
    typeof track.durationSeconds === "number" &&
    Number.isFinite(track.durationSeconds) &&
    track.durationSeconds >= 15 &&
    track.durationSeconds <= MUSIC_VIDEO_MAX_DURATION_SECONDS &&
    typeof track.analysis === "string" &&
    track.analysis.trim().length >= 20 &&
    track.analysis.length <= 2_500
  );
}
