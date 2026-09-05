"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import Header from "@/components/Header";
import { ImageIcon, LoadingIcon, MusicIcon, SparklesIcon } from "@/components/Icons";

type SongMediaVersion = { number: number; title: string; audioUrl: string; downloadUrl: string; audioMimeType?: string; audioExtension?: "m4a" | "mp3"; audioFormatLabel?: "M4A" | "MP3"; imageUrl?: string; studioUrl?: string };
type MediaItem = { kind: "song" | "video" | "image"; jobId: string; title: string; createdAt: number; status: "pending" | "processing" | "done" | "error"; progress?: number; ready: boolean; mediaUrl?: string; downloadUrl?: string; studioUrl?: string; songVersions?: SongMediaVersion[]; retryUrl?: string; errorMessage?: string };
type AccountData = { configured: boolean; authenticated: boolean; email?: string; privateInfluencerAccess?: boolean; media?: MediaItem[]; subscription?: null | { planName: string; songsRemaining: number; editsRemaining: number; renewsAt: number; cancelAtPeriodEnd: boolean }; videoSubscription?: null | { planName: string; videoSecondsRemaining: number; studioEditsRemaining: number; renewsAt: number; cancelAtPeriodEnd: boolean } };

export default function AccountDashboard() {
  const [data, setData] = useState<AccountData | null>(null);
  const [filter, setFilter] = useState<"all" | MediaItem["kind"]>("all");
  useEffect(() => { void fetch("/api/account", { cache: "no-store" }).then((response) => response.json()).then(setData).catch(() => setData({ configured: true, authenticated: false })); }, []);
  const items = useMemo(() => (data?.media ?? []).filter((item) => filter === "all" || item.kind === filter), [data?.media, filter]);
  if (!data) return <Shell><div className="flex min-h-[65vh] items-center justify-center text-violet-200"><LoadingIcon className="animate-spin" /></div></Shell>;
  if (!data.authenticated) return <Shell><section className="mx-auto max-w-3xl py-16 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200"><SparklesIcon /></div><h1 className="mt-6 text-4xl font-semibold">Dein persönlicher Bereich</h1><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-zinc-400">Melde dich an oder registriere dich kostenlos, damit dein Abo und alle neuen Songs, Videos und Bilder dauerhaft gespeichert werden.</p><a href="/anmelden?next=/konto" className="mt-7 inline-flex rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-3 text-sm font-semibold">Anmelden oder registrieren</a>{!data.configured && <p className="mt-4 text-xs text-amber-300">Die Kundenanmeldung wird gerade eingerichtet.</p>}</section></Shell>;
  return <Shell>
    <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200">Mein KI Studio</div><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">Meine Inhalte</h1><p className="mt-2 text-sm text-zinc-500">{data.email}</p></div><form action="/api/auth/signout" method="post"><button className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-zinc-300">Abmelden</button></form></section>
    <section className="mt-8 rounded-3xl border border-fuchsia-400/20 bg-gradient-to-r from-fuchsia-500/[0.1] to-violet-500/[0.05] p-6">{data.subscription ? <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">Song-Abo aktiv</p><h2 className="mt-2 text-2xl font-semibold">{data.subscription.planName}</h2><p className="mt-2 text-sm text-zinc-400"><strong className="text-white">{data.subscription.songsRemaining}</strong> Songs · <strong className="text-white">{data.subscription.editsRemaining}</strong> KI-Bearbeitungen übrig</p><p className="mt-1 text-[11px] text-zinc-500">{data.subscription.cancelAtPeriodEnd ? "Endet" : "Neues Kontingent"} am {new Date(data.subscription.renewsAt).toLocaleDateString("de-DE")}</p></div><button type="button" onClick={() => void fetch("/api/song-subscription-portal", { method: "POST" }).then((response) => response.json()).then((value) => { if (value.url) window.location.href = value.url; })} className="rounded-xl border border-white/10 px-4 py-3 text-xs font-semibold">Abo verwalten</button></div> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-lg font-semibold">Noch kein Song-Abo</p><p className="mt-1 text-sm text-zinc-400">Wähle ein Paket und nutze das vollständige Sound Studio.</p></div><a href="/ki-song-erstellen#song-abos" className="rounded-xl bg-fuchsia-600 px-4 py-3 text-xs font-semibold">Abos ansehen</a></div>}</section>
    <section className="mt-5 rounded-3xl border border-blue-400/20 bg-gradient-to-r from-blue-500/[0.1] to-violet-500/[0.05] p-6">{data.videoSubscription ? <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Video-Abo aktiv</p><h2 className="mt-2 text-2xl font-semibold">{data.videoSubscription.planName}</h2><p className="mt-2 text-sm text-zinc-400"><strong className="text-white">Bis zu {formatVideoMinutes(data.videoSubscription.videoSecondsRemaining)} mit Veo Fast</strong> · <strong className="text-white">{data.videoSubscription.studioEditsRemaining}</strong> Studio-Exporte übrig</p><p className="mt-1 text-[11px] text-zinc-500">{data.videoSubscription.cancelAtPeriodEnd ? "Endet" : "Neues Kontingent"} am {new Date(data.videoSubscription.renewsAt).toLocaleDateString("de-DE")}</p></div><div className="flex flex-wrap gap-2"><a href="/video-studio" className="rounded-xl bg-blue-600 px-4 py-3 text-xs font-semibold">Video Studio</a><button type="button" onClick={() => void fetch("/api/video-subscription-portal", { method: "POST" }).then((response) => response.json()).then((value) => { if (value.url) window.location.href = value.url; })} className="rounded-xl border border-white/10 px-4 py-3 text-xs font-semibold">Abo verwalten</button></div></div> : <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-lg font-semibold">Noch kein Video-Abo</p><p className="mt-1 text-sm text-zinc-400">Erstelle Videos aus deinem Kontingent und bearbeite sie im Video Studio.</p></div><a href="/ki-video-erstellen#video-abos" className="rounded-xl bg-blue-600 px-4 py-3 text-xs font-semibold">Video-Abos ansehen</a></div>}</section>
    {data.privateInfluencerAccess && <section className="mt-5 overflow-hidden rounded-3xl border border-violet-400/25 bg-gradient-to-r from-violet-500/[0.16] via-fuchsia-500/[0.08] to-blue-500/[0.1] p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-violet-300">Privat · nur für dein Konto</p><h2 className="mt-2 text-2xl font-semibold">Mein KI-Influencer</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Speichere Gesicht, Auftreten und Stimme einmal. Danach bereitest du jeden Tag mit nur einem Thema einen neuen Social-Media-Beitrag vor.</p></div><a href="/mein-ki-influencer" className="shrink-0 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-xs font-semibold">Privaten Creator öffnen</a></div></section>}
    <section className="mt-10"><div className="flex flex-wrap gap-2">{(["all", "song", "video", "image"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-xl px-4 py-2 text-xs font-semibold ${filter === value ? "bg-violet-600 text-white" : "border border-white/10 text-zinc-400"}`}>{value === "all" ? "Alle" : value === "song" ? "Songs" : value === "video" ? "Videos" : "Bilder"}</button>)}</div>
      {items.length === 0 ? <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.025] p-10 text-center"><p className="text-lg font-semibold">Noch keine Inhalte gespeichert</p><p className="mt-2 text-sm text-zinc-500">Neue Bestellungen erscheinen nach der Zahlung automatisch hier.</p><a href="/" className="mt-5 inline-flex text-sm font-semibold text-violet-300">Jetzt etwas erstellen →</a></div> : <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <MediaCard key={`${item.kind}:${item.jobId}`} item={item} />)}</div>}
    </section>
  </Shell>;
}

function MediaCard({ item }: { item: MediaItem }) {
  const working = item.status === "pending" || item.status === "processing";
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const songVersions = item.kind === "song"
    ? item.songVersions?.length
      ? item.songVersions
      : item.mediaUrl && item.downloadUrl
        ? [{ number: 1, title: item.title, audioUrl: item.mediaUrl, downloadUrl: item.downloadUrl, studioUrl: item.studioUrl }]
        : []
    : [];

  async function retrySong() {
    if (!item.retryUrl || retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      const response = await fetch(item.retryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: item.jobId }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Der Song konnte nicht neu gestartet werden.");
      }
      window.location.reload();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "Der Song konnte nicht neu gestartet werden.");
      setRetrying(false);
    }
  }

  return <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
    {item.ready && item.kind === "song" && songVersions.length > 0 ? <div className={`grid gap-3 bg-black/20 p-3 ${songVersions.length > 1 ? "sm:grid-cols-2" : ""}`}>{songVersions.map((version) => { const formatLabel = version.audioFormatLabel ?? (version.audioMimeType?.includes("mp4") ? "M4A" : "MP3"); return <div key={version.number} className="overflow-hidden rounded-2xl border border-white/10 bg-black/25"><div className="relative aspect-square bg-gradient-to-br from-fuchsia-500/20 to-violet-500/20">{version.imageUrl ? <Image src={version.imageUrl} alt={`Cover von ${version.title}`} fill unoptimized sizes="(min-width: 1280px) 180px, (min-width: 768px) 220px, 90vw" className="object-cover" /> : <div className="absolute inset-0 flex items-center justify-center"><MusicIcon className="text-fuchsia-300" /></div>}<span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[9px] font-semibold">Version {version.number}</span></div><div className="p-3"><p className="truncate text-xs font-semibold">{version.title}</p><audio aria-label={`${version.title} anhören`} src={version.audioUrl} controls preload="metadata" className="mt-3 h-9 w-full" /><div className="mt-3 flex flex-wrap gap-2"><a href={version.downloadUrl} className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-200">{formatLabel} laden</a>{version.studioUrl && <a href={version.studioUrl} className="rounded-lg bg-fuchsia-600 px-2.5 py-2 text-[10px] font-semibold">Bearbeiten</a>}</div></div></div>; })}</div> : <div className="relative flex aspect-video items-center justify-center bg-black/30">{item.ready && item.kind === "image" && item.mediaUrl ? <Image src={item.mediaUrl} alt={item.title} fill unoptimized sizes="(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw" className="object-cover" /> : item.ready && item.kind === "video" ? <video src={item.mediaUrl} controls preload="metadata" className="h-full w-full object-contain" /> : <div className="text-center text-zinc-500">{working ? <LoadingIcon className="mx-auto animate-spin" /> : item.kind === "image" ? <ImageIcon className="mx-auto" /> : <MusicIcon className="mx-auto" />}<p className="mt-3 text-xs">{working ? `${item.progress ?? 0} % erstellt` : "Erstellung unterbrochen"}</p></div>}</div>}
    <div className="p-5"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">{item.kind === "song" ? "Song" : item.kind === "video" ? "Video" : "Bild"}</span><span className="text-[10px] text-zinc-600">{new Date(item.createdAt).toLocaleDateString("de-DE")}</span></div><h3 className="mt-2 truncate font-semibold">{item.title}</h3>{item.errorMessage && <p className="mt-3 text-xs leading-5 text-red-200/80">{item.errorMessage}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{item.kind !== "song" && item.downloadUrl && <a href={item.downloadUrl} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-200">Herunterladen</a>}{item.kind !== "song" && item.studioUrl && <a href={item.studioUrl} className={`rounded-lg px-3 py-2 text-xs font-semibold ${item.kind === "video" ? "bg-blue-600" : "bg-fuchsia-600"}`}>{item.kind === "video" ? "Video Studio" : "Sound Studio"}</a>}{item.retryUrl && <button type="button" onClick={() => void retrySong()} disabled={retrying} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-xs font-semibold disabled:opacity-50">{retrying ? "Wird neu gestartet …" : "Ohne neue Berechnung wiederholen"}</button>}</div>{retryError && <p className="mt-3 text-xs text-red-300">{retryError}</p>}
    </div>
  </article>;
}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[#07070b] text-white"><Header active="account" /><div className="mx-auto max-w-7xl px-5 pb-20 pt-12 sm:px-8">{children}</div></main>; }

function formatVideoMinutes(seconds: number): string { const minutes = seconds / 60; return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(minutes)} ${minutes === 1 ? "Video-Minute" : "Video-Minuten"}`; }
