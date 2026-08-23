export const SONG_PLAN_IDS = ["creator", "pro", "studio-max"] as const;

export type SongPlanId = (typeof SONG_PLAN_IDS)[number];

export type SongPlan = {
  id: SongPlanId;
  name: string;
  priceCents: number;
  songsPerMonth: number;
  aiEditsPerMonth: number;
  tagline: string;
  featured?: boolean;
  nearUnlimited?: boolean;
};

export const SONG_PLANS: readonly SongPlan[] = [
  {
    id: "creator",
    name: "Creator",
    priceCents: 1_499,
    songsPerMonth: 25,
    aiEditsPerMonth: 25,
    tagline: "Für regelmäßige neue Songs",
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 2_499,
    songsPerMonth: 60,
    aiEditsPerMonth: 75,
    tagline: "Für aktive Creator und Artists",
    featured: true,
  },
  {
    id: "studio-max",
    name: "Studio Max",
    priceCents: 5_999,
    songsPerMonth: 200,
    aiEditsPerMonth: 200,
    tagline: "Nahezu unbegrenzt produzieren",
    nearUnlimited: true,
  },
] as const;

export function isSongPlanId(value: unknown): value is SongPlanId {
  return typeof value === "string" && SONG_PLAN_IDS.includes(value as SongPlanId);
}
export function getSongPlan(planId: SongPlanId): SongPlan {
  return SONG_PLANS.find((plan) => plan.id === planId)!;
}
