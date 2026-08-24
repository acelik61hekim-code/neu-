import type { Metadata } from "next";

import SoundStudio from "@/components/SoundStudio";

export const metadata: Metadata = {
  title: "Sound Studio – eigene Songs mit KI bearbeiten",
  description: "Lade eigene Songs hoch, arrangiere sie mit KI neu, erweitere sie musikalisch oder bearbeite einzelne Songstellen.",
};

export default function SoundStudioPage() {
  return <SoundStudio />;
}
