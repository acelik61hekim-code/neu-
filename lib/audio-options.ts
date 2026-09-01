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

export type PromptSpeechIntent =
  | "single-speaker"
  | "conversation"
  | "voiceover";

export const SUPPORTED_VOICEOVER_VOICES = [
  "Charon",
  "Kore",
] as const;

export type VoiceoverVoiceName =
  (typeof SUPPORTED_VOICEOVER_VOICES)[number];

export function inferPromptVoiceoverVoiceName(
  value: string,
): VoiceoverVoiceName | null {
  const text =
    value
      .toLocaleLowerCase("de-DE")
      .replace(/\s+/g, " ")
      .trim();

  if (
    /\b(?:männlich(?:e|er|en)?|mannesstimme|männerstimme|male voice|male narrator)\b/i.test(
      text,
    )
  ) {
    return "Charon";
  }

  if (
    /\b(?:weiblich(?:e|er|en)?|frauenstimme|female voice|female narrator)\b/i.test(
      text,
    )
  ) {
    return "Kore";
  }

  return null;
}

export function isVoiceoverVoiceName(
  value: unknown,
): value is VoiceoverVoiceName {
  return (
    typeof value === "string" &&
    SUPPORTED_VOICEOVER_VOICES.includes(
      value as VoiceoverVoiceName,
    )
  );
}

export function inferPromptSpeechIntent(
  value: string,
): PromptSpeechIntent | null {
  const text =
    value
      .toLocaleLowerCase(
        "de-DE",
      )
      .replace(/\s+/g, " ")
      .trim();

  if (!text) {
    return null;
  }

  const explicitlySilent =
    /\b(?:ohne\s+(?:sprache|dialog|stimme)|stumm|lautlos|(?:soll|darf|wird|möchte)\s+(?:die\s+person\s+)?(?:nicht|niemals)\s+(?:sprechen|reden|sagen))\b/i.test(
      text,
    );

  if (explicitlySilent) {
    return null;
  }

  const explicitlyRejectsVoiceover =
    /\b(?:kein(?:e|en|er|es)?|ohne|niemals|nicht)\b.{0,32}\b(?:voice[\s-]?over|voiceover|erzähler(?:in)?|narrator|narration|off[\s-]?(?:sprecher(?:in)?|stimme)|sprecher(?:in)?\s+(?:aus\s+dem|im)\s+off)\b|\b(?:voice[\s-]?over|voiceover|erzähler(?:in)?|narrator|narration|off[\s-]?(?:sprecher(?:in)?|stimme))\b.{0,32}\b(?:unerwünscht|verboten|weglassen|entfernen|nicht\s+(?:verwenden|benutzen|erzeugen))\b/i.test(
      text,
    );

  const explicitlyRequestsVoiceover =
    !explicitlyRejectsVoiceover &&
    /\b(?:voice[\s-]?over|voiceover|erzähler(?:in)?|narrator|narration|off[\s-]?(?:sprecher(?:in)?|stimme)|sprecher(?:in)?\s+(?:aus\s+dem|im)\s+off)\b/i.test(
      text,
    );

  if (explicitlyRequestsVoiceover) {
    return "voiceover";
  }

  const speakerLabels =
    Array.from(
      value.matchAll(
        /(?:^|\n)\s*(?:[-*•]\s*)?([^:\n]{1,48}):[^\S\r\n]*[^\r\n]+/gu,
      ),
      (match) =>
        match[1]
          .trim()
          .toLocaleLowerCase(
            "de-DE",
          )
          .replace(/[^a-z0-9äöüß]+/giu, " ")
          .replace(/\s+/g, " ")
          .trim(),
    )
      .filter(Boolean);

  const distinctSpeakerLabelCount =
    new Set(
      speakerLabels,
    ).size;

  const requestsSpeech =
    /\b(?:spricht|sprechen|redet|reden|sagt|sagen|dialog|gespräch|monolog|ansprache|moderiert|präsentiert)\b/i.test(
      text,
    ) ||
    /\b(?:soll|muss|wird|möchte)\b.{0,60}\b(?:erklären|erzählen|präsentieren|vorstellen|bewerben)\b/i.test(
      text,
    ) ||
    distinctSpeakerLabelCount >
      0;

  if (!requestsSpeech) {
    return null;
  }

  const requestsConversation =
    distinctSpeakerLabelCount >=
      2 ||
    /\b(?:miteinander|abwechselnd|unterhalten\s+sich|gespräch\s+zwischen|dialog\s+zwischen|beide\s+(?:sprechen|reden)|zwei\s+(?:personen|figuren|menschen).{0,40}(?:sprechen|reden))\b/i.test(
      text,
    );

  return requestsConversation
    ? "conversation"
    : "single-speaker";
}

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
      "POST-PRODUCED VISIBLE SPEECH MODE (highest priority): Stage the exact planned on-screen speech. A single selected character may deliver a direct-to-camera presenter monologue; with multiple selected speakers, stage a real alternating conversation. The active speaker's face and mouth remain clearly visible and perform the exact planned line with natural sentence-paced mouth, jaw and facial movement. Generate only quiet non-vocal ambience, Foley and restrained music inside the video footage: no audible dialogue, narration, voice-over, off-screen speech, singing or vocalizations. Each character receives a distinct fixed studio voice that is added scene-synchronously during final finishing.",

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
