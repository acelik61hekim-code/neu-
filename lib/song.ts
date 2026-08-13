export const SONG_LENGTHS = ["clip", "full2", "full3", "full4"] as const;
export const SONG_LYRICS_MODES = ["instrumental", "ai", "custom"] as const;
export const SONG_LANGUAGES = ["de", "tr", "en", "auto"] as const;
export const SONG_VOCAL_STYLES = ["auto", "female", "male", "duet", "choir"] as const;

export type SongLength = (typeof SONG_LENGTHS)[number];
export type SongLyricsMode = (typeof SONG_LYRICS_MODES)[number];
export type SongLanguage = (typeof SONG_LANGUAGES)[number];
export type SongVocalStyle = (typeof SONG_VOCAL_STYLES)[number];

export const SONG_PRICE_CENTS: Record<SongLength, number> = {
  clip: 299,
  full2: 799,
  full3: 999,
  full4: 1199,
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
  if (value === "clip") return "30-Sekunden-Song";
  return `${songDurationMinutes(value)}-Minuten-Song`;
}

export function songModel(value: SongLength): string {
  return value === "clip" ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
}

export function songDurationMinutes(value: SongLength): 0.5 | 2 | 3 | 4 {
  if (value === "clip") return 0.5;
  if (value === "full2") return 2;
  if (value === "full3") return 3;
  return 4;
}

function songLanguageName(language: SongLanguage): string {
  if (language === "de") return "German";
  if (language === "tr") return "Turkish";
  if (language === "en") return "English";
  return "the language that best matches the customer's description and lyrics";
}

function languageQualityDirection(language: SongLanguage): string {
  if (language === "tr") {
    return [
      "Tüm şarkı yalnızca doğal ve akıcı Türkçe olmalı.",
      "Türkçe telaffuz, vurgu ve heceleme net ve doğru olmalı; başka bir dile geçme.",
      "Şarkı sözlerindeki ğ, ı, İ, ö, ş, ç ve ü harflerini doğru telaffuz et.",
      "Uydurma kelime kullanma ve kelimelerin yazımını ya da sonlarını değiştirme.",
    ].join(" ");
  }
  if (language === "de") return "Der gesamte Gesang muss ausschließlich in natürlichem, gut verständlichem Deutsch sein. Sprich jede Silbe deutlich aus, wechsle nicht die Sprache und erfinde keine Wörter.";
  if (language === "en") return "All vocals must be exclusively in natural, intelligible English. Pronounce every lyric clearly, do not switch languages, and do not invent words.";
  return "Keep one consistent language throughout the entire song. Use natural pronunciation and do not invent words.";
}

export function prepareCustomLyrics(lyrics: string, length: SongLength): string {
  const normalized = lyrics
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized || /^\s*\[(?:intro|verse|strophe|kıta|chorus|refrain|nakarat|bridge|köprü|outro|pre[- ]?chorus)[^\]]*\]/im.test(normalized)) {
    return normalized;
  }
  const lines = normalized.split("\n").filter((line) => line.trim());
  if (length === "clip") return `[Verse / Hook]\n${lines.join("\n")}`;
  const thirds = Math.max(2, Math.ceil(lines.length / 3));
  const first = lines.slice(0, thirds);
  const second = lines.slice(thirds, thirds * 2);
  const third = lines.slice(thirds * 2);
  return [
    `[Verse 1]\n${first.join("\n")}`,
    second.length ? `[Chorus]\n${second.join("\n")}` : "",
    third.length ? `[Verse 2 / Bridge]\n${third.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export function minimumCustomLyricsWords(length: SongLength): number {
  if (length === "clip") return 8;
  if (length === "full2") return 45;
  if (length === "full3") return 70;
  return 90;
}

export function countLyricsWords(lyrics: string): number {
  return lyrics
    .replace(/\[[^\]]+\]/g, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .length;
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
  voiceIdeaAnalysis?: string;
}): string {
  const language = songLanguageName(input.language);

  const musicStyle = input.style.trim() === "Deutschrap / Straßenrap"
    ? [
        "Original hard-edged modern German street rap with an authentic urban sound",
        "massive deep sub-bass and hard controlled 808 bass that hits with weight but stays clean and undistorted",
        "a hard punchy kick locked tightly to the bass, dry snare or clap, sharp rolling hi-hats and modern trap percussion",
        "a striking dark minor-key melody with memorable piano notes, tense synth or string layers and an unmistakable original instrumental motif",
        "use impactful beat drops, short pauses, bass transitions and rising energy between verse and hook so the production feels cinematic and powerful",
        "tight rhythmic rap delivery with compact bars, confident cadence, clear German diction and natural contemporary phrasing",
        "a short forceful rhythmic hook rather than a soft sung pop chorus",
        "the instrumental must feel powerful and exciting on its own, with club-ready low end and a polished wide mix while leaving space for the rap vocal",
        "serious, raw and energetic production; not Schlager, soft pop-rap, comedy rap or a sentimental pop ballad",
        "Do not imitate any named rapper, collective, existing song, melody, voice or recording",
      ].join("; ")
    : input.style.trim() === "Türkischer Arabesk"
      ? [
        "Original Turkish dramatic arabesk ballad with profound sadness, longing, heartbreak and emotional weight",
        "slow to moderate tempo in a dark minor key with restrained rhythm and no dance groove",
        "cinematic grand string orchestra, sorrowful piano, deep warm bass, subtle acoustic guitar and only a very discreet bağlama texture for Turkish character",
        "the arrangement must sound dramatic, tragic, intimate and orchestral rather than Middle Eastern, folkloric, exotic or festive",
        "avoid oud, kanun, zurna, ney, darbuka solos, belly-dance rhythms, busy hand percussion and stereotypical oriental melodic runs",
        "use a controlled expressive Turkish vocal with clear diction, deep feeling and tasteful ornamentation; avoid excessive melisma and theatrical wailing",
        "start intimate, build gradually with strings and harmony, reach a powerful sorrowful chorus, then end quietly and unresolved",
        "Do not imitate any named singer, existing song, melody, voice or recording",
        ].join("; ")
      : input.style.trim() === "Türkischer Arabesk-Pop / Fantezi"
        ? [
          "Original modern Turkish arabesk-pop and fantezi music",
          "romantic, cinematic and emotionally intense with a polished contemporary production",
          "expressive Turkish-style vocals, lush string orchestra, piano, bağlama/saz and tasteful darbuka percussion",
          "clear pop song structure, soaring chorus and dramatic instrumental transitions",
          "Do not imitate any named singer, existing song, melody or recording",
          ].join("; ")
        : input.style.trim() || "modern, polished production";

  const durationMinutes = songDurationMinutes(input.length);
  const duration = input.length === "clip"
    ? "Create an exactly 30-second polished music clip."
    : [
        `Create a complete song targeting ${durationMinutes} minutes (${durationMinutes * 60} seconds), with a tolerance of no more than 10 seconds.`,
        "This must be a real full song, not a short clip or teaser.",
        durationMinutes >= 3
          ? "Use this timeline: [0:00 Intro] -> [0:12 Verse 1] -> [0:42 Chorus] -> [1:08 Verse 2 with new lyrics and melodic variation] -> [1:38 Instrumental development using the main motif] -> [2:04 Bridge] -> [2:30 Final chorus with a tasteful lift] -> [2:52 Outro and clean ending]."
          : "Use this timeline: [0:00 Intro] -> [0:08 Verse 1] -> [0:32 Chorus] -> [0:58 Verse 2 with new lyrics] -> [1:22 Bridge] -> [1:38 Final chorus] -> [1:52 Outro and clean ending].",
      ].join(" ");

  const vocalDirection = input.lyricsMode === "instrumental"
    ? "Instrumental only. No singing, spoken words, chants or vocal samples."
    : input.vocalStyle === "female"
      ? "Use one consistent natural female lead singer with a rich warm alto-to-mezzo range, expressive but controlled phrasing, stable timbre, clear diction and no robotic formants."
      : input.vocalStyle === "male"
        ? "Use one consistent natural male lead singer with a warm resonant baritone-to-tenor range, emotionally expressive but controlled delivery, stable timbre, clear diction and no robotic formants."
        : input.vocalStyle === "duet"
          ? "Use a complementary male and female duet with clearly distinguishable stable voices. Assign complete lines to each singer and reserve simultaneous singing for the chorus; do not randomly switch voices mid-line."
          : input.vocalStyle === "choir"
            ? "Use a stable natural lead singer supported by an expressive choir in choruses only. Keep verses intimate and intelligible; do not let the choir obscure the words."
            : "Choose one natural lead singer that fits the genre, then keep the same singer identity, range, accent and timbre throughout the entire song.";

  const genreArrangementDirection = input.style.trim() === "Deutschrap / Straßenrap"
    ? "DEUTSCHRAP PRODUCTION PRIORITY: The beat and melody are as important as the vocal. Keep the sub-bass physically powerful, the 808 tuned to the song key, and the kick clearly audible without clipping. Build a dark catchy original main motif, vary drums and bass tastefully between sections, and create a strong drop into every hook. Do not replace the rap beat with pop chords or soft ballad instrumentation."
    : input.style.trim() === "Türkischer Arabesk"
      ? "ARABESK PRODUCTION PRIORITY: Make sorrow, longing and dramatic emotional tension the defining qualities. The core sound is cinematic strings, piano and deep bass. Keep all Turkish folk color subtle and secondary. Do not use an oriental dance groove, exotic instrumental solos, festive percussion or a cheerful resolution. Favor spacious phrases, descending melodic tension, minor harmonies and a restrained tragic ending."
      : "";

  const lyricsDirection = input.lyricsMode === "custom"
    ? [
        "Perform the customer-provided original lyrics faithfully as written below.",
        "Do not rewrite, translate, paraphrase, reorder, omit or add words or lines.",
        "Do not stretch a written word by inventing extra letters in the performed or returned lyrics.",
        "Repeat only sections explicitly marked as [Chorus] or [Refrain]; never repeat a verse merely to fill the duration.",
        "Use instrumental bars, melodic development, solos, backing harmonies and a longer outro to fill remaining time instead of repeating verses.",
        `CUSTOMER LYRICS:\n${prepareCustomLyrics(input.lyrics?.trim() || "", input.length)}`,
      ].join("\n\n")
    : input.lyricsMode === "ai"
      ? `Write polished, meaningful original lyrics in ${language}. Use distinct verses that advance the story, a concise memorable chorus, natural rhyme and singable line lengths. Repeat the chorus at most three times, never recycle a verse, and do not use filler syllables excessively. Do not quote or imitate existing copyrighted lyrics.`
      : "Do not generate lyrics.";

  return [
    duration,
    input.title?.trim() ? `Working title: ${input.title.trim()}.` : "",
    `Customer's song idea: ${input.description.trim()}`,
    `Music style: ${musicStyle}.`,
    `Mood and energy: ${input.mood.trim() || "emotionally engaging"}.`,
    input.voiceIdeaAnalysis?.trim()
      ? `CUSTOMER VOICE-NOTE ANALYSIS (use as high-level musical guidance for a new original composition; never clone the voice or copy a recognizable melody):\n${input.voiceIdeaAnalysis.trim()}`
      : "",
    vocalDirection,
    genreArrangementDirection,
    languageQualityDirection(input.language),
    lyricsDirection,
    "QUALITY RULES: Keep the melody coherent and memorable. Avoid abrupt key, tempo, singer, genre or language changes. Use natural transitions between sections. Keep the lead vocal centered, clear and intelligible above the instruments without clipping, distortion, robotic artifacts or excessive reverb. Avoid awkward silence at the beginning, mid-song cutoffs, fake endings and restarting the song after the outro.",
    "Create a new original composition with its own melody, arrangement and vocal identity.",
    "Deliver a release-ready stereo mix with a clean ending and no spoken explanation outside the song.",
  ].filter(Boolean).join("\n\n");
}
