import type { VideoDurationSeconds } from "@/types/story";

export const VIDEO_PRICE_CENTS = {
  8: 799,
  30: 2499,
  60: 4499,
  120: 7999,
  180: 11999,
  240: 14999,
  300: 17999,
} as const satisfies Record<VideoDurationSeconds, number>;

export const CURRENTLY_RELEASED_MAX_DURATION_SECONDS: VideoDurationSeconds = 30;

export function getVideoPriceCents(duration: VideoDurationSeconds): number {
  return VIDEO_PRICE_CENTS[duration];
}

export function formatEuroPrice(priceCents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);
}
