// lib/acedata-suno.ts

import { isRestartableSongProviderError } from "@/lib/song-recovery";
import {
  resolveSongAudioFormat,
  type SongAudioExtension,
} from "@/lib/song-audio-format";

const ACEDATA_BASE_URL = "https://api.acedata.cloud";

export type AceDataSongResult = {
  id: string;
  title?: string;
  lyric?: string;
  audio_url?: string;
  image_url?: string;
  image_large_url?: string;
  video_url?: string;
  model?: string;
  state?: string;
  prompt?: string;
  style?: string;
  duration?: number | null;
  created_at?: string;
};

export type StartAceDataSongInput = {
  prompt: string;
  title?: string;
  lyrics?: string;
  style?: string;
  styleNegative?: string;
  instrumental?: boolean;
  vocalGender?: "m" | "f";
  custom?: boolean;
};

export type StartAceDataReplaceSectionInput = {
  audioId: string;
  startSeconds: number;
  endSeconds: number;
  lyrics?: string;
  style?: string;
  title?: string;
};

export type StartAceDataUploadedEditInput = {
  audioId: string;
  action: "upload_cover" | "upload_extend";
  instruction: string;
  continueAtSeconds?: number;
  lyrics?: string;
  title?: string;
};

type StartSongResponse = {
  task_id?: string;
  trace_id?: string;
  success?: boolean | string;
  data?: AceDataSongResult[];
  error?: {
    code?: string;
    message?: string;
  };
};

type TaskResponse = {
  id?: string;

  request?: Record<string, unknown>;

  response?: {
    success?: boolean;
    task_id?: string;
    trace_id?: string;
    data?: AceDataSongResult[];

    error?: {
      code?: string;
      message?: string;
    };
  };

  error?: {
    code?: string;
    message?: string;
  };
};

type UploadSongResponse = {
  success?: boolean | string;
  data?: {
    audio_id?: string;
    id?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

class AceDataTaskResponseError extends Error {
  readonly restartTask = true;
}

export function shouldRestartAceDataTask(
  error: unknown,
): boolean {
  return error instanceof AceDataTaskResponseError;
}

function getApiKey(): string {
  const key = process.env.ACEDATA_API_KEY?.trim();

  if (!key) {
    throw new Error(
      "ACEDATA_API_KEY ist nicht konfiguriert."
    );
  }

  return key;
}

function getModel(): string {
  return (
    process.env.ACEDATA_SUNO_MODEL?.trim() ||
    "chirp-v5-5"
  );
}

async function parseResponse(
  response: Response
): Promise<any> {
  const text = await response.text();

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `AceData hat keine gültige JSON-Antwort geliefert ` +
        `(HTTP ${response.status}): ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `AceData Request fehlgeschlagen (HTTP ${response.status}).`;

    throw new Error(message);
  }

  return data;
}

function normalizePrompt(prompt: string): string {
  const value = prompt.trim();

  if (!value) {
    return "Create an original professional song.";
  }

  // Für normalen Prompt-Mode eher kompakt halten.
  return value.slice(0, 200);
}

function normalizeStyle(style?: string): string | undefined {
  const value = style?.trim();

  if (!value) {
    return undefined;
  }

  return value.slice(0, 1000);
}

function normalizeLyrics(
  lyrics?: string
): string | undefined {
  const value = lyrics?.trim();

  if (!value) {
    return undefined;
  }

  return value.slice(0, 12_000);
}

export async function startAceDataSong(
  input: StartAceDataSongInput
): Promise<{
  taskId: string;
  traceId?: string;
}> {
  const lyrics = normalizeLyrics(input.lyrics);
  const style = normalizeStyle(input.style);
  const instrumental = input.instrumental ?? false;

  /*
   * Custom Mode:
   *
   * - eigene Lyrics
   * - eigener Titel
   * - eigener Style
   *
   * Instrumental darf ebenfalls Custom Mode nutzen,
   * auch ohne Lyrics.
   */
  const custom =
    input.custom ??
    Boolean(
      lyrics ||
        style ||
        input.title?.trim() ||
        instrumental
    );

  const body: Record<string, unknown> = {
    model: getModel(),
    action: "generate",
    async: true,
    custom,
    instrumental,
  };

  /*
   * Bei custom=false erzeugt Suno den Song
   * hauptsächlich aus dem Prompt.
   */
  if (!custom) {
    body.prompt = normalizePrompt(input.prompt);
  }

  /*
   * Custom Song Generation.
   */
  if (custom) {
    if (lyrics && !instrumental) {
      body.lyric = lyrics;
    }

    if (input.title?.trim()) {
      body.title = input.title.trim().slice(0, 200);
    }

    if (style) {
      body.style = style;
    }

    if (input.styleNegative?.trim()) {
      body.style_negative =
        input.styleNegative.trim().slice(0, 1000);
    }

    if (
      !instrumental &&
      (input.vocalGender === "m" ||
        input.vocalGender === "f")
    ) {
      body.vocal_gender = input.vocalGender;
    }

    /*
     * AceData dokumentiert für v5+
     * high | normal | subtle.
     */
    body.variation_category = "normal";
  }

  const response = await fetch(
    `${ACEDATA_BASE_URL}/suno/audios`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify(body),

      cache: "no-store",
    }
  );

  const data = (await parseResponse(
    response
  )) as StartSongResponse;

  if (data.error) {
    throw new Error(
      data.error.message ||
        data.error.code ||
        "AceData Songgenerierung konnte nicht gestartet werden."
    );
  }

  const taskId = data.task_id?.trim();

  if (!taskId) {
    throw new Error(
      `AceData hat keine task_id zurückgegeben: ${JSON.stringify(
        data
      ).slice(0, 1000)}`
    );
  }

  return {
    taskId,
    traceId: data.trace_id?.trim() || undefined,
  };
}

export async function getAceDataSongTask(
  taskId: string
): Promise<{
  taskId: string;
  songs: AceDataSongResult[];
  finished: boolean;
}> {
  const cleanTaskId = taskId.trim();

  if (!cleanTaskId) {
    throw new Error("AceData taskId fehlt.");
  }

  const response = await fetch(
    `${ACEDATA_BASE_URL}/suno/tasks`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        id: cleanTaskId,
        action: "retrieve",
      }),

      cache: "no-store",
    }
  );

  const task = (await parseResponse(
    response
  )) as TaskResponse;

  if (task.error) {
    throw new Error(
      task.error.message ||
        task.error.code ||
        "AceData Task konnte nicht abgefragt werden."
    );
  }

  if (task.response?.error) {
    throw new AceDataTaskResponseError(
      task.response.error.message ||
        task.response.error.code ||
        "AceData Songgenerierung ist fehlgeschlagen."
    );
  }

  const songs = Array.isArray(task.response?.data)
    ? task.response!.data!
    : [];

  /*
   * Explizite Fehlerzustände erkennen.
   */
  const failedSong = songs.find((song) => {
    const state = song.state?.toLowerCase();

    return (
      state === "failed" ||
      state === "error" ||
      state === "cancelled" ||
      state === "canceled"
    );
  });

  if (failedSong) {
    throw new AceDataTaskResponseError(
      `AceData Songgenerierung fehlgeschlagen. ` +
        `Song ${failedSong.id}: ${failedSong.state}.`
    );
  }

  /*
   * Dein echter Test hat "succeeded" geliefert.
   */
  const finished =
    songs.length > 0 &&
    songs.every(
      (song) =>
        song.state?.toLowerCase() === "succeeded"
    );

  return {
    taskId: cleanTaskId,
    songs,
    finished,
  };
}

export async function waitForAceDataSong(
  taskId: string,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    onProgress?: (
      songs: AceDataSongResult[],
    ) => Promise<void> | void;
  }
): Promise<AceDataSongResult[]> {
  const timeoutMs =
    options?.timeoutMs ?? 6 * 60 * 1000;

  const intervalMs =
    options?.intervalMs ?? 3_000;

  const startedAt = Date.now();
  let transientPollFailures = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let result: Awaited<ReturnType<typeof getAceDataSongTask>>;

    try {
      result = await getAceDataSongTask(taskId);
      transientPollFailures = 0;
    } catch (error) {
      if (
        !shouldRestartAceDataTask(error) &&
        isRestartableSongProviderError(error)
      ) {
        if (transientPollFailures >= 5) {
          throw new AceDataTaskResponseError(
            "AceData upstream server timed out repeatedly while checking the song task.",
          );
        }

        transientPollFailures += 1;

        console.warn(
          "AceData Task-Abfrage vorübergehend nicht erreichbar:",
          {
            taskId: cleanTaskIdForLog(taskId),
            attempt: transientPollFailures,
            message:
              error instanceof Error
                ? error.message
                : String(error),
          },
        );

        await new Promise<void>((resolve) => {
          setTimeout(
            resolve,
            Math.min(intervalMs * transientPollFailures, 30_000),
          );
        });

        continue;
      }

      throw error;
    }

    const validSongs =
      result.songs.filter(
        (song) =>
          song.state?.toLowerCase() ===
            "succeeded" &&
          typeof song.audio_url ===
            "string" &&
          song.audio_url.trim().length > 0
      );

    if (
      validSongs.length > 0 &&
      options?.onProgress
    ) {
      await options.onProgress(
        validSongs,
      );
    }

    if (result.finished) {

      if (!validSongs.length) {
        throw new Error(
          "AceData meldet Erfolg, hat aber keine Audio-URL zurückgegeben."
        );
      }

      return validSongs;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  throw new AceDataTaskResponseError(
    "AceData upstream server timed out while waiting for the song task.",
  );
}

function cleanTaskIdForLog(taskId: string): string {
  const clean = taskId.trim();

  if (clean.length <= 12) {
    return clean;
  }

  return `${clean.slice(0, 6)}…${clean.slice(-4)}`;
}

export async function downloadAceDataAudio(
  audioUrl: string
): Promise<{
  data: Buffer;
  extension: SongAudioExtension;
  mimeType: "audio/mp4" | "audio/mpeg";
}> {
  const url = audioUrl.trim();

  if (!url) {
    throw new Error(
      "Die AceData Audio-URL fehlt."
    );
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",

    headers: {
      Accept:
        "audio/mp4,audio/x-m4a,audio/aac,audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Die fertige AceData-Audiodatei konnte nicht geladen werden ` +
        `(HTTP ${response.status}).`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    contentType &&
    !contentType.startsWith("audio/") &&
    !contentType.startsWith("video/mp4") &&
    !contentType.includes(
      "application/octet-stream"
    )
  ) {
    throw new Error(
      `AceData Audio-URL hat einen unerwarteten Content-Type geliefert: ${contentType}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const audio = Buffer.from(arrayBuffer);

  if (audio.length < 10_000) {
    throw new Error(
      `Die heruntergeladene Audiodatei ist ungewöhnlich klein (${audio.length} Bytes).`
    );
  }

  const format =
    resolveSongAudioFormat({
      mimeType:
        contentType,
      sourceUrl:
        url,
      bytes:
        audio.subarray(
          0,
          32,
        ),
    });

  return {
    data:
      audio,
    extension:
      format.extension,
    mimeType:
      format.mimeType,
  };
}

export async function downloadAceDataImage(
  imageUrl: string,
): Promise<{
  data: Buffer;
  mimeType: string;
}> {
  const url = imageUrl.trim();

  if (!url) {
    throw new Error(
      "Die AceData Cover-URL fehlt.",
    );
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept:
        "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.1",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Das AceData Songcover konnte nicht geladen werden (HTTP ${response.status}).`,
    );
  }

  const reportedMimeType =
    response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLocaleLowerCase();

  const inferredMimeType =
    /\.png(?:$|\?)/i.test(url)
      ? "image/png"
      : /\.webp(?:$|\?)/i.test(url)
        ? "image/webp"
        : /\.avif(?:$|\?)/i.test(url)
          ? "image/avif"
          : "image/jpeg";

  const mimeType =
    reportedMimeType?.startsWith("image/")
      ? reportedMimeType
      : !reportedMimeType ||
          reportedMimeType === "application/octet-stream"
        ? inferredMimeType
        : reportedMimeType;

  if (!mimeType.startsWith("image/")) {
    throw new Error(
      `AceData Cover-URL hat einen unerwarteten Content-Type geliefert: ${mimeType}`,
    );
  }

  const data = Buffer.from(
    await response.arrayBuffer(),
  );

  if (
    data.length < 1_000 ||
    data.length > 20 * 1024 * 1024
  ) {
    throw new Error(
      `Das heruntergeladene Songcover hat eine ungültige Größe (${data.length} Bytes).`,
    );
  }

  return {
    data,
    mimeType,
  };
}

export async function startAceDataReplaceSection(
  input: StartAceDataReplaceSectionInput,
): Promise<{ taskId: string; traceId?: string }> {
  const audioId = input.audioId.trim();
  if (!audioId) throw new Error("Die Suno-Song-ID fehlt.");
  if (!Number.isFinite(input.startSeconds) || !Number.isFinite(input.endSeconds) || input.startSeconds < 0 || input.endSeconds <= input.startSeconds) {
    throw new Error("Der ausgewählte Songabschnitt ist ungültig.");
  }

  const body: Record<string, unknown> = {
    model: getModel(),
    action: "replace_section",
    async: true,
    audio_id: audioId,
    replace_section_start: Number(input.startSeconds.toFixed(2)),
    replace_section_end: Number(input.endSeconds.toFixed(2)),
  };
  const lyrics = normalizeLyrics(input.lyrics);
  const style = normalizeStyle(input.style);
  if (lyrics) body.lyric = lyrics;
  if (style) body.style = style;
  if (input.title?.trim()) body.title = input.title.trim().slice(0, 200);

  const response = await fetch(`${ACEDATA_BASE_URL}/suno/audios`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await parseResponse(response) as StartSongResponse;
  if (data.error) throw new Error(data.error.message || data.error.code || "Die Abschnittsbearbeitung konnte nicht gestartet werden.");
  const taskId = data.task_id?.trim();
  if (!taskId) throw new Error("Der Musikdienst hat keine Bearbeitungs-ID zurückgegeben.");
  return { taskId, traceId: data.trace_id?.trim() || undefined };
}

export async function uploadAceDataReferenceAudio(
  audioUrl: string,
): Promise<{ audioId: string }> {
  const cleanAudioUrl = audioUrl.trim();

  if (!cleanAudioUrl) {
    throw new Error("Die URL der hochgeladenen Audiodatei fehlt.");
  }

  const response = await fetch(`${ACEDATA_BASE_URL}/suno/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ audio_url: cleanAudioUrl }),
    cache: "no-store",
  });

  const data = await parseResponse(response) as UploadSongResponse;

  if (data.error) {
    throw new Error(
      data.error.message ||
        data.error.code ||
        "Die Audiodatei konnte nicht an die Musik-KI übergeben werden.",
    );
  }

  const audioId = (data.data?.audio_id || data.data?.id || "").trim();

  if (!audioId) {
    throw new Error("Der Musikdienst hat keine Audio-ID für den Upload zurückgegeben.");
  }

  return { audioId };
}

export async function startAceDataUploadedEdit(
  input: StartAceDataUploadedEditInput,
): Promise<{ taskId: string; traceId?: string }> {
  const audioId = input.audioId.trim();
  const instruction = normalizeStyle(input.instruction);

  if (!audioId) {
    throw new Error("Die Audio-ID des eigenen Songs fehlt.");
  }

  if (!instruction) {
    throw new Error("Bitte beschreibe, was die KI am Song verändern soll.");
  }

  const body: Record<string, unknown> = {
    model: getModel(),
    action: input.action,
    async: true,
    audio_id: audioId,
    custom: true,
    variation_category: "normal",
  };

  const operationDirection = input.action === "upload_cover"
    ? "Rearrange the uploaded song according to this direction while keeping its core timing, musical identity and coherent song structure. Produce a polished full-song studio version."
    : "Continue the uploaded song seamlessly from the chosen point. Match its key, tempo, groove, vocal character and production quality, then develop the requested new musical idea with a natural transition.";

  body.style = normalizeStyle(`${instruction}. ${operationDirection}`);

  const lyrics = normalizeLyrics(input.lyrics);
  if (lyrics) body.lyric = lyrics;

  if (input.title?.trim()) {
    body.title = input.title.trim().slice(0, 200);
  }

  if (input.action === "upload_extend") {
    const continueAt = Number(input.continueAtSeconds);
    if (!Number.isFinite(continueAt) || continueAt < 1) {
      throw new Error("Der Zeitpunkt für die Song-Erweiterung ist ungültig.");
    }
    body.continue_at = Number(continueAt.toFixed(2));
  }

  const response = await fetch(`${ACEDATA_BASE_URL}/suno/audios`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await parseResponse(response) as StartSongResponse;
  if (data.error) {
    throw new Error(
      data.error.message ||
        data.error.code ||
        "Die KI-Bearbeitung des Uploads konnte nicht gestartet werden.",
    );
  }

  const taskId = data.task_id?.trim();
  if (!taskId) {
    throw new Error("Der Musikdienst hat keine Bearbeitungs-ID zurückgegeben.");
  }

  return {
    taskId,
    traceId: data.trace_id?.trim() || undefined,
  };
}
