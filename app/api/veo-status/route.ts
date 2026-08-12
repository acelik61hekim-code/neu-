import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

type VeoStatusRequest = {
  operationName?: unknown;
};

type VeoOperationError = {
  code?: number;
  message?: string;
  status?: string;
};

type VeoVideo = {
  uri?: string;
  mimeType?: string;
};

type VeoOperationResponse = {
  name?: string;
  done?: boolean;
  error?: VeoOperationError;

  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{
        video?: VeoVideo;
      }>;
    };

    generatedVideos?: Array<{
      video?: VeoVideo;
    }>;
  };
};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

function getVideoFromOperation(
  operation: VeoOperationResponse,
): VeoVideo | null {
  const restVideo =
    operation.response?.generateVideoResponse
      ?.generatedSamples?.[0]?.video;

  if (restVideo?.uri) {
    return restVideo;
  }

  const sdkStyleVideo =
    operation.response?.generatedVideos?.[0]?.video;

  if (sdkStyleVideo?.uri) {
    return sdkStyleVideo;
  }

  return null;
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt. Prüfe deine .env.local und starte npm run dev danach neu.",
      },
      { status: 500 },
    );
  }

  let body: VeoStatusRequest;

  try {
    body = (await request.json()) as VeoStatusRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Der Request-Body enthält kein gültiges JSON.",
      },
      { status: 400 },
    );
  }

  const operationName =
    typeof body.operationName === "string"
      ? body.operationName.trim()
      : "";

  if (!operationName) {
    return NextResponse.json(
      {
        success: false,
        error: "operationName fehlt.",
      },
      { status: 400 },
    );
  }

  const validOperationPattern =
    /^models\/[a-zA-Z0-9._-]+\/operations\/[a-zA-Z0-9._-]+$/;

  if (!validOperationPattern.test(operationName)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "operationName hat kein gültiges Veo-Format.",
      },
      { status: 400 },
    );
  }

  try {
    const statusUrl =
      `${GEMINI_API_BASE_URL}/${operationName}`;

    const googleResponse = await fetch(statusUrl, {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const responseText = await googleResponse.text();

    let operation: VeoOperationResponse;

    try {
      operation = JSON.parse(
        responseText,
      ) as VeoOperationResponse;
    } catch {
      return NextResponse.json(
        {
          success: false,
          done: false,
          status: "invalid_google_response",
          error:
            "Google hat keine gültige JSON-Antwort zurückgegeben.",
          googleStatus: googleResponse.status,
          googleResponse: responseText,
        },
        { status: 502 },
      );
    }

    if (!googleResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          done: false,
          status: "google_error",
          error:
            operation.error?.message ??
            "Die Veo-Statusabfrage bei Google ist fehlgeschlagen.",
          googleStatus: googleResponse.status,
          googleError: operation.error ?? operation,
        },
        { status: googleResponse.status },
      );
    }

    if (!operation.done) {
      return NextResponse.json({
        success: true,
        done: false,
        status: "processing",
        message: "Das Video wird noch generiert.",
        operationName:
          operation.name ?? operationName,
      });
    }

    if (operation.error) {
      console.error("Veo-Operation fehlgeschlagen:", {
  operationName:
    operation.name ?? operationName,
  error: operation.error,
});
      return NextResponse.json(
        {
          success: false,
          done: true,
          status: "failed",
          message:
            operation.error.message ??
            "Die Veo-Videogenerierung ist fehlgeschlagen.",
          operationName:
            operation.name ?? operationName,
          operationError: operation.error,
        },
        { status: 502 },
      );
    }

    const video = getVideoFromOperation(operation);

    if (!video?.uri) {
      return NextResponse.json(
        {
          success: false,
          done: true,
          status: "completed_without_video",
          message:
            "Die Operation ist abgeschlossen, aber Google hat keine Video-URL zurückgegeben.",
          operationName:
            operation.name ?? operationName,
          rawResponse: operation,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
  success: true,
  done: true,
  status: "completed",
  message: "Das Veo-Video ist fertig.",
  operationName:
    operation.name ?? operationName,
  videoUri: video.uri,
  mimeType:
    video.mimeType ?? "video/mp4",

  /*
   * Das Referenzbild existiert hier noch nicht.
   * Es wird anschließend durch unsere
   * FFmpeg-Route erzeugt.
   */
  lastFrameUrl: null,
});
  } catch (error: unknown) {
    const details = serializeError(error);

    console.error(
      "Veo-Statusabfrage fehlgeschlagen:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        done: false,
        status: "error",
        error: details.message,
        details,
      },
      { status: 500 },
    );
  }
}