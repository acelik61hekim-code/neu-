import type {
  VideoDurationSeconds,
} from "@/types/story";

const SUPPORTED_PROMPT_DURATIONS =
  new Set<number>([
    8,
    15,
    30,
    60,
    120,
    180,
    240,
    300,
  ]);

export function inferPromptVideoDurationSeconds(
  value: string,
): VideoDurationSeconds | null {
  const leadingRequest =
    value
      .slice(0, 800)
      .replace(/\s+/gu, " ");
  const secondsMatch =
    leadingRequest.match(
      /\b(8|15|30|60|120|180|240|300)\s*(?:sekunden?|sek\.?|seconds?|sec\.?)\s+(?:lang(?:e[snr]?)?|(?:werbe|kurz|social[\s-]?)?(?:video|clip|film)s?)\b/iu,
    ) ??
    leadingRequest.match(
      /\b(?:video|clip|film)\b.{0,36}\b(8|15|30|60|120|180|240|300)\s*(?:sekunden?|sek\.?|seconds?|sec\.?)\b/iu,
    );

  if (!secondsMatch) {
    return null;
  }

  const duration =
    Number.parseInt(
      secondsMatch[1],
      10,
    );

  return SUPPORTED_PROMPT_DURATIONS.has(
    duration,
  )
    ? duration as VideoDurationSeconds
    : null;
}
