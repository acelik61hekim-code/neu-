// lib/acedata-suno.ts

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
    throw new Error(
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
    throw new Error(
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
  }
): Promise<AceDataSongResult[]> {
  const timeoutMs =
    options?.timeoutMs ?? 8 * 60 * 1000;

  const intervalMs =
    options?.intervalMs ?? 10_000;

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result =
      await getAceDataSongTask(taskId);

    if (result.finished) {
      const validSongs =
        result.songs.filter(
          (song) =>
            song.state?.toLowerCase() ===
              "succeeded" &&
            typeof song.audio_url ===
              "string" &&
            song.audio_url.trim().length > 0
        );

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

  throw new Error(
    `Zeitüberschreitung beim Warten auf AceData Task ${taskId}.`
  );
}

export async function downloadAceDataAudio(
  audioUrl: string
): Promise<Buffer> {
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
        "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
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

  return audio;
}