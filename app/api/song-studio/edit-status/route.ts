import { NextRequest, NextResponse } from "next/server";

import { downloadAceDataAudio, getAceDataSongTask } from "@/lib/acedata-suno";
import { matchesSongAccessToken } from "@/lib/song-access";
import { songEditStore } from "@/lib/song-edit-store";
import { storeSongAudio } from "@/lib/song-generation";
import { getActiveSongSubscription } from "@/lib/song-subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const editId = request.nextUrl.searchParams.get("editId")?.trim() || "";
  const editToken = request.nextUrl.searchParams.get("edit_token")?.trim() || "";
  const [edit, subscription] = await Promise.all([
    editId ? songEditStore.get(editId) : undefined,
    getActiveSongSubscription(request).catch(() => null),
  ]);
  if (!edit || !subscription || edit.subscriptionId !== subscription.subscriptionId || !matchesSongAccessToken(edit.accessTokenHash, editToken)) {
    return NextResponse.json({ error: "Die Studioversion wurde nicht gefunden." }, { status: 404 });
  }
  if (edit.status === "done") return doneResponse(editId, editToken, edit);
  if (edit.status === "error") return NextResponse.json({ status: "error", error: edit.errorMessage || "Die KI-Bearbeitung ist fehlgeschlagen." });

  try {
    const task = await getAceDataSongTask(edit.providerTaskId);
    if (!task.finished) return NextResponse.json({ status: "processing" });
    const song = task.songs.find((candidate) => candidate.state?.toLowerCase() === "succeeded" && candidate.audio_url);
    if (!song?.audio_url) throw new Error("Der Musikdienst hat keine fertige Audiodatei geliefert.");
    const audio = await downloadAceDataAudio(song.audio_url);
    const audioUri = await storeSongAudio(`edit-${editId}`, audio, "audio/mpeg");
    const completed = { ...edit, status: "done" as const, providerSongId: song.id, audioUri, audioMimeType: "audio/mpeg", updatedAt: Date.now() };
    await songEditStore.set(editId, completed);
    return doneResponse(editId, editToken, completed);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 600) : "Die KI-Bearbeitung ist fehlgeschlagen.";
    await songEditStore.set(editId, { ...edit, status: "error", errorMessage: message, updatedAt: Date.now() });
    return NextResponse.json({ status: "error", error: message });
  }
}
function doneResponse(editId: string, editToken: string, edit: { startSeconds: number; endSeconds: number }) {
  return NextResponse.json({
    status: "done",
    startSeconds: edit.startSeconds,
    endSeconds: edit.endSeconds,
    audioUrl: `/api/song-studio/edit-audio/${encodeURIComponent(editId)}?edit_token=${encodeURIComponent(editToken)}`,
  });
}
