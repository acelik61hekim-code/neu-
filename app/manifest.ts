import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "KI Studio",
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#06060c",
    theme_color: "#08080f",
    lang: "de-DE",
    categories: ["photo", "video", "music", "productivity"],
    icons: [
      {
        src: "/app-icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Video erstellen",
        short_name: "Video",
        description: "Ein neues KI-Video erstellen",
        url: "/ki-video-erstellen",
      },
      {
        name: "Song erstellen",
        short_name: "Song",
        description: "Einen neuen KI-Song erstellen",
        url: "/ki-song-erstellen",
      },
      {
        name: "Bild erstellen",
        short_name: "Bild",
        description: "Ein neues KI-Bild erstellen",
        url: "/ki-bilder-erstellen",
      },
      {
        name: "Meine Projekte",
        short_name: "Projekte",
        description: "Gespeicherte Inhalte und Abos öffnen",
        url: "/konto",
      },
    ],
  };
}
