import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { FatalError } from "workflow";

import {
  buildSongPrompt,
  type SongLanguage,
  type SongLength,
} from "@/lib/song";

import {
  assessSongLyricQuality,
  type SongLyricQuality,
} from "@/lib/song-quality";

import { songStore } from "@/lib/song-store";

import {
  downloadAceDataAudio,
  startAceDataSong,
  waitForAceDataSong,
  type AceDataSongResult,
} from "@/lib/acedata-suno";

const localSongRoot = resolve(
  process.cwd(),
  ".video-backend-backups",
  "local-song-output",
);

const exec = promisify(execFile);

type SongJob = NonNullable<
  Awaited<ReturnType<typeof songStore.get>>
>;

type InspectedSongCandidate = {
  song: AceDataSongResult;
  audio: Buffer;

  generatedAudio: {
    mimeType: string;
  };

  audioQuality: Awaited<
    ReturnType<typeof inspectAudio>
  >;

  lyricQuality: SongLyricQuality;
};

export function resolveLocalSongPath(
  value: string,
): string {
  const relative = value.startsWith("local-song:")
    ? value.slice("local-song:".length)
    : value;

  const destination = resolve(
    localSongRoot,
    relative
      .replace(/\\/g, "/")
      .replace(/^\/+/, ""),
  );

  if (
    !destination.startsWith(
      `${localSongRoot}${sep}`,
    )
  ) {
    throw new Error(
      "Ungültiger lokaler Songpfad.",
    );
  }

  return destination;
}

export async function storeSongAudio(
  jobId: string,
  audio: Buffer,
  mimeType: string,
): Promise<string> {
  const pathname = `songs/${jobId}.mp3`;

  const hasBlobCredentials = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (
        process.env.VERCEL_OIDC_TOKEN &&
        process.env.BLOB_STORE_ID
      ),
  );

  if (
    process.env.NODE_ENV === "development" &&
    !hasBlobCredentials
  ) {
    const filename =
      resolveLocalSongPath(pathname);

    await mkdir(
      dirname(filename),
      { recursive: true },
    );

    await writeFile(filename, audio);

    return `local-song:${pathname}`;
  }

  const blob = await put(
    pathname,
    audio,
    {
      access: "private",
      contentType:
        mimeType || "audio/mpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );

  return `blob:${blob.pathname}`;
}

async function inspectAudio(
  audio: Buffer,
): Promise<{
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}> {
  if (!ffmpegPath) {
    throw new Error(
      "Die technische Songprüfung ist nicht verfügbar.",
    );
  }

  const directory = await mkdtemp(
    join(tmpdir(), "song-quality-"),
  );

  try {
    const filename = join(
      directory,
      "song.mp3",
    );

    await writeFile(filename, audio);

    const result = await exec(
      ffmpegPath,
      [
        "-hide_banner",
        "-i",
        filename,
        "-f",
        "null",
        "-",
      ],
      {
        maxBuffer:
          12 * 1024 * 1024,
      },
    ).catch((error: unknown) => {
      const details = error as {
        stderr?: string;
      };

      if (details.stderr) {
        return {
          stderr: details.stderr,
        };
      }

      throw error;
    });

    const output =
      result.stderr || "";

    const durationMatch =
      output.match(
        /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i,
      );

    const audioMatch =
      output.match(
        /Audio:[^,]*,\s*(\d+)\s*Hz,\s*(mono|stereo|\d+ channels?)/i,
      );

    if (
      !durationMatch ||
      !audioMatch
    ) {
      throw new Error(
        "Die erzeugte MP3 konnte technisch nicht geprüft werden.",
      );
    }

    const durationSeconds =
      Number(durationMatch[1]) *
        3600 +
      Number(durationMatch[2]) *
        60 +
      Number(durationMatch[3]);

    const channelText =
      audioMatch[2].toLowerCase();

    const channels =
      channelText === "stereo"
        ? 2
        : channelText === "mono"
          ? 1
          : Number.parseInt(
              channelText,
              10,
            );

    return {
      durationSeconds,
      sampleRate:
        Number(audioMatch[1]),
      channels,
    };
  } finally {
    await rm(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

function permanentProviderError(
  error: unknown,
): boolean {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  return (
    /\b400\b|blocked|safety|sensitive|prohibited|copyright|artist|moderation|balance|insufficient|not sufficient|buy more/i.test(
      message,
    )
  );
}

function lyricLanguage(
  language: SongLanguage,
): string {
  if (language === "tr") {
    return "Turkish";
  }

  if (language === "de") {
    return "German";
  }

  if (language === "en") {
    return "English";
  }

  return (
    "the natural language of the customer's description"
  );
}

function targetLyricsWords(
  length: SongLength,
): number {
  if (length === "clip") {
    return 45;
  }

  if (length === "full2") {
    return 120;
  }

  if (length === "full3") {
    return 175;
  }

  return 220;
}

function streetRapLyricsWords(
  length: SongLength,
): number {
  if (length === "clip") {
    return 70;
  }

  if (length === "full2") {
    return 190;
  }

  if (length === "full3") {
    return 275;
  }

  return 350;
}

function isGermanStreetRap(
  style: string,
): boolean {
  const normalized =
    style
      .trim()
      .toLocaleLowerCase(
        "de-DE",
      );

  return (
    normalized.includes(
      "deutschrap",
    ) ||
    normalized.includes(
      "straßenrap",
    )
  );
}

function safeFallbackGenre(
  style: string,
): string {
  const normalized =
    style.toLocaleLowerCase(
      "de-DE",
    );

  if (
    normalized.includes(
      "deutschrap",
    ) ||
    normalized.includes(
      "straßenrap",
    )
  ) {
    return (
      "hard-edged modern German street rap with massive clean sub-bass, " +
      "hard tuned 808s, a punchy kick, sharp rolling hi-hats, a striking " +
      "dark minor-key piano and synth motif, impactful beat drops, tight " +
      "rhythmic verses and a forceful spoken hook without pop singing"
    );
  }

  if (
    normalized.includes("rap") ||
    normalized.includes(
      "hip-hop",
    )
  ) {
    return (
      "modern melodic hip-hop and rap with crisp drums, warm bass, " +
      "clear rhythmic verses and a memorable original hook"
    );
  }

  if (
    normalized.includes(
      "arabesk",
    ) &&
    !normalized.includes("pop") &&
    !normalized.includes(
      "fantezi",
    )
  ) {
    return (
      "slow dramatic Turkish arabesk ballad in a dark minor key with " +
      "profound sadness, cinematic string orchestra, sorrowful piano, " +
      "deep warm bass, restrained drums, a discreet bağlama texture and " +
      "expressive clear Turkish vocals; not Middle Eastern folklore, " +
      "not oriental dance music, no oud, kanun, zurna, ney, darbuka solos " +
      "or busy hand percussion"
    );
  }

  if (
    normalized.includes(
      "arabesk",
    ) ||
    normalized.includes(
      "fantezi",
    )
  ) {
    return (
      "original Turkish arabesk-pop with expressive vocals, piano, " +
      "lush warm strings, subtle bağlama and restrained modern percussion"
    );
  }

  if (
    normalized.includes("r&b")
  ) {
    return (
      "modern melodic R&B with a warm groove and expressive vocals"
    );
  }

  if (
    normalized.includes("afro")
  ) {
    return (
      "modern Afrobeats with a warm danceable groove and melodic vocals"
    );
  }

  if (
    normalized.includes("rock")
  ) {
    return (
      "modern melodic rock with organic drums, guitars and expressive vocals"
    );
  }

  if (
    normalized.includes(
      "elektr",
    )
  ) {
    return (
      "modern electronic pop with polished synthesizers and a memorable vocal hook"
    );
  }

  if (
    normalized.includes(
      "akust",
    )
  ) {
    return (
      "warm acoustic pop with guitar, piano and intimate vocals"
    );
  }

  return (
    "modern polished pop with a coherent melody, natural vocals and a memorable original hook"
  );
}

function safeFallbackPrompt(
  job: SongJob,
): string {
  const language =
    isGermanStreetRap(
      job.style,
    )
      ? "German"
      : lyricLanguage(
          job.language,
        );

  const singer =
    job.vocalStyle === "female"
      ? "one consistent natural female lead singer"
      : job.vocalStyle === "male"
        ? "one consistent natural male lead singer"
        : job.vocalStyle === "duet"
          ? "a consistent female and male duet"
          : job.vocalStyle === "choir"
            ? "one natural lead singer with a choir in the choruses"
            : "one consistent natural lead singer";

  return [
    `Create a complete original song in ${safeFallbackGenre(
      job.style,
    )}. Let the musical structure determine its natural duration; do not target a fixed minute length.`,

    `Use ${singer}. Write all lyrics entirely in ${language}.`,

    `Mood: ${job.mood}.`,

    `Topic: ${job.description}`,

    "Create an original melody, arrangement and vocal identity. Do not imitate a real performer or existing song.",

    "Use a coherent song structure, memorable chorus, polished production, clear diction and a clean ending.",
  ].join("\n\n");
}

function buildAceDataStyle(
  job: SongJob,
): string {
  const parts: string[] = [
    safeFallbackGenre(
      job.style,
    ),
    `${job.mood} mood`,
  ];

  if (
    job.vocalStyle === "male"
  ) {
    parts.push(
      "deep expressive male lead vocal",
    );
  } else if (
    job.vocalStyle ===
    "female"
  ) {
    parts.push(
      "expressive female lead vocal",
    );
  } else if (
    job.vocalStyle ===
    "duet"
  ) {
    parts.push(
      "natural male and female duet",
    );
  } else if (
    job.vocalStyle ===
    "choir"
  ) {
    parts.push(
      "natural lead vocal with layered choir in the choruses",
    );
  }

  if (
    job.language === "tr"
  ) {
    parts.push(
      "natural clear Turkish pronunciation",
    );
  } else if (
    job.language === "de"
  ) {
    parts.push(
      "natural clear German pronunciation",
    );
  } else if (
    job.language === "en"
  ) {
    parts.push(
      "natural clear English pronunciation",
    );
  }

  parts.push(
    "professional studio production",
    "balanced mix",
    "clear lead vocal",
    "memorable original chorus",
  );

  return parts
    .join(", ")
    .slice(0, 1000);
}

function aceDataVocalGender(
  vocalStyle: string,
): "m" | "f" | undefined {
  if (
    vocalStyle === "male"
  ) {
    return "m";
  }

  if (
    vocalStyle === "female"
  ) {
    return "f";
  }

  return undefined;
}

function buildStyleNegative(
  job: SongJob,
): string {
  const parts = [
    "poor audio quality",
    "distorted vocals",
    "unclear diction",
    "excessive clipping",
    "abrupt ending",
  ];

  const normalized =
    job.style.toLocaleLowerCase(
      "de-DE",
    );

  if (
    normalized.includes(
      "arabesk",
    )
  ) {
    parts.push(
      "oriental dance music",
      "excessive darbuka",
      "zurna solo",
      "busy folk percussion",
    );
  }

  return parts
    .join(", ")
    .slice(0, 1000);
}

async function polishGermanStreetRapLyrics(
  ai: GoogleGenAI,
  job: SongJob,
  draft: string,
  safetyRewrite: boolean,
): Promise<string> {
  const response =
    await ai.interactions.create({
      model:
        "gemini-3.6-flash",

      input: [
        "Du bist ein professioneller deutschsprachiger Rap-Texter und ein sehr strenger Lektor.",

        "Überarbeite den folgenden Entwurf vollständig zu einem eigenständigen, modernen Deutschrap-Text. Gib ausschließlich den fertigen Songtext aus.",

        `Thema und Kundenwunsch: ${job.description}`,

        `Stimmung: ${job.mood}. Schreibe einen vollständigen Song mit natürlicher Länge. Zielumfang: ungefähr ${streetRapLyricsWords(
          job.length,
        )} Wörter.`,

        job.title
          ? `Arbeitstitel: ${job.title}.`
          : "",

        "Schreibe zwei inhaltlich unterschiedliche Strophen mit jeweils 14 bis 16 kompakten Bars. Jede Strophe muss die Geschichte weiterführen. Schreibe einen kurzen, druckvollen Refrain mit 4 Zeilen, der beim zweiten Mal exakt wiederholt werden darf. Ergänze eine kurze Bridge und ein knappes Outro.",

        "Jede Zeile muss wie natürlich gesprochenes, grammatikalisch korrektes Deutsch klingen und rhythmisch rappbar sein. Verwende saubere Paarreime, Binnenreime und gelegentliche mehrsilbige Reime, aber verdrehe niemals die Grammatik nur für einen Reim.",

        "Schreibe pro Rapzeile ungefähr 6 bis 12 Wörter. Keine überlangen Zeilen, keine künstlich gedehnten Schreibweisen und keine Fülllaute. Setze Satzzeichen so, dass natürliche Atempausen entstehen.",

        "Nutze konkrete, neue Bilder und Details aus dem Kundenwunsch. Schreibe eine nachvollziehbare Perspektive und einen roten Faden statt einer beliebigen Aneinanderreihung von Statussymbolen.",

        "Verboten sind automatisch eingefügte Klischees und Füllwörter wie Bruda, Para, Yallah, Lan, Baba, Benz, AMG, Block, Kiez, Beton, Blaulicht, Schlamm, Herz aus Stein, ganz unten und nach oben – außer der Kunde hat den jeweiligen Begriff ausdrücklich verlangt.",

        "Keine sinnlosen Adlibs, keine erfundene Migrantensprache, keine falschen Artikel oder Fälle, keine unfertigen Sätze, keine austauschbaren Motivationssprüche und keine Reimwörter ohne inhaltlichen Zusammenhang.",

        "Imitiere weder Text, Stimme, Reimschema noch typische Formulierungen eines bekannten Rappers. Erfinde einen eigenen glaubwürdigen Stil.",

        safetyRewrite
          ? "Halte den Text vollständig jugendfrei: keine Gewaltfantasien, Drohungen, Drogenverherrlichung, Hassrede, sexuellen Inhalte oder Anleitungen zu Straftaten. Die Haltung darf trotzdem direkt und selbstbewusst bleiben."
          : "Keine grafische Gewalt, Drohungen, Hassrede, Drogenverherrlichung oder Anleitungen zu Straftaten.",

        "Nutze ausschließlich diese Abschnittsüberschriften: [Intro], [Verse 1], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro]. Keine Zeitangaben und keine Produktionsanweisungen.",

        `ENTWURF:\n${draft}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

  const polished =
    response.output_text
      ?.trim()
      .replace(
        /^```(?:text)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();

  if (
    !polished ||
    polished.length < 160
  ) {
    throw new Error(
      "Der Deutschrap-Text konnte nicht vollständig überarbeitet werden.",
    );
  }

  return polished.slice(
    0,
    12_000,
  );
}

async function polishLyricsForPerformance(
  ai: GoogleGenAI,
  job: SongJob,
  draft: string,
  requestedWords: number,
  safetyRewrite: boolean,
): Promise<string> {
  const language =
    lyricLanguage(
      job.language,
    );

  const response =
    await ai.interactions.create({
      model:
        "gemini-3.6-flash",

      input: [
        "You are a meticulous native lyric editor and vocal arranger. Return only the final lyrics, never an explanation.",

        `Edit the draft into natural, release-ready lyrics entirely in ${language} for a ${job.style} song with a ${job.mood} mood.`,

        `Keep the customer's subject and intended story. Target roughly ${requestedWords} words for a complete song; let the natural structure determine the duration and do not make the text denser merely to fill time.`,

        "Use only [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus] and [Outro] section tags. Do not add timestamps, stage directions or production notes.",

        "Each sung line should normally contain 4 to 9 words, one natural phrase and a clear breathing point. A chorus should be concise. Every verse must introduce new content.",

        "Use correct native grammar, spelling, punctuation, stress and idiom. Remove tongue-twisting word clusters, awkward inversions, incomplete sentences and meaningless rhymes.",

        "Never spell sustained notes phonetically, repeat letters inside words, invent word endings or write filler strings such as aaa, ooo, iii, ahhh or ohhh. A sustained note must keep the normally written word unchanged.",

        "Keep the average vocal delivery steady and intelligible. Do not cram a paragraph into one line and do not stretch a few words across an entire section.",

        job.language === "tr"
          ? "Türkçe sözleri doğal ve güncel bir dille düzenle. Ğ, ı, İ, ö, ş, ç ve ü harflerini doğru kullan; heceleri bozma, kelime sonlarını değiştirme ve gereksiz melisma çağrıştıran yazımlar ekleme."
          : "",

        safetyRewrite
          ? "Keep every line unambiguously family-friendly and free of violence, threats, drugs, sexual content, self-harm, hate or crime instructions."
          : "Keep the wording suitable for a general audience.",

        `DRAFT:\n${draft}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

  const polished =
    response.output_text
      ?.trim()
      .replace(
        /^```(?:text)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();

  if (
    !polished ||
    polished.length < 120
  ) {
    throw new Error(
      "Der Songtext konnte nicht für einen natürlichen Gesang vorbereitet werden.",
    );
  }

  return polished.slice(
    0,
    12_000,
  );
}

async function generatePlannedLyrics(
  ai: GoogleGenAI,
  job: SongJob,
  safetyRewrite = false,
): Promise<string | undefined> {
  if (
    job.lyricsMode !== "ai"
  ) {
    return undefined;
  }

  const language =
    isGermanStreetRap(
      job.style,
    )
      ? "German"
      : lyricLanguage(
          job.language,
        );

  const germanStreetRap =
    isGermanStreetRap(
      job.style,
    );

  const requestedWords =
    germanStreetRap
      ? streetRapLyricsWords(
          job.length,
        )
      : targetLyricsWords(
          job.length,
        );

  const streetRapDirection =
    germanStreetRap
      ? "Draft authentic modern German rap with a coherent topic-specific story, 14 to 16 compact bars per verse, natural grammar, internal and multisyllabic rhymes and a concise four-line hook. Never add generic pseudo-street slang, status symbols or filler adlibs unless explicitly requested by the customer. Avoid the stock words Bruda, Para, Yallah, Lan, Baba, Benz, AMG, Block, Kiez, Beton, Blaulicht and Herz aus Stein. Do not imitate a known rapper."
      : "";

  const response =
    await ai.interactions.create({
      model:
        "gemini-3.6-flash",

      input: [
        `Write original, release-ready song lyrics in ${language}.`,

        `Target about ${requestedWords} words for a complete song whose natural musical structure determines the duration.`,

        `Song topic and wishes: ${job.description}`,

        `Genre: ${job.style}. Mood: ${job.mood}.`,

        job.title
          ? `Title: ${job.title}.`
          : "",

        "Output only the lyrics with clear section tags: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro].",

        "Every verse must contain new lines that advance the story. The chorus must be short and memorable and may appear twice, but do not duplicate a verse.",

        "Use natural grammar, meaningful imagery, singable line lengths and correct spelling. Do not invent words, stretch spelling or include production notes.",

        streetRapDirection,

        safetyRewrite
          ? "A previous music-generation attempt was rejected by an automated safety filter. Rewrite the lyrics with clearly harmless, family-friendly wording. Avoid graphic violence, weapons, drugs, self-harm, sexual content, insults, threats, crime instructions and ambiguous slang. Preserve the general emotion and topic without risky wording."
          : "Keep all wording suitable for a general audience so a music-generation model can perform it safely.",

        job.language === "tr"
          ? "Doğal ve doğru Türkçe kullan. Her dize anlamlı olsun; uydurma kelime ve başka dil kullanma."
          : "",

        safetyRewrite &&
        job.language === "tr"
          ? "Sözleri tamamen güvenli ve aile dostu ifadelerle yeniden yaz. Şiddet, silah, uyuşturucu, tehdit, hakaret, kendine zarar verme, cinsel içerik ve belirsiz argo kullanma."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

  const lyrics =
    response.output_text
      ?.trim()
      .replace(
        /^```(?:text)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();

  if (
    !lyrics ||
    lyrics.length < 80
  ) {
    throw new Error(
      "Die KI konnte keinen vollständigen Songtext vorbereiten.",
    );
  }

  if (germanStreetRap) {
    return polishGermanStreetRapLyrics(
      ai,
      job,
      lyrics,
      safetyRewrite,
    );
  }

  return polishLyricsForPerformance(
    ai,
    job,
    lyrics,
    requestedWords,
    safetyRewrite,
  );
}

/*
 * WICHTIG:
 *
 * Die Songlänge wird hier bewusst NICHT mehr geprüft.
 *
 * Suno kann aus einem gebuchten 2-Minuten-Song z. B.
 * auch einen Song mit 3:12 Minuten erzeugen.
 *
 * Solange Lyrics/Aussprache und technische Audioqualität
 * stimmen, wird der Song nicht wegen seiner Dauer abgelehnt.
 */
function songCandidateIssues(
  candidate: InspectedSongCandidate,
  _length: SongLength,
  instrumental: boolean,
): string[] {
  const issues =
    instrumental
      ? []
      : [
          ...candidate
            .lyricQuality
            .issues,
        ];

  if (
    candidate.audioQuality
      .sampleRate < 44_100 ||
    candidate.audioQuality
      .channels < 2
  ) {
    issues.push(
      "Die Audiodatei ist nicht in hochwertigem 44,1-kHz-Stereo.",
    );
  }

  return issues;
}

async function inspectSongCandidate(
  song: AceDataSongResult,
  job: SongJob,
  plannedLyrics?: string,
): Promise<InspectedSongCandidate> {
  if (!song.audio_url) {
    throw new Error(
      "AceData hat keine Audio-URL zurückgegeben.",
    );
  }

  const audio =
    await downloadAceDataAudio(
      song.audio_url,
    );

  if (
    audio.length < 10_000
  ) {
    throw new Error(
      "Die erzeugte Audiodatei ist unvollständig.",
    );
  }

  const audioQuality =
    await inspectAudio(audio);

  const expectedLyrics =
    plannedLyrics ??
    (
      job.lyricsMode ===
      "custom"
        ? job.lyrics
        : undefined
    );

  const outputLyrics =
    song.lyric ??
    expectedLyrics;

  const lyricQuality =
    job.lyricsMode ===
    "instrumental"
      ? {
          passed: true,
          score: 100,
          issues: [],
          suspiciousTokens: [],
          sectionRates: [],
        }
      : assessSongLyricQuality({
          outputText:
            outputLyrics,
          expectedLyrics,
          language:
            job.language,
          style: job.style,
          durationSeconds:
            audioQuality
              .durationSeconds,
        });

  return {
    song,

    generatedAudio: {
      mimeType:
        "audio/mpeg",
    },

    audio,

    audioQuality,

    lyricQuality,
  };
}

async function chooseBestCandidate(
  songs: AceDataSongResult[],
  job: SongJob,
  plannedLyrics?: string,
): Promise<{
  candidate: InspectedSongCandidate;
  issues: string[];
}> {
  const inspected: Array<{
    candidate: InspectedSongCandidate;
    issues: string[];
  }> = [];

  for (const song of songs) {
    try {
      const candidate =
        await inspectSongCandidate(
          song,
          job,
          plannedLyrics,
        );

      const issues =
        songCandidateIssues(
          candidate,
          job.length,
          job.lyricsMode ===
            "instrumental",
        );

      inspected.push({
        candidate,
        issues,
      });

      /*
       * Sobald eine Variante alle Prüfungen besteht,
       * verwenden wir sie direkt.
       */
      if (
        issues.length === 0
      ) {
        return {
          candidate,
          issues,
        };
      }
    } catch (error) {
      console.warn(
        "AceData candidate inspection failed:",
        song.id,
        error,
      );
    }
  }

  if (
    inspected.length === 0
  ) {
    throw new Error(
      "Keine der von AceData erzeugten Songvarianten konnte technisch geprüft werden.",
    );
  }

  /*
   * Falls keine Variante vollständig besteht,
   * verwenden wir für die Fehlermeldung die Variante
   * mit den wenigsten Problemen.
   */
  inspected.sort(
    (a, b) => {
      if (
        a.issues.length !==
        b.issues.length
      ) {
        return (
          a.issues.length -
          b.issues.length
        );
      }

      return (
        b.candidate
          .lyricQuality.score -
        a.candidate
          .lyricQuality.score
      );
    },
  );

  return inspected[0];
}

export async function generateAndStoreSong(
  jobId: string,
): Promise<void> {
  const initialJob =
    await songStore.get(
      jobId,
    );

  if (!initialJob) {
    throw new Error(
      `Songauftrag ${jobId} wurde nicht gefunden.`,
    );
  }

  if (
    initialJob.paymentStatus !==
    "paid"
  ) {
    throw new Error(
      "Songauftrag ist nicht bezahlt.",
    );
  }

  if (
    initialJob.status ===
      "done" &&
    initialJob.audioUri
  ) {
    return;
  }

  await songStore.update(
    jobId,
    (current) => ({
      ...current,

      status: "processing",

      renderStage:
        "generating",

      progressPercent: 20,

      startedAt:
        current.startedAt ??
        Date.now(),

      errorMessage:
        undefined,
    }),
  );

  /*
   * Job erneut frisch laden.
   *
   * Bei einem Workflow-Retry kann inzwischen bereits
   * eine providerTaskId gespeichert worden sein.
   */
  const job =
    await songStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      `Songauftrag ${jobId} wurde nicht gefunden.`,
    );
  }

  const geminiApiKey =
    process.env
      .GEMINI_API_KEY
      ?.trim();

  if (!geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY für die Songtext-Erstellung ist nicht konfiguriert.",
    );
  }

  if (
    !process.env
      .ACEDATA_API_KEY
      ?.trim()
  ) {
    throw new Error(
      "ACEDATA_API_KEY für die Musikgenerierung ist nicht konfiguriert.",
    );
  }

  const ai =
    new GoogleGenAI({
      apiKey:
        geminiApiKey,
    });

  /*
   * Wenn AceData bereits gestartet wurde,
   * verwenden wir dieselbe Task-ID weiter.
   */
  let providerTaskId =
    job.providerTaskId;

  let providerTraceId =
    job.providerTraceId;

  /*
   * Bereits erzeugte KI-Lyrics nach Möglichkeit
   * wiederverwenden.
   */
  let plannedLyrics =
    job.lyricsMode === "ai"
      ? job.generatedLyrics
      : undefined;

  let generationPrompt =
    "";

  try {
    /*
     * KI-Lyrics nur erzeugen, falls sie noch
     * nicht persistent gespeichert sind.
     */
    if (
      job.lyricsMode ===
        "ai" &&
      !plannedLyrics
    ) {
      try {
        plannedLyrics =
          await generatePlannedLyrics(
            ai,
            job,
          );
      } catch (error) {
        if (
          !permanentProviderError(
            error,
          )
        ) {
          throw error;
        }

        plannedLyrics =
          await generatePlannedLyrics(
            ai,
            job,
            true,
          );
      }

      if (plannedLyrics) {
        await songStore.update(
          jobId,
          (current) => ({
            ...current,

            generatedLyrics:
              plannedLyrics,
          }),
        );
      }
    }

    const revisionDirection =
      job.revisionMode
        ? job.revisionApproach ===
          "character"
          ? "REINTERPRETATION: Preserve the reference analysis's approximate tempo, groove, instrumentation, energy curve, section proportions and generic melodic contour as closely as possible while composing a clearly new melody and harmony. Keep a compatible generic vocal range and delivery, but do not clone a voice or reproduce the source recording."
          : job.revisionApproach ===
              "new-melody"
            ? "REINTERPRETATION: Preserve the reference analysis's genre, tempo, groove, instrumentation and energy, but create a clearly different new melody, hook and harmonic progression. Use the selected vocal profile without cloning the source singer."
            : "REINTERPRETATION: Treat the reference analysis only as loose inspiration. Freely redesign melody, harmony, arrangement and vocal delivery according to the customer's current wishes while creating a fully original song."
        : "";

    const generationInput =
      plannedLyrics
        ? {
            ...job,

            lyricsMode:
              "custom" as const,

            lyrics:
              plannedLyrics,
          }
        : job;

    const enrichedGenerationInput =
      revisionDirection
        ? {
            ...generationInput,

            description:
              `${generationInput.description}\n\n${revisionDirection}`,
          }
        : generationInput;

    generationPrompt =
      buildSongPrompt(
        enrichedGenerationInput,
      );

    /*
     * Nur einen neuen AceData-Task starten,
     * wenn noch keiner existiert.
     */
    if (!providerTaskId) {
      const effectiveLyrics =
        job.lyricsMode ===
        "ai"
          ? plannedLyrics
          : job.lyricsMode ===
              "custom"
            ? job.lyrics?.trim()
            : undefined;

      const instrumental =
        job.lyricsMode ===
        "instrumental";

      const started =
        await startAceDataSong({
          prompt:
            generationPrompt ||
            safeFallbackPrompt(
              job,
            ),

          title:
            job.title,

          lyrics:
            instrumental
              ? undefined
              : effectiveLyrics,

          style:
            buildAceDataStyle(
              job,
            ),

          styleNegative:
            buildStyleNegative(
              job,
            ),

          instrumental,

          vocalGender:
            aceDataVocalGender(
              job.vocalStyle,
            ),

          /*
           * Unsere Modi arbeiten über Custom Generation:
           *
           * AI      -> Gemini-Lyrics
           * Custom  -> Kunden-Lyrics
           * Instrumental -> eigener Style ohne Lyrics
           */
          custom: true,
        });

      providerTaskId =
        started.taskId;

      providerTraceId =
        started.traceId;

      /*
       * Task-ID sofort speichern.
       *
       * Falls der Workflow danach neu startet,
       * wird kein zweiter kostenpflichtiger
       * AceData-Auftrag erzeugt.
       */
      await songStore.update(
        jobId,
        (current) => ({
          ...current,

          provider:
            "acedata",

          providerTaskId:
            started.taskId,

          providerTraceId:
            started.traceId,

          progressPercent:
            35,
        }),
      );
    }
  } catch (error) {
    if (
      permanentProviderError(
        error,
      )
    ) {
      throw new FatalError(
        error instanceof Error
          ? error.message
          : "Der Musikdienst hat die Songanfrage abgelehnt.",
      );
    }

    throw error;
  }

  if (!providerTaskId) {
    throw new Error(
      "AceData Task-ID fehlt.",
    );
  }

  /*
   * Auf die bestehende AceData/Suno-Task warten.
   */
  const generatedSongs =
    await waitForAceDataSong(
      providerTaskId,
      {
        timeoutMs:
          8 * 60 * 1000,

        intervalMs:
          10_000,
      },
    );

  if (
    generatedSongs.length === 0
  ) {
    throw new Error(
      "AceData hat keine Songvarianten zurückgegeben.",
    );
  }

  await songStore.update(
    jobId,
    (current) => ({
      ...current,

      renderStage:
        "quality-check",

      progressPercent:
        72,
    }),
  );

  /*
   * AceData/Suno liefert häufig zwei Varianten.
   *
   * Wir prüfen beide und nehmen die erste,
   * die unsere verbleibenden Qualitätschecks besteht.
   *
   * DIE LÄNGE IST KEIN ABLEHNUNGSGRUND MEHR.
   */
  const {
    candidate,
    issues:
      candidateIssues,
  } =
    await chooseBestCandidate(
      generatedSongs,
      job,
      plannedLyrics,
    );

  if (
    candidateIssues.length >
    0
  ) {
    throw new FatalError(
      `Die automatische Gesangsprüfung hat die erzeugten Versionen abgelehnt: ${candidateIssues.join(
        " ",
      )}`,
    );
  }

  /*
   * Gewählte konkrete Suno-Song-ID speichern.
   */
  await songStore.update(
    jobId,
    (current) => ({
      ...current,

      provider:
        "acedata",

      providerTaskId,

      providerTraceId,

      providerSongId:
        candidate.song.id,

      renderStage:
        "uploading",

      progressPercent:
        88,
    }),
  );

  /*
   * MP3 in unserem eigenen Storage speichern.
   */
  const audioUri =
    await storeSongAudio(
      jobId,
      candidate.audio,
      candidate.generatedAudio
        .mimeType,
    );

  const generatedLyrics =
    candidate.song.lyric
      ?.slice(0, 30_000) ??
    plannedLyrics ??
    (
      job.lyricsMode ===
      "custom"
        ? job.lyrics
        : undefined
    );

  await songStore.update(
    jobId,
    (current) => ({
      ...current,

      status:
        "done",

      renderStage:
        "completed",

      progressPercent:
        100,

      provider:
        "acedata",

      providerTaskId,

      providerTraceId,

      providerSongId:
        candidate.song.id,

      audioUri,

      audioMimeType:
        candidate.generatedAudio
          .mimeType,

      generatedLyrics,

      qualityScore:
        candidate.lyricQuality
          .score,

      completedAt:
        Date.now(),
    }),
  );
}
