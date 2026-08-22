import { fal } from "@fal-ai/client";

import type { VideoAspectRatio } from "@/types/story";

const TEXT_TO_VIDEO_MODEL =
  "bytedance/seedance-2.0/fast/text-to-video";

const IMAGE_TO_VIDEO_MODEL =
  "bytedance/seedance-2.0/fast/image-to-video";

const REFERENCE_TO_VIDEO_MODEL =
  "bytedance/seedance-2.0/fast/reference-to-video";

const OPERATION_PREFIX = "fal-seedance";

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
};

export type SeedanceExtensionOptions = {
  aspectRatio?: VideoAspectRatio;
  extensionNumber?: number;
  maxAttempts?: number;
};

export type SeedanceVideoStatus = {
  done: boolean;
  videoUrl?: string;
  videoUri?: string;
  mimeType?: string;
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
      typeof candidate.retryAfterMs ===
      "number"
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
    typeof candidate.response?.status ===
    "number"
  ) {
    return candidate.response.status;
  }

  return 0;
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
): {
  modelId: string;
  requestId: string;
} {
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
): Promise<string> {
  configureFal();

  try {
    const result =
      await fal.queue.submit(
        modelId as any,
        {
          input,
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

  const commonInput = {
    resolution: "720p",
    duration: "8",
    aspect_ratio: aspectRatio,
    generate_audio: true,
    bitrate_mode: "standard",
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
    );
  }

  return submitSeedance(
    TEXT_TO_VIDEO_MODEL,
    {
      ...commonInput,
      prompt: cleanedPrompt,
    },
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

      duration: "7",

      aspect_ratio:
        options.aspectRatio ?? "9:16",

      generate_audio: true,

      bitrate_mode: "standard",
    },
  );
}

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