import { Suspense } from "react";

import VideoStudio from "@/components/VideoStudio";

export const metadata = {
  title: "KI Video Studio | Videos professionell bearbeiten",
  description: "Bearbeite deine KI-Videos mit Schnitt, Tempo, Ton und professionellen Blenden.",
};

export default function VideoStudioPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07070b]" />}>
      <VideoStudio />
    </Suspense>
  );
}
