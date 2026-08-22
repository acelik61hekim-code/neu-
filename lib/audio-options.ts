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

export function isVideoAudioStyle(
  value: unknown,
): value is VideoAudioStyle {
  return (
    typeof value === "string" &&
    SUPPORTED_AUDIO_STYLES.includes(
      value as VideoAudioStyle,
    )
  );
}

export function isVideoVoiceMode(
  value: unknown,
): value is VideoVoiceMode {
  return (
    typeof value === "string" &&
    SUPPORTED_VOICE_MODES.includes(
      value as VideoVoiceMode,
    )
  );
}

export function isVideoSpokenLanguage(
  value: unknown,
): value is VideoSpokenLanguage {
  return (
    typeof value === "string" &&
    SUPPORTED_SPOKEN_LANGUAGES.includes(
      value as VideoSpokenLanguage,
    )
  );
}

export function normalizeVideoAudioStyle(
  value: unknown,
): VideoAudioStyle {
  return isVideoAudioStyle(value)
    ? value
    : "cinematic";
}

export function normalizeVideoVoiceMode(
  value: unknown,
): VideoVoiceMode {
  return isVideoVoiceMode(value)
    ? value
    : "auto";
}

export function normalizeVideoSpokenLanguage(
  value: unknown,
): VideoSpokenLanguage {
  return isVideoSpokenLanguage(value)
    ? value
    : "de";
}

export function buildSelectedAudioDirection(
  audioStyle: VideoAudioStyle,
  voiceMode: VideoVoiceMode,
  spokenLanguage: VideoSpokenLanguage,
  _exactVoiceoverText = "",
  targetDurationSeconds = 15,
): string {
  const musicDirection: Record<
    VideoAudioStyle,
    string
  > = {
    cinematic:
      "Use an original cinematic score with a clear emotional arc, restrained under speech and naturally continuous across extensions.",

    emotional:
      "Use an original warm, emotional score led by intimate piano, subtle strings or similarly expressive instrumentation; never overpower speech.",

    upbeat:
      "Use original energetic, modern music with a clear pulse and positive forward momentum; keep transitions musical and controlled.",

    electronic:
      "Use an original modern electronic score with tasteful synth textures, controlled bass and rhythm-aware development.",

    ambient:
      "Use an original atmospheric ambient sound bed with subtle tonal movement, spacious texture and seamless continuity.",

    "no-music":
      "Do not generate music. Use only believable ambience, Foley and story-relevant sound effects.",
  };

  const voiceDirection: Record<
    VideoVoiceMode,
    string
  > = {
    /*
     * Ein einzelner neuer Seedance-Clip
     * umfasst bis zu 15 Sekunden.
     *
     * Erst bei mehr als 15 Sekunden besteht
     * das Video aus mehreren Provider-Clips.
     *
     * Dann deaktivieren wir im Auto-Modus
     * native Sprache, damit Stimme und
     * Aussprache nicht zwischen Clips springen.
     *
     * Ein alter 8-Sekunden-Legacy-Auftrag
     * funktioniert dadurch ebenfalls weiterhin.
     */
    auto:
      targetDurationSeconds > 15
        ? "MULTI-PART VOICE SAFETY: Do not generate dialogue, narration or other spoken words inside the video footage. Use only music, ambience and sound effects. This prevents speaker identity and pronunciation from changing between generated clips."
        : "Use speech only when it improves the story. Keep any dialogue or narration concise, natural and clearly mixed.",

    dialogue:
      "POST-PRODUCED DIALOGUE MODE (highest priority): Stage a real on-screen conversation between at least two visible, named characters. The active speaker's face and mouth remain clearly visible and perform the exact planned line with natural sentence-paced mouth, jaw and facial movement. Generate only quiet non-vocal ambience, Foley and restrained music inside the video footage: no audible dialogue, narration, voice-over, off-screen speech, singing or vocalizations. Each character receives a distinct fixed studio voice that is added scene-synchronously during final finishing.",

    voiceover:
      "Do not generate dialogue, narration or any spoken words inside the video footage. A separate studio-quality voice-over will be added in post-production, either from the customer's exact text or from the automatically written narration; preserve clean music, ambience and sound effects beneath it.",

    "no-voice":
      "Do not generate dialogue, narration or other spoken words. Tell the story through images, music, ambience and sound effects.",
  };

  const languageDirection: Record<
    VideoSpokenLanguage,
    string
  > = {
    auto:
      "If speech is used, infer the most suitable language from the user's story and keep it consistent.",

    de:
      "All spoken words must be natural German. Do not generate English speech or subtitles.",

    en:
      "All spoken words must be natural English. Do not generate German speech or subtitles.",
  };

  return [
    "CUSTOMER-SELECTED AUDIO SETTINGS:",

    musicDirection[
      audioStyle
    ],

    voiceDirection[
      voiceMode
    ],

    languageDirection[
      spokenLanguage
    ],

    "Never add subtitles, captions, watermarks, logos, interface writing, code, URLs or any other readable letters, words or numbers inside the generated footage.",

    "Computer and phone screens must use abstract unlettered graphics only.",
  ].join("\n");
}