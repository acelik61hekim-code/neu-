import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { startAceDataReplaceSection } from "@/lib/acedata-suno";
import { canAccessSong, createSongAccessToken, matchesSongAccessToken } from "@/lib/song-access";
import { songEditStore } from "@/lib/song-edit-store";
import {
  getGeneratedSongVersion,
  songStore,
} from "@/lib/song-store";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import { reserveSubscriptionUsage } from "@/lib/song-subscription-usage";
import { getCurrentUser } from "@/lib/supabase/server";

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
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const sourceAccessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const sourceEditId = typeof body.sourceEditId === "string" ? body.sourceEditId.trim() : "";
  const sourceEditToken = typeof body.sourceEditToken === "string" ? body.sourceEditToken.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 1_000) : "";
  const lyrics = typeof body.lyrics === "string" ? body.lyrics.trim().slice(0, 4_000) : "";
  const startSeconds = Number(body.startSeconds);
  const endSeconds = Number(body.endSeconds);
  const requestedVersion =
    typeof body.sourceVersion === "number" ||
    typeof body.sourceVersion === "string"
      ? String(body.sourceVersion)
      : "1";

  if (!jobId || !instruction) return NextResponse.json({ error: "Bitte beschreibe, wie die markierte Stelle klingen soll." }, { status: 400 });
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 30) {
    return NextResponse.json({ error: "Markiere einen Abschnitt zwischen 1 und 30 Sekunden." }, { status: 400 });
  }

  const [job, subscription, user] = await Promise.all([
    songStore.get(jobId),
    getActiveSongSubscription(request).catch(() => null),
    getCurrentUser(),
  ]);
  if (!subscription) return NextResponse.json({ error: "Für KI-Bearbeitungen brauchst du ein aktives Song-Abo." }, { status: 401 });
  const accountOwner = Boolean(job?.userId && user?.id && job.userId === user.id);
  const selected = job
    ? getGeneratedSongVersion(
        job,
        requestedVersion,
      )
    : undefined;

  if (!job || (!canAccessSong(job, sessionId, sourceAccessToken) && !accountOwner) || !selected?.version.providerSongId) {
    return NextResponse.json({ error: "Der Ausgangssong konnte nicht sicher geöffnet werden." }, { status: 404 });
  }

  let providerSongId =
    selected.version
      .providerSongId;
  if (sourceEditId || sourceEditToken) {
    const sourceEdit = sourceEditId ? await songEditStore.get(sourceEditId) : undefined;
    if (!sourceEdit || sourceEdit.subscriptionId !== subscription.subscriptionId || sourceEdit.sourceJobId !== jobId || sourceEdit.status !== "done" || !sourceEdit.providerSongId || !matchesSongAccessToken(sourceEdit.accessTokenHash, sourceEditToken)) {
      return NextResponse.json({ error: "Die gewählte Studioversion konnte nicht geöffnet werden." }, { status: 403 });
    }
    providerSongId = sourceEdit.providerSongId;
  }

  const reservation = await reserveSubscriptionUsage({
    subscriptionId: subscription.subscriptionId,
    periodStart: subscription.periodStart,
    periodEnd: subscription.periodEnd,
    kind: "edits",
    limit: subscription.plan.aiEditsPerMonth,
  });
  if (!reservation.allowed) return NextResponse.json({ error: "Dein Kontingent für KI-Bearbeitungen ist diesen Monat aufgebraucht. Manuelle Bearbeitungen und Exporte bleiben verfügbar." }, { status: 409 });

  try {
    const started = await startAceDataReplaceSection({
      audioId: providerSongId,
      startSeconds,
      endSeconds,
      lyrics: lyrics || undefined,
      style: `${job.style}. Replace only the selected section. ${instruction}`,
      title: job.title,
    });
    const editId = nanoid();
    const access = createSongAccessToken();
    const now = Date.now();
    await songEditStore.set(editId, {
      status: "processing",
      sourceJobId: jobId,
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
    return NextResponse.json({ editId, editToken: access.token, editsRemaining: reservation.remaining });
  } catch (error) {
    console.error("Songabschnitt konnte nicht neu generiert werden:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Die KI-Bearbeitung konnte nicht gestartet werden." }, { status: 500 });
  }
}
