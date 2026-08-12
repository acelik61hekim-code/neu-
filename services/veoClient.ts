import type {
  GenerateVideoDialogue,
} from "@/types/story";

export interface StartVeoInput {
  prompt: string;
  audioPrompt?: string;
  negativePrompt?: string;
  dialogue?: GenerateVideoDialogue;
}

export interface StartVeoResult {
  success: boolean;
  message?: string;
  error?: string;
  model?: string;
  operationName?: string;
  done?: boolean;
}

export interface VeoStatusResult {
  success: boolean;
  done: boolean;
  status: string;
  message?: string;
  error?: string;
  operationName?: string;
  videoUri?: string;
  mimeType?: string;
}

export interface WaitForVideoOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onStatusChange?: (
    result: VeoStatusResult,
  ) => void;
}

export interface ExtendVeoInput {
  videoUri: string;
  prompt: string;
  mimeType?: string;
}

export interface OneMinuteVideoInput
  extends StartVeoInput {
  continuationPrompts: string[];
}

export interface OneMinuteProgress {
  step: number;
  totalSteps: number;
  approximateDurationSeconds: number;
  status:
    | "starting"
    | "generating"
    | "extending"
    | "completed";
  videoUri?: string;
}

export interface OneMinuteVideoOptions
  extends WaitForVideoOptions {
  onProgress?: (
    progress: OneMinuteProgress,
  ) => void;
}

async function readJsonResponse<T>(
  response: Response,
): Promise<T> {
  const contentType =
    response.headers.get(
      "content-type",
    );

  if (
    !contentType?.includes(
      "application/json",
    )
  ) {
    const responseText =
      await response.text();

    throw new Error(
      responseText ||
        `Der Server hat keine gültige JSON-Antwort geliefert. HTTP ${response.status}`,
    );
  }

  const data =
    (await response.json()) as T;

  if (!response.ok) {
    const possibleError = data as {
      error?: string;
      message?: string;
    };

    throw new Error(
      possibleError.error ??
        possibleError.message ??
        `HTTP-Fehler ${response.status}`,
    );
  }

  return data;
}

export async function startVeoVideo(
  input: StartVeoInput,
): Promise<StartVeoResult> {
  if (
    typeof input.prompt !== "string" ||
    input.prompt.trim().length === 0
  ) {
    throw new Error(
      "Für die Videogenerierung fehlt der Veo-Prompt.",
    );
  }

  const response = await fetch(
    "/api/generate-video",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        prompt:
          input.prompt.trim(),
        audioPrompt:
          input.audioPrompt?.trim(),
        negativePrompt:
          input.negativePrompt?.trim(),
        dialogue:
          input.dialogue,
      }),
    },
  );

  return readJsonResponse<StartVeoResult>(
    response,
  );
}

export async function startVeoExtension(
  input: ExtendVeoInput,
): Promise<StartVeoResult> {
  const videoUri =
    input.videoUri.trim();

  const prompt =
    input.prompt.trim();

  if (!videoUri) {
    throw new Error(
      "Für die Videoverlängerung fehlt die Video-Adresse.",
    );
  }

  if (!prompt) {
    throw new Error(
      "Für die Videoverlängerung fehlt der Fortsetzungs-Prompt.",
    );
  }

  const response = await fetch(
    "/api/extend-video",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        videoUri,
        prompt,
        mimeType:
          input.mimeType ??
          "video/mp4",
      }),
    },
  );

  return readJsonResponse<StartVeoResult>(
    response,
  );
}

export async function getVeoStatus(
  operationName: string,
): Promise<VeoStatusResult> {
  if (!operationName.trim()) {
    throw new Error(
      "Für die Statusabfrage fehlt der Name des Veo-Auftrags.",
    );
  }

  const response = await fetch(
    "/api/veo-status",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        operationName,
      }),
    },
  );

  return readJsonResponse<VeoStatusResult>(
    response,
  );
}

export async function waitForVideo(
  operationName: string,
  options: WaitForVideoOptions = {},
): Promise<VeoStatusResult> {
  const {
    intervalMs = 5000,
    timeoutMs =
      15 * 60 * 1000,
    onStatusChange,
  } = options;

  const startedAt =
    Date.now();

  while (true) {
    if (
      Date.now() - startedAt >
      timeoutMs
    ) {
      throw new Error(
        "Die Videogenerierung hat das Zeitlimit überschritten.",
      );
    }

    const result =
      await getVeoStatus(
        operationName,
      );

    onStatusChange?.(result);

    if (!result.success) {
      throw new Error(
        result.error ??
          result.message ??
          "Die Veo-Statusabfrage ist fehlgeschlagen.",
      );
    }

    if (result.done) {
      if (
        result.status !==
          "completed" ||
        !result.videoUri
      ) {
        throw new Error(
          result.message ??
            result.error ??
            "Veo wurde beendet, aber es wurde kein Video zurückgegeben.",
        );
      }

      return result;
    }

    await new Promise<void>(
      (resolve) => {
        window.setTimeout(
          resolve,
          intervalMs,
        );
      },
    );
  }
}

export async function generateVeoVideo(
  input: StartVeoInput,
  options: WaitForVideoOptions = {},
): Promise<VeoStatusResult> {
  const startResult =
    await startVeoVideo(input);

  if (
    !startResult.success ||
    !startResult.operationName
  ) {
    throw new Error(
      startResult.error ??
        startResult.message ??
        "Der Veo-Auftrag konnte nicht gestartet werden.",
    );
  }

  return waitForVideo(
    startResult.operationName,
    options,
  );
}

export async function extendVeoVideo(
  input: ExtendVeoInput,
  options: WaitForVideoOptions = {},
): Promise<VeoStatusResult> {
  const startResult =
    await startVeoExtension(
      input,
    );

  if (
    !startResult.success ||
    !startResult.operationName
  ) {
    throw new Error(
      startResult.error ??
        startResult.message ??
        "Die Veo-Videoverlängerung konnte nicht gestartet werden.",
    );
  }

  return waitForVideo(
    startResult.operationName,
    options,
  );
}

/*
 * Erstellt ein langes, zusammenhängendes Video.
 *
 * Start:
 * 8 Sekunden
 *
 * Jede Extension:
 * +7 Sekunden
 *
 * Mit 8 Extensions:
 * 8 + (8 × 7) = ca. 64 Sekunden
 *
 * Für exakt 60 Sekunden können wir später
 * serverseitig die letzten ca. 4 Sekunden trimmen.
 */
export async function generateOneMinuteVideo(
  input: OneMinuteVideoInput,
  options: OneMinuteVideoOptions = {},
): Promise<VeoStatusResult> {
  const {
    continuationPrompts,
    ...startInput
  } = input;

  if (
    !Array.isArray(
      continuationPrompts,
    ) ||
    continuationPrompts.length === 0
  ) {
    throw new Error(
      "Für das 1-Minuten-Video fehlen die Fortsetzungs-Prompts.",
    );
  }

  /*
   * Für ungefähr eine Minute brauchen wir
   * maximal 8 Extensions:
   *
   * 8 + 8×7 = 64 Sekunden.
   */
  const extensionPrompts =
    continuationPrompts
      .map((prompt) =>
        prompt.trim(),
      )
      .filter(Boolean)
      .slice(0, 8);

  if (
    extensionPrompts.length === 0
  ) {
    throw new Error(
      "Es wurden keine gültigen Fortsetzungs-Prompts übergeben.",
    );
  }

  const totalSteps =
    1 +
    extensionPrompts.length;

  options.onProgress?.({
    step: 0,
    totalSteps,
    approximateDurationSeconds:
      0,
    status: "starting",
  });

  /*
   * Schritt 1:
   * Das erste 8-Sekunden-Video.
   */
  let currentResult =
    await generateVeoVideo(
      startInput,
      {
        intervalMs:
          options.intervalMs,
        timeoutMs:
          options.timeoutMs,
        onStatusChange:
          options.onStatusChange,
      },
    );

  options.onProgress?.({
    step: 1,
    totalSteps,
    approximateDurationSeconds:
      8,
    status: "generating",
    videoUri:
      currentResult.videoUri,
  });

  /*
   * Jeder folgende Auftrag verlängert
   * das bisherige Video.
   *
   * Wichtig:
   * Wir übergeben immer die Video-URI
   * des zuletzt verlängerten Videos.
   */
  for (
    let index = 0;
    index <
    extensionPrompts.length;
    index += 1
  ) {
    if (
      !currentResult.videoUri
    ) {
      throw new Error(
        "Das vorherige Veo-Video besitzt keine Video-Adresse und kann nicht verlängert werden.",
      );
    }

    const extensionNumber =
      index + 1;

    const continuationPrompt =
      extensionPrompts[index];

    options.onProgress?.({
      step:
        extensionNumber,
      totalSteps,
      approximateDurationSeconds:
        8 +
        index * 7,
      status:
        "extending",
      videoUri:
        currentResult.videoUri,
    });

    currentResult =
      await extendVeoVideo(
        {
          videoUri:
            currentResult.videoUri,
          mimeType:
            currentResult.mimeType ??
            "video/mp4",
          prompt:
            continuationPrompt,
        },
        {
          intervalMs:
            options.intervalMs,
          timeoutMs:
            options.timeoutMs,
          onStatusChange:
            options.onStatusChange,
        },
      );

    options.onProgress?.({
      step:
        extensionNumber + 1,
      totalSteps,
      approximateDurationSeconds:
        8 +
        extensionNumber * 7,
      status:
        extensionNumber ===
        extensionPrompts.length
          ? "completed"
          : "extending",
      videoUri:
        currentResult.videoUri,
    });
  }

  return currentResult;
}

export async function downloadVeoVideo(
  videoUri: string,
  filename =
    "veo-video.mp4",
): Promise<void> {
  if (!videoUri.trim()) {
    throw new Error(
      "Für den Download fehlt die Video-Adresse.",
    );
  }

  const response =
    await fetch(
      "/api/veo-download",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify({
            videoUri,
          }),
      },
    );

  if (!response.ok) {
    let message =
      `Download fehlgeschlagen: HTTP ${response.status}`;

    try {
      const data =
        (await response.json()) as {
          error?: string;
          message?: string;
        };

      message =
        data.error ??
        data.message ??
        message;
    } catch {
      // Die Fehlerantwort war kein JSON.
    }

    throw new Error(
      message,
    );
  }

  const videoBlob =
    await response.blob();

  if (
    videoBlob.size === 0
  ) {
    throw new Error(
      "Die heruntergeladene Videodatei ist leer.",
    );
  }

  const objectUrl =
    URL.createObjectURL(
      videoBlob,
    );

  const link =
    document.createElement(
      "a",
    );

  link.href =
    objectUrl;

  link.download =
    filename;

  document.body.appendChild(
    link,
  );

  link.click();

  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(
      objectUrl,
    );
  }, 1000);
}

export async function extractLastFrame(
  videoUri: string,
): Promise<Blob> {
  if (!videoUri.trim()) {
    throw new Error(
      "Für die Frame-Extraktion fehlt die Video-Adresse.",
    );
  }

  const response =
    await fetch(
      "/api/extract-last-frame",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify({
            videoUri,
          }),
      },
    );

  if (!response.ok) {
    let message =
      "Das letzte Bild konnte nicht extrahiert werden.";

    try {
      const data =
        (await response.json()) as {
          error?: string;
          message?: string;
        };

      message =
        data.error ??
        data.message ??
        message;
    } catch {
      // Die Fehlerantwort war kein JSON.
    }

    throw new Error(
      message,
    );
  }

  const frameBlob =
    await response.blob();

  if (
    frameBlob.size === 0
  ) {
    throw new Error(
      "Die extrahierte Bilddatei ist leer.",
    );
  }

  return frameBlob;
}