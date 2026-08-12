import type {
  VideoAudioStyle,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

export const SUPPORTED_AUDIO_STYLES = [
  "cinematic",
  "emotional",
  "upbeat",
  "electronic",
  "ambient",
  "no-music",
] as const satisfies readonly VideoAudioStyle[];

export const SUPPORTED_VOICE_MODES = [
  "auto",
  "dialogue",
  "voiceover",
  "no-voice",
] as const satisfies readonly VideoVoiceMode[];

export const SUPPORTED_SPOKEN_LANGUAGES = [
  "auto",
  "de",
  "en",
] as const satisfies readonly VideoSpokenLanguage[];

export function isVideoAudioStyle(value: unknown): value is VideoAudioStyle {
  return typeof value === "string" && SUPPORTED_AUDIO_STYLES.includes(value as VideoAudioStyle);
}

export function isVideoVoiceMode(value: unknown): value is VideoVoiceMode {
  return typeof value === "string" && SUPPORTED_VOICE_MODES.includes(value as VideoVoiceMode);
}

export function isVideoSpokenLanguage(value: unknown): value is VideoSpokenLanguage {
  return typeof value === "string" && SUPPORTED_SPOKEN_LANGUAGES.includes(value as VideoSpokenLanguage);
}

export function normalizeVideoAudioStyle(value: unknown): VideoAudioStyle {
  return isVideoAudioStyle(value) ? value : "cinematic";
}

export function normalizeVideoVoiceMode(value: unknown): VideoVoiceMode {
  return isVideoVoiceMode(value) ? value : "auto";
}

export function normalizeVideoSpokenLanguage(value: unknown): VideoSpokenLanguage {
  return isVideoSpokenLanguage(value) ? value : "de";
}

export function buildSelectedAudioDirection(
  audioStyle: VideoAudioStyle,
  voiceMode: VideoVoiceMode,
  spokenLanguage: VideoSpokenLanguage,
): string {
  const musicDirection: Record<VideoAudioStyle, string> = {
    cinematic: "Use an original cinematic score with a clear emotional arc, restrained under speech and naturally continuous across extensions.",
    emotional: "Use an original warm, emotional score led by intimate piano, subtle strings or similarly expressive instrumentation; never overpower speech.",
    upbeat: "Use original energetic, modern music with a clear pulse and positive forward momentum; keep transitions musical and controlled.",
    electronic: "Use an original modern electronic score with tasteful synth textures, controlled bass and rhythm-aware development.",
    ambient: "Use an original atmospheric ambient sound bed with subtle tonal movement, spacious texture and seamless continuity.",
    "no-music": "Do not generate music. Use only believable ambience, Foley and story-relevant sound effects.",
  };

  const voiceDirection: Record<VideoVoiceMode, string> = {
    auto: "Use speech only when it improves the story. Keep any dialogue or narration concise, natural and clearly mixed.",
    dialogue: "Prioritize short natural on-screen character dialogue. Keep speaker identity and voice consistent; do not add an external narrator.",
    voiceover: "Use a concise professional voice-over that supports the images. Avoid on-screen character dialogue unless essential to the story.",
    "no-voice": "Do not generate dialogue, narration or other spoken words. Tell the story through images, music, ambience and sound effects.",
  };

  const languageDirection: Record<VideoSpokenLanguage, string> = {
    auto: "If speech is used, infer the most suitable language from the user's story and keep it consistent.",
    de: "All spoken words must be natural German. Do not generate English speech or subtitles.",
    en: "All spoken words must be natural English. Do not generate German speech or subtitles.",
  };

  return [
    "CUSTOMER-SELECTED AUDIO SETTINGS:",
    musicDirection[audioStyle],
    voiceDirection[voiceMode],
    languageDirection[spokenLanguage],
    "Never add subtitles, captions, watermarks or visible lyrics.",
  ].join("\n");
}
