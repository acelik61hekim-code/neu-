"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import Header from "@/components/Header";
import { FilmIcon, LoadingIcon, LockIcon, SparklesIcon, WarningIcon } from "@/components/Icons";

type StudioVersion = {
  id: string;
  title: string;
  createdAt: number;
  durationSeconds?: number;
  videoUrl: string;
  downloadUrl: string;
};

type StudioSource = {
  jobId: string;
  title: string;
  durationSeconds: number;
  videoUrl: string;
  studioEditsRemaining: number;
  versions: StudioVersion[];
};

export default function VideoStudio() {
  const jobId = useSearchParams().get("jobId") || "";
  const [source, setSource] = useState<StudioSource | null>(null);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("Meine Studio-Version");
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(15);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    void fetch(`/api/video-studio/source?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as StudioSource & { error?: string; locked?: boolean };
        if (!response.ok) {
          setLocked(Boolean(data.locked));
          throw new Error(data.error || "Das Video konnte nicht geöffnet werden.");
        }
        setSource(data);
        setEndSeconds(data.durationSeconds);
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Das Video konnte nicht geöffnet werden."))
      .finally(() => setLoading(false));
  }, [jobId]);

  const outputDuration = useMemo(
    () => Math.max(0.5, endSeconds - startSeconds) / playbackRate,
    [endSeconds, playbackRate, startSeconds],
  );

  async function exportVersion() {
    if (!source || exporting) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/video-studio/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: source.jobId,
          title,
          startSeconds,
          endSeconds,
          playbackRate,
          volume,
          muted,
          fadeInSeconds,
          fadeOutSeconds,
        }),
      });
      const data = await response.json() as {
        version?: StudioVersion;
        studioEditsRemaining?: number;
        error?: string;
      };
      if (!response.ok || !data.version) throw new Error(data.error || "Der Export konnte nicht erstellt werden.");
      setSource((current) => current ? {
        ...current,
        studioEditsRemaining: data.studioEditsRemaining ?? current.studioEditsRemaining,
        versions: [...current.versions, data.version!],
      } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Export konnte nicht erstellt werden.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#07070b] text-white">
      <Header />
      <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200"><SparklesIcon /> Pro Video Studio</div>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Dein Video. Dein finaler Schnitt.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">Schneide Anfang und Ende, ändere Tempo und Lautstärke, schalte den Ton stumm und setze professionelle Ein- und Ausblendungen.</p>
          </div>
          <a href="/konto" className="w-fit rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-zinc-200">Meine Videos öffnen</a>
        </div>

        {!jobId && <StudioEmpty />}
        {loading && <div className="mt-10 flex min-h-[420px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.025] text-fuchsia-200"><LoadingIcon className="animate-spin" /></div>}
        {jobId && !loading && !source && (
          <section className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/10 text-fuchsia-200">{locked ? <LockIcon /> : <WarningIcon />}</div>
            <h2 className="mt-5 text-2xl font-semibold">{locked ? "Video Studio im Abo freischalten" : "Video konnte nicht geöffnet werden"}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">{error}</p>
            <a href={locked ? "/ki-video-erstellen#video-abos" : "/konto"} className="mt-6 inline-flex rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold">{locked ? "Video-Abos ansehen" : "Zu meinen Videos"}</a>
          </section>
        )}

        {source && (
          <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
            <section className="overflow-hidden rounded-3xl border border-white/10 bg-black/35">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300">Originalvideo</p><p className="mt-1 text-sm font-medium">{source.title}</p></div>
                <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400">{formatSeconds(source.durationSeconds)}</span>
              </div>
              <video src={source.videoUrl} controls playsInline preload="metadata" className="mx-auto block max-h-[680px] w-full bg-black object-contain" />
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">Schnitt & Ton</p><h2 className="mt-2 text-2xl font-semibold">Export einstellen</h2></div><span className="rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300">{source.studioEditsRemaining} Exporte</span></div>

              <label className="mt-6 block text-xs font-medium text-zinc-300">Name der Version<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none focus:border-fuchsia-400/40" /></label>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <NumberField label="Start (Sek.)" value={startSeconds} min={0} max={Math.max(0, endSeconds - 0.5)} step={0.5} onChange={setStartSeconds} />
                <NumberField label="Ende (Sek.)" value={endSeconds} min={startSeconds + 0.5} max={source.durationSeconds} step={0.5} onChange={setEndSeconds} />
              </div>
              <label className="mt-5 block text-xs font-medium text-zinc-300">Geschwindigkeit<select value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111118] px-4 py-3 text-sm"><option value={0.5}>0,5× Zeitlupe</option><option value={0.75}>0,75×</option><option value={1}>1× Original</option><option value={1.25}>1,25×</option><option value={1.5}>1,5×</option><option value={2}>2×</option></select></label>
              <label className="mt-5 block text-xs font-medium text-zinc-300">Lautstärke: {muted ? "stumm" : `${Math.round(volume * 100)} %`}<input type="range" min={0} max={2} step={0.05} value={volume} disabled={muted} onChange={(event) => setVolume(Number(event.target.value))} className="mt-3 w-full accent-fuchsia-500" /></label>
              <label className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 px-4 py-3 text-sm text-zinc-300"><input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} className="h-4 w-4 accent-fuchsia-500" /> Ton vollständig entfernen</label>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <NumberField label="Einblenden" value={fadeInSeconds} min={0} max={5} step={0.5} onChange={setFadeInSeconds} suffix=" Sek." />
                <NumberField label="Ausblenden" value={fadeOutSeconds} min={0} max={5} step={0.5} onChange={setFadeOutSeconds} suffix=" Sek." />
              </div>
              <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-400"><div className="flex justify-between"><span>Neue Videolänge</span><strong className="text-white">{formatSeconds(outputDuration)}</strong></div><div className="mt-2 flex justify-between"><span>Qualität</span><strong className="text-white">H.264 · Studio Export</strong></div></div>
              <button type="button" disabled={exporting || source.studioEditsRemaining <= 0} onClick={() => void exportVersion()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3.5 text-sm font-semibold disabled:opacity-50">{exporting ? <><LoadingIcon className="animate-spin" /> Video wird exportiert …</> : "Neue Version exportieren"}</button>
              {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs leading-5 text-red-200">{error}</p>}
            </section>
          </div>
        )}

        {source && source.versions.length > 0 && (
          <section className="mt-8"><h2 className="text-2xl font-semibold">Deine Studio-Versionen</h2><div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{source.versions.map((version) => <article key={version.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"><video src={version.videoUrl} controls preload="metadata" className="aspect-video w-full bg-black object-contain" /><div className="p-4"><p className="font-medium">{version.title}</p><p className="mt-1 text-xs text-zinc-500">{formatSeconds(version.durationSeconds || 0)} · {new Date(version.createdAt).toLocaleDateString("de-DE")}</p><a href={version.downloadUrl} className="mt-4 inline-flex rounded-lg bg-fuchsia-600 px-3 py-2 text-xs font-semibold">Herunterladen</a></div></article>)}</div></section>
        )}
      </div>
    </main>
  );
}

function StudioEmpty() {
  return <section className="relative mt-10 overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/[0.1] via-violet-500/[0.04] to-blue-500/[0.08] p-8 sm:p-12"><div className="absolute right-8 top-8 text-fuchsia-300/20"><FilmIcon /></div><div className="max-w-2xl"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-fuchsia-200"><LockIcon /></div><h2 className="mt-6 text-3xl font-semibold">Das Video Studio ist bereit</h2><p className="mt-3 text-sm leading-7 text-zinc-400">Öffne ein fertiges Video in deinem Kundenkonto. Mit einem Video-Abo kannst du anschließend Schnitt, Tempo, Ton und Blenden einstellen und mehrere Versionen speichern.</p><div className="mt-7 flex flex-wrap gap-3"><a href="/konto" className="rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold">Video aus Konto wählen</a><a href="/ki-video-erstellen#video-abos" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-medium">Video-Abos ansehen</a></div></div></section>;
}

function NumberField({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="block text-xs font-medium text-zinc-300">{label}<div className="relative mt-2"><input type="number" value={Number(value.toFixed(2))} min={min} max={max} step={step} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value))))} className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 pr-11 text-sm outline-none focus:border-fuchsia-400/40" />{suffix && <span className="pointer-events-none absolute right-3 top-3 text-xs text-zinc-500">{suffix}</span>}</div></label>;
}

function formatSeconds(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")} Min.` : `${remainder} Sek.`;
}
