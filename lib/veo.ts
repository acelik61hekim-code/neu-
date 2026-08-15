import type {
  MovieContinuation,
  Story,
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoGenerationStrategy,
} from "@/types/story";
import {
  buildStudioAdvertisementDirection,
  isStudioWebsiteAdvertisement,
} from "@/lib/studio-brand";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

const VIDEO_MODEL =
  "veo-3.1-fast-generate-preview";

const TEXT_MODEL =
  "gemini-3.5-flash-lite";

const SUPPORTED_VIDEO_DURATIONS = [
  8,
  30,
  60,
  120,
  180,
  240,
  300,
] as const satisfies readonly VideoDurationSeconds[];

const SUPPORTED_ASPECT_RATIOS = [
  "9:16",
  "16:9",
] as const satisfies readonly VideoAspectRatio[];

if (!GEMINI_API_KEY) {
  console.warn(
    "GEMINI_API_KEY fehlt in den Umgebungsvariablen (.env.local)",
  );
}

type GoogleApiError = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type PredictLongRunningResponse =
  GoogleApiError & {
    name?: string;
    done?: boolean;
  };

const SAFELY_RETRYABLE_PROVIDER_START_STATUSES = new Set([
  429,
  503,
]);

export class VeoProviderStartError extends Error {
  readonly provider = "google-veo";
  readonly phase = "start";
  readonly httpStatus: number;
  readonly safeToRetry: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { httpStatus: number; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "VeoProviderStartError";
    this.httpStatus = options.httpStatus;
    this.safeToRetry = SAFELY_RETRYABLE_PROVIDER_START_STATUSES.has(options.httpStatus);
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function getRetryableVeoStartError(
  error: unknown,
): { message: string; httpStatus: number; retryAfterMs?: number } | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as Partial<VeoProviderStartError>;
  if (
    candidate.provider !== "google-veo" ||
    candidate.phase !== "start" ||
    candidate.safeToRetry !== true ||
    typeof candidate.httpStatus !== "number"
  ) {
    return null;
  }

  return {
    message: typeof candidate.message === "string" ? candidate.message : "Google Veo ist vorübergehend nicht verfügbar.",
    httpStatus: candidate.httpStatus,
    retryAfterMs: typeof candidate.retryAfterMs === "number" ? candidate.retryAfterMs : undefined,
  };
}

type GeminiFileResource =
  GoogleApiError & {
    name?: string;
    uri?: string;
    downloadUri?: string;
    mimeType?: string;
    state?: string;
    source?: string;
    expirationTime?: string;
  };

type VideoOperationResponse =
  GoogleApiError & {
    done?: boolean;

    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{
          video?: {
            uri?: string;
            mimeType?: string;
          };
        }>;
      };
    };
  };

export type VeoGenerationOptions = {
  aspectRatio?: VideoAspectRatio;

  referenceImage?: {
    data: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  };

  referenceImages?: Array<{
    data: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  }>;

  /*
   * Standard bleibt 4 Versuche, damit bestehende Aufrufe
   * unverändert funktionieren.
   *
   * Durable Workflow-Steps setzen später maxAttempts: 1,
   * damit ein kostenpflichtiger Provider-Start nicht
   * innerhalb derselben Step-Ausführung mehrfach
   * ausgelöst werden kann.
   */
  maxAttempts?: number;
};

export type VeoExtensionOptions = {
  aspectRatio?: VideoAspectRatio;
  extensionNumber?: number;

  /*
   * Gleiche Regel für Extensions:
   * normale/alte Aufrufe behalten 4 Versuche,
   * Workflow-Start-Steps können exakt 1 Versuch wählen.
   */
  maxAttempts?: number;
};

export type VeoVideoStatus = {
  done: boolean;
  videoUrl?: string;
  videoUri?: string;
  mimeType?: string;
};

export type WaitForVideoOptions = {
  intervalMs?: number;
  timeoutMs?: number;
};

export function buildOpeningVideoRequestBody(
  prompt: string,
  options: Pick<VeoGenerationOptions, "aspectRatio" | "referenceImage" | "referenceImages"> = {},
): Record<string, unknown> {
  const cleanedPrompt = prompt.trim();
  if (!cleanedPrompt) throw new Error("Für die Videogenerierung fehlt der Prompt.");

  const instance: Record<string, unknown> = { prompt: cleanedPrompt };
  if (options.referenceImage && options.referenceImages?.length) {
    throw new Error("Veo kann nicht gleichzeitig ein Startbild und Asset-Referenzbilder verwenden.");
  }
  if (options.referenceImage) {
    const { data, mimeType } = options.referenceImage;
    if (!data || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      throw new Error("Die Veo-Bildreferenz ist ungültig.");
    }

    // predictLongRunning erwartet Bildbytes direkt im Image-Objekt.
    // inlineData gehört zu anderen Gemini-Endpunkten und wird von diesem
    // Veo-Modell mit HTTP 400 abgelehnt.
    instance.image = {
      bytesBase64Encoded: data,
      mimeType,
    };
  }

  if (options.referenceImages?.length) {
    if (options.referenceImages.length > 3) {
      throw new Error("Veo erlaubt höchstens drei Asset-Referenzbilder.");
    }

    instance.referenceImages = options.referenceImages.map(({ data, mimeType }) => {
      if (!data || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        throw new Error("Eine Veo-Asset-Referenz ist ungültig.");
      }

      return {
        referenceType: "asset",
        image: {
          bytesBase64Encoded: data,
          mimeType,
        },
      };
    });
  }

  const requestBody: Record<string, unknown> = { instances: [instance] };
  if (options.aspectRatio !== undefined) {
    if (!isVideoAspectRatio(options.aspectRatio)) {
      throw new Error('Ungültiges Veo-Bildformat. Erlaubt sind "9:16" oder "16:9".');
    }
    requestBody.parameters = {
      aspectRatio: options.aspectRatio,
      durationSeconds: 8,
      resolution: "720p",
    };
  }
  return requestBody;
}

export type VideoDurationPlan = {
  targetDurationSeconds:
    VideoDurationSeconds;

  generationStrategy:
    VideoGenerationStrategy;

  extensionCount:
    number;

  generatedDurationSeconds:
    number;

  chapterTargets:
    VideoDurationSeconds[];
};

function getApiKey(): string {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
    );
  }

  return GEMINI_API_KEY;
}

function isVideoAspectRatio(
  value: unknown,
): value is VideoAspectRatio {
  return (
    typeof value === "string" &&
    SUPPORTED_ASPECT_RATIOS.includes(
      value as VideoAspectRatio,
    )
  );
}

function isVideoDurationSeconds(
  value: unknown,
): value is VideoDurationSeconds {
  return (
    typeof value === "number" &&
    SUPPORTED_VIDEO_DURATIONS.includes(
      value as VideoDurationSeconds,
    )
  );
}

function normalizeAspectRatio(
  value: unknown,
): VideoAspectRatio {
  return isVideoAspectRatio(value)
    ? value
    : "9:16";
}

async function sleep(
  milliseconds: number,
): Promise<void> {
  await new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

async function readJsonSafely<T>(
  response: Response,
): Promise<T | null> {
  try {
    return (
      await response.json()
    ) as T;
  } catch {
    return null;
  }
}

function getGoogleErrorMessage(
  payload: GoogleApiError | null,
  fallback: string,
): string {
  return (
    payload?.error?.message ||
    fallback
  );
}

function createRetryDelay(
  attempt: number,
): number {
  return (
    10000 * attempt
  );
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1000, Math.round(seconds * 1000));
  }

  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(1000, date - Date.now());
  }

  return undefined;
}

function generatedLengthForSingleChain(
  targetDurationSeconds:
    VideoDurationSeconds,
): {
  extensionCount: number;
  generatedDurationSeconds: number;
} {
  if (
    targetDurationSeconds === 8
  ) {
    return {
      extensionCount: 0,
      generatedDurationSeconds: 8,
    };
  }

  const extensionCount =
    Math.ceil(
      (
        targetDurationSeconds -
        8
      ) / 7,
    );

  return {
    extensionCount,

    generatedDurationSeconds:
      8 +
      extensionCount * 7,
  };
}

/*
 * =========================================================
 * VIDEO-DURATION PLAN
 * =========================================================
 *
 * 8 s:
 *   ein einzelner Veo-Auftrag
 *
 * 30�?"120 s:
 *   Opening 8 s + direkte 7-s-Extensions
 *
 * 180�?"300 s:
 *   mehrere Kapitel mit maximal 120 s Zielzeit.
 *
 * Das ist dieselbe Zeitarchitektur wie im Story Architect.
 */
export function buildVideoDurationPlan(
  targetDurationSeconds:
    VideoDurationSeconds,
): VideoDurationPlan {
  if (
    !isVideoDurationSeconds(
      targetDurationSeconds,
    )
  ) {
    throw new Error(
      "Ungültige Videolänge. Erlaubt sind 8, 30, 60, 120, 180, 240 oder 300 Sekunden.",
    );
  }

  if (
    targetDurationSeconds <=
    120
  ) {
    const chain =
      generatedLengthForSingleChain(
        targetDurationSeconds,
      );

    return {
      targetDurationSeconds,

      generationStrategy:
        targetDurationSeconds ===
        8
          ? "single-shot"
          : "extension-chain",

      extensionCount:
        chain.extensionCount,

      generatedDurationSeconds:
        chain.generatedDurationSeconds,

      chapterTargets: [
        targetDurationSeconds,
      ],
    };
  }

  const chapterTargets:
    VideoDurationSeconds[] = [];

  let remaining =
    targetDurationSeconds;

  while (
    remaining > 120
  ) {
    chapterTargets.push(
      120,
    );

    remaining -=
      120;
  }

  if (
    remaining > 0
  ) {
    if (
      !isVideoDurationSeconds(
        remaining,
      )
    ) {
      throw new Error(
        `Ungültige Restkapitellänge: ${remaining} Sekunden.`,
      );
    }

    chapterTargets.push(
      remaining,
    );
  }

  const generatedDurationSeconds =
    chapterTargets.reduce(
      (
        sum,
        chapterTarget,
      ) =>
        sum +
        generatedLengthForSingleChain(
          chapterTarget,
        )
          .generatedDurationSeconds,
      0,
    );

  return {
    targetDurationSeconds,

    generationStrategy:
      "chaptered",

    extensionCount:
      0,

    generatedDurationSeconds,

    chapterTargets,
  };
}

function normalizeProviderStartAttempts(
  value: number | undefined,
): number {
  if (value === undefined) {
    return 4;
  }

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 4
  ) {
    throw new Error(
      "maxAttempts muss eine ganze Zahl zwischen 1 und 4 sein.",
    );
  }

  return value;
}

/*
 * =========================================================
 * OPENING / STANDARD VIDEO
 * =========================================================
 *
 * Rückwärtskompatibel:
 *
 * startVideoGeneration(prompt)
 *
 * funktioniert weiterhin mit exakt derselben alten
 * Request-Struktur.
 *
 * Nur wenn aspectRatio explizit übergeben wird,
 * ergänzen wir parameters.aspectRatio.
 */
export async function startVideoGeneration(
  prompt: string,
  options:
    VeoGenerationOptions = {},
): Promise<string> {
  const cleanedPrompt =
    prompt.trim();

  if (!cleanedPrompt) {
    throw new Error(
      "Für die Videogenerierung fehlt der Prompt.",
    );
  }

  const apiKey =
    getApiKey();

  const maxAttempts =
    normalizeProviderStartAttempts(
      options.maxAttempts,
    );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const requestBody = buildOpeningVideoRequestBody(cleanedPrompt, options);

    const response =
      await fetch(
        `${BASE_URL}/models/${VIDEO_MODEL}:predictLongRunning`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey,
          },

          body:
            JSON.stringify(
              requestBody,
            ),

          cache:
            "no-store",
        },
      );

    const data =
      await readJsonSafely<
        PredictLongRunningResponse
      >(response);

    if (
      response.ok
    ) {
      if (
        !data?.name
      ) {
        throw new Error(
          "Veo hat keinen Operation-Namen zurückgegeben.",
        );
      }

      return data.name;
    }

    if (
      response.status ===
        429 &&
      attempt <
        maxAttempts
    ) {
      await sleep(
        createRetryDelay(
          attempt,
        ),
      );

      continue;
    }

    throw new VeoProviderStartError(
      getGoogleErrorMessage(
        data,
        `Veo-Anfrage fehlgeschlagen. HTTP ${response.status}.`,
      ),
      {
        httpStatus: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      },
    );
  }

  throw new Error(
    "Veo-Anfrage fehlgeschlagen: Kontingent wiederholt überschritten.",
  );
}

/*
 * =========================================================
 * VIDEO STATUS
 * =========================================================
 */
export async function checkVideoStatus(
  operationName: string,
): Promise<VeoVideoStatus> {
  const cleanedOperationName =
    operationName.trim();

  if (
    !cleanedOperationName
  ) {
    throw new Error(
      "Für die Statusabfrage fehlt der Operation-Name.",
    );
  }

  const apiKey =
    getApiKey();

  const response =
    await fetch(
      `${BASE_URL}/${cleanedOperationName}`,
      {
        headers: {
          "x-goog-api-key":
            apiKey,
        },

        cache:
          "no-store",
      },
    );

  const data =
    await readJsonSafely<
      VideoOperationResponse
    >(response);

  if (
    !response.ok
  ) {
    throw new Error(
      getGoogleErrorMessage(
        data,
        `Statusabfrage fehlgeschlagen. HTTP ${response.status}.`,
      ),
    );
  }

  if (
    !data?.done
  ) {
    return {
      done: false,
    };
  }

  if (
    data.error?.message
  ) {
    throw new Error(
      data.error.message,
    );
  }

  const video =
    data.response
      ?.generateVideoResponse
      ?.generatedSamples
      ?.[0]
      ?.video;

  const videoUri =
    video?.uri;

  if (
    !videoUri
  ) {
    throw new Error(
      "Video fertig gemeldet, aber keine Video-URL erhalten.",
    );
  }

  /*
   * Bestehende Consumer erwarten videoUrl inklusive key.
   * Für die neue Extension-Pipeline geben wir zusätzlich
   * die originale URI ohne angehängten Key zurück.
   */
  const videoUrl =
    `${videoUri}${
      videoUri.includes("?")
        ? "&"
        : "?"
    }key=${encodeURIComponent(
      apiKey,
    )}`;

  return {
    done: true,
    videoUrl,
    videoUri,
    mimeType:
      video?.mimeType ??
      "video/mp4",
  };
}

export async function waitForVideoCompletion(
  operationName: string,
  options:
    WaitForVideoOptions = {},
): Promise<
  Required<
    Pick<
      VeoVideoStatus,
      "done" | "videoUrl" | "videoUri"
    >
  > &
    Pick<
      VeoVideoStatus,
      "mimeType"
    >
> {
  const {
    intervalMs =
      10000,

    timeoutMs =
      12 * 60 * 1000,
  } = options;

  const startedAt =
    Date.now();

  while (true) {
    if (
      Date.now() -
        startedAt >
      timeoutMs
    ) {
      throw new Error(
        "Zeitüberschreitung bei der Videoerstellung.",
      );
    }

    await sleep(
      intervalMs,
    );

    const status =
      await checkVideoStatus(
        operationName,
      );

    if (
      status.done &&
      status.videoUrl &&
      status.videoUri
    ) {
      return {
        done: true,
        videoUrl:
          status.videoUrl,
        videoUri:
          status.videoUri,
        mimeType:
          status.mimeType,
      };
    }
  }
}

/*
 * =========================================================
 * VEO GENERATED FILE RESOLUTION
 * =========================================================
 *
 * Für Extensions darf NICHT die Browser-Download-URL
 * als Videoquelle an Veo geschickt werden.
 *
 * Wir lesen zuerst die Gemini Files Resource und verwenden
 * anschlie�Yend ausschlie�Ylich file.uri.
 */
function extractGeminiFileNameFromUri(
  videoUri: string,
): string {
  const match =
    videoUri.match(
      /\/files\/([a-z0-9-]+)/i,
    );

  if (!match?.[1]) {
    throw new Error(
      "Aus der Veo-Video-Adresse konnte keine Gemini-Datei-ID gelesen werden.",
    );
  }

  return `files/${match[1]}`;
}

async function getGeminiFileResource(
  fileName: string,
  apiKey: string,
): Promise<GeminiFileResource> {
  const response =
    await fetch(
      `${BASE_URL}/${fileName}`,
      {
        method:
          "GET",

        headers: {
          "x-goog-api-key":
            apiKey,
        },

        cache:
          "no-store",
      },
    );

  const body =
    await readJsonSafely<
      GeminiFileResource
    >(response);

  if (
    !response.ok
  ) {
    throw new Error(
      getGoogleErrorMessage(
        body,
        `Die Gemini-Datei konnte nicht gelesen werden. HTTP ${response.status}.`,
      ),
    );
  }

  if (!body) {
    throw new Error(
      "Google hat keine gültigen Metadaten für das Veo-Video zurückgegeben.",
    );
  }

  return body;
}

async function resolveProcessedGeneratedVideoUri(
  videoUri: string,
): Promise<{
  processedUri: string;
  mimeType: string;
}> {
  const apiKey =
    getApiKey();

  const fileName =
    extractGeminiFileNameFromUri(
      videoUri,
    );

  const maxAttempts =
    12;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const file =
      await getGeminiFileResource(
        fileName,
        apiKey,
      );

    const state =
      file.state ??
      "STATE_UNSPECIFIED";

    const source =
      file.source ??
      "SOURCE_UNSPECIFIED";

    if (
      source !==
      "GENERATED"
    ) {
      throw new Error(
        `Das Eingangsvideo ist keine von Google generierte Veo-Datei. source=${source}`,
      );
    }

    if (
      state ===
      "ACTIVE"
    ) {
      if (
        !file.uri?.trim()
      ) {
        throw new Error(
          "Die verarbeitete Veo-Datei besitzt keine file.uri.",
        );
      }

      return {
        processedUri:
          file.uri.trim(),

        mimeType:
          file.mimeType ??
          "video/mp4",
      };
    }

    if (
      state ===
      "FAILED"
    ) {
      throw new Error(
        file.error?.message ??
          "Die Verarbeitung der Veo-Datei ist fehlgeschlagen.",
      );
    }

    if (
      attempt <
      maxAttempts
    ) {
      await sleep(
        2500,
      );
    }
  }

  throw new Error(
    "Die Veo-Datei ist nach 30 Sekunden noch nicht ACTIVE/verarbeitet.",
  );
}

/*
 * =========================================================
 * VEO EXTENSION
 * =========================================================
 *
 * Diese Request-Form folgt bewusst der bereits
 * funktionierenden Extension-Pipeline:
 *
 * instances: [{
 *   prompt,
 *   video: { uri: file.uri }
 * }]
 *
 * parameters: {
 *   aspectRatio
 * }
 *
 * KEIN inlineData
 * KEINE videoBytes
 * KEIN numberOfVideos
 * Explizit: 8 Sekunden und 720p; das Modell liefert genau ein Video
 */
export async function startVideoExtension(
  videoUri: string,
  prompt: string,
  options:
    VeoExtensionOptions = {},
): Promise<string> {
  const cleanedVideoUri =
    videoUri.trim();

  const cleanedPrompt =
    prompt.trim();

  if (
    !cleanedVideoUri
  ) {
    throw new Error(
      "Für die Videoverlängerung fehlt die Video-URI.",
    );
  }

  if (
    !cleanedPrompt
  ) {
    throw new Error(
      "Für die Videoverlängerung fehlt der Fortsetzungs-Prompt.",
    );
  }

  const aspectRatio =
    normalizeAspectRatio(
      options.aspectRatio,
    );

  const processedVideo =
    await resolveProcessedGeneratedVideoUri(
      cleanedVideoUri,
    );

  const apiKey =
    getApiKey();

  const maxAttempts =
    normalizeProviderStartAttempts(
      options.maxAttempts,
    );

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const response =
      await fetch(
        `${BASE_URL}/models/${VIDEO_MODEL}:predictLongRunning`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey,
          },

          body:
            JSON.stringify({
              instances: [
                {
                  prompt:
                    cleanedPrompt,

                  video: {
                    uri:
                      processedVideo
                        .processedUri,
                  },
                },
              ],

              parameters: {
                aspectRatio,
                durationSeconds: 8,
                resolution: "720p",
              },
            }),

          cache:
            "no-store",
        },
      );

    const data =
      await readJsonSafely<
        PredictLongRunningResponse
      >(response);

    if (
      response.ok
    ) {
      if (
        !data?.name
      ) {
        throw new Error(
          "Veo hat keinen Operation-Namen für die Videoverlängerung zurückgegeben.",
        );
      }

      return data.name;
    }

    if (
      response.status ===
        429 &&
      attempt <
        maxAttempts
    ) {
      await sleep(
        createRetryDelay(
          attempt,
        ),
      );

      continue;
    }

    throw new VeoProviderStartError(
      getGoogleErrorMessage(
        data,
        `Google Veo Extension fehlgeschlagen. HTTP ${response.status}.`,
      ),
      {
        httpStatus: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      },
    );
  }

  throw new Error(
    "Veo-Videoverlängerung fehlgeschlagen: Kontingent wiederholt überschritten.",
  );
}

/*
 * =========================================================
 * MOVIE CONTINUATION PROMPT
 * =========================================================
 *
 * Baut serverseitig denselben Continuity-Kontext auf,
 * den wir vorher temporär im Client hatten.
 *
 * editingStyle und aspectRatio stehen bereits im MoviePlan
 * und flie�Yen damit zusätzlich in jede Fortsetzung ein.
 */
function createDialogueInstruction(
  continuation:
    MovieContinuation,
): string {
  const dialogue =
    continuation.dialogue;

  if (
    !dialogue.enabled
  ) {
    return [
      "DIALOGUE:",
      "No spoken dialogue.",
      "No narration.",
      "No voice-over.",
    ].join("\n");
  }

  return [
    "DIALOGUE:",
    `Speaker: ${dialogue.speaker}`,
    `Language: ${dialogue.language}`,
    `Exact spoken words: "${dialogue.text}"`,
    `Voice direction: ${dialogue.voiceDirection}`,
    "The visible speaker says exactly these words once.",
    "Use natural pronunciation and synchronized lip movement.",
    "Do not translate, paraphrase, repeat or add spoken words.",
    "Do not show subtitles or captions.",
  ].join("\n");
}

function editingStyleInstruction(
  editingStyle:
    VideoEditingStyle | undefined,
): string {
  switch (
    editingStyle
  ) {
    case "cinematic":
      return [
        "CINEMATIC EDITING LANGUAGE:",
        "Use motivated film coverage and preserve spatial geography.",
        "Respect eyelines, screen direction and the 180-degree rule.",
        "Cuts and camera changes must be motivated by action, look or emotion.",
        "Do not force TikTok-style pacing or arbitrary jump cuts.",
      ].join("\n");

    case "music-video":
      return [
        "MUSIC VIDEO LANGUAGE:",
        "Preserve the established music-video visual identity.",
        "Use rhythm-, section- and emotion-aware visual progression.",
        "Do not cut mechanically on every beat.",
      ].join("\n");

    case "social":
      return [
        "SOCIAL VIDEO LANGUAGE:",
        "Keep visual progression fast and immediately readable.",
        "Preserve continuity despite the more energetic pacing.",
      ].join("\n");

    default:
      return [
        "EDITING LANGUAGE:",
        "Preserve the visual and editing language established by the movie plan.",
      ].join("\n");
  }
}

export function removeVisibleTextRenderingInstructions(value: string): string {
  const visibleTextRequest = /\b(?:on[- ]screen|onscreen|screens?|text|letters?|words?|typography|caption|subtitle|title card|logo|watermark|url|website|domain|code)\b/i;
  return value
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !visibleTextRequest.test(part))
    .join(" ")
    .trim();
}

export function buildMovieContinuationPrompt(
  story: Story,
  continuation:
    MovieContinuation,
): string {
  const plan =
    story.moviePlan;

  if (!plan) {
    return continuation
      .continuationPrompt;
  }

  const studioAdvertisement =
    isStudioWebsiteAdvertisement(
      [
        story.title,
        story.genre,
        story.mood,
        story.setting,
        story.summary,
      ].join("\n"),
    );

  const preserveRequiredVisualInstructions =
    (value: string) =>
      studioAdvertisement
        ? value.trim()
        : removeVisibleTextRenderingInstructions(value);

  const characterIdentity =
    story.productionBible
      .characterBible
      .map(
        (character) =>
          [
            `${character.name}:`,
            `appearance=${character.fixedAppearance}`,
            `face=${character.faceIdentity}`,
            `hair=${character.hair}`,
            `eyes=${character.eyes}`,
            `body=${character.bodyType}`,
            `clothing=${character.clothing}`,
            `accessories=${character.accessories}`,
            `movement=${character.movementStyle}`,
            `voice=${character.voiceIdentity}`,
          ].join(" "),
      )
      .join("\n");

  const protectedOutputSecond = Math.min(
    plan.generatedDurationSeconds,
    plan.targetDurationSeconds + 2,
  );

  const visibleSeconds = Math.max(
    0,
    Math.min(
      continuation.durationSeconds,
      protectedOutputSecond - continuation.startSecond,
    ),
  );

  const finalTrimInstruction =
    visibleSeconds < continuation.durationSeconds
      ? [
          "PROTECTED ENDING WINDOW (highest priority):",
          `The booked duration is approximately ${plan.targetDurationSeconds} seconds. The finishing pipeline may preserve footage through second ${protectedOutputSecond} so speech, gestures and movement can end naturally.`,
          `Deliver the final story payoff and reach a visually stable resting frame within the first ${visibleSeconds} second${visibleSeconds === 1 ? "" : "s"} of this extension.`,
          "Do not begin a new sentence, gesture, camera move or important action near the protected ending boundary.",
        ].join("\n")
      : "";

  const socialBoundaryDirection = plan.editingStyle === "social"
    ? [
        "SOCIAL TRANSITION RULE:",
        "Match the source video's final frame for the first half-second, then advance to a clearly different, story-relevant visual beat with one motivated match cut, whip transition or object-led transition.",
        "Do not repeat the previous composition for the whole extension. Add visibly new information while preserving the established color palette and production identity.",
      ].join("\n")
    : [
        "BOUNDARY MATCH (highest priority): The first frames must match the source video's final frames exactly: subject position, scale, silhouette, pose, fold geometry, material, camera position, lens, background geometry, lighting and motion vector.",
        "Continue the existing motion without a cut, jump, wipe, reframe, zoom reset, speed reset or time skip.",
      ].join("\n");

  return [
    preserveRequiredVisualInstructions(
      continuation.continuationPrompt,
    ),
    "",
    "THIS IS A DIRECT EXTENSION OF THE EXISTING VIDEO.",
    "Do not restart, reintroduce or redesign the scene.",
    socialBoundaryDirection,
    "For non-human subjects and objects, preserve the exact dimensions, silhouette, construction, folds, color and material. Never morph, enlarge, redesign or add parts.",
    "",
    `ASPECT RATIO: ${plan.aspectRatio}`,
    editingStyleInstruction(
      plan.editingStyle,
    ),
    "",
    `STORY BEAT: ${preserveRequiredVisualInstructions(continuation.storyBeat)}`,
    `EMOTIONAL BEAT: ${preserveRequiredVisualInstructions(continuation.emotionalBeat)}`,
    `ESCALATION PURPOSE: ${preserveRequiredVisualInstructions(continuation.escalationPurpose)}`,
    `ACTION CONTINUATION: ${preserveRequiredVisualInstructions(continuation.actionContinuation)}`,
    "",
    "CHARACTER CONTINUITY:",
    continuation
      .characterContinuity,
    characterIdentity,
    "",
    "ENVIRONMENT CONTINUITY:",
    continuation
      .environmentContinuity,
    "Preserve physically plausible geography and architecture. Keep landmarks, streets, waterways and buildings in their real spatial relationship; never relocate a landmark into water or invent impossible terrain.",
    "",
    "CAMERA CONTINUITY:",
    continuation
      .cameraContinuation,
    plan.cameraContinuityRules,
    "",
    "LIGHTING CONTINUITY:",
    continuation
      .lightingContinuation,
    plan.lightingContinuityRules,
    "",
    "PERFORMANCE:",
    continuation
      .performanceContinuation,
    "",
    "AUDIO CONTINUITY:",
    continuation
      .audioContinuation,
    continuation
      .audioPrompt ??
      "",
    plan.audioContinuityRules,
    "",
    createDialogueInstruction(
      continuation,
    ),
    "",
    "GLOBAL CONTINUITY:",
    plan.characterContinuityRules,
    plan.visualContinuityRules,
    plan.storyContinuityRules,
    "",
    finalTrimInstruction,
    "",
    "NEGATIVE REQUIREMENTS:",
    continuation
      .negativePrompt ??
      "",
    studioAdvertisement
      ? [
          "BRANDED PRODUCT-SCREEN EXCEPTION (highest priority):",
          buildStudioAdvertisementDirection(),
          "Preserve the authentic website already visible in the source video. Do not blur, remove, redesign or replace it during the extension.",
          "No identity drift, no face changes, no wardrobe changes, no duplicated characters, no teleportation, no unmotivated camera reset, no lighting reset, no subtitles, no captions, no watermarks, no invented UI text, no fake websites and no unrelated logos.",
        ].join("\n")
      : "No identity drift, no face changes, no wardrobe changes, no duplicated characters, no teleportation, no unmotivated camera reset, no lighting reset, no subtitles, no captions, no logos, no watermarks, no readable letters, no words, no numbers, no URLs, no code and no visible interface text. All screens use abstract unlettered light patterns only.",
  ]
    .filter(Boolean)
    .join("\n");
}

/*
 * =========================================================
 * LEGACY SCENE SPLITTER
 * =========================================================
 *
 * Nur für Rückwärtskompatibilität.
 *
 * Die neue MoviePlan-Pipeline soll für 30�?"120 s
 * Extensions und für 3�?"5 Minuten Chapters verwenden.
 */
export async function splitIntoScenes(
  prompt: string,
  sceneCount: number,
): Promise<string[]> {
  const cleanedPrompt =
    prompt.trim();

  if (
    !cleanedPrompt
  ) {
    throw new Error(
      "Für die Szenen-Aufteilung fehlt der Prompt.",
    );
  }

  if (
    !Number.isInteger(
      sceneCount,
    ) ||
    sceneCount < 1
  ) {
    throw new Error(
      "sceneCount muss eine positive ganze Zahl sein.",
    );
  }

  const apiKey =
    getApiKey();

  const response =
    await fetch(
      `${BASE_URL}/models/${TEXT_MODEL}:generateContent`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            apiKey,
        },

        body:
          JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text:
                      `Teile diese Videoidee in genau ${sceneCount} aufeinanderfolgende, kurze Videoclip-Beschreibungen auf (je ca. 8 Sekunden). Idee: "${cleanedPrompt}". Gib NUR ein JSON-Array mit genau ${sceneCount} Strings zurück, jeder String ist eine bildhafte, eigenständige Beschreibung (Stil, Bewegung, Kameraführung) für einen KI-Videogenerator, die zusammen eine zusammenhängende Geschichte erzählen. Kein Text au�Yerhalb des JSON-Arrays.`,
                  },
                ],
              },
            ],

            generationConfig: {
              responseMimeType:
                "application/json",
            },
          }),

        cache:
          "no-store",
      },
    );

  const data =
    await readJsonSafely<{
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;

      error?: {
        message?: string;
      };
    }>(response);

  if (
    !response.ok
  ) {
    throw new Error(
      data?.error?.message ||
        `Szenen-Aufteilung fehlgeschlagen. HTTP ${response.status}.`,
    );
  }

  const text =
    data?.candidates
      ?.[0]
      ?.content
      ?.parts
      ?.[0]
      ?.text;

  if (!text) {
    throw new Error(
      "Keine Szenen von der KI erhalten.",
    );
  }

  let scenes:
    unknown;

  try {
    scenes =
      JSON.parse(
        text,
      );
  } catch {
    throw new Error(
      "Die KI hat kein gültiges JSON für die Szenen-Aufteilung geliefert.",
    );
  }

  if (
    !Array.isArray(
      scenes,
    ) ||
    scenes.length === 0 ||
    !scenes.every(
      (scene) =>
        typeof scene ===
        "string",
    )
  ) {
    throw new Error(
      "Unerwartetes Format der Szenen-Antwort.",
    );
  }

  return scenes
    .slice(
      0,
      sceneCount,
    )
    .map(
      (scene) =>
        scene.trim(),
    );
}
