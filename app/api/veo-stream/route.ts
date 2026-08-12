import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST =
  "generativelanguage.googleapis.com";

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
        },
        {
          status: 500,
        },
      );
    }

    const videoUri =
      request.nextUrl.searchParams.get("videoUri");

    if (!videoUri) {
      return NextResponse.json(
        {
          error: "videoUri fehlt.",
        },
        {
          status: 400,
        },
      );
    }

    let googleUrl: URL;

    try {
      googleUrl = new URL(videoUri);
    } catch {
      return NextResponse.json(
        {
          error: "Die videoUri ist ungültig.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      googleUrl.protocol !== "https:" ||
      googleUrl.hostname !== ALLOWED_HOST
    ) {
      return NextResponse.json(
        {
          error:
            "Die angegebene Video-Adresse ist nicht erlaubt.",
        },
        {
          status: 400,
        },
      );
    }

    googleUrl.searchParams.set("key", apiKey);

    const range =
      request.headers.get("range");

    const headers = new Headers();

    if (range) {
      headers.set("Range", range);
    }

    const googleResponse = await fetch(
      googleUrl.toString(),
      {
        method: "GET",
        headers,
        cache: "no-store",
      },
    );

    if (!googleResponse.ok) {
      const errorText =
        await googleResponse.text();

      console.error(
        "Veo-Stream konnte nicht geladen werden:",
        {
          status: googleResponse.status,
          errorText,
        },
      );

      return NextResponse.json(
        {
          error:
            "Das Video konnte nicht geladen werden.",
        },
        {
          status: googleResponse.status,
        },
      );
    }

    const responseHeaders = new Headers();

    responseHeaders.set(
      "Content-Type",
      googleResponse.headers.get(
        "content-type",
      ) ?? "video/mp4",
    );

    responseHeaders.set(
      "Accept-Ranges",
      googleResponse.headers.get(
        "accept-ranges",
      ) ?? "bytes",
    );

    responseHeaders.set(
      "Cache-Control",
      "private, no-store",
    );

    const contentLength =
      googleResponse.headers.get(
        "content-length",
      );

    const contentRange =
      googleResponse.headers.get(
        "content-range",
      );

    if (contentLength) {
      responseHeaders.set(
        "Content-Length",
        contentLength,
      );
    }

    if (contentRange) {
      responseHeaders.set(
        "Content-Range",
        contentRange,
      );
    }

    return new NextResponse(
      googleResponse.body,
      {
        status: googleResponse.status,
        headers: responseHeaders,
      },
    );
  } catch (error) {
    console.error("Veo-Stream-Fehler:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Das Video konnte nicht geladen werden.",
      },
      {
        status: 500,
      },
    );
  }
}