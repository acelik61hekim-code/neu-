import { get, put } from "@vercel/blob";
import { GoogleGenAI } from "@google/genai";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const exec = promisify(execFile);

export type VideoFinishingOptions = {
  voiceoverText?: string;
  voiceoverVoiceName?: "Charon" | "Kore";
  dialogueCues?: DialogueCue[];
  dialogueReferenceAudioUris?: string[];
  closingText?: string;
  spokenLanguage?: "auto" | "de" | "en";
  musicTrackUri?: string;
  musicTrackDurationSeconds?: number;
};

export type DialogueCue = {
  startSeconds: number;
  maximumDurationSeconds: number;
  speaker: string;
  text: string;
  voiceName: string;
  voiceDirection: string;
};

export type DialogueReferenceCueMetric = {
  speaker: string;
  startSeconds: number;
  maximumDurationSeconds: number;
  sourceDurationSeconds: number;
  effectiveDurationSeconds: number;
  tempo: number;
};

export type VideoStudioEditOptions = {
  startSeconds: number;
  endSeconds: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  fadeInSeconds: number;
  fadeOutSeconds: number;
};

type GeneratedNarration = {
  pathname: string;
  mimeType: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
};

const MAX_FINISHING_GRACE_SECONDS = 2;
const NARRATION_START_DELAY_SECONDS = 0.65;
const NARRATION_TAIL_SECONDS = 0.35;

// Gemini narration is 24 kHz PCM. Some clips contain a narrow-band whistle at
// its 12 kHz Nyquist edge, so notch that tone and keep the cutoff safely below it.
const NARRATION_WHISTLE_HZ = 12_000;
const NARRATION_WHISTLE_WIDTH_HZ = 300;
const NARRATION_LOWPASS_HZ = 10_500;

const localOutputRoot = resolve(
  process.cwd(),
  ".video-backend-backups",
  "local-output",
);

export function resolveLocalVideoPath(value: string): string {
  const pathname = value.startsWith("local:")
    ? value.slice("local:".length)
    : value;

  const normalized = pathname
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  const destination = resolve(
    localOutputRoot,
    normalized,
  );

  if (!destination.startsWith(`${localOutputRoot}${sep}`)) {
    throw new Error(
      "Ungültiger lokaler Videopfad.",
    );
  }

  return destination;
}

async function withTemp<T>(
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), "video-backend-"),
  );

  try {
    return await run(dir);
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    });
  }
}

async function saveWebStream(
  stream: ReadableStream<Uint8Array>,
  destination: string,
) {
  await pipeline(
    Readable.fromWeb(stream as never),
    createWriteStream(destination),
  );
}

async function download(
  source: string,
  destination: string,
) {
  if (source.startsWith("local:")) {
    await pipeline(
      createReadStream(
        resolveLocalVideoPath(source),
      ),
      createWriteStream(destination),
    );

    return;
  }

  if (source.startsWith("blob:")) {
    const result = await get(
      source.slice("blob:".length),
      {
        access: "private",
      },
    );

    if (!result?.stream) {
      throw new Error(
        "Private Blob konnte nicht gelesen werden.",
      );
    }

    await saveWebStream(
      result.stream,
      destination,
    );

    return;
  }

  const url = new URL(source);

  const isGoogleVideo =
    url.hostname ===
    "generativelanguage.googleapis.com";

  const apiKey =
    isGoogleVideo
      ? process.env.GEMINI_API_KEY
      : undefined;

  if (
    apiKey &&
    !url.searchParams.has("key")
  ) {
    url.searchParams.set(
      "key",
      apiKey,
    );
  }

  const response = await fetch(
    url,
    {
      headers:
        apiKey
          ? {
              "x-goog-api-key":
                apiKey,
            }
          : undefined,

      cache: "no-store",
    },
  );

  if (
    !response.ok ||
    !response.body
  ) {
    throw new Error(
      `Video-Download fehlgeschlagen (HTTP ${response.status}).`,
    );
  }

  await saveWebStream(
    response.body,
    destination,
  );
}

async function upload(
  pathname: string,
  filename: string,
  contentType = "video/mp4",
) {
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
    const destination =
      resolveLocalVideoPath(pathname);

    await mkdir(
      dirname(destination),
      {
        recursive: true,
      },
    );

    await copyFile(
      filename,
      destination,
    );

    return {
      pathname:
        `local:${pathname}`,

      url:
        `local:${pathname}`,
    };
  }

  const body =
    Readable.toWeb(
      createReadStream(filename),
    ) as ReadableStream<Uint8Array>;

  const blob = await put(
    pathname,
    body,
    {
      access: "private",
      contentType,
      multipart: true,
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );

  return {
    pathname: blob.pathname,
    url: blob.url,
  };
}

function escapeFilterPath(
  pathname: string,
): string {
  return pathname
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function wrapOverlayText(
  value: string,
): string {
  const lines: string[] = [];

  for (
    const requestedLine of
    value
      .replace(/\r/g, "")
      .split("\n")
  ) {
    const words =
      requestedLine
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    let current = "";

    for (const word of words) {
      const candidate =
        current
          ? `${current} ${word}`
          : word;

      if (
        candidate.length > 30 &&
        current
      ) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines
    .slice(0, 4)
    .join("\n");
}

function readDurationFromFfmpegOutput(
  value: string,
): number | undefined {
  const match =
    value.match(
      /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i,
    );

  if (!match) {
    return undefined;
  }

  const duration =
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]);

  return (
    Number.isFinite(duration) &&
    duration > 0
  )
    ? duration
    : undefined;
}

async function inspectContainerDuration(
  binary: string,
  pathname: string,
): Promise<number | undefined> {
  try {
    const result = await exec(
      binary,
      [
        "-hide_banner",
        "-i",
        pathname,
      ],
      {
        maxBuffer:
          4 * 1024 * 1024,
      },
    );

    return readDurationFromFfmpegOutput(
      `${result.stdout}\n${result.stderr}`,
    );
  } catch (error) {
    const details =
      error as {
        stdout?: string;
        stderr?: string;
      };

    return readDurationFromFfmpegOutput(
      `${details.stdout ?? ""}\n${details.stderr ?? ""}`,
    );
  }
}

function buildAtempoFilters(
  rate: number,
): string[] {
  const filters: string[] = [];

  let remaining =
    Math.max(
      1,
      rate,
    );

  while (remaining > 2) {
    filters.push(
      "atempo=2",
    );

    remaining /= 2;
  }

  if (remaining > 1.0005) {
    filters.push(
      `atempo=${remaining.toFixed(5)}`,
    );
  }

  return filters;
}

async function generateNarration(
  dir: string,
  text: string,
  seconds: number,
  language:
    VideoFinishingOptions["spokenLanguage"],
  options: {
    filename?: string;
    voiceName?: string;
    deliveryDirection?: string;
  } = {},
): Promise<GeneratedNarration> {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Für das exakte Voice-over fehlt der Google-AI-Schlüssel.",
    );
  }

  const languageDirection =
    language === "en"
      ? "Speak natural English."
      : language === "auto"
        ? "Use the language of the supplied script."
        : "Sprich natürliches, klares Hochdeutsch. Sprich KI als K-I aus.";

  const pronunciationDirections = [
    /\bkivideostudio\.de\b/iu.test(
      text,
    )
      ? "Pronounce kivideostudio.de naturally as: K-I Video Studio Punkt D-E."
      : "",
    /\bINSTA10\b/iu.test(
      text,
    )
      ? "Pronounce INSTA10 naturally as: Insta zehn."
      : "",
  ].filter(Boolean);

  const maximumSeconds =
    Math.max(
      1.8,
      seconds - 0.15,
    );

  const voiceName =
    options.voiceName?.trim() ||
    "Kore";

  const deliveryDirection =
    options.deliveryDirection?.trim() ||
    "Use a professional, warm and confident studio voice.";

  const client =
    new GoogleGenAI({
      apiKey,
    });

  let chunks: Buffer[] = [];
  let mimeType = "audio/l16";
  let sampleRate = 24_000;
  let channels = 1;
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
    try {
      chunks = [];
      mimeType = "audio/l16";
      sampleRate = 24_000;
      channels = 1;

      const stream =
        await client.interactions.create({
          model:
            "gemini-3.1-flash-tts-preview",

          input: [
            "Synthesize the following exact spoken line as studio-quality speech.",

            languageDirection,

            ...pronunciationDirections,

            "Read the supplied script exactly once without adding, removing, translating or paraphrasing words.",

            `${deliveryDirection} Finish naturally within ${maximumSeconds.toFixed(1)} seconds.`,

            "SPOKEN SCRIPT:",

            text,
          ].join("\n"),

          response_format: {
            type: "audio",
          },

          generation_config: {
            speech_config: [
              {
                voice:
                  voiceName,
              },
            ],
          },

          stream: true,
        });

      for await (
        const event of stream
      ) {
        if (
          event.event_type !==
            "step.delta" ||
          event.delta.type !==
            "audio"
        ) {
          continue;
        }

        if (
          event.delta.mime_type
        ) {
          mimeType =
            event.delta.mime_type;
        }

        if (
          event.delta.sample_rate
        ) {
          sampleRate =
            event.delta.sample_rate;
        }

        if (
          event.delta.channels
        ) {
          channels =
            event.delta.channels;
        }

        if (
          event.delta.data
        ) {
          chunks.push(
            Buffer.from(
              event.delta.data,
              "base64",
            ),
          );
        }
      }

      if (
        chunks.length === 0
      ) {
        throw new Error(
          "Die Sprach-KI hat keine Tonspur zurückgegeben.",
        );
      }

      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (
    lastError ||
    chunks.length === 0
  ) {
    throw lastError instanceof Error
      ? lastError
      : new Error(
          "Die Sprach-KI hat keine Tonspur zurückgegeben.",
        );
  }

  const extension =
    mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("mp3")
        ? "mp3"
        : "pcm";

  const filename =
    (
      options.filename ||
      "voiceover"
    ).replace(
      /[^a-z0-9-]/gi,
      "-",
    );

  const pathname =
    join(
      dir,
      `${filename}.${extension}`,
    );

  const audio =
    Buffer.concat(chunks);

  await writeFile(
    pathname,
    audio,
  );

  const isRawPcm =
    mimeType.includes("l16") ||
    extension === "pcm";

  const durationSeconds =
    isRawPcm
      ? audio.length /
        Math.max(
          1,
          sampleRate *
            channels *
            2,
        )
      : await inspectContainerDuration(
          ffmpegPath as string,
          pathname,
        );

  if (
    !durationSeconds ||
    !Number.isFinite(
      durationSeconds,
    )
  ) {
    throw new Error(
      "Die Länge des erzeugten Voice-overs konnte nicht geprüft werden.",
    );
  }

  return {
    pathname,
    mimeType,
    sampleRate,
    channels,
    durationSeconds,
  };
}

export async function createAndStoreDialogueReferenceAudio(
  pathname: string,
  cues: DialogueCue[],
  seconds: number,
  spokenLanguage:
    VideoFinishingOptions["spokenLanguage"],
): Promise<{
  pathname: string;
  url: string;
  durationSeconds: number;
  cueMetrics: DialogueReferenceCueMetric[];
}> {
  const binary =
    ffmpegPath;

  if (!binary) {
    throw new Error(
      "ffmpeg-static ist auf dieser Plattform nicht verfügbar.",
    );
  }

  const durationSeconds =
    Math.max(
      2,
      Math.min(15, seconds),
    );

  const safeCues =
    cues
      .filter(
        (cue) =>
          Number.isFinite(cue.startSeconds) &&
          Number.isFinite(cue.maximumDurationSeconds) &&
          cue.startSeconds >= 0 &&
          cue.startSeconds < durationSeconds &&
          cue.maximumDurationSeconds >= 1 &&
          Boolean(cue.speaker.trim()) &&
          Boolean(cue.text.trim()) &&
          Boolean(cue.voiceName.trim()),
      )
      .slice(0, 16);

  return withTemp(
    async (dir) => {
      const output =
        join(
          dir,
          "dialogue-reference.wav",
        );

      const cueMetrics:
        DialogueReferenceCueMetric[] = [];

      if (safeCues.length === 0) {
        await exec(
          binary,
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            `anullsrc=r=48000:cl=mono:d=${durationSeconds}`,
            "-t",
            String(durationSeconds),
            "-c:a",
            "pcm_s16le",
            output,
          ],
          {
            maxBuffer:
              8 * 1024 * 1024,
          },
        );
      } else {
        const generated:
          GeneratedNarration[] = [];

        for (
          let index = 0;
          index < safeCues.length;
          index += 1
        ) {
          const cue =
            safeCues[index];

          generated.push(
            await generateNarration(
              dir,
              cue.text,
              cue.maximumDurationSeconds,
              spokenLanguage,
              {
                filename:
                  `reference-dialogue-${index + 1}`,
                voiceName:
                  cue.voiceName,
                deliveryDirection:
                  [
                    `The visible character ${cue.speaker} is speaking directly in the scene.`,
                    cue.voiceDirection,
                    "Use native, clear Standard German pronunciation and keep this character's vocal identity stable.",
                  ].join(" "),
              },
            ),
          );
        }

        const args: string[] = [
          "-y",
        ];

        generated.forEach(
          (audio) => {
            if (
              audio.mimeType.includes("l16") ||
              audio.pathname.endsWith(".pcm")
            ) {
              args.push(
                "-f",
                "s16le",
                "-ar",
                String(audio.sampleRate),
                "-ac",
                String(audio.channels),
              );
            }

            args.push(
              "-i",
              audio.pathname,
            );
          },
        );

        const filters: string[] = [];
        const mixInputs: string[] = [];

        generated.forEach(
          (audio, index) => {
            const cue =
              safeCues[index];
            const tempo =
              Math.max(
                1,
                audio.durationSeconds /
                  cue.maximumDurationSeconds,
              );

            if (
              tempo > 1.25
            ) {
              throw new Error(
                `Die Dialogzeile von ${cue.speaker} benötigt ${audio.durationSeconds.toFixed(2)} Sekunden, hat aber nur ${cue.maximumDurationSeconds.toFixed(2)} Sekunden. Der Render wurde gestoppt, damit die Aussprache nicht unnatürlich beschleunigt und die Lippenbewegung nicht unsynchron wird.`,
              );
            }

            cueMetrics.push({
              speaker:
                cue.speaker,
              startSeconds:
                cue.startSeconds,
              maximumDurationSeconds:
                cue.maximumDurationSeconds,
              sourceDurationSeconds:
                audio.durationSeconds,
              effectiveDurationSeconds:
                audio.durationSeconds /
                tempo,
              tempo,
            });

            const label =
              `reference${index}`;

            filters.push(
              `[${index}:a]${[
                ...buildAtempoFilters(tempo),
                "volume=1.36",
                "highpass=f=80",
                `bandreject=f=${NARRATION_WHISTLE_HZ}:t=h:w=${NARRATION_WHISTLE_WIDTH_HZ}`,
                `lowpass=f=${NARRATION_LOWPASS_HZ}:p=2`,
                `adelay=${Math.round(cue.startSeconds * 1000)}:all=1`,
              ].join(",")}[${label}]`,
            );

            mixInputs.push(
              `[${label}]`,
            );
          },
        );

        const mixed =
          mixInputs.length === 1
            ? mixInputs[0]
            : `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0,`;

        filters.push(
          `${mixed}apad=pad_dur=${durationSeconds},atrim=duration=${durationSeconds},loudnorm=I=-15:TP=-1.5:LRA=9[a]`,
        );

        args.push(
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[a]",
          "-t",
          String(durationSeconds),
          "-ar",
          "48000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          output,
        );

        await exec(
          binary,
          args,
          {
            maxBuffer:
              8 * 1024 * 1024,
          },
        );
      }

      const exactDurationSeconds =
        await inspectContainerDuration(
          binary,
          output,
        );

      if (
        !exactDurationSeconds ||
        Math.abs(
          exactDurationSeconds -
            durationSeconds,
        ) > 0.08
      ) {
        throw new Error(
          "Die erzeugte Dialog-Referenzspur besitzt nicht die exakte Videolänge.",
        );
      }

      const stored =
        await upload(
          pathname,
          output,
          "audio/wav",
        );

      return {
        ...stored,
        durationSeconds:
          exactDurationSeconds,
        cueMetrics,
      };
    },
  );
}

export async function loadStoredAudioReference(
  source: string,
): Promise<{
  data: string;
  mimeType: "audio/wav";
}> {
  return withTemp(
    async (dir) => {
      const pathname =
        join(
          dir,
          "dialogue-reference.wav",
        );

      await download(
        source,
        pathname,
      );

      return {
        data:
          (
            await readFile(
              pathname,
            )
          ).toString("base64"),
        mimeType:
          "audio/wav" as const,
      };
    },
  );
}

async function finishVideo(
  input: string,
  output: string,
  dir: string,
  seconds: number,
  options:
    VideoFinishingOptions = {},
): Promise<void> {
  const binary =
    ffmpegPath;

  if (!binary) {
    throw new Error(
      "ffmpeg-static ist auf dieser Plattform nicht verfügbar.",
    );
  }

  const musicTrackUri =
    options.musicTrackUri?.trim() ??
    "";

  const voiceoverText =
    musicTrackUri
      ? ""
      : options.voiceoverText?.trim() ??
        "";

  const dialogueCues =
    musicTrackUri
      ? []
      : options.dialogueReferenceAudioUris?.length
        ? []
      : (
      options.dialogueCues ??
      []
      )
      .filter(
        (cue) =>
          Number.isFinite(
            cue.startSeconds,
          ) &&
          Number.isFinite(
            cue.maximumDurationSeconds,
          ) &&
          cue.startSeconds >= 0 &&
          cue.maximumDurationSeconds >= 1 &&
          Boolean(
            cue.speaker.trim(),
          ) &&
          Boolean(
            cue.text.trim(),
          ) &&
          Boolean(
            cue.voiceName.trim(),
          ),
      )
      .slice(
        0,
        24,
      );

  const dialogueReferenceAudioUris =
    musicTrackUri
      ? []
      : (
          options.dialogueReferenceAudioUris ??
          []
        )
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 20);

  const closingText =
    options.closingText?.trim() ??
    "";

  const args: string[] = [
    "-y",
    "-i",
    input,
  ];

  let musicInputIndex:
    number |
    undefined;

  let exactMusicDuration:
    number |
    undefined;

  if (musicTrackUri) {
    const musicInput =
      join(
        dir,
        "original-song.audio",
      );

    await download(
      musicTrackUri,
      musicInput,
    );

    exactMusicDuration =
      await inspectContainerDuration(
        binary,
        musicInput,
      );

    if (
      !exactMusicDuration ||
      exactMusicDuration < 15 ||
      exactMusicDuration > 300.25
    ) {
      throw new Error(
        "Die vollständige Länge des Originalsongs konnte nicht geprüft werden.",
      );
    }

    if (
      options.musicTrackDurationSeconds &&
      Math.abs(
        exactMusicDuration -
          options.musicTrackDurationSeconds,
      ) > 2
    ) {
      throw new Error(
        "Die gespeicherte Songdauer stimmt nicht mit dem Musikvideo-Auftrag überein.",
      );
    }

    musicInputIndex =
      1;

    args.push(
      "-i",
      musicInput,
    );
  }

  const sourceDuration =
    await inspectContainerDuration(
      binary,
      input,
    );

  let narration:
    | GeneratedNarration
    | undefined;

  let narrationInputIndex:
    | number
    | undefined;

  const generatedDialogue:
    Array<{
      cue: DialogueCue;
      audio: GeneratedNarration;
      inputIndex: number;
    }> = [];

  let nextInputIndex =
    musicInputIndex ===
    undefined
      ? 1
      : 2;

  const dialogueReferenceInputIndices:
    number[] = [];

  const dialogueReferenceDurations:
    number[] = [];

  for (
    let index = 0;
    index < dialogueReferenceAudioUris.length;
    index += 1
  ) {
    const referenceInput =
      join(
        dir,
        `dialogue-reference-${index + 1}.wav`,
      );

    await download(
      dialogueReferenceAudioUris[index],
      referenceInput,
    );

    const referenceDuration =
      await inspectContainerDuration(
        binary,
        referenceInput,
      );

    if (
      !referenceDuration ||
      !Number.isFinite(referenceDuration)
    ) {
      throw new Error(
        `Die Länge der Dialog-Referenzspur ${index + 1} konnte nicht geprüft werden.`,
      );
    }

    dialogueReferenceDurations.push(
      referenceDuration,
    );

    dialogueReferenceInputIndices.push(
      nextInputIndex,
    );

    nextInputIndex += 1;

    args.push(
      "-i",
      referenceInput,
    );
  }

  if (
    dialogueReferenceDurations.length > 0
  ) {
    const totalReferenceDuration =
      dialogueReferenceDurations.reduce(
        (total, duration) =>
          total + duration,
        0,
      );

    if (
      Math.abs(
        totalReferenceDuration -
          seconds,
      ) > 0.12
    ) {
      throw new Error(
        `Die vollständige Dialog-Referenzspur ist ${totalReferenceDuration.toFixed(2)} Sekunden lang, das Video aber ${seconds.toFixed(2)} Sekunden. Eine unsynchronisierte Ausgabe wurde verhindert.`,
      );
    }

    console.info(
      JSON.stringify({
        level: "info",
        msg: "dialogue_reference_finishing_verified",
        videoDurationSeconds:
          seconds,
        referenceDurationSeconds:
          totalReferenceDuration,
        clipDurations:
          dialogueReferenceDurations,
      }),
    );
  }

  function appendAudioInput(
    audio: GeneratedNarration,
  ): number {
    const inputIndex =
      nextInputIndex;

    nextInputIndex += 1;

    if (
      audio.mimeType.includes(
        "l16",
      ) ||
      audio.pathname.endsWith(
        ".pcm",
      )
    ) {
      args.push(
        "-f",
        "s16le",

        "-ar",
        String(
          audio.sampleRate,
        ),

        "-ac",
        String(
          audio.channels,
        ),

        "-i",
        audio.pathname,
      );
    } else {
      args.push(
        "-i",
        audio.pathname,
      );
    }

    return inputIndex;
  }

  if (voiceoverText) {
    narration =
      await generateNarration(
        dir,
        voiceoverText,
        seconds,
        options.spokenLanguage,
        {
          voiceName:
            options.voiceoverVoiceName,
          deliveryDirection:
            options.voiceoverVoiceName ===
              "Charon"
              ? "Use a professional, calm and authoritative male documentary narrator voice."
              : "Use a professional, warm and confident female studio narrator voice.",
        },
      );

    narrationInputIndex =
      appendAudioInput(
        narration,
      );
  }

  for (
    let index = 0;
    index <
    dialogueCues.length;
    index += 1
  ) {
    const cue =
      dialogueCues[index];

    const audio =
      await generateNarration(
        dir,
        cue.text,
        cue.maximumDurationSeconds,
        options.spokenLanguage,
        {
          filename:
            `dialogue-${index + 1}`,

          voiceName:
            cue.voiceName,

          deliveryDirection:
            [
              `The visible character ${cue.speaker} is speaking.`,

              cue.voiceDirection,

              "Keep this character's vocal identity consistent with every other line assigned to the same voice.",
            ].join(" "),
        },
      );

    generatedDialogue.push({
      cue,
      audio,

      inputIndex:
        appendAudioInput(
          audio,
        ),
    });
  }

  const maximumOutputSeconds =
    exactMusicDuration ??
    (
      seconds +
      MAX_FINISHING_GRACE_SECONDS
    );

  const naturalVideoEnd =
    Math.min(
      maximumOutputSeconds,

      Math.max(
        seconds,

        sourceDuration ??
          seconds,
      ),
    );

  const naturalNarrationEnd =
    narration
      ? NARRATION_START_DELAY_SECONDS +
        narration.durationSeconds +
        NARRATION_TAIL_SECONDS
      : seconds;

  const naturalDialogueEnd =
    generatedDialogue.reduce(
      (
        latest,
        item,
      ) =>
        Math.max(
          latest,

          item.cue.startSeconds +
            Math.min(
              item.audio.durationSeconds,
              item.cue.maximumDurationSeconds,
            ) +
            NARRATION_TAIL_SECONDS,
        ),

      seconds,
    );

  const outputSeconds =
    exactMusicDuration ??
    Math.min(
      maximumOutputSeconds,

      Math.max(
        naturalVideoEnd,
        naturalNarrationEnd,
        naturalDialogueEnd,
      ),
    );

  const availableNarrationSeconds =
    Math.max(
      1,

      outputSeconds -
        NARRATION_START_DELAY_SECONDS -
        NARRATION_TAIL_SECONDS,
    );

  const narrationTempo =
    narration
      ? Math.max(
          1,

          narration.durationSeconds /
            availableNarrationSeconds,
        )
      : 1;

  const filters:
    string[] = [];

  let videoMap =
    "0:v:0";

  let audioMap =
    musicInputIndex ===
    undefined
      ? "0:a:0?"
      : `${musicInputIndex}:a:0`;

  const needsVideoPadding =
    outputSeconds >
    (
      sourceDuration ??
      seconds
    ) +
      0.02;

  if (
    closingText ||
    needsVideoPadding ||
    outputSeconds >
      seconds + 0.02
  ) {
    const videoFilters:
      string[] = [];

    if (
      needsVideoPadding
    ) {
      videoFilters.push(
        `tpad=stop_mode=clone:stop_duration=${MAX_FINISHING_GRACE_SECONDS}`,
      );
    }

    const textFile =
      join(
        dir,
        "closing-text.txt",
      );

    if (closingText) {
      await writeFile(
        textFile,
        wrapOverlayText(
          closingText,
        ),
        "utf8",
      );

      const startSecond =
        Math.max(
          0,
          outputSeconds - 6,
        );

      videoFilters.push(
        `drawbox=x=w*0.04:y=h*0.64:w=w*0.92:h=h*0.30:color=black@0.84:t=fill:enable='between(t,${startSecond},${outputSeconds})'`,

        `drawtext=font='Sans':textfile='${escapeFilterPath(textFile)}':fontcolor=white:fontsize=h/24:line_spacing=18:x=(w-text_w)/2:y=h*0.72:enable='between(t,${startSecond},${outputSeconds})'`,
      );
    }

    videoFilters.push(
      `trim=duration=${outputSeconds}`,
      "setpts=PTS-STARTPTS",
      "format=yuv420p",
    );

    filters.push(
      `[0:v]${videoFilters.join(",")}[v]`,
    );

    videoMap =
      "[v]";
  }

  if (
    dialogueReferenceInputIndices.length > 0
  ) {
    const referenceLabels =
      dialogueReferenceInputIndices.map(
        (inputIndex, index) => {
          const label =
            `dialoguereference${index}`;

          filters.push(
            `[${inputIndex}:a]asetpts=PTS-STARTPTS[${label}]`,
          );

          return `[${label}]`;
        },
      );

    const exactReferenceTrack =
      referenceLabels.length === 1
        ? referenceLabels[0]
        : `${referenceLabels.join("")}concat=n=${referenceLabels.length}:v=0:a=1,`;

    filters.push(
      `${exactReferenceTrack}apad=pad_dur=${outputSeconds},atrim=duration=${outputSeconds},loudnorm=I=-15:TP=-1.5:LRA=9[a]`,
    );

    audioMap =
      "[a]";
  } else if (
    narration ||
    generatedDialogue.length >
      0
  ) {
    /*
     * Provider-Modelle erzeugen gelegentlich trotz ausdrücklichem Verbot
     * eine eigene Sprecher- oder Erzählerstimme. Diese Stimme lässt sich
     * nachträglich nicht zuverlässig von Musik und Ambience trennen.
     *
     * Sobald eine kontrollierte Studio-Stimme vorhanden ist, wird die
     * komplette Provider-Tonspur deshalb bewusst verworfen. So können
     * niemals zwei Stimmen übereinanderliegen. Projekte ohne Studio-
     * Voice-over oder Studio-Dialog behalten weiterhin ihren Originalton.
     */
    const mixInputs: string[] = [];

    if (
      narration &&
      narrationInputIndex !==
        undefined
    ) {
      const voiceFilters = [
        ...buildAtempoFilters(
          narrationTempo,
        ),

        "volume=1.30",
        "highpass=f=80",

        `bandreject=f=${NARRATION_WHISTLE_HZ}:t=h:w=${NARRATION_WHISTLE_WIDTH_HZ}`,

        `lowpass=f=${NARRATION_LOWPASS_HZ}:p=2`,

        `adelay=${Math.round(
          NARRATION_START_DELAY_SECONDS *
            1000,
        )}:all=1`,
      ];

      filters.push(
        `[${narrationInputIndex}:a]${voiceFilters.join(",")}[voiceover]`,
      );

      mixInputs.push(
        "[voiceover]",
      );
    }

    generatedDialogue.forEach(
      (
        item,
        index,
      ) => {
        const dialogueTempo =
          Math.max(
            1,

            item.audio.durationSeconds /
              item.cue.maximumDurationSeconds,
          );

        const label =
          `dialogue${index}`;

        const dialogueFilters = [
          ...buildAtempoFilters(
            dialogueTempo,
          ),

          "volume=1.36",
          "highpass=f=80",

          `bandreject=f=${NARRATION_WHISTLE_HZ}:t=h:w=${NARRATION_WHISTLE_WIDTH_HZ}`,

          `lowpass=f=${NARRATION_LOWPASS_HZ}:p=2`,

          `adelay=${Math.round(
            item.cue.startSeconds *
              1000,
          )}:all=1`,
        ];

        filters.push(
          `[${item.inputIndex}:a]${dialogueFilters.join(",")}[${label}]`,
        );

        mixInputs.push(
          `[${label}]`,
        );
      },
    );

    const studioAudioInput =
      mixInputs.length === 1
        ? mixInputs[0]
        : `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=2,`;

    filters.push(
      `${studioAudioInput}apad=pad_dur=${outputSeconds},atrim=duration=${outputSeconds},loudnorm=I=-15:TP=-1.5:LRA=9[a]`,
    );

    audioMap =
      "[a]";
  }

  if (
    filters.length > 0
  ) {
    args.push(
      "-filter_complex",
      filters.join(";"),
    );
  }

  args.push(
    "-map",
    videoMap,

    "-map",
    audioMap,

    "-t",
    String(outputSeconds),

    "-c:v",
    "libx264",

    "-preset",
    "fast",

    "-crf",
    "18",

    "-c:a",
    "aac",

    "-b:a",
    musicInputIndex ===
    undefined
      ? "192k"
      : "320k",

    "-ar",
    "48000",

    "-movflags",
    "+faststart",

    output,
  );

  await exec(
    binary,
    args,
    {
      maxBuffer:
        32 * 1024 * 1024,
    },
  );
}

async function copyAndStore(
  source: string,
  pathname: string,
) {
  return withTemp(
    async (dir) => {
      const input =
        join(
          dir,
          "input.mp4",
        );

      await download(
        source,
        input,
      );

      return upload(
        pathname,
        input,
      );
    },
  );
}

export async function trimAndStore(
  source: string,
  seconds: number,
  pathname: string,
  finishing:
    VideoFinishingOptions = {},
) {
  /*
   * Ein einzelnes Provider-Video ist bei diesen
   * beiden Ziellängen bereits das vollständige Video:
   *
   * 8 Sekunden  -> Legacy-Veo
   * 15 Sekunden -> Seedance
   *
   * Wenn weder Voice-over, Dialog noch Schluss-Text
   * ergänzt werden muss, vermeiden wir deshalb eine
   * unnötige erneute H.264-Kodierung über FFmpeg.
   */
  const canStoreProviderVideoDirectly =
    (
      seconds === 8 ||
      seconds === 15
    ) &&
    !finishing.voiceoverText &&
    !finishing.dialogueCues?.length &&
    !finishing.dialogueReferenceAudioUris?.length &&
    !finishing.closingText &&
    !finishing.musicTrackUri;

  if (
    canStoreProviderVideoDirectly
  ) {
    return copyAndStore(
      source,
      pathname,
    );
  }

  const binary =
    ffmpegPath;

  if (!binary) {
    throw new Error(
      "ffmpeg-static ist auf dieser Plattform nicht verfügbar.",
    );
  }

  return withTemp(
    async (dir) => {
      const input =
        join(
          dir,
          "input.mp4",
        );

      const output =
        join(
          dir,
          "output.mp4",
        );

      await download(
        source,
        input,
      );

      await finishVideo(
        input,
        output,
        dir,
        seconds,
        finishing,
      );

      return upload(
        pathname,
        output,
      );
    },
  );
}

export async function mergeAndStore(
  sources: string[],
  seconds: number,
  pathname: string,
  finishing:
    VideoFinishingOptions = {},
) {
  const binary =
    ffmpegPath;

  if (!binary) {
    throw new Error(
      "ffmpeg-static ist auf dieser Plattform nicht verfügbar.",
    );
  }

  if (
    sources.length === 0
  ) {
    throw new Error(
      "Für das Zusammenfügen fehlen Kapitelvideos.",
    );
  }

  return withTemp(
    async (dir) => {
      const files:
        string[] = [];

      for (
        let index = 0;
        index <
        sources.length;
        index += 1
      ) {
        const file =
          join(
            dir,
            `chapter-${index + 1}.mp4`,
          );

        await download(
          sources[index],
          file,
        );

        files.push(
          file,
        );
      }

      const list =
        join(
          dir,
          "concat.txt",
        );

      await writeFile(
        list,

        files
          .map(
            (file) =>
              `file '${file.replace(/'/g, "'\\''")}'`,
          )
          .join("\n"),

        "utf8",
      );

      const output =
        join(
          dir,
          "output.mp4",
        );

      const merged =
        join(
          dir,
          "merged.mp4",
        );

      /*
       * Seedance erstellt jeden Abschnitt als eigenständige Videodatei.
       *
       * Deshalb kodieren wir das zusammengefügte Material bewusst auf
       * ein einheitliches H.264/AAC-Format neu, statt die Streams mit
       * "-c copy" unverändert aneinanderzuhängen.
       */
      await exec(
        binary,
        [
          "-y",

          "-f",
          "concat",

          "-safe",
          "0",

          "-i",
          list,

          "-c:v",
          "libx264",

          "-preset",
          "fast",

          "-crf",
          "18",

          "-c:a",
          "aac",

          "-b:a",
          "192k",

          "-ar",
          "48000",

          "-movflags",
          "+faststart",

          merged,
        ],
        {
          maxBuffer:
            32 * 1024 * 1024,
        },
      );

      await finishVideo(
        merged,
        output,
        dir,
        seconds,
        finishing,
      );

      return upload(
        pathname,
        output,
      );
    },
  );
}

export async function createVideoStudioVersion(
  source: string,
  pathname: string,
  options: VideoStudioEditOptions,
): Promise<{ pathname: string; durationSeconds: number }> {
  const binary = ffmpegPath;

  if (!binary) {
    throw new Error(
      "Die Video-Bearbeitung ist auf diesem Server nicht verfügbar.",
    );
  }

  const startSeconds = Math.max(0, options.startSeconds);
  const endSeconds = Math.max(startSeconds + 0.5, options.endSeconds);
  const playbackRate = Math.min(2, Math.max(0.5, options.playbackRate));
  const inputDuration = endSeconds - startSeconds;
  const outputDuration = inputDuration / playbackRate;
  const fadeInSeconds = Math.min(Math.max(0, options.fadeInSeconds), outputDuration / 2);
  const fadeOutSeconds = Math.min(Math.max(0, options.fadeOutSeconds), outputDuration / 2);
  const volume = Math.min(2, Math.max(0, options.volume));

  return withTemp(async (dir) => {
    const input = join(dir, "studio-input.mp4");
    const output = join(dir, "studio-output.mp4");

    await download(source, input);

    const sourceDuration = await inspectContainerDuration(binary, input);
    if (!sourceDuration || startSeconds >= sourceDuration) {
      throw new Error("Der gewählte Startpunkt liegt außerhalb des Videos.");
    }

    const safeEnd = Math.min(endSeconds, sourceDuration);
    const safeInputDuration = safeEnd - startSeconds;
    const safeOutputDuration = safeInputDuration / playbackRate;
    const videoFilters = [`setpts=PTS/${playbackRate.toFixed(4)}`];

    if (fadeInSeconds > 0.01) {
      videoFilters.push(`fade=t=in:st=0:d=${fadeInSeconds.toFixed(3)}`);
    }
    if (fadeOutSeconds > 0.01) {
      videoFilters.push(
        `fade=t=out:st=${Math.max(0, safeOutputDuration - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`,
      );
    }

    const args = [
      "-y",
      "-ss",
      startSeconds.toFixed(3),
      "-i",
      input,
      "-t",
      safeInputDuration.toFixed(3),
      "-vf",
      videoFilters.join(","),
      "-map",
      "0:v:0",
    ];

    if (options.muted) {
      args.push("-an");
    } else {
      const audioFilters = [
        `atempo=${playbackRate.toFixed(4)}`,
        `volume=${volume.toFixed(3)}`,
      ];
      if (fadeInSeconds > 0.01) {
        audioFilters.push(`afade=t=in:st=0:d=${fadeInSeconds.toFixed(3)}`);
      }
      if (fadeOutSeconds > 0.01) {
        audioFilters.push(
          `afade=t=out:st=${Math.max(0, safeOutputDuration - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`,
        );
      }
      args.push(
        "-map",
        "0:a:0?",
        "-af",
        audioFilters.join(","),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
      );
    }

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      output,
    );

    await exec(binary, args, { maxBuffer: 32 * 1024 * 1024 });
    const stored = await upload(pathname, output);

    return {
      pathname: stored.pathname,
      durationSeconds: safeOutputDuration,
    };
  });
}

export async function extractVideoFrameReference(
  source: string,
  atSeconds: number,
): Promise<{ data: string; mimeType: "image/jpeg" }> {
  const binary = ffmpegPath;

  if (!binary) {
    throw new Error(
      "Die Szenen-Bearbeitung ist auf diesem Server nicht verfügbar.",
    );
  }

  return withTemp(async (dir) => {
    const input = join(dir, "scene-source.mp4");
    const frame = join(dir, "scene-reference.jpg");

    await download(source, input);
    await exec(
      binary,
      [
        "-y",
        "-ss",
        Math.max(0, atSeconds).toFixed(3),
        "-i",
        input,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        frame,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    return {
      data: (await readFile(frame)).toString("base64"),
      mimeType: "image/jpeg" as const,
    };
  });
}

export async function replaceVideoSceneAndStore(
  source: string,
  replacement: string,
  pathname: string,
  options: {
    startSeconds: number;
    endSeconds: number;
    aspectRatio: "9:16" | "16:9";
  },
): Promise<{ pathname: string; durationSeconds: number }> {
  const binary = ffmpegPath;

  if (!binary) {
    throw new Error(
      "Die Szenen-Bearbeitung ist auf diesem Server nicht verfügbar.",
    );
  }

  return withTemp(async (dir) => {
    const input = join(dir, "scene-original.mp4");
    const generated = join(dir, "scene-generated.mp4");
    const output = join(dir, "scene-result.mp4");

    await Promise.all([
      download(source, input),
      download(replacement, generated),
    ]);

    const sourceDuration = await inspectContainerDuration(binary, input);
    if (!sourceDuration) {
      throw new Error("Die Länge des Originalvideos konnte nicht gelesen werden.");
    }

    const startSeconds = Math.min(
      Math.max(0, options.startSeconds),
      Math.max(0, sourceDuration - 0.25),
    );
    const endSeconds = Math.min(
      sourceDuration,
      Math.max(startSeconds + 0.25, options.endSeconds),
    );
    const sceneDuration = endSeconds - startSeconds;
    const [width, height] = options.aspectRatio === "16:9"
      ? [1280, 720]
      : [720, 1280];
    const normalize = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
      "fps=30",
      "format=yuv420p",
    ].join(",");
    const filters: string[] = [];
    const labels: string[] = [];

    if (startSeconds > 0.01) {
      filters.push(
        `[0:v]trim=start=0:end=${startSeconds.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[before]`,
      );
      labels.push("[before]");
    }

    filters.push(
      `[1:v]tpad=stop_mode=clone:stop_duration=${sceneDuration.toFixed(3)},trim=duration=${sceneDuration.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[newscene]`,
    );
    labels.push("[newscene]");

    if (endSeconds < sourceDuration - 0.01) {
      filters.push(
        `[0:v]trim=start=${endSeconds.toFixed(3)}:end=${sourceDuration.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[after]`,
      );
      labels.push("[after]");
    }

    filters.push(
      `${labels.join("")}concat=n=${labels.length}:v=1:a=0[outv]`,
    );

    await exec(
      binary,
      [
        "-y",
        "-i",
        input,
        "-i",
        generated,
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[outv]",
        "-map",
        "0:a:0?",
        "-t",
        sourceDuration.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        output,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );

    const stored = await upload(pathname, output);
    return {
      pathname: stored.pathname,
      durationSeconds: sourceDuration,
    };
  });
}
