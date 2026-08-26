import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";

import {
  hasPrivateInfluencerAccess,
  isOwnedInfluencerImagePath,
  PRIVATE_INFLUENCER_IMAGE_TYPES,
  PRIVATE_INFLUENCER_MAX_IMAGE_BYTES,
} from "@/lib/private-influencer";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user) throw new Error("Bitte melde dich zuerst an.");
        if (!hasPrivateInfluencerAccess(user.email)) {
          throw new Error("Dieser private Bereich ist für dein Konto nicht freigeschaltet.");
        }

        const rateLimit = await checkRateLimit(
          request,
          "private-influencer-image-upload",
          12,
          60 * 60,
        );
        if (!rateLimit.allowed) {
          throw new Error("Zu viele Bild-Uploads in kurzer Zeit. Bitte versuche es später erneut.");
        }

        if (!isOwnedInfluencerImagePath(user.id, pathname)) {
          throw new Error("Der Speicherpfad des Referenzbildes ist ungültig.");
        }

        return {
          allowedContentTypes: [...PRIVATE_INFLUENCER_IMAGE_TYPES],
          maximumSizeInBytes: PRIVATE_INFLUENCER_MAX_IMAGE_BYTES,
          validUntil: Date.now() + 15 * 60 * 1_000,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        };
      },
      onUploadCompleted: async () => {
        /* Das Profil übernimmt das Bild erst beim ausdrücklichen Speichern. */
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Das Referenzbild konnte nicht sicher hochgeladen werden.",
      },
      { status: 400 },
    );
  }
}
