export const SONG_LENGTHS = ["clip", "full"] as const;
export const SONG_LYRICS_MODES = ["instrumental", "ai", "custom"] as const;
export const SONG_LANGUAGES = ["de", "en", "auto"] as const;
export const SONG_VOCAL_STYLES = ["auto", "female", "male", "duet", "choir"] as const;

export type SongLength = (typeof SONG_LENGTHS)[number];
export type SongLyricsMode = (typeof SONG_LYRICS_MODES)[number];
export type SongLanguage = (typeof SONG_LANGUAGES)[number];
export type SongVocalStyle = (typeof SONG_VOCAL_STYLES)[number];

export const SONG_PRICE_CENTS: Record<SongLength, number> = {
  clip: 299,
  full: 799,
};

export function isSongLength(value: unknown): value is SongLength {
  return typeof value === "string" && SONG_LENGTHS.includes(value as SongLength);
}

export function isSongLyricsMode(value: unknown): value is SongLyricsMode {
  return typeof value === "string" && SONG_LYRICS_MODES.includes(value as SongLyricsMode);
}

export function isSongLanguage(value: unknown): value is SongLanguage {
  return typeof value === "string" && SONG_LANGUAGES.includes(value as SongLanguage);
}

export function isSongVocalStyle(value: unknown): value is SongVocalStyle {
  return typeof value === "string" && SONG_VOCAL_STYLES.includes(value as SongVocalStyle);
}

export function songLengthLabel(value: SongLength): string {
  return value === "clip" ? "30-Sekunden-Song" : "Vollständiger Song";
}

export function songModel(value: SongLength): string {
  return value === "clip" ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
}

export function buildSongPrompt(input: {
  title?: string;
  description: string;
  style: string;
  mood: string;
  length: SongLength;
  lyricsMode: SongLyricsMode;
  lyrics?: string;
  language: SongLanguage;
  vocalStyle: SongVocalStyle;
}): string {
  const language = input.language === "de"
    ? "German"
    : input.language === "en"
      ? "English"
      : "the language that best matches the customer's description and lyrics";

  const duration = input.length === "clip"
    ? "Create an exactly 30-second polished music clip."
    : "Create a complete song of about 2 minutes with a clear intro, verses, chorus, bridge and outro.";

  const vocalDirection = input.lyricsMode === "instrumental"
    ? "Instrumental only. No singing, spoken words, chants or vocal samples."
    : input.vocalStyle === "female"
      ? "Use a natural female lead vocal."
      : input.vocalStyle === "male"
        ? "Use a natural male lead vocal."
        : input.vocalStyle === "duet"
          ? "Use a complementary male and female duet."
          : input.vocalStyle === "choir"
            ? "Use expressive choir vocals where musically appropriate."
            : "Choose the lead vocal that best fits the song.";

  const lyricsDirection = input.lyricsMode === "custom"
    ? `Use the customer's lyrics below. Preserve their wording as closely as musical phrasing and safety allow.\n\nCUSTOMER LYRICS:\n${input.lyrics?.trim() || ""}`
    : input.lyricsMode === "ai"
      ? `Write original lyrics in ${language}. The lyrics must match the customer's topic and include a memorable repeating chorus. Do not quote or imitate existing copyrighted lyrics.`
      : "Do not generate lyrics.";

  return [
    duration,
    input.title?.trim() ? `Working title: ${input.title.trim()}.` : "",
    `Customer's song idea: ${input.description.trim()}`,
    `Music style: ${input.style.trim() || "modern, polished production"}.`,
    `Mood and energy: ${input.mood.trim() || "emotionally engaging"}.`,
    vocalDirection,
    lyricsDirection,
    "Create an original composition. Do not imitate a named living artist or reproduce an existing melody, recording or copyrighted lyrics.",
    "Deliver a release-ready stereo mix with a clean ending and no spoken explanation outside the song.",
  ].filter(Boolean).join("\n\n");
}
