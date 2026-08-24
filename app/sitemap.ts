import type { MetadataRoute } from "next";

import { SITE_URL, STUDIO_PATHS } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-08-24");
  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}${STUDIO_PATHS.video}`, lastModified, changeFrequency: "weekly", priority: 0.95 },
    { url: `${SITE_URL}${STUDIO_PATHS.song}`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}${STUDIO_PATHS.image}`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/video-studio`, lastModified, changeFrequency: "weekly", priority: 0.75 },
    { url: `${SITE_URL}/sound-studio`, lastModified, changeFrequency: "weekly", priority: 0.75 },
  ];
}
