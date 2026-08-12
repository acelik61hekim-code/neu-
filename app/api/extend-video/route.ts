import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VEO_EXTENSION_MODEL =
  "veo-3.1-fast-generate-preview";

const GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";


type ExtendVideoRequest = {
  videoUri?: unknown;
  prompt?: unknown;
  mimeType?: unknown;
  extensionNumber?: unknown;
};

type PredictLongRunningResponse = {
  name?: string;
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type GeminiFileResource = {
  name?: string;
  uri?: string;
  downloadUri?: string;
  mimeType?: string;
  state?: string;
  source?: string;
  expirationTime?: string;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function readRequiredString(
  value: unknown,
  fieldName: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `${fieldName} fehlt oder ist ungÃ¼ltig.`,
    );
  }

  return value.trim();
}

function readExtensionNumber(
  value: unknown,
): number | undefined {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1
  ) {
    return value;
  }

  return undefined;
}

function isAllowedGoogleVideoUri(
  value: string,
): boolean {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      return false;
    }

    const hostname =
      url.hostname.toLowerCase();

    return (
      hostname ===
        "generativelanguage.googleapis.com" ||
      hostname.endsWith(".googleapis.com") ||
      hostname.endsWith(
        ".googleusercontent.com",
      )
    );
  } catch {
    return false;
  }
}

function buildContinuationPrompt(
  prompt: string,
): string {
  return [
    prompt,
    "",
    "IMPORTANT CONTINUITY INSTRUCTIONS:",
    "Continue the existing Veo-generated video seamlessly from its exact final state.",
    "This is a direct continuation of the same video, not a new scene and not a restart.",
    "Preserve the exact identity, face, hair, body proportions, clothing, accessories and voice of every existing character.",
    "Preserve the established environment, object positions, spatial layout, lighting direction, exposure, color temperature and weather.",
    "Continue the current camera position, framing, lens behavior, movement direction and physical momentum naturally.",
    "Continue active ambience, music and sound sources without an audible reset.",
    "Do not reintroduce characters that are already visible.",
    "Do not reset poses.",
    "Do not teleport characters or objects.",
    "Do not change wardrobe or identity.",
    "Do not add subtitles, captions, logos, watermarks or interface text.",
  ].join("\n");
}

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const record =
      error as Record<string, unknown>;

    if (
      typeof record.message === "string"
    ) {
      return record.message;
    }
  }

  return "Die Veo-VideoverlÃ¤ngerung ist fehlgeschlagen.";
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
      `${GEMINI_API_BASE_URL}/${fileName}`,
      {
        method: "GET",

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

  if (!response.ok) {
    const message =
      body?.error?.message ??
      `Die Gemini-Datei konnte nicht gelesen werden. HTTP ${response.status}.`;

    const apiError =
      new Error(
        message,
      ) as Error & {
        status?: number;
      };

    apiError.status =
      response.status;

    throw apiError;
  }

  if (!body) {
    throw new Error(
      "Google hat keine gÃ¼ltigen Metadaten fÃ¼r das Veo-Video zurÃ¼ckgegeben.",
    );
  }

  return body;
}

async function resolveProcessedGeneratedVideoUri({
  videoUri,
  apiKey,
}: {
  videoUri: string;
  apiKey: string;
}): Promise<{
  fileName: string;
  processedUri: string;
  mimeType: string;
  state: string;
  source: string;
}> {
  /*
   * Die URI aus operation.response wird bei unserem
   * bisherigen Flow als DOWNLOAD-URI an den Browser
   * weitergereicht:
   *
   *   .../files/<id>:download?alt=media
   *
   * Googles Files API unterscheidet aber ausdrÃ¼cklich:
   *
   *   file.uri
   *   file.downloadUri
   *
   * FÃ¼r die Extension brauchen wir die verarbeitete
   * File-Ressource, nicht die Download-Adresse.
   */
  const fileName =
    extractGeminiFileNameFromUri(
      videoUri,
    );

  const maxAttempts = 12;

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
      file.state ?? "STATE_UNSPECIFIED";

    const source =
      file.source ??
      "SOURCE_UNSPECIFIED";

    console.log(
      "Veo Extension File-Metadaten:",
      {
        attempt,
        fileName,
        state,
        source,
        hasFileUri:
          Boolean(file.uri),
        hasDownloadUri:
          Boolean(
            file.downloadUri,
          ),
        mimeType:
          file.mimeType,
        expirationTime:
          file.expirationTime,
      },
    );

    /*
     * Extension darf nur mit Google/Veo-generierten
     * Dateien arbeiten.
     */
    if (
      source !== "GENERATED"
    ) {
      throw new Error(
        `Das Eingangsvideo ist keine von Google generierte Veo-Datei. source=${source}`,
      );
    }

    if (
      state === "ACTIVE"
    ) {
      if (
        !file.uri ||
        !file.uri.trim()
      ) {
        throw new Error(
          "Die verarbeitete Veo-Datei besitzt keine file.uri.",
        );
      }

      return {
        fileName,
        processedUri:
          file.uri.trim(),
        mimeType:
          file.mimeType ??
          "video/mp4",
        state,
        source,
      };
    }

    if (
      state === "FAILED"
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
      await new Promise<void>(
        (resolve) => {
          setTimeout(
            resolve,
            2500,
          );
        },
      );
    }
  }

  throw new Error(
    "Die Veo-Datei ist nach 30 Sekunden noch nicht ACTIVE/verarbeitet.",
  );
}

async function startExtensionWithVideoUri({
  apiKey,
  prompt,
  videoUri,
}: {
  apiKey: string;
  prompt: string;
  videoUri: string;
}): Promise<PredictLongRunningResponse> {
  const endpoint =
    `${GEMINI_API_BASE_URL}/models/${VEO_EXTENSION_MODEL}:predictLongRunning`;

  /*
   * WICHTIG:
   *
   * Wir senden KEINE videoBytes und KEIN inlineData.
   *
   * Wir senden weiterhin KEIN numberOfVideos.
   * Dieser Parameter wurde vom Extension-Endpunkt
   * zuvor ausdrÃ¼cklich abgelehnt.
   *
   * Jetzt setzen wir aber aspectRatio explizit auf
   * 9:16, weil Veo sonst 16:9 als Standard annimmt
   * und unser Eingangsvideo vertikal ist.
   *
   * resolution lassen wir weg; die Extension arbeitet
   * mit dem bereits erzeugten 720p-Veo-Video.
   */
  const response =
    await fetch(
      endpoint,
      {
        method: "POST",

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
                prompt,

                video: {
                  uri:
                    videoUri,
                },
              },
            ],

            /*
             * Ohne aspectRatio verwendet Veo standardmÃ¤ÃŸig
             * 16:9. Unser bereits erzeugtes Eingangsvideo
             * ist aber 9:16. Deshalb muss die Extension
             * explizit dasselbe SeitenverhÃ¤ltnis bekommen.
             *
             * Wir lassen numberOfVideos weiterhin weg,
             * weil dieser Parameter vom Extension-Endpunkt
             * zuvor ausdrÃ¼cklich abgelehnt wurde.
             *
             * resolution lassen wir ebenfalls weg:
             * fÃ¼r Extensions ist 720p vorgesehen und das
             * Eingangsvideo wurde bereits in 720p erzeugt.
             */
            parameters: {
              aspectRatio:
                "9:16",
            },
          }),

        cache:
          "no-store",
      },
    );

  const responseBody =
    await readJsonSafely<
      PredictLongRunningResponse
    >(response);

  if (!response.ok) {
    const message =
      responseBody?.error
        ?.message ||
      `Google Veo Extension fehlgeschlagen. HTTP ${response.status}.`;

    const apiError =
      new Error(
        message,
      ) as Error & {
        status?: number;
      };

    apiError.status =
      response.status;

    throw apiError;
  }

  if (!responseBody) {
    throw new Error(
      "Google hat auf den Extension-Request keine gÃ¼ltige JSON-Antwort zurÃ¼ckgegeben.",
    );
  }

  return responseBody;
}

export async function POST(
  request: Request,
) {
  if (process.env.LEGACY_VEO_ROUTES_ENABLED !== "true") {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 },
    );
  }
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
      },
      {
        status: 500,
      },
    );
  }


  let body:
    ExtendVideoRequest;

  try {
    body =
      (await request.json()) as ExtendVideoRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Request enthÃ¤lt kein gÃ¼ltiges JSON.",
      },
      {
        status: 400,
      },
    );
  }

  let videoUri: string;
  let prompt: string;

  try {
    videoUri =
      readRequiredString(
        body.videoUri,
        "videoUri",
      );

    prompt =
      readRequiredString(
        body.prompt,
        "prompt",
      );
  } catch (
    error: unknown
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          getErrorMessage(
            error,
          ),
      },
      {
        status: 400,
      },
    );
  }

  if (
    !isAllowedGoogleVideoUri(
      videoUri,
    )
  ) {
    return NextResponse.json(
      {
        success: false,

        error:
          "Die Video-Adresse ist keine gÃ¼ltige Google/Veo-Video-Adresse.",
      },
      {
        status: 400,
      },
    );
  }

  const extensionNumber =
    readExtensionNumber(
      body.extensionNumber,
    );

  const continuationPrompt =
    buildContinuationPrompt(
      prompt,
    );

  try {
    console.log(
      "Veo Extension FAST: Start ...",
      {
        extensionNumber,

        model:
          VEO_EXTENSION_MODEL,

        videoInput:
          "previous-veo-generated-uri",
      },
    );

    /*
     * Erst die File-Ressource auflÃ¶sen.
     *
     * Wir verwenden danach bewusst file.uri und NICHT
     * mehr die :download?alt=media-Adresse.
     */
    const processedVideo =
      await resolveProcessedGeneratedVideoUri({
        videoUri,
        apiKey,
      });

    console.log(
      "Veo Extension: verarbeitete GENERATED-Datei bestÃ¤tigt.",
      {
        extensionNumber,
        fileName:
          processedVideo.fileName,
        state:
          processedVideo.state,
        source:
          processedVideo.source,
        mimeType:
          processedVideo.mimeType,
      },
    );

    const operation =
      await startExtensionWithVideoUri({
        apiKey,

        prompt:
          continuationPrompt,

        videoUri:
          processedVideo.processedUri,
      });

    if (!operation.name) {
      console.error(
        "Veo Extension hat keinen Operation-Namen zurÃ¼ckgegeben:",
        operation,
      );

      return NextResponse.json(
        {
          success: false,

          error:
            "Veo hat keinen Operation-Namen fÃ¼r die VideoverlÃ¤ngerung zurÃ¼ckgegeben.",
        },
        {
          status: 502,
        },
      );
    }

    console.log(
      "Veo Extension FAST erfolgreich gestartet:",
      {
        extensionNumber,

        model:
          VEO_EXTENSION_MODEL,

        operationName:
          operation.name,
      },
    );

    const response =
      NextResponse.json(
        {
          success: true,

          operationName:
            operation.name,

          name:
            operation.name,

          done:
            Boolean(
              operation.done,
            ),

          model:
            VEO_EXTENSION_MODEL,
        },
        {
          status: 200,
        },
      );

    return response;
  } catch (
    error: unknown
  ) {
    console.error(
      "Veo Video Extension FAST fehlgeschlagen:",
      error,
    );

    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (
        error as {
          status?: unknown;
        }
      ).status === "number"
        ? (
            error as {
              status: number;
            }
          ).status
        : 500;

    return NextResponse.json(
      {
        success: false,

        model:
          VEO_EXTENSION_MODEL,

        error:
          getErrorMessage(
            error,
          ),
      },
      {
        status:
          status >= 400 &&
          status <= 599
            ? status
            : 500,
      },
    );
  }
}