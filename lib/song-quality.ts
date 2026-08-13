import type { SongLanguage } from "@/lib/song";

export type SongLyricQuality = {
  passed: boolean;
  score: number;
  issues: string[];
  similarity?: number;
  suspiciousTokens: string[];
  sectionRates: number[];
};

type TimedSection = { start: number; words: string[] };

function locale(language: SongLanguage): string {
  if (language === "tr") return "tr-TR";
  if (language === "de") return "de-DE";
  return "en-US";
}

function normalizeToken(token: string, language: SongLanguage): string {
  return token
    .normalize("NFKC")
    .toLocaleLowerCase(locale(language))
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/([\p{L}])\1{2,}/gu, "$1");
}

function wordsFromText(text: string, language: SongLanguage): string[] {
  return text
    .replace(/\[\[[^\]]+\]\]/g, " ")
    .replace(/\[(?:\d+(?:\.\d+)?\s*:|\s*:)[^\]]*\]/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .split(/\s+/u)
    .map((token) => normalizeToken(token, language))
    .filter(Boolean);
}

function expectedWordCoverage(expected: string[], actual: string[]): number {
  if (!expected.length || !actual.length) return 0;
  const available = new Map<string, number>();
  for (const word of actual) available.set(word, (available.get(word) ?? 0) + 1);
  let matched = 0;
  for (const word of expected) {
    const count = available.get(word) ?? 0;
    if (count <= 0) continue;
    matched += 1;
    available.set(word, count - 1);
  }
  return matched / expected.length;
}

function timedSections(text: string, language: SongLanguage): TimedSection[] {
  const sections: TimedSection[] = [];
  let current: TimedSection | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const timestamp = rawLine.match(/^\s*\[(\d+(?:\.\d+)?)\s*:\s*\]\s*(.*)$/u);
    if (timestamp) {
      current = { start: Number(timestamp[1]), words: wordsFromText(timestamp[2], language) };
      sections.push(current);
      continue;
    }
    const continuation = rawLine.match(/^\s*\[\s*:\s*\]\s*(.*)$/u);
    if (continuation && current) current.words.push(...wordsFromText(continuation[1], language));
  }
  return sections;
}

function suspiciousOutput(text: string): string[] {
  const tokens = text
    .replace(/\[\[[^\]]+\]\]|\[[^\]]+\]/g, " ")
    .split(/\s+/u)
    .map((token) => token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""))
    .filter(Boolean);
  return [...new Set(tokens.filter((token) => {
    if (/([aeiouyäöüıİâêîôû])\1{2,}|([\p{L}])\2{3,}/iu.test(token)) return true;
    if (/�|Ã.|(?:Ä|Å)[^\s]|Â[^\p{L}]|â(?:€|‚|„|€¦|€™)/u.test(token)) return true;
    const letters = token.replace(/[^\p{L}]/gu, "");
    if (letters.length >= 5 && new Set([...letters.toLocaleLowerCase()]).size <= 2) return true;
    return false;
  }))].slice(0, 12);
}

function vocalRateRange(style: string): { minimum: number; maximum: number } {
  const normalized = style.toLocaleLowerCase("de-DE");
  if (normalized.includes("deutschrap") || normalized.includes("straßenrap") || normalized.includes("hip-hop")) {
    return { minimum: 80, maximum: 195 };
  }
  if (normalized.includes("arabesk") || normalized.includes("fantezi") || normalized.includes("ballad")) {
    return { minimum: 38, maximum: 125 };
  }
  return { minimum: 48, maximum: 165 };
}

export function assessSongLyricQuality(input: {
  outputText?: string;
  expectedLyrics?: string;
  language: SongLanguage;
  style: string;
  durationSeconds: number;
}): SongLyricQuality {
  const output = input.outputText?.trim() || "";
  if (!output) {
    return { passed: false, score: 0, issues: ["Der Musikdienst hat keinen prüfbaren Gesangstext zurückgegeben."], suspiciousTokens: [], sectionRates: [] };
  }

  const issues: string[] = [];
  const suspiciousTokens = suspiciousOutput(output);
  if (suspiciousTokens.length) issues.push(`Künstlich verlängerte oder beschädigte Wörter: ${suspiciousTokens.join(", ")}`);

  const expectedWords = input.expectedLyrics ? wordsFromText(input.expectedLyrics, input.language) : [];
  const actualWords = wordsFromText(output, input.language);
  const similarity = expectedWords.length ? expectedWordCoverage(expectedWords, actualWords) : undefined;
  if (similarity !== undefined && similarity < 0.88) {
    issues.push(`Zu viele vorgesehene Wörter fehlen oder wurden verändert (${Math.round(similarity * 100)} % Textabdeckung).`);
  }

  const sections = timedSections(output, input.language);
  const range = vocalRateRange(input.style);
  const sectionRates: number[] = [];
  let severeTimingSections = 0;
  let unstableTiming = false;
  for (let index = 0; index < sections.length; index += 1) {
    const end = sections[index + 1]?.start ?? input.durationSeconds;
    const seconds = end - sections[index].start;
    if (seconds < 6 || sections[index].words.length < 8) continue;
    const rate = Math.round(sections[index].words.length / seconds * 60);
    sectionRates.push(rate);
    if (rate < range.minimum || rate > range.maximum) severeTimingSections += 1;
  }
  if (severeTimingSections >= 2) {
    issues.push(`Mehrere Gesangsabschnitte sind zu schnell oder zu langsam (${sectionRates.join(", ")} Wörter/Minute).`);
  }
  if (sectionRates.length >= 3 && Math.max(...sectionRates) / Math.max(1, Math.min(...sectionRates)) > 2.35) {
    unstableTiming = true;
    issues.push(`Das Gesangstempo schwankt zwischen den Abschnitten unnatürlich stark (${sectionRates.join(", ")} Wörter/Minute).`);
  }

  if (actualWords.length < 12) issues.push("Der erzeugte Gesang ist unvollständig.");
  let score = 100;
  if (suspiciousTokens.length) score -= Math.min(40, 14 + suspiciousTokens.length * 6);
  if (similarity !== undefined) score -= Math.round(Math.max(0, 0.94 - similarity) * 100);
  if (severeTimingSections >= 2) score -= Math.min(30, severeTimingSections * 8);
  if (unstableTiming) score -= 18;
  score = Math.max(0, Math.min(100, score));

  return {
    passed: issues.length === 0 && score >= 78,
    score,
    issues,
    similarity,
    suspiciousTokens,
    sectionRates,
  };
}

export function lyricQualityRetryDirection(quality: SongLyricQuality): string {
  return [
    "QUALITY CORRECTION ATTEMPT: The previous audio failed the automatic lyric and vocal-timing check.",
    ...quality.issues.map((issue) => `- ${issue}`),
    "Perform every supplied lyric exactly as written, with correct pronunciation and natural breathing.",
    "Never change spelling to show a sustained note. Never add meaningless vowel sounds, filler syllables, adlibs or extra words.",
    "Keep a steady, intelligible vocal pace. If a phrase needs more room, simplify the melody and extend instrumental space instead of rushing, dragging or swallowing syllables.",
  ].join("\n");
}
