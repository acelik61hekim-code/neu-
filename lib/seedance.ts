import { fal } from "@fal-ai/client";

import type { VideoAspectRatio } from "@/types/story";

const TEXT_TO_VIDEO_MODEL =
  "bytedance/seedance-2.0/fast/text-to-video";

const IMAGE_TO_VIDEO_MODEL =
  "bytedance/seedance-2.0/fast/image-to-video";

const REFERENCE_TO_VIDEO_MODEL =
  "bytedance/seedance-2.0/fast/reference-to-video";

const OPERATION_PREFIX = "fal-seedance";

/*
 * Neue Standardlänge:
 *
 * Seedance erzeugt für unsere neue Pipeline immer
 * 15-Sekunden-Blöcke.
 *
 * 15 s  -> 1 Clip
 * 30 s  -> 2 Clips
 * 60 s  -> 4 Clips
 * 120 s -> 8 Clips
 */
export const SEEDANCE_DEFAULT_CLIP_DURATION_SECONDS = 15;

type SeedanceImageReference = {
  data: string;
  mimeType:
    | "image/jpeg"
    | "image/png"
    | "image/webp";
};

export type SeedanceGenerationOptions = {
  aspectRatio?: VideoAspectRatio;
  referenceImage?: SeedanceImageReference;
  referenceImages?: SeedanceImageReference[];
  maxAttempts?: number;

  /*
   * Standard ist 15 Sekunden.
   *
   * Das optionale Feld bleibt vorhanden,
   * damit ältere Jobs bei Bedarf auch mit ihrer
   * ursprünglichen Dauer wiederhergestellt werden können.
   */
  durationSeconds?: number;

  /**
   * Wird von fal.ai aufgerufen, sobald die Generierung
   * abgeschlossen oder fehlgeschlagen ist.
   */
  webhookUrl?: string;
};

export type SeedanceExtensionOptions = {
  aspectRatio?: VideoAspectRatio;
  extensionNumber?: number;
  maxAttempts?: number;

  /*
   * Standard ist ebenfalls 15 Sekunden.
   */
  durationSeconds?: number;

  /**
   * Wird von fal.ai aufgerufen, sobald die Fortsetzung
   * abgeschlossen oder fehlgeschlagen ist.
   */
  webhookUrl?: string;
};

export type SeedanceVideoStatus = {
  done: boolean;
  videoUrl?: string;
  videoUri?: string;
  mimeType?: string;
};

export type SeedanceOperationDetails = {
  modelId: string;
  requestId: string;
};

export type SeedanceWebhookPayload = {
  request_id?: string;
  gateway_request_id?: string;
  status?: string;

  payload?: {
    video?: {
      url?: string;
      content_type?: string;
      file_name?: string;
      file_size?: number;
    };

    [key: string]: unknown;
  };

  error?: unknown;
};

export class SeedanceProviderStartError extends Error {
  readonly provider = "fal-seedance";
  readonly phase = "start";

  readonly httpStatus: number;
  readonly safeToRetry: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      httpStatus: number;
      retryAfterMs?: number;
    },
  ) {
    super(message);

    this.name = "SeedanceProviderStartError";
    this.httpStatus = options.httpStatus;

    this.safeToRetry = [
      0,
      429,
      500,
      502,
      503,
      504,
    ].includes(options.httpStatus);

    this.retryAfterMs =
      options.retryAfterMs;
  }
}

export class SeedanceProviderOperationError extends Error {
  readonly provider = "fal-seedance";
  readonly phase = "operation";
  readonly safeToRestart: boolean;

  constructor(message: string) {
    super(message);

    this.name =
      "SeedanceProviderOperationError";

    this.safeToRestart =
      /internal|infrastructure|runner|temporar|timeout|unavailable|overload|429|500|502|503|504/i.test(
        message,
      );
  }
}

export function getRetryableSeedanceStartError(
  error: unknown,
): {
  message: string;
  httpStatus: number;
  retryAfterMs?: number;
} | null {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return null;
  }

  const candidate =
    error as Partial<SeedanceProviderStartError>;

  if (
    candidate.provider !== "fal-seedance" ||
    candidate.phase !== "start" ||
    candidate.safeToRetry !== true ||
    typeof candidate.httpStatus !== "number"
  ) {
    return null;
  }

  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : "Seedance ist vorübergehend nicht verfügbar.",

    httpStatus: candidate.httpStatus,

    retryAfterMs:
      typeof candidate.retryAfterMs === "number"
        ? candidate.retryAfterMs
        : undefined,
  };
}

export function getRestartableSeedanceOperationError(
  error: unknown,
): {
  message: string;
} | null {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return null;
  }

  const candidate =
    error as Partial<SeedanceProviderOperationError>;

  if (
    candidate.provider !== "fal-seedance" ||
    candidate.phase !== "operation" ||
    candidate.safeToRestart !== true
  ) {
    return null;
  }

  return {
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : "Seedance konnte die Generierung nicht abschließen.",
  };
}

function configureFal(): void {
  const key = process.env.FAL_KEY;

  if (!key) {
    throw new Error(
      "FAL_KEY fehlt in den Umgebungsvariablen.",
    );
  }

  fal.config({
    credentials: key,
  });
}

function toDataUri(
  reference: SeedanceImageReference,
): string {
  return `data:${reference.mimeType};base64,${reference.data}`;
}

function readErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unbekannter Seedance-Fehler.";
}

function readHttpStatus(
  error: unknown,
): number {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return 0;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;

    response?: {
      status?: unknown;
    };
  };

  if (
    typeof candidate.status === "number"
  ) {
    return candidate.status;
  }

  if (
    typeof candidate.statusCode === "number"
  ) {
    return candidate.statusCode;
  }

  if (
    typeof candidate.response?.status === "number"
  ) {
    return candidate.response.status;
  }

  return 0;
}

/*
 * Seedance 2.0 Fast unterstützt Clip-Längen
 * bis maximal 15 Sekunden.
 *
 * Wir erlauben intern weiterhin kürzere Werte,
 * damit bestehende Legacy-Aufträge bei Bedarf
 * wiederhergestellt werden können.
 */
function normalizeDurationSeconds(
  value: number | undefined,
): number {
  const duration =
    value ??
    SEEDANCE_DEFAULT_CLIP_DURATION_SECONDS;

  if (
    !Number.isInteger(duration) ||
    duration < 4 ||
    duration > 15
  ) {
    throw new Error(
      "Ungültige Seedance-Cliplänge. Erlaubt sind 4 bis 15 Sekunden.",
    );
  }

  return duration;
}

function normalizeWebhookUrl(
  value: string | undefined,
): string | undefined {
  const webhookUrl = value?.trim();

  if (!webhookUrl) {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error(
      "Die Seedance-Webhook-URL ist ungültig.",
    );
  }

  if (
    parsed.protocol !== "https:" &&
    parsed.protocol !== "http:"
  ) {
    throw new Error(
      "Die Seedance-Webhook-URL muss HTTP oder HTTPS verwenden.",
    );
  }

  return webhookUrl;
}

function encodeOperation(
  modelId: string,
  requestId: string,
): string {
  return [
    OPERATION_PREFIX,
    modelId,
    requestId,
  ].join("|");
}

function decodeOperation(
  operationName: string,
): SeedanceOperationDetails {
  const parts =
    operationName.split("|");

  if (
    parts.length !== 3 ||
    parts[0] !== OPERATION_PREFIX ||
    !parts[1] ||
    !parts[2]
  ) {
    throw new Error(
      "Ungültige Seedance-Operation.",
    );
  }

  return {
    modelId: parts[1],
    requestId: parts[2],
  };
}

export function getSeedanceOperationDetails(
  operationName: string,
): SeedanceOperationDetails {
  return decodeOperation(operationName);
}

export function isSeedanceOperationName(
  operationName: string,
): boolean {
  return operationName.startsWith(
    `${OPERATION_PREFIX}|`,
  );
}

async function submitSeedance(
  modelId: string,
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<string> {
  configureFal();

  const normalizedWebhookUrl =
    normalizeWebhookUrl(webhookUrl);

  try {
    const result =
      await fal.queue.submit(
        modelId as any,
        {
          input,

          ...(normalizedWebhookUrl
            ? {
                webhookUrl:
                  normalizedWebhookUrl,
              }
            : {}),
        } as any,
      );

    const requestId =
      (
        result as {
          request_id?: string;
        }
      ).request_id;

    if (!requestId) {
      throw new Error(
        "fal.ai hat keine Request-ID zurückgegeben.",
      );
    }

    return encodeOperation(
      modelId,
      requestId,
    );
  } catch (error) {
    if (
      error instanceof
      SeedanceProviderStartError
    ) {
      throw error;
    }

    throw new SeedanceProviderStartError(
      readErrorMessage(error),
      {
        httpStatus:
          readHttpStatus(error),
      },
    );
  }
}

export async function startVideoGeneration(
  prompt: string,
  options: SeedanceGenerationOptions = {},
): Promise<string> {
  const cleanedPrompt =
    prompt.trim();

  if (!cleanedPrompt) {
    throw new Error(
      "Für die Videogenerierung fehlt der Prompt.",
    );
  }

  const aspectRatio =
    options.aspectRatio ?? "9:16";

  const durationSeconds =
    normalizeDurationSeconds(
      options.durationSeconds,
    );

  const commonInput = {
    resolution: "720p",

    /*
     * Neue Pipeline:
     * standardmäßig 15 Sekunden pro Provider-Job.
     */
    duration:
      String(durationSeconds),

    aspect_ratio: aspectRatio,
    generate_audio: true,
    /*
     * Fast bleibt wirtschaftlich bei 720p, aber der High-Bitrate-
     * Encode bewahrt Gesichter, Fruchttexturen und schnelle
     * Reaktionsschnitte deutlich sauberer.
     */
    bitrate_mode: "high",
  };

  if (options.referenceImage) {
    return submitSeedance(
      IMAGE_TO_VIDEO_MODEL,
      {
        ...commonInput,
        prompt: cleanedPrompt,

        image_url: toDataUri(
          options.referenceImage,
        ),
      },
      options.webhookUrl,
    );
  }

  if (
    options.referenceImages &&
    options.referenceImages.length > 0
  ) {
    if (
      options.referenceImages.length > 9
    ) {
      throw new Error(
        "Seedance unterstützt maximal neun Bildreferenzen.",
      );
    }

    const identityInstructions =
      options.referenceImages
        .map(
          (_, index) =>
            `@Image${index + 1} is a locked identity reference. Preserve this character's exact visual identity throughout the shot.`,
        )
        .join("\n");

    return submitSeedance(
      REFERENCE_TO_VIDEO_MODEL,
      {
        ...commonInput,

        prompt: [
          identityInstructions,
          "",
          cleanedPrompt,
        ].join("\n"),

        image_urls:
          options.referenceImages.map(
            toDataUri,
          ),
      },
      options.webhookUrl,
    );
  }

  return submitSeedance(
    TEXT_TO_VIDEO_MODEL,
    {
      ...commonInput,
      prompt: cleanedPrompt,
    },
    options.webhookUrl,
  );
}

export async function startVideoExtension(
  previousVideoUri: string,
  prompt: string,
  options: SeedanceExtensionOptions = {},
): Promise<string> {
  const previousVideo =
    previousVideoUri.trim();

  const cleanedPrompt =
    prompt.trim();

  if (!previousVideo) {
    throw new Error(
      "Für die Fortsetzung fehlt das vorherige Video.",
    );
  }

  if (!cleanedPrompt) {
    throw new Error(
      "Für die Fortsetzung fehlt der Prompt.",
    );
  }

  const durationSeconds =
    normalizeDurationSeconds(
      options.durationSeconds,
    );

  return submitSeedance(
    REFERENCE_TO_VIDEO_MODEL,
    {
      prompt: [
        "@Video1 is the immediately preceding shot.",
        "Continue directly from its final visible moment.",
        "Preserve the exact same characters, identities, wardrobe, environment, lighting, visual style and camera continuity.",
        "Do not restart the scene.",
        "Do not redesign or replace characters.",
        "",
        cleanedPrompt,
      ].join("\n"),

      video_urls: [
        previousVideo,
      ],

      resolution: "720p",

      /*
       * Neue Pipeline:
       * ebenfalls standardmäßig 15 Sekunden.
       */
      duration:
        String(durationSeconds),

      aspect_ratio:
        options.aspectRatio ?? "9:16",

      generate_audio: true,

      bitrate_mode: "high",
    },
    options.webhookUrl,
  );
}

/**
 * Liest den direkten Callback von fal.ai.
 *
 * Erwarteter erfolgreicher Callback:
 *
 * {
 *   request_id: "...",
 *   status: "OK",
 *   payload: {
 *     video: {
 *       url: "https://..."
 *     }
 *   }
 * }
 */
export function readSeedanceWebhookResult(
  operationName: string,
  value: unknown,
): SeedanceVideoStatus {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new SeedanceProviderOperationError(
      "Seedance hat einen ungültigen Webhook-Callback geliefert.",
    );
  }

  const body =
    value as SeedanceWebhookPayload;

  const operation =
    decodeOperation(operationName);

  const callbackRequestId =
    typeof body.request_id === "string"
      ? body.request_id
      : typeof body.gateway_request_id === "string"
        ? body.gateway_request_id
        : "";

  if (
    callbackRequestId &&
    callbackRequestId !== operation.requestId
  ) {
    throw new SeedanceProviderOperationError(
      "Der Seedance-Webhook gehört nicht zur erwarteten Videooperation.",
    );
  }

  const status =
    typeof body.status === "string"
      ? body.status.toUpperCase()
      : "";

  if (status === "ERROR") {
    let errorMessage =
      "Seedance konnte die Generierung nicht abschließen.";

    if (
      typeof body.error === "string" &&
      body.error.trim()
    ) {
      errorMessage = body.error.trim();
    } else if (
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      errorMessage =
        body.error.message;
    }

    throw new SeedanceProviderOperationError(
      errorMessage,
    );
  }

  if (
    status &&
    status !== "OK" &&
    status !== "COMPLETED"
  ) {
    throw new SeedanceProviderOperationError(
      `Seedance hat einen unerwarteten Webhook-Status geliefert: ${status}`,
    );
  }

  const videoUrl =
    body.payload?.video?.url;

  if (!videoUrl) {
    throw new SeedanceProviderOperationError(
      "Seedance hat den Webhook ausgelöst, aber keine Video-URL geliefert.",
    );
  }

  return {
    done: true,
    videoUrl,
    videoUri: videoUrl,

    mimeType:
      body.payload?.video?.content_type ??
      "video/mp4",
  };
}

/**
 * Bleibt absichtlich erhalten:
 *
 * - manuelle Recovery
 * - bestehende alte Jobs
 * - Debugging
 *
 * Der normale Workflow läuft über den
 * fal.ai-Webhook und pollt nicht permanent.
 */
export async function checkVideoStatus(
  operationName: string,
): Promise<SeedanceVideoStatus> {
  configureFal();

  const {
    modelId,
    requestId,
  } =
    decodeOperation(operationName);

  try {
    const status =
      await fal.queue.status(
        modelId as any,
        {
          requestId,
          logs: true,
        } as any,
      );

    const statusValue =
      (
        status as {
          status?: string;
        }
      ).status;

    if (
      statusValue !== "COMPLETED"
    ) {
      return {
        done: false,
      };
    }

    const result =
      await fal.queue.result(
        modelId as any,
        {
          requestId,
        } as any,
      );

    const data =
      (
        result as {
          data?: {
            video?: {
              url?: string;
              content_type?: string;
            };
          };
        }
      ).data;

    const videoUrl =
      data?.video?.url;

    if (!videoUrl) {
      throw new Error(
        "Seedance meldet die Generierung als fertig, aber es wurde keine Video-URL geliefert.",
      );
    }

    return {
      done: true,
      videoUrl,
      videoUri: videoUrl,

      mimeType:
        data?.video?.content_type ??
        "video/mp4",
    };
  } catch (error) {
    if (
      error instanceof
      SeedanceProviderOperationError
    ) {
      throw error;
    }

    throw new SeedanceProviderOperationError(
      readErrorMessage(error),
    );
  }
}
