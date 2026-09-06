import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";

import { NextResponse } from "next/server";

import {
  MUSIC_VIDEO_AUDIO_TYPES,
  MUSIC_VIDEO_MAX_AUDIO_BYTES,
  MUSIC_VIDEO_MAX_DURATION_SECONDS,
} from "@/lib/music-video";

import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientPayload = {
  durationSeconds?: unknown;
};

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json() as HandleUploadPresignedBody;

    if (
      body.type ===
      "blob.generate-presigned-url"
    ) {
      const rateLimit =
        await checkRateLimit(
          request,
          "music-video-audio-upload",
          12,
          60 * 60,
        );

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error:
              "Zu viele Song-Uploads in kurzer Zeit. Bitte versuche es später erneut.",
          },
          {
            status: 429,
            headers: {
              "Retry-After":
                String(rateLimit.retryAfterSeconds),
            },
          },
        );
      }
    }

    const result =
      await handleUploadPresigned({
        request,
        body,
        getSignedToken:
          async (
            pathname,
            clientPayload,
          ) => {
            if (
              !pathname.startsWith(
                "music-video-audio/",
              ) ||
              pathname.includes("..") ||
              pathname.length > 260
            ) {
              throw new Error(
                "Ungültiger Speicherpfad für den Song.",
              );
            }

            let payload:
              ClientPayload = {};

            try {
              payload = clientPayload
                ? JSON.parse(clientPayload) as ClientPayload
                : {};
            } catch {
              throw new Error(
                "Die Song-Informationen sind ungültig.",
              );
            }

            const durationSeconds =
              Number(payload.durationSeconds);

            if (
              !Number.isFinite(durationSeconds) ||
              durationSeconds < 15 ||
              durationSeconds > MUSIC_VIDEO_MAX_DURATION_SECONDS + 0.25
            ) {
              throw new Error(
                "Der Song muss zwischen fünfzehn Sekunden und fünf Minuten lang sein.",
              );
            }

            const validUntil =
              Date.now() + 15 * 60 * 1_000;

            const token =
              await issueSignedToken({
                pathname,
                operations: ["put"],
                allowedContentTypes:
                  [...MUSIC_VIDEO_AUDIO_TYPES],
                maximumSizeInBytes:
                  MUSIC_VIDEO_MAX_AUDIO_BYTES,
                validUntil,
              });

            return {
              token,
              urlOptions: {
                allowedContentTypes:
                  [...MUSIC_VIDEO_AUDIO_TYPES],
                maximumSizeInBytes:
                  MUSIC_VIDEO_MAX_AUDIO_BYTES,
                validUntil,
                addRandomSuffix:
                  true,
                tokenPayload:
                  JSON.stringify({
                    durationSeconds,
                  }),
              },
            };
          },
      });

    return NextResponse.json(
      result,
    );
  } catch (error) {
    console.error(
      "Musikvideo-Song konnte nicht hochgeladen werden:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Der Song konnte nicht sicher hochgeladen werden.",
      },
      {
        status: 400,
      },
    );
  }
}
