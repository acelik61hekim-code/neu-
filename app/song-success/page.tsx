"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

import Header from "@/components/Header";
import { LoadingIcon, MusicIcon, SparklesIcon, WarningIcon } from "@/components/Icons";

type SongStatus = {
  status?: "pending" | "processing" | "done" | "error";
  paymentStatus?: "unpaid" | "paid" | "failed" | "refunded";
  renderStage?: "queued" | "generating" | "quality-check" | "uploading" | "completed" | "failed";
  progressPercent?: number;
  title?: string;
  length?: "clip" | "full2" | "full3" | "full4";
  lyricsMode?: "instrumental" | "ai" | "custom";
  generatedLyrics?: string;
  audioUrl?: string;
  imageUrl?: string;
  studioUrl?: string;
  versions?: Array<{
    number: number;
    title: string;
    durationSeconds?: number;
    audioUrl: string;
    downloadUrl: string;
    imageUrl?: string;
    studioUrl?: string;
  }>;
  errorMessage?: string;
};

const stageLabels: Record<NonNullable<SongStatus["renderStage"]>, string> = {
  queued: "Dein Songauftrag wird vorbereitet",
  generating: "Komposition, Arrangement und Mix entstehen",
  "quality-check": "Aussprache, Lyrics und Gesangstempo werden geprüft",
  uploading: "Die fertigen MP3-Dateien werden bereitgestellt",
  completed: "Dein Song ist fertig",
  failed: "Die Songerstellung wurde unterbrochen",
};

export default function SongSuccessPage() {
  return <Suspense fallback={<Page status={{ status: "pending", progressPercent: 0 }} />}><SongSuccessContent /></Suspense>;
}

function SongSuccessContent() {
  const params = useSearchParams();
  const jobId = params.get("jobId");
  const sessionId = params.get("session_id");
  const accessToken = params.get("access_token");
  const [status, setStatus] = useState<SongStatus>({ status: "pending", progressPercent: 0 });
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || (!sessionId && !accessToken)) {
      setStatus({ status: "error", errorMessage: "Der sichere Link zu deinem Song ist unvollständig." });
      return;
    }
    let stopped = false;
    let confirmed = false;
    let claimed = false;
    let refreshing = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        if (!confirmed && sessionId) {
          const response = await fetch("/api/confirm-song-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, sessionId }),
          });
          const data = await response.json() as { error?: string };
          if (!response.ok && response.status !== 202) throw new Error(data.error || "Die Zahlung wird geprüft.");
          confirmed = true;
        }
        if (!claimed) {
          const claimResponse = await fetch("/api/account/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "song", jobId, sessionId: sessionId || undefined, accessToken: accessToken || undefined }),
          });
          claimed = claimResponse.ok || claimResponse.status === 401;
        }
        const accessQuery = sessionId
          ? `session_id=${encodeURIComponent(sessionId)}`
          : `access_token=${encodeURIComponent(accessToken!)}`;
        const response = await fetch(`/api/song-status?jobId=${encodeURIComponent(jobId)}&${accessQuery}`, { cache: "no-store" });
        const data = await response.json() as SongStatus & { error?: string };
        if (!response.ok) throw new Error(data.error || "Der Songstatus konnte nicht geladen werden.");
        if (stopped) return;
        setStatus(data);
        setConnectionError(null);
        if ((data.status === "done" || data.status === "error") && interval) clearInterval(interval);
      } catch (error) {
        if (!stopped) setConnectionError(error instanceof Error ? error.message : "Die Verbindung wird wiederhergestellt.");
      } finally {
        refreshing = false;
      }
    };

    void refresh();
    interval = setInterval(() => void refresh(), 4000);
    return () => { stopped = true; if (interval) clearInterval(interval); };
  }, [jobId, sessionId, accessToken]);

  return <Page status={status} connectionError={connectionError} />;
}

function Page({ status, connectionError }: { status: SongStatus; connectionError?: string | null }) {
  const state = status.status ?? "pending";
  const working = state === "pending" || state === "processing";
  const done = state === "done";
  const progress = Math.max(0, Math.min(100, status.progressPercent ?? 0));
  const stage = status.renderStage ? stageLabels[status.renderStage] : "Deine Zahlung wird bestätigt";
  const songVersions =
    status.versions?.length
      ? status.versions
      : status.audioUrl
        ? [
            {
              number: 1,
              title:
                status.title ||
                "Dein KI-Song",
              audioUrl:
                status.audioUrl,
              downloadUrl:
                `${status.audioUrl}&download=1`,
              imageUrl:
                status.imageUrl,
              studioUrl:
                status.studioUrl,
            },
          ]
        : [];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0"><div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-fuchsia-700/20 blur-[140px]" /><div className="absolute right-[-180px] top-[120px] h-[420px] w-[420px] rounded-full bg-violet-700/15 blur-[140px]" /><div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" /></div>
      <Header active="song" />

      <div className="relative z-10 mx-auto max-w-4xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <section className="mx-auto mb-10 max-w-3xl text-center">
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${done ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : state === "error" ? "border-red-400/20 bg-red-400/10 text-red-200" : "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-200"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-300" : state === "error" ? "bg-red-300" : "animate-pulse bg-fuchsia-300"}`} />
            {done ? "Song fertiggestellt" : state === "error" ? "Erstellung unterbrochen" : "KI-Song wird erstellt"}
          </div>
          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            {done ? "Dein Song ist " : state === "error" ? "Das hat noch nicht " : "Deine Idee wird jetzt "}
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">{done ? "bereit" : state === "error" ? "geklappt" : "zu Musik"}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400">{done ? songVersions.length > 1 ? "Höre dir beide erstellten Song-Versionen an und lade deine Favoriten herunter." : "Höre deinen Song direkt an oder lade die MP3 herunter." : state === "error" ? "Dein Auftrag ist sicher gespeichert. Unten findest du weitere Informationen." : "Du kannst die Seite geöffnet lassen. Der Status aktualisiert sich automatisch."}</p>
        </section>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-7">
            <div className="flex items-center gap-3">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${done ? "bg-emerald-400/10 text-emerald-300" : state === "error" ? "bg-red-400/10 text-red-300" : "bg-gradient-to-br from-fuchsia-500/25 to-violet-500/25 text-fuchsia-200"}`}>
                {working ? <LoadingIcon className="animate-spin" /> : state === "error" ? <WarningIcon /> : <MusicIcon />}
              </div>
              <div><p className="text-xs font-medium uppercase tracking-wider text-fuchsia-300">Songstatus</p><h2 className="mt-1 text-lg font-semibold">{stage}</h2></div>
            </div>
            <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-300">{done ? "100 %" : `${progress} %`}</span>
          </div>

          <div className="p-5 sm:p-7">
            {working && <div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 transition-[width] duration-700" style={{ width: `${Math.max(progress, 3)}%` }} /></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><Step complete={status.paymentStatus === "paid"} active={status.paymentStatus !== "paid"} title="Zahlung" text="Sicher bestätigt" /><Step complete={progress >= 85} active={progress < 85} title="Songerstellung" text="Zwei Versionen entstehen" /><Step complete={done} active={progress >= 85} title="MP3-Dateien" text="Downloads vorbereiten" /></div>{connectionError && <p className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/80">{connectionError} Dein Auftrag läuft unabhängig davon weiter.</p>}</div>}

            {done && songVersions.length > 0 && <div><div className={`grid gap-5 ${songVersions.length > 1 ? "md:grid-cols-2" : "mx-auto max-w-2xl"}`}>{songVersions.map((version) => <article key={version.number} className="overflow-hidden rounded-2xl border border-fuchsia-400/15 bg-gradient-to-br from-fuchsia-500/10 to-violet-500/5 text-left"><div className="relative aspect-square overflow-hidden bg-gradient-to-br from-fuchsia-600/25 via-violet-600/20 to-blue-600/20">{version.imageUrl ? <Image src={version.imageUrl} alt={`Cover von ${version.title}`} fill unoptimized sizes="(min-width: 768px) 420px, 90vw" className="object-cover" /> : <div className="absolute inset-0 flex items-center justify-center"><div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 shadow-2xl shadow-fuchsia-950/50"><MusicIcon className="h-8 w-8" /></div></div>}<span className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/55 px-3 py-1 text-xs font-semibold text-white backdrop-blur">Version {version.number}</span></div><div className="p-5 sm:p-6"><h3 className="truncate text-xl font-semibold">{version.title}</h3><p className="mt-1 text-xs text-zinc-500">{formatSongDuration(version.durationSeconds) || songLengthText(status.length)} · MP3</p><audio className="mt-5 w-full" controls preload="metadata" src={version.audioUrl} /><div className="mt-5 flex flex-wrap gap-2"><a className="inline-flex flex-1 items-center justify-center rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-semibold transition hover:bg-fuchsia-500" href={version.downloadUrl}>MP3 herunterladen</a>{version.studioUrl && <a className="inline-flex items-center justify-center rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.07] px-4 py-3 text-sm font-medium text-fuchsia-200 transition hover:bg-fuchsia-400/[0.12]" href={version.studioUrl}>Bearbeiten</a>}</div></div></article>)}</div>{status.generatedLyrics && status.lyricsMode !== "instrumental" && <details className="mx-auto mt-6 max-w-2xl rounded-2xl border border-white/10 bg-black/20 p-5 text-left"><summary className="cursor-pointer text-sm font-medium text-fuchsia-200">Lyrics und Songstruktur anzeigen</summary><pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-400">{status.generatedLyrics}</pre></details>}</div>}

            {state === "error" && <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-5"><div className="flex items-start gap-3"><WarningIcon className="mt-0.5 text-red-300" /><div><p className="font-medium text-red-100">Die Songerstellung konnte nicht abgeschlossen werden.</p><p className="mt-2 text-sm leading-6 text-red-100/70">{status.errorMessage || "Bitte versuche es später erneut oder wende dich an den Support."}</p></div></div></div>}

            <div className="mt-7 flex flex-wrap justify-center gap-3 border-t border-white/10 pt-6"><a className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.07] px-4 py-2.5 text-sm font-medium text-fuchsia-200 transition hover:bg-fuchsia-400/[0.12]" href={status.studioUrl || "/ki-song-erstellen#song-abos"}>{status.studioUrl ? "Im Sound Studio bearbeiten" : "Sound Studio freischalten"}</a><a className="px-4 py-2.5 text-sm font-medium text-fuchsia-300 transition hover:text-fuchsia-200" href="/songs">Weiteren Song erstellen</a></div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Step({ active, complete, title, text }: { active: boolean; complete: boolean; title: string; text: string }) {
  return <div className={`rounded-2xl border p-4 ${active || complete ? "border-fuchsia-400/20 bg-fuchsia-400/[0.06]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${complete ? "bg-emerald-400/15 text-emerald-300" : active ? "bg-fuchsia-400/15 text-fuchsia-300" : "bg-white/5 text-zinc-600"}`}>{complete ? "✓" : active ? <SparklesIcon /> : "·"}</span><p className="text-sm font-medium">{title}</p></div><p className="mt-2 text-xs text-zinc-500">{text}</p></div>;
}

function songLengthText(length: SongStatus["length"]): string {
  void length;
  return "Vollständiger Song";
}

function formatSongDuration(
  durationSeconds?: number,
): string {
  if (
    typeof durationSeconds !==
      "number" ||
    !Number.isFinite(
      durationSeconds,
    ) ||
    durationSeconds <= 0
  ) {
    return "";
  }

  const rounded =
    Math.round(
      durationSeconds,
    );

  const minutes =
    Math.floor(
      rounded / 60,
    );

  const seconds =
    String(
      rounded % 60,
    ).padStart(2, "0");

  return `${minutes}:${seconds} Min.`;
}
