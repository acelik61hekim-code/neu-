import type { VideoDurationSeconds } from "@/types/story";

/*
 * Die 8-Sekunden-Option bleibt ausschließlich intern erhalten,
 * damit bereits bestehende alte Aufträge weiterhin gelesen
 * und wiederhergestellt werden können.
 *
 * Auf der Website wird 8 Sekunden nicht mehr angeboten.
 */
export const VIDEO_PRICE_CENTS = {
  8: 299,

  15: 699,
  30: 1399,
  60: 2799,
  120: 5499,

  /*
   * Langform-Musikvideos verwenden den vollständigen hochgeladenen
   * Song und entsprechend mehr 15-Sekunden-Renderabschnitte.
   */
  180: 8299,
  240: 10999,
  300: 13799,
} as const satisfies Record<VideoDurationSeconds, number>;

/*
 * Aktuell können Kunden maximal 120 Sekunden auswählen.
 */
export const CURRENTLY_RELEASED_MAX_DURATION_SECONDS:
  VideoDurationSeconds = 120;

/*
 * Neue Kundenaufträge beginnen bei 15 Sekunden.
 * 8 Sekunden existieren nur noch für Legacy-Aufträge.
 */
export const CURRENTLY_RELEASED_MIN_DURATION_SECONDS:
  VideoDurationSeconds = 15;

export function isReleasedVideoDuration(
  duration: VideoDurationSeconds,
): boolean {
  return (
    duration >= CURRENTLY_RELEASED_MIN_DURATION_SECONDS &&
    duration <= CURRENTLY_RELEASED_MAX_DURATION_SECONDS
  );
}

export function getVideoPriceCents(
  duration: VideoDurationSeconds,
): number {
  return VIDEO_PRICE_CENTS[duration];
}

export function formatEuroPrice(
  priceCents: number,
): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);
}
