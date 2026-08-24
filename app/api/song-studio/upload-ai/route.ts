import { head } from "@vercel/blob";
import { nanoid } from "nanoid";
import { NextRequest, NextResponse } from "next/server";

import {
  startAceDataUploadedEdit,
  uploadAceDataReferenceAudio,
} from "@/lib/acedata-suno";
import { createSongAccessToken } from "@/lib/song-access";
import { songEditStore } from "@/lib/song-edit-store";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import { reserveSubscriptionUsage } from "@/lib/song-subscription-usage";
import {
  createSignedProviderAudioUrl,
  isSongStudioUploadPathname,
  SONG_STUDIO_MAX_AUDIO_BYTES,
} from "@/lib/song-studio-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;

  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const pathname = typeof body.pathname === "string" ? body.pathname.trim() : "";
  const mode = body.mode === "extend" ? "extend" : body.mode === "cover" ? "cover" : "";
  const instruction = typeof body.instruction === "string"
    ? body.instruction.trim().slice(0, 1_000)
    : "";
  const lyrics = typeof body.lyrics === "string"
    ? body.lyrics.trim().slice(0, 12_000)
    : "";
  const title = typeof body.title === "string"
    ? body.title.trim().slice(0, 200)
    : "Eigener Song";
  const continueAtSeconds = Number(body.continueAtSeconds);
  const durationSeconds = Number(body.durationSeconds);

  if (!isSongStudioUploadPathname(pathname)) {
    return NextResponse.json({ error: "Die hochgeladene Audiodatei ist ungültig." }, { status: 400 });
  }

  if (!mode || !instruction) {
    return NextResponse.json({ error: "Wähle eine KI-Aktion und beschreibe die gewünschte Änderung." }, { status: 400 });
  }

  if (body.rightsConfirmed !== true) {
    return NextResponse.json({ error: "Bitte bestätige, dass du die Audiodatei verwenden und bearbeiten darfst." }, { status: 400 });
  }

  if (
    mode === "extend" &&
    (!Number.isFinite(continueAtSeconds) ||
      continueAtSeconds < 1 ||
      (Number.isFinite(durationSeconds) && continueAtSeconds > durationSeconds))
  ) {
    return NextResponse.json({ error: "Der gewählte Zeitpunkt für die Erweiterung ist ungültig." }, { status: 400 });
  }

  const subscription = await getActiveSongSubscription(request).catch(() => null);
  if (!subscription) {
    return NextResponse.json({ error: "Für KI-Bearbeitungen brauchst du ein aktives Song-Abo." }, { status: 401 });
  }

  try {
    const metadata = await head(pathname);
    if (!metadata || metadata.size < 1_000 || metadata.size > SONG_STUDIO_MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Die Audiodatei ist leer oder größer als 200 MB." }, { status: 400 });
    }

    const reservation = await reserveSubscriptionUsage({
      subscriptionId: subscription.subscriptionId,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
      kind: "edits",
      limit: subscription.plan.aiEditsPerMonth,
    });

    if (!reservation.allowed) {
      return NextResponse.json(
        {
          error: "Dein Kontingent für KI-Bearbeitungen ist diesen Monat aufgebraucht. Manuelle Bearbeitungen und Exporte bleiben verfügbar.",
        },
        { status: 409 },
      );
    }

    const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
    const providerUrl = createSignedProviderAudioUrl(appUrl, pathname);
    const uploaded = await uploadAceDataReferenceAudio(providerUrl);
    const started = await startAceDataUploadedEdit({
      audioId: uploaded.audioId,
      action: mode === "cover" ? "upload_cover" : "upload_extend",
      instruction,
      continueAtSeconds: mode === "extend" ? continueAtSeconds : undefined,
      lyrics: lyrics || undefined,
      title,
    });

    const editId = nanoid();
    const access = createSongAccessToken();
    const now = Date.now();
    const startSeconds = mode === "extend" ? continueAtSeconds : 0;
    const endSeconds = Number.isFinite(durationSeconds)
      ? Math.max(startSeconds + 0.1, durationSeconds)
      : startSeconds + 0.1;

    await songEditStore.set(editId, {
      status: "processing",
      sourceJobId: `upload:${pathname}`,
      subscriptionId: subscription.subscriptionId,
      accessTokenHash: access.hash,
      startSeconds,
      endSeconds,
      instruction,
      providerTaskId: started.taskId,
      providerTraceId: started.traceId,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      editId,
      editToken: access.token,
      mode,
      editsRemaining: reservation.remaining,
    });
  } catch (error) {
    console.error("KI-Bearbeitung eines eigenen Uploads fehlgeschlagen:", error);
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message.slice(0, 600)
          : "Die KI-Bearbeitung konnte nicht gestartet werden.",
      },
      { status: 500 },
    );
  }
}
