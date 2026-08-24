import type {
  VideoDurationSeconds,
  VideoModelId,
} from "@/types/story";

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

export type VideoModelOption = {
  id: VideoModelId;
  name: string;
  shortName: string;
  description: string;
  quality: string;
  provider: "seedance" | "veo";
  quotaMultiplier: number;
  featured?: boolean;
};

export const VIDEO_MODELS: readonly VideoModelOption[] = [
  {
    id: "google-veo-fast",
    name: "Google Veo 3.1 Fast",
    shortName: "Veo Fast",
    description: "Googles schnelles Videomodell mit natürlichem Ton und starkem Realismus zum besonders günstigen Einstiegspreis.",
    quality: "Günstig & realistisch",
    provider: "veo",
    quotaMultiplier: 1,
  },
  {
    id: "seedance-2-fast",
    name: "Seedance 2 Fast",
    shortName: "Seedance Fast",
    description: "Sehr gute Qualität mit starkem Preis-Leistungs-Verhältnis – ideal für Reels und regelmäßige Inhalte.",
    quality: "Schnell & vielseitig",
    provider: "seedance",
    quotaMultiplier: 2.4,
  },
  {
    id: "seedance-2-original",
    name: "Seedance 2 Original",
    shortName: "Original",
    description: "Das Standardmodell mit maximaler Seedance-Detailqualität und aufwendigerer Berechnung.",
    quality: "Maximale Details",
    provider: "seedance",
    quotaMultiplier: 3,
    featured: true,
  },
  {
    id: "google-veo",
    name: "Google Veo 3.1 Standard",
    shortName: "Veo Standard",
    description: "Googles Premium-Modell für anspruchsvolle filmische Szenen, besonders realistische Bewegung und natürlichen Ton.",
    quality: "Premium-Realismus",
    provider: "veo",
    quotaMultiplier: 4,
  },
] as const;

const VIDEO_MODEL_PRICE_CENTS: Record<
  VideoModelId,
  Record<VideoDurationSeconds, number>
> = {
  "seedance-2-fast": VIDEO_PRICE_CENTS,
  "seedance-2-original": {
    8: 499,
    15: 899,
    30: 1749,
    60: 3449,
    120: 6749,
    180: 9999,
    240: 13299,
    300: 16499,
  },
  "google-veo-fast": {
    8: 299,
    15: 499,
    30: 999,
    60: 1999,
    120: 3999,
    180: 5999,
    240: 7999,
    300: 9999,
  },
  "google-veo": {
    8: 699,
    15: 1199,
    30: 2349,
    60: 4599,
    120: 8999,
    180: 13399,
    240: 17699,
    300: 21999,
  },
};

export function getVideoModel(
  modelId: VideoModelId,
): VideoModelOption {
  return VIDEO_MODELS.find(
    (model) => model.id === modelId,
  )!;
}

export function getVideoQuotaSeconds(
  duration: number,
  modelId: VideoModelId,
): number {
  return Math.ceil(
    duration * getVideoModel(modelId).quotaMultiplier,
  );
}

export function getVideoOutputSecondsForQuota(
  quotaSeconds: number,
  modelId: VideoModelId,
): number {
  return Math.max(
    0,
    quotaSeconds / getVideoModel(modelId).quotaMultiplier,
  );
}

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
  modelId: VideoModelId = "seedance-2-fast",
): number {
  return VIDEO_MODEL_PRICE_CENTS[modelId][duration];
}

export function formatEuroPrice(
  priceCents: number,
): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);
}
