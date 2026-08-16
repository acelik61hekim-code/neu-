import type { VideoDurationSeconds } from "@/types/story";

export const VIDEO_PRICE_CENTS = {
  8: 299,
  30: 899,
  60: 1599,
  120: 2999,
  180: 4299,
  240: 5499,
  300: 6499,
} as const satisfies Record<VideoDurationSeconds, number>;

export const CURRENTLY_RELEASED_MAX_DURATION_SECONDS: VideoDurationSeconds = 120;

export function isReleasedVideoDuration(
  duration: VideoDurationSeconds,
): boolean {
  return duration <= CURRENTLY_RELEASED_MAX_DURATION_SECONDS;
}

export function getVideoPriceCents(duration: VideoDurationSeconds): number {
  return VIDEO_PRICE_CENTS[duration];
}

export function formatEuroPrice(priceCents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);
}
