import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  hasPrivateInfluencerAccess,
  PRIVATE_INFLUENCER_IMAGE_TYPES,
  PRIVATE_INFLUENCER_MAX_IMAGE_BYTES,
  privateInfluencerStore,
  privateInfluencerUploadPrefix,
} from "@/lib/private-influencer";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Bitte melde dich zuerst an." },
        { status: 401 },
      );
    }
    if (!hasPrivateInfluencerAccess(user.email)) {
      return NextResponse.json(
        { error: "Dieser private Bereich ist für dein Konto nicht freigeschaltet." },
        { status: 403 },
      );
    }

    const rateLimit = await checkRateLimit(
      request,
      "private-influencer-image-upload-v2",
      12,
      60 * 60,
    );
    if (!rateLimit.allowed) {
      throw new Error("Zu viele Bild-Uploads in kurzer Zeit. Bitte versuche es später erneut.");
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Wähle ein gültiges Referenzbild aus.");
    }
    if (
      !PRIVATE_INFLUENCER_IMAGE_TYPES.includes(
        file.type as (typeof PRIVATE_INFLUENCER_IMAGE_TYPES)[number],
      )
    ) {
      throw new Error("Bitte verwende nur JPG-, PNG- oder WebP-Bilder.");
    }
    if (file.size < 1 || file.size > PRIVATE_INFLUENCER_MAX_IMAGE_BYTES) {
      throw new Error("Das vorbereitete Referenzbild ist zu groß.");
    }

    const safeName =
      file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100) ||
      "referenz.jpg";
    const pathname = `${privateInfluencerUploadPrefix(user.id)}${Date.now()}-${randomUUID()}-${safeName}`;
    const dataBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    await privateInfluencerStore.setImage(user.id, pathname, {
      dataBase64,
      mimeType: file.type,
    });

    return NextResponse.json({
      pathname,
      name: file.name.slice(0, 120) || "Referenzbild",
      mimeType: file.type,
    });
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
