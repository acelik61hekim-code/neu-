import type { VideoDurationSeconds } from "@/types/story";

export const VIDEO_PRICE_CENTS = {
  8: 599,
  30: 1799,
  60: 3299,
  120: 5999,
  180: 8999,
  240: 10999,
  300: 12999,
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
