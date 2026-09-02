import type { Metadata } from "next";

import VideoLandingPage from "@/components/VideoLandingPage";

export const metadata: Metadata = {
  title: "KI-Videos mit deutschem Dialog erstellen",
  description:
    "Erstelle kurze KI-Videos für Reels, TikTok und Werbung. Prüfe Story, Sprechertext und Look vor der Zahlung.",
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  return <VideoLandingPage />;
}
