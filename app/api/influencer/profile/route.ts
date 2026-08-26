import { NextResponse } from "next/server";

import { isVoiceoverVoiceName } from "@/lib/audio-options";
import {
  hasPrivateInfluencerAccess,
  isOwnedInfluencerImagePath,
  PRIVATE_INFLUENCER_IMAGE_TYPES,
  PRIVATE_INFLUENCER_MAX_IMAGES,
  privateInfluencerStore,
  privateInfluencerUploadPrefix,
  type PrivateInfluencerImage,
} from "@/lib/private-influencer";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileInput = {
  displayName?: unknown;
  appearance?: unknown;
  personality?: unknown;
  contentStyle?: unknown;
  audience?: unknown;
  defaultCallToAction?: unknown;
  voiceName?: unknown;
  images?: unknown;
};

function cleanText(value: unknown, maximumLength: number, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} fehlt.`);
  }

  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error(`${field} fehlt.`);
  if (clean.length > maximumLength) {
    throw new Error(`${field} ist zu lang.`);
  }

  return clean;
}

function readImages(userId: string, value: unknown): PrivateInfluencerImage[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error("Lade mindestens ein festes Referenzbild hoch.");
  }

  if (value.length > PRIVATE_INFLUENCER_MAX_IMAGES) {
    throw new Error("Du kannst höchstens drei feste Referenzbilder speichern.");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Eine Bildreferenz ist ungültig.");
    }

    const image = entry as Record<string, unknown>;
    const pathname = typeof image.pathname === "string" ? image.pathname.trim() : "";
    const name = typeof image.name === "string" ? image.name.trim().slice(0, 120) : "Referenzbild";
    const mimeType = typeof image.mimeType === "string" ? image.mimeType.trim() : "";

    if (
      !isOwnedInfluencerImagePath(userId, pathname) ||
      !PRIVATE_INFLUENCER_IMAGE_TYPES.includes(
        mimeType as (typeof PRIVATE_INFLUENCER_IMAGE_TYPES)[number],
      )
    ) {
      throw new Error("Eine Bildreferenz ist ungültig.");
    }

    return { pathname, name: name || "Referenzbild", mimeType };
  });
}

async function requireOwner() {
  const user = await getCurrentUser();
  if (!user) return { error: "Bitte melde dich zuerst an.", status: 401 as const };
  if (!hasPrivateInfluencerAccess(user.email)) {
    return { error: "Dieser private Bereich ist für dein Konto nicht freigeschaltet.", status: 403 as const };
  }
  return { user };
}

export async function GET() {
  const access = await requireOwner();
  if (!("user" in access) || !access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const profile = await privateInfluencerStore.get(access.user.id);
  return NextResponse.json({
    access: true,
    uploadPrefix: privateInfluencerUploadPrefix(access.user.id),
    profile: profile
      ? {
          ...profile,
          imageUrls: profile.images.map(
            (_image, index) => `/api/influencer/image/${index}?v=${profile.updatedAt}`,
          ),
        }
      : null,
  });
}

export async function PUT(request: Request) {
  try {
    const access = await requireOwner();
    if (!("user" in access) || !access.user) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as ProfileInput;
    if (!isVoiceoverVoiceName(body.voiceName)) {
      throw new Error("Wähle eine gültige feste Stimme aus.");
    }

    const profile = {
      displayName: cleanText(body.displayName, 60, "Der Name"),
      appearance: cleanText(body.appearance, 800, "Die Beschreibung des Aussehens"),
      personality: cleanText(body.personality, 500, "Die Persönlichkeit"),
      contentStyle: cleanText(body.contentStyle, 500, "Der Content-Stil"),
      audience: cleanText(body.audience, 300, "Die Zielgruppe"),
      defaultCallToAction: cleanText(body.defaultCallToAction, 220, "Der Standard-Aufruf"),
      voiceName: body.voiceName,
      images: readImages(access.user.id, body.images),
      updatedAt: Date.now(),
    };

    await privateInfluencerStore.set(access.user.id, profile);
    return NextResponse.json({ success: true, profile });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Der KI-Influencer konnte nicht gespeichert werden.",
      },
      { status: 400 },
    );
  }
}
