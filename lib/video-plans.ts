export const VIDEO_PLAN_IDS = [
  "video-creator",
  "video-pro",
  "video-studio-max",
] as const;

export type VideoPlanId =
  (typeof VIDEO_PLAN_IDS)[number];

export type VideoPlan = {
  id: VideoPlanId;
  name: string;
  priceCents: number;
  creditsPerMonth: number;
  studioEditsPerMonth: number;
  tagline: string;
  featured?: boolean;
  nearUnlimited?: boolean;
};

export const VIDEO_PLANS: readonly VideoPlan[] = [
  {
    id: "video-creator",
    name: "Video Creator",
    priceCents: 2_999,
    creditsPerMonth: 5,
    studioEditsPerMonth: 10,
    tagline: "Für erste Reels und regelmäßige Kurzvideos",
  },
  {
    id: "video-pro",
    name: "Video Pro",
    priceCents: 7_999,
    creditsPerMonth: 15,
    studioEditsPerMonth: 35,
    tagline: "Für aktive Creator, Marken und Social Media",
    featured: true,
  },
  {
    id: "video-studio-max",
    name: "Video Studio Max",
    priceCents: 19_999,
    creditsPerMonth: 40,
    studioEditsPerMonth: 100,
    tagline: "Für hohe Produktionsmengen und Agenturen",
    nearUnlimited: true,
  },
] as const;

export function isVideoPlanId(
  value: unknown,
): value is VideoPlanId {
  return (
    typeof value === "string" &&
    VIDEO_PLAN_IDS.includes(
      value as VideoPlanId,
    )
  );
}

export function getVideoPlan(
  planId: VideoPlanId,
): VideoPlan {
  return VIDEO_PLANS.find(
    (plan) => plan.id === planId,
  )!;
}
