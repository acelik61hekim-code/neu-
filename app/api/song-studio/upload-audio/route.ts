import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/rate-limit";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import {
  isSongStudioUploadPathname,
  SONG_STUDIO_AUDIO_TYPES,
  SONG_STUDIO_MAX_AUDIO_BYTES,
} from "@/lib/song-studio-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HandleUploadBody;

    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const [subscription, rateLimit] = await Promise.all([
          getActiveSongSubscription(request).catch(() => null),
          checkRateLimit(request, "song-studio-audio-upload", 16, 60 * 60),
        ]);

        if (!subscription) {
          throw new Error("Für KI-Bearbeitungen brauchst du ein aktives Song-Abo.");
        }

        if (!rateLimit.allowed) {
          throw new Error("Zu viele Uploads in kurzer Zeit. Bitte versuche es später erneut.");
        }

        if (!isSongStudioUploadPathname(pathname)) {
          throw new Error("Der Speicherpfad der Audiodatei ist ungültig.");
        }

        return {
          allowedContentTypes: [...SONG_STUDIO_AUDIO_TYPES],
          maximumSizeInBytes: SONG_STUDIO_MAX_AUDIO_BYTES,
          validUntil: Date.now() + 15 * 60 * 1_000,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            subscriptionId: subscription.subscriptionId,
          }),
        };
      },
      onUploadCompleted: async () => {
        /* Die private Datei wird erst bei einer KI-Aktion verarbeitet. */
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Sound-Studio-Upload fehlgeschlagen:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message.slice(0, 500)
          : "Die Audiodatei konnte nicht sicher hochgeladen werden.",
      },
      { status: 400 },
    );
  }
}
