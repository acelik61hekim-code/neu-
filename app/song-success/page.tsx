"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  studioUrl?: string;
  errorMessage?: string;
};

const stageLabels: Record<NonNullable<SongStatus["renderStage"]>, string> = {
  queued: "Dein Songauftrag wird vorbereitet",
  generating: "Komposition, Arrangement und Mix entstehen",
  "quality-check": "Aussprache, Lyrics und Gesangstempo werden geprüft",
  uploading: "Die fertige MP3 wird bereitgestellt",
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
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400">{done ? "Höre deinen Song direkt an oder lade die MP3 herunter." : state === "error" ? "Dein Auftrag ist sicher gespeichert. Unten findest du weitere Informationen." : "Du kannst die Seite geöffnet lassen. Der Status aktualisiert sich automatisch."}</p>
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
            {working && <div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-blue-500 transition-[width] duration-700" style={{ width: `${Math.max(progress, 3)}%` }} /></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><Step complete={status.paymentStatus === "paid"} active={status.paymentStatus !== "paid"} title="Zahlung" text="Sicher bestätigt" /><Step complete={progress >= 85} active={progress < 85} title="Songerstellung" text="Komposition und Mix" /><Step complete={done} active={progress >= 85} title="MP3" text="Download vorbereiten" /></div>{connectionError && <p className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/80">{connectionError} Dein Auftrag läuft unabhängig davon weiter.</p>}</div>}

            {done && status.audioUrl && <div className="text-center"><div className="mx-auto max-w-2xl rounded-2xl border border-fuchsia-400/15 bg-gradient-to-br from-fuchsia-500/10 to-violet-500/5 p-6"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 shadow-2xl shadow-fuchsia-950/50"><MusicIcon className="h-8 w-8" /></div><h3 className="mt-5 text-xl font-semibold">{status.title || "Dein KI-Song"}</h3><p className="mt-1 text-xs text-zinc-500">{songLengthText(status.length)} · MP3</p><audio className="mt-6 w-full" controls preload="metadata" src={status.audioUrl} /><a className="mt-5 inline-flex items-center justify-center rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold transition hover:bg-fuchsia-500" href={`${status.audioUrl}&download=1`}>MP3 herunterladen</a></div>{status.generatedLyrics && status.lyricsMode !== "instrumental" && <details className="mx-auto mt-6 max-w-2xl rounded-2xl border border-white/10 bg-black/20 p-5 text-left"><summary className="cursor-pointer text-sm font-medium text-fuchsia-200">Lyrics und Songstruktur anzeigen</summary><pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-400">{status.generatedLyrics}</pre></details>}</div>}

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
  if (length === "clip") return "30-Sekunden-Song";
  if (length === "full2") return "2-Minuten-Vollsong";
  if (length === "full3") return "3-Minuten-Vollsong";
  if (length === "full4") return "4-Minuten-Vollsong";
  return "Vollständiger Song";
}
