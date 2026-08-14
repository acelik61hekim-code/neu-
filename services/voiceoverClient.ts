import type {
  VideoDurationSeconds,
  VideoSpokenLanguage,
} from "@/types/story";

type VoiceoverResponse = {
  success?: boolean;
  text?: string;
  error?: string;
};

export async function requestAutomaticVoiceover(
  story: unknown,
  targetDurationSeconds: VideoDurationSeconds,
  spokenLanguage: VideoSpokenLanguage,
): Promise<string> {
  const response = await fetch("/api/generate-voiceover-text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      story,
      targetDurationSeconds,
      spokenLanguage,
    }),
  });

  const data = (await response.json()) as VoiceoverResponse;
  if (!response.ok || !data.text?.trim()) {
    throw new Error(
      data.error || "Der Sprechertext konnte nicht automatisch erstellt werden.",
    );
  }

  return data.text.trim();
}
