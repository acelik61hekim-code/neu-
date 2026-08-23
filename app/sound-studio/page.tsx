import type { Metadata } from "next";

import SoundStudio from "@/components/SoundStudio";

export const metadata: Metadata = {
  title: "Sound Studio – KI-Songs sekundengenau bearbeiten",
  description: "Bearbeite deine KI-Songs, markiere einzelne Sekunden und erstelle gezielt neue Versionen.",
};

export default function SoundStudioPage() {
  return <SoundStudio />;
}
