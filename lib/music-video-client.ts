import {
  MUSIC_VIDEO_AUDIO_TYPES,
  MUSIC_VIDEO_MAX_AUDIO_BYTES,
  MUSIC_VIDEO_MAX_DURATION_SECONDS,
} from "@/lib/music-video";

type AnalysisExcerpt = {
  file: File;
  durationSeconds: number;
  windowMap: string;
  mimeType: string;
};

const ANALYSIS_SAMPLE_RATE = 16_000;
const ANALYSIS_WINDOW_SECONDS = 10;
const ANALYSIS_WINDOW_COUNT = 5;

function normalizedAudioType(file: File): string {
  const supplied =
    file.type.toLowerCase().split(";")[0].trim();

  if (
    MUSIC_VIDEO_AUDIO_TYPES.includes(
      supplied as (typeof MUSIC_VIDEO_AUDIO_TYPES)[number],
    )
  ) {
    return supplied;
  }

  const extension =
    file.name.toLowerCase().split(".").pop() ?? "";

  const byExtension: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };

  const inferred =
    byExtension[extension];

  if (!inferred) {
    throw new Error(
      "Bitte lade deinen Song als MP3, WAV, M4A, AAC, OGG oder FLAC hoch.",
    );
  }

  return inferred;
}

function writeAscii(
  view: DataView,
  offset: number,
  value: string,
) {
  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    view.setUint8(
      offset + index,
      value.charCodeAt(index),
    );
  }
}

function encodeMonoWav(
  samples: Float32Array,
  sampleRate: number,
): Blob {
  const bytesPerSample = 2;
  const dataBytes =
    samples.length * bytesPerSample;

  const buffer =
    new ArrayBuffer(44 + dataBytes);

  const view =
    new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let outputOffset = 44;

  for (const sample of samples) {
    const clamped =
      Math.max(-1, Math.min(1, sample));

    view.setInt16(
      outputOffset,
      clamped < 0
        ? clamped * 0x8000
        : clamped * 0x7fff,
      true,
    );

    outputOffset += bytesPerSample;
  }

  return new Blob(
    [buffer],
    {
      type: "audio/wav",
    },
  );
}

function createAnalysisWindows(
  durationSeconds: number,
) {
  if (durationSeconds <= 55) {
    return [
      {
        start: 0,
        duration: durationSeconds,
      },
    ];
  }

  const maximumStart =
    Math.max(0, durationSeconds - ANALYSIS_WINDOW_SECONDS);

  return Array.from(
    {
      length: ANALYSIS_WINDOW_COUNT,
    },
    (_, index) => ({
      start:
        maximumStart *
        (index / (ANALYSIS_WINDOW_COUNT - 1)),
      duration:
        ANALYSIS_WINDOW_SECONDS,
    }),
  );
}

export async function createMusicVideoAnalysisExcerpt(
  file: File,
): Promise<AnalysisExcerpt> {
  if (file.size < 1_000) {
    throw new Error(
      "Die Audiodatei ist leer oder zu kurz.",
    );
  }

  if (file.size > MUSIC_VIDEO_MAX_AUDIO_BYTES) {
    throw new Error(
      "Die Audiodatei darf höchstens siebzig Megabyte groß sein.",
    );
  }

  const mimeType =
    normalizedAudioType(file);

  const AudioContextConstructor =
    window.AudioContext;

  if (!AudioContextConstructor) {
    throw new Error(
      "Dieser Browser kann die Songdauer nicht zuverlässig auslesen.",
    );
  }

  const audioContext =
    new AudioContextConstructor();

  let decodedAudio: AudioBuffer;

  try {
    decodedAudio =
      await audioContext.decodeAudioData(
        await file.arrayBuffer(),
      );
  } catch {
    throw new Error(
      "Der Song konnte nicht gelesen werden. Bitte nutze eine normale MP3-, WAV- oder M4A-Datei.",
    );
  } finally {
    await audioContext.close();
  }

  const durationSeconds =
    decodedAudio.duration;

  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 15
  ) {
    throw new Error(
      "Der Song muss mindestens fünfzehn Sekunden lang sein.",
    );
  }

  if (durationSeconds > MUSIC_VIDEO_MAX_DURATION_SECONDS + 0.25) {
    throw new Error(
      "Der Song darf höchstens fünf Minuten lang sein.",
    );
  }

  const windows =
    createAnalysisWindows(durationSeconds);

  const excerptSeconds =
    windows.reduce(
      (sum, window) => sum + window.duration,
      0,
    );

  const offlineContext =
    new OfflineAudioContext(
      1,
      Math.ceil(excerptSeconds * ANALYSIS_SAMPLE_RATE),
      ANALYSIS_SAMPLE_RATE,
    );

  let outputStart = 0;

  for (const window of windows) {
    const source =
      offlineContext.createBufferSource();

    source.buffer =
      decodedAudio;

    source.connect(
      offlineContext.destination,
    );

    source.start(
      outputStart,
      window.start,
      window.duration,
    );

    outputStart +=
      window.duration;
  }

  const rendered =
    await offlineContext.startRendering();

  const wav =
    encodeMonoWav(
      rendered.getChannelData(0),
      ANALYSIS_SAMPLE_RATE,
    );

  const windowMap =
    windows
      .map(
        (window, index) =>
          `Analyse ${Math.round(index * ANALYSIS_WINDOW_SECONDS)}–${Math.round(index * ANALYSIS_WINDOW_SECONDS + window.duration)} Sekunden = Original ${window.start.toFixed(1)}–${(window.start + window.duration).toFixed(1)} Sekunden`,
      )
      .join("; ");

  return {
    file:
      new File(
        [wav],
        "musikvideo-analyse.wav",
        {
          type: "audio/wav",
        },
      ),
    durationSeconds,
    windowMap:
      `${windowMap}. Originalformat: ${mimeType}.`,
    mimeType,
  };
}
