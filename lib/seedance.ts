import { fal } from "@fal-ai/client";

import type { VideoAspectRatio } from "@/types/story";
import {
  buildNativeDialogueAudioInstruction,
} from "@/lib/native-dialogue-audio";

export type SeedanceModelTier =
  | "fast"
  | "original";

function seedanceModelId(
  tier: SeedanceModelTier,
  endpoint:
    | "text-to-video"
    | "image-to-video"
    | "reference-to-video",
): string {
  if (getConfiguredSeedanceProvider() === "byteplus") {
    return tier === "fast"
      ? "dreamina-seedance-2-0-fast-260128"
      : "dreamina-seedance-2-5-260628";
  }

  return tier === "fast"
    ? `bytedance/seedance-2.0/fast/${endpoint}`
    : `bytedance/seedance-2.0/${endpoint}`;
}

const BYTEPLUS_OPERATION_PREFIX = "byteplus-seedance";
const LEGACY_FAL_OPERATION_PREFIX = "fal-seedance";
const BYTEPLUS_BASE_URL =
  "https://ark.ap-southeast.bytepluses.com";

type SeedanceProvider = "byteplus" | "fal";

export function getConfiguredSeedanceProvider(): SeedanceProvider {
  return process.env.SEEDANCE_PROVIDER === "byteplus"
    ? "byteplus"
    : "fal";
}

export function hasConfiguredSeedanceCredentials(): boolean {
  return getConfiguredSeedanceProvider() === "byteplus"
    ? Boolean(
        process.env.BYTEPLUS_ARK_API_KEY ||
          process.env.BYTEPLUS_LAS_API_KEY ||
          process.env.LAS_API_KEY,
      )
    : Boolean(process.env.FAL_KEY);
}

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
  label?: string;
};

export type SeedanceAudioReference = {
  data: string;
  mimeType:
    | "audio/wav"
    | "audio/mpeg";
};

export type SeedanceGenerationOptions = {
  modelTier?: SeedanceModelTier;
  aspectRatio?: VideoAspectRatio;
  referenceImage?: SeedanceImageReference;
  referenceImages?: SeedanceImageReference[];
  referenceAudios?: SeedanceAudioReference[];
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
  modelTier?: SeedanceModelTier;
  aspectRatio?: VideoAspectRatio;
  extensionNumber?: number;
  maxAttempts?: number;

  /*
   * Standard ist ebenfalls 15 Sekunden.
   */
  durationSeconds?: number;

  referenceAudios?: SeedanceAudioReference[];

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
  provider: SeedanceProvider;
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

type BytePlusSeedanceTask = {
  id?: string;
  status?: string;
  content?: {
    video_url?: string;
  };
  error?: unknown;
};

export class SeedanceProviderStartError extends Error {
  readonly provider = "seedance";
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
  readonly provider = "seedance";
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
    candidate.provider !== "seedance" ||
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
    candidate.provider !== "seedance" ||
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

function getBytePlusApiKey(): string {
  const key =
    process.env.BYTEPLUS_ARK_API_KEY ||
    process.env.BYTEPLUS_LAS_API_KEY ||
    process.env.LAS_API_KEY;

  if (!key) {
    throw new Error(
      "BYTEPLUS_ARK_API_KEY fehlt in den Umgebungsvariablen.",
    );
  }

  return key;
}

function toDataUri(
  reference: SeedanceImageReference,
): string {
  return `data:${reference.mimeType};base64,${reference.data}`;
}

function audioToDataUri(
  reference: SeedanceAudioReference,
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

/*
 * BytePlus can mistake stylised fictional characters for real people.
 * content[0] is the text prompt, so content[1] maps to the first image.
 * Rejected tasks are not billed; remove only the rejected reference and
 * keep the paid project running with the remaining character references.
 */
function readRejectedBytePlusReferenceIndex(
  error: unknown,
): number | null {
  if (
    getConfiguredSeedanceProvider() !==
    "byteplus"
  ) {
    return null;
  }

  const message =
    readErrorMessage(error);

  if (
    !/(?:may contain|contains?).{0,30}(?:real person|real human)|real (?:person|human).{0,30}(?:reference|face)/i.test(
      message,
    )
  ) {
    return null;
  }

  const match =
    message.match(
      /content\s*\[\s*(\d+)\s*\]/i,
    );

  return match
    ? Number(match[1]) - 1
    : -1;
}

function buildReferenceModerationFallbackPrompt(
  prompt: string,
): string {
  return [
    "PROVIDER-SAFE FALLBACK: No image reference is attached.",
    "Ignore any later sentence claiming that reference images are supplied.",
    "Create only clearly fictional, stylized characters exactly as described in the written prompt.",
    "Do not depict, imitate or identify any real person.",
    "Preserve the written creature type, body proportions, outfit, colors, role, relationship and distinctive non-human features throughout the clip.",
    "",
    prompt,
  ].join("\n");
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
  provider: SeedanceProvider,
  modelId: string,
  requestId: string,
): string {
  return [
    provider === "byteplus"
      ? BYTEPLUS_OPERATION_PREFIX
      : LEGACY_FAL_OPERATION_PREFIX,
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
    (
      parts[0] !== BYTEPLUS_OPERATION_PREFIX &&
      parts[0] !== LEGACY_FAL_OPERATION_PREFIX
    ) ||
    !parts[1] ||
    !parts[2]
  ) {
    throw new Error(
      "Ungültige Seedance-Operation.",
    );
  }

  return {
    provider:
      parts[0] === BYTEPLUS_OPERATION_PREFIX
        ? "byteplus"
        : "fal",
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
  return (
    operationName.startsWith(
      `${BYTEPLUS_OPERATION_PREFIX}|`,
    ) ||
    operationName.startsWith(
      `${LEGACY_FAL_OPERATION_PREFIX}|`,
    )
  );
}

function parseRetryAfterMs(
  value: string | null,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds =
    Number(value);

  if (
    Number.isFinite(
      seconds,
    ) &&
    seconds >= 0
  ) {
    return Math.max(
      1000,
      Math.round(
        seconds * 1000,
      ),
    );
  }

  const date =
    Date.parse(value);

  if (
    Number.isFinite(
      date,
    )
  ) {
    return Math.max(
      1000,
      date - Date.now(),
    );
  }

  return undefined;
}

async function submitSeedance(
  modelId: string,
  input: Record<string, unknown>,
  webhookUrl?: string,
): Promise<string> {
  const normalizedWebhookUrl =
    normalizeWebhookUrl(webhookUrl);

  if (getConfiguredSeedanceProvider() === "byteplus") {
    const content: Array<Record<string, unknown>> = [];
    const prompt =
      typeof input.prompt === "string"
        ? input.prompt
        : "";

    content.push({
      type: "text",
      text: prompt,
    });

    const imageUrls = Array.isArray(input.image_urls)
      ? input.image_urls
      : typeof input.image_url === "string"
        ? [input.image_url]
        : [];

    for (const imageUrl of imageUrls) {
      if (typeof imageUrl !== "string") continue;

      content.push({
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
        role: "reference_image",
      });
    }

    const videoUrls = Array.isArray(input.video_urls)
      ? input.video_urls
      : [];

    for (const videoUrl of videoUrls) {
      if (typeof videoUrl !== "string") continue;

      content.push({
        type: "video_url",
        video_url: {
          url: videoUrl,
        },
        role: "reference_video",
      });
    }

    const audioUrls = Array.isArray(input.audio_urls)
      ? input.audio_urls
      : [];

    for (const audioUrl of audioUrls) {
      if (typeof audioUrl !== "string") continue;

      content.push({
        type: "audio_url",
        audio_url: {
          url: audioUrl,
        },
        role: "reference_audio",
      });
    }

    try {
      const response = await fetch(
        `${BYTEPLUS_BASE_URL}/api/v3/contents/generations/tasks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getBytePlusApiKey()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelId,
            content,
            generate_audio: input.generate_audio !== false,
            resolution:
              typeof input.resolution === "string"
                ? input.resolution
                : "720p",
            ratio:
              typeof input.aspect_ratio === "string"
                ? input.aspect_ratio
                : "9:16",
            duration: Number(input.duration) || 15,
            watermark: false,
            ...(normalizedWebhookUrl
              ? { callback_url: normalizedWebhookUrl }
              : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );

      const responseText = await response.text();
      let result: {
        id?: string;
        error?: unknown;
      } = {};

      if (responseText) {
        try {
          result = JSON.parse(responseText) as typeof result;
        } catch {
          result = {};
        }
      }

      if (!response.ok) {
        const providerMessage =
          typeof result.error === "string"
            ? result.error
            : result.error &&
                typeof result.error === "object" &&
                "message" in result.error &&
                typeof result.error.message === "string"
              ? result.error.message
              : responseText ||
                `BytePlus HTTP ${response.status}`;

        throw new SeedanceProviderStartError(
          providerMessage,
          {
            httpStatus: response.status,
            retryAfterMs:
              parseRetryAfterMs(
                response.headers.get(
                  "retry-after",
                ),
              ),
          },
        );
      }

      if (!result.id) {
        throw new SeedanceProviderStartError(
          "BytePlus hat keine Task-ID zurückgegeben.",
          {
            httpStatus: response.status,
          },
        );
      }

      return encodeOperation(
        "byteplus",
        modelId,
        result.id,
      );
    } catch (error) {
      if (error instanceof SeedanceProviderStartError) {
        throw error;
      }

      throw new SeedanceProviderStartError(
        readErrorMessage(error),
        {
          httpStatus: readHttpStatus(error),
        },
      );
    }
  }

  configureFal();

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
      "fal",
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

  const modelTier =
    options.modelTier ?? "fast";

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
  };

  const audioUrls =
    options.referenceAudios
      ?.slice(0, 3)
      .map(audioToDataUri) ?? [];

  const dialogueAudioInstruction =
    audioUrls.length > 0
      ? buildNativeDialogueAudioInstruction()
      : "";
  const submitAudioOnlyDialogueFallback =
  async (): Promise<string> => {
    if (
      getConfiguredSeedanceProvider() !== "byteplus" ||
      audioUrls.length === 0
    ) {
      throw new Error(
        "Der Audio-Fallback ist für diesen Provider nicht verfügbar.",
      );
    }

    return submitSeedance(
      seedanceModelId(
        "original",
        "reference-to-video",
      ),
      {
        ...commonInput,

        prompt: [
          "PROVIDER-SAFE AUDIO-ONLY DIALOGUE MODE.",
          "No image reference is attached.",
          "Create only clearly fictional characters exactly as described in the written prompt.",
          "Do not depict, imitate or reconstruct any real person.",

          "IMPORTANT AUDIO RULE:",
          "@Audio1 is the authoritative finished dialogue track.",
          "Preserve the original human voice timbre, natural prosody, pauses, timing and German pronunciation from @Audio1.",
          "Do not synthesize, rerecord, replace, reinterpret or robotize the spoken voice.",
          "Synchronize the visible speakers' mouth movements to the supplied audio.",

          dialogueAudioInstruction,
          cleanedPrompt,
        ]
          .filter(Boolean)
          .join("\n\n"),

        audio_urls: audioUrls,
      },
      options.webhookUrl,
    );
  };

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

  const acceptedReferences =
    [...options.referenceImages];

  while (
    acceptedReferences.length > 0
  ) {
    const identityInstructions =
      acceptedReferences
        .map(
          (reference, index) => {
            const label =
              reference.label?.trim() ||
              `character ${index + 1}`;

            return `@Image${index + 1} is the locked identity reference for ${label}. Preserve this character's exact creature type, head geometry, face, body proportions, outfit, colors, shoes, accessories and distinctive non-human features throughout the shot.`;
          },
        )
        .join("\n");

    try {
      return await submitSeedance(
        seedanceModelId(
          modelTier,
          "reference-to-video",
        ),
        {
          ...commonInput,

          prompt: [
            identityInstructions,
            dialogueAudioInstruction,
            "",
            cleanedPrompt,
          ]
            .filter(Boolean)
            .join("\n"),

          image_urls:
            acceptedReferences.map(
              toDataUri,
            ),

          ...(audioUrls.length > 0
            ? {
                audio_urls:
                  audioUrls,
              }
            : {}),
        },
        options.webhookUrl,
      );
    } catch (error) {
      const rejectedIndex =
        readRejectedBytePlusReferenceIndex(
          error,
        );

      if (
        rejectedIndex === null
      ) {
        throw error;
      }

      if (
        rejectedIndex < 0 ||
        rejectedIndex >=
          acceptedReferences.length
      ) {
        acceptedReferences.splice(
          0,
          acceptedReferences.length,
        );
      } else {
        acceptedReferences.splice(
          rejectedIndex,
          1,
        );
      }

      if (
        audioUrls.length > 0 &&
        acceptedReferences.length === 0
      ) {
        return submitAudioOnlyDialogueFallback();
      }
    }
  }

  if (
    audioUrls.length > 0
  ) {
    return submitAudioOnlyDialogueFallback();
  }

  return submitSeedance(
    seedanceModelId(
      modelTier,
      "text-to-video",
    ),
    {
      ...commonInput,

      prompt:
        buildReferenceModerationFallbackPrompt(
          cleanedPrompt,
        ),
    },
    options.webhookUrl,
  );
}

if (
  options.referenceImage
) {
  try {
    return await submitSeedance(
      seedanceModelId(
        modelTier,
        audioUrls.length > 0
          ? "reference-to-video"
          : "image-to-video",
      ),
      {
        ...commonInput,

        prompt: [
          dialogueAudioInstruction,
          cleanedPrompt,
        ]
          .filter(Boolean)
          .join("\n\n"),

        ...(audioUrls.length > 0
          ? {
              image_urls: [
                toDataUri(
                  options.referenceImage,
                ),
              ],
              audio_urls:
                audioUrls,
            }
          : {
              image_url:
                toDataUri(
                  options.referenceImage,
                ),
            }),
      },
      options.webhookUrl,
    );
  } catch (error) {
    const rejectedIndex =
      readRejectedBytePlusReferenceIndex(
        error,
      );

    if (
      rejectedIndex === null
    ) {
      throw error;
    }

    if (
      audioUrls.length > 0
    ) {
      return submitAudioOnlyDialogueFallback();
    }

    return submitSeedance(
      seedanceModelId(
        modelTier,
        "text-to-video",
      ),
      {
        ...commonInput,

        prompt:
          buildReferenceModerationFallbackPrompt(
            cleanedPrompt,
          ),
      },
      options.webhookUrl,
    );
  }
}

if (
  audioUrls.length > 0 &&
  getConfiguredSeedanceProvider() ===
    "byteplus"
) {
  return submitAudioOnlyDialogueFallback();
}

return submitSeedance(
  seedanceModelId(
    modelTier,
    "text-to-video",
  ),
  {
    ...commonInput,
    prompt:
      cleanedPrompt,
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

  const audioUrls =
    options.referenceAudios
      ?.slice(0, 3)
      .map(audioToDataUri) ?? [];

  return submitSeedance(
    seedanceModelId(
      options.modelTier ?? "fast",
      "reference-to-video",
    ),
    {
      prompt: [
        "@Video1 is the immediately preceding shot.",
        ...(audioUrls.length > 0
          ? [
              buildNativeDialogueAudioInstruction(),
            ]
          : []),
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

      ...(audioUrls.length > 0
        ? { audio_urls: audioUrls }
        : {}),

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

  if (operation.provider === "byteplus") {
    const bytePlusBody = value as BytePlusSeedanceTask;
    const callbackId =
      typeof bytePlusBody.id === "string"
        ? bytePlusBody.id
        : "";

    if (
      callbackId &&
      callbackId !== operation.requestId
    ) {
      throw new SeedanceProviderOperationError(
        "Der BytePlus-Callback gehört nicht zur erwarteten Seedance-Operation.",
      );
    }

    const bytePlusStatus =
      typeof bytePlusBody.status === "string"
        ? bytePlusBody.status.toLowerCase()
        : "";

    if (
      bytePlusStatus === "queued" ||
      bytePlusStatus === "running"
    ) {
      return { done: false };
    }

    if (
      bytePlusStatus === "failed" ||
      bytePlusStatus === "cancelled" ||
      bytePlusStatus === "expired"
    ) {
      let message =
        "BytePlus konnte die Seedance-Generierung nicht abschließen.";

      if (
        typeof bytePlusBody.error === "string" &&
        bytePlusBody.error.trim()
      ) {
        message = bytePlusBody.error.trim();
      } else if (
        bytePlusBody.error &&
        typeof bytePlusBody.error === "object" &&
        "message" in bytePlusBody.error &&
        typeof bytePlusBody.error.message === "string"
      ) {
        message = bytePlusBody.error.message;
      }

      throw new SeedanceProviderOperationError(message);
    }

    if (bytePlusStatus !== "succeeded") {
      throw new SeedanceProviderOperationError(
        `BytePlus hat einen unerwarteten Seedance-Status geliefert: ${bytePlusStatus || "leer"}`,
      );
    }

    const videoUrl =
      bytePlusBody.content?.video_url?.trim();

    if (!videoUrl) {
      throw new SeedanceProviderOperationError(
        "BytePlus meldet Seedance als fertig, hat aber keine Video-URL geliefert.",
      );
    }

    return {
      done: true,
      videoUrl,
      videoUri: videoUrl,
      mimeType: "video/mp4",
    };
  }

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
  const {
    provider,
    modelId,
    requestId,
  } =
    decodeOperation(operationName);

  if (provider === "byteplus") {
    try {
      const response = await fetch(
        `${BYTEPLUS_BASE_URL}/api/v3/contents/generations/tasks/${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${getBytePlusApiKey()}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(30_000),
        },
      );

      const responseText = await response.text();
      let task: BytePlusSeedanceTask = {};

      if (responseText) {
        try {
          task = JSON.parse(responseText) as BytePlusSeedanceTask;
        } catch {
          task = {};
        }
      }

      if (!response.ok) {
        throw new SeedanceProviderOperationError(
          responseText || `BytePlus HTTP ${response.status}`,
        );
      }

      return readSeedanceWebhookResult(
        operationName,
        task,
      );
    } catch (error) {
      if (error instanceof SeedanceProviderOperationError) {
        throw error;
      }

      throw new SeedanceProviderOperationError(
        readErrorMessage(error),
      );
    }
  }

  configureFal();

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
