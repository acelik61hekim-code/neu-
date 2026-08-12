import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VeoDownloadRequest = {
  videoUri?: unknown;
};

function isAllowedGoogleVideoUri(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname === "generativelanguage.googleapis.com" &&
      url.pathname.startsWith("/v1beta/files/") &&
      url.searchParams.get("alt") === "media"
    );
  } catch {
    return false;
  }
}

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

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt. Prüfe deine .env.local und starte den Server neu.",
      },
      { status: 500 },
    );
  }

  let body: VeoDownloadRequest;

  try {
    body = (await request.json()) as VeoDownloadRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Der Request-Body enthält kein gültiges JSON.",
      },
      { status: 400 },
    );
  }

  const videoUri =
    typeof body.videoUri === "string"
      ? body.videoUri.trim()
      : "";

  if (!videoUri) {
    return NextResponse.json(
      {
        success: false,
        error: "videoUri fehlt.",
      },
      { status: 400 },
    );
  }

  if (!isAllowedGoogleVideoUri(videoUri)) {
    return NextResponse.json(
      {
        success: false,
        error: "Die videoUri ist keine gültige Google-Veo-Datei-URL.",
      },
      { status: 400 },
    );
  }

  try {
    const googleResponse = await fetch(videoUri, {
      method: "GET",
      headers: {
        "x-goog-api-key": apiKey,
      },
      cache: "no-store",
    });

    if (!googleResponse.ok) {
      const googleError = await googleResponse.text();

      return NextResponse.json(
        {
          success: false,
          error: "Das Video konnte nicht von Google heruntergeladen werden.",
          googleStatus: googleResponse.status,
          googleResponse: googleError,
        },
        { status: googleResponse.status },
      );
    }

    if (!googleResponse.body) {
      return NextResponse.json(
        {
          success: false,
          error: "Google hat keine Videodaten zurückgegeben.",
        },
        { status: 502 },
      );
    }

    const contentType =
      googleResponse.headers.get("content-type") ?? "video/mp4";

    const contentLength =
      googleResponse.headers.get("content-length");

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition":
        'attachment; filename="veo-test-video.mp4"',
      "Cache-Control": "private, no-store, max-age=0",
    });

    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(googleResponse.body, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const details = serializeError(error);

    console.error("Veo-Download fehlgeschlagen:", error);

    return NextResponse.json(
      {
        success: false,
        error: details.message,
        details,
      },
      { status: 500 },
    );
  }
}