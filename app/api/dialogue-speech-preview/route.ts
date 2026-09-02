import { NextResponse } from "next/server";

import {
  synthesizeDialogueSpeechPreview,
} from "@/lib/dialogue-speech";
import {
  dialogueVoiceForSpeaker,
} from "@/lib/dialogue-voices";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

type RequestBody = {
  speaker?: unknown;
  speakers?: unknown;
  text?: unknown;
  language?: unknown;
};

export async function POST(
  request: Request,
) {
  const rateLimit = await checkRateLimit(
    request,
    "dialogue-speech-preview",
    30,
    60 * 60,
  );

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "Zu viele Hörproben in kurzer Zeit. Bitte versuche es später erneut.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            rateLimit.retryAfterSeconds,
          ),
        },
      },
    );
  }

  let body: RequestBody;

  try {
    body = await request.json() as RequestBody;
  } catch {
    return NextResponse.json(
      {
        error: "Ungültige Hörproben-Anfrage.",
      },
      {
        status: 400,
      },
    );
  }

  const speaker =
    typeof body.speaker === "string"
      ? body.speaker.trim().slice(0, 120)
      : "Sprecherfigur";
  const text =
    typeof body.text === "string"
      ? body.text.trim()
      : "";
  const speakers =
    Array.isArray(body.speakers)
      ? body.speakers
          .filter(
            (value): value is string =>
              typeof value === "string" &&
              Boolean(value.trim()),
          )
          .map((value) =>
            value.trim().slice(0, 120),
          )
          .slice(0, 8)
      : [speaker];
  const language =
    body.language === "en" ||
    body.language === "auto"
      ? body.language
      : "de";

  if (!text || text.length > 500) {
    return NextResponse.json(
      {
        error:
          "Eine Hörprobe benötigt zwischen 1 und 500 Zeichen.",
      },
      {
        status: 400,
      },
    );
  }

  try {
    const voiceName =
      dialogueVoiceForSpeaker(
        speaker,
        speakers,
      );
    const preview =
      await synthesizeDialogueSpeechPreview({
        text,
        voiceName,
        language,
        speaker,
      });

    console.info(
      "Dialogue pronunciation preview created",
      {
        voiceName,
        language,
        characterCount: text.length,
        durationSeconds:
          Number(
            preview.durationSeconds.toFixed(2),
          ),
      },
    );

    return new Response(
      new Uint8Array(preview.audio),
      {
        status: 200,
        headers: {
          "Content-Type": preview.contentType,
          "Content-Length": String(
            preview.audio.length,
          ),
          "Cache-Control":
            "private, no-store, max-age=0",
          "X-Dialogue-Voice": voiceName,
        },
      },
    );
  } catch (error) {
    console.error(
      "Dialogue pronunciation preview failed",
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );

    return NextResponse.json(
      {
        error:
          "Die Hörprobe konnte gerade nicht erstellt werden. Bitte versuche es erneut.",
      },
      {
        status: 502,
      },
    );
  }
}
