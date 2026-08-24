"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import Header from "@/components/Header";
import { FilmIcon, LoadingIcon, LockIcon, SparklesIcon, WarningIcon } from "@/components/Icons";
import { getVideoModel, getVideoOutputSecondsForQuota } from "@/lib/pricing";
import type { VideoModelId } from "@/types/story";

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
  videoModel: VideoModelId;
  videoModelName: string;
  videoSecondsRemaining: number;
  studioEditsRemaining: number;
  scenes: StudioScene[];
  sceneRenders: SceneRender[];
  versions: StudioVersion[];
};

type StudioScene = {
  number: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

type SceneRender = {
  id: string;
  versionId: string;
  sceneNumber: number;
  status: "generating" | "finalizing" | "done" | "error";
  instruction: string;
  errorMessage?: string;
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
  const [selectedSceneNumber, setSelectedSceneNumber] = useState(1);
  const [sceneInstruction, setSceneInstruction] = useState("");
  const [regeneratingScene, setRegeneratingScene] = useState(false);
  const [sceneProgress, setSceneProgress] = useState("");
  const [playerUrl, setPlayerUrl] = useState("");
  const [playerTitle, setPlayerTitle] = useState("Originalvideo");
  const playerRef = useRef<HTMLVideoElement>(null);

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
        setSelectedSceneNumber(data.scenes[0]?.number ?? 1);
        setPlayerUrl(data.videoUrl);
        setError("");
        const activeRender = [...data.sceneRenders].reverse().find(
          (render) => render.status === "generating" || render.status === "finalizing",
        );
        if (activeRender) {
          setRegeneratingScene(true);
          setSelectedSceneNumber(activeRender.sceneNumber);
          setSceneProgress(activeRender.status === "finalizing"
            ? "Die neue Szene wird sauber in dein Video eingesetzt …"
            : "Die KI generiert deine neue Szene …");
          void pollScene(activeRender.id, data)
            .catch((reason) => {
              setError(reason instanceof Error ? reason.message : "Die Szene konnte nicht fertiggestellt werden.");
              setSceneProgress("");
            })
            .finally(() => setRegeneratingScene(false));
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Das Video konnte nicht geöffnet werden."))
      .finally(() => setLoading(false));
  }, [jobId]);

  const outputDuration = useMemo(
    () => Math.max(0.5, endSeconds - startSeconds) / playbackRate,
    [endSeconds, playbackRate, startSeconds],
  );

  const selectedScene = useMemo(
    () => source?.scenes.find((scene) => scene.number === selectedSceneNumber) ?? source?.scenes[0],
    [selectedSceneNumber, source],
  );

  function selectScene(scene: StudioScene) {
    setSelectedSceneNumber(scene.number);
    if (playerRef.current) {
      playerRef.current.currentTime = scene.startSeconds;
      void playerRef.current.play().catch(() => undefined);
    }
  }

  async function regenerateScene() {
    if (!source || !selectedScene || regeneratingScene) return;
    setRegeneratingScene(true);
    setSceneProgress("Szene wird an das KI-Modell übergeben …");
    setError("");

    try {
      const response = await fetch("/api/video-studio/regenerate-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: source.jobId,
          sceneNumber: selectedScene.number,
          instruction: sceneInstruction,
        }),
      });
      const data = await response.json() as {
        renderId?: string;
        videoSecondsRemaining?: number;
        error?: string;
      };
      if (!response.ok || !data.renderId) {
        throw new Error(data.error || "Die Szene konnte nicht gestartet werden.");
      }

      if (typeof data.videoSecondsRemaining === "number") {
        setSource((current) => current ? { ...current, videoSecondsRemaining: data.videoSecondsRemaining! } : current);
      }
      await pollScene(data.renderId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die Szene konnte nicht neu erstellt werden.");
      setSceneProgress("");
    } finally {
      setRegeneratingScene(false);
    }
  }

  async function pollScene(renderId: string, suppliedSource?: StudioSource) {
    const activeSource = suppliedSource ?? source;
    if (!activeSource) return;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 5_000));
      }

      const response = await fetch(
        `/api/video-studio/scene-status?jobId=${encodeURIComponent(activeSource.jobId)}&renderId=${encodeURIComponent(renderId)}`,
        { cache: "no-store" },
      );
      const data = await response.json() as {
        status?: "generating" | "finalizing" | "done" | "error";
        version?: StudioVersion;
        videoSecondsRemaining?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Der Szenenstatus konnte nicht geladen werden.");
      }
      if (data.status === "generating") {
        setSceneProgress("Die KI generiert deine neue Szene …");
        continue;
      }
      if (data.status === "finalizing") {
        setSceneProgress("Die neue Szene wird sauber in dein Video eingesetzt …");
        continue;
      }
      if (data.status === "done" && data.version) {
        const completedVersion = data.version;
        setSource((current) => current ? {
          ...current,
          videoSecondsRemaining: data.videoSecondsRemaining ?? current.videoSecondsRemaining,
          versions: [
            ...current.versions.filter((version) => version.id !== completedVersion.id),
            completedVersion,
          ],
        } : current);
        setPlayerUrl(completedVersion.videoUrl);
        setPlayerTitle(completedVersion.title);
        setSceneInstruction("");
        setSceneProgress("Fertig – die neue Version liegt unten bereit.");
        return;
      }
    }

    throw new Error("Die Generierung dauert länger als erwartet. Öffne das Video später erneut im Konto.");
  }

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
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">Wähle einzelne Szenen aus, generiere gezielte Änderungen neu und passe anschließend Schnitt, Tempo, Ton und Blenden für deine finale Version an.</p>
          </div>
          <a href="/konto" className="w-fit rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-zinc-200">Meine Videos öffnen</a>
        </div>

        {!jobId && <StudioOverview />}
        {loading && <div className="mt-10 flex min-h-[420px] items-center justify-center rounded-3xl border border-white/10 bg-white/[0.025] text-fuchsia-200"><LoadingIcon className="animate-spin" /></div>}
        {jobId && !loading && !source && locked && <StudioOverview message={error} />}
        {jobId && !loading && !source && !locked && (
          <section className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500/10 text-fuchsia-200"><WarningIcon /></div>
            <h2 className="mt-5 text-2xl font-semibold">Video konnte nicht geöffnet werden</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">{error}</p>
            <a href="/konto" className="mt-6 inline-flex rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold">Zu meinen Videos</a>
          </section>
        )}

        {source && (
          <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
            <section className="overflow-hidden rounded-3xl border border-white/10 bg-black/35">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div><p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300">{playerTitle}</p><p className="mt-1 text-sm font-medium">{source.title}</p></div>
                <span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400">{formatSeconds(source.durationSeconds)}</span>
              </div>
              <video ref={playerRef} key={playerUrl} src={playerUrl || source.videoUrl} controls playsInline preload="metadata" className="mx-auto block max-h-[680px] w-full bg-black object-contain" />
              <div className="border-t border-white/10 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">Szenen-Timeline</p><p className="mt-1 text-xs text-zinc-500">Wähle genau den Abschnitt, den du verändern möchtest.</p></div>
                  <button type="button" onClick={() => { setPlayerUrl(source.videoUrl); setPlayerTitle("Originalvideo"); }} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-zinc-300">Original ansehen</button>
                </div>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {source.scenes.map((scene) => (
                    <button key={scene.number} type="button" onClick={() => selectScene(scene)} className={`min-w-[130px] flex-1 rounded-xl border px-3 py-3 text-left transition ${selectedScene?.number === scene.number ? "border-fuchsia-400/55 bg-fuchsia-500/15 text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20"}`}>
                      <span className="block text-xs font-semibold">Szene {scene.number}</span>
                      <span className="mt-1 block text-[10px]">{formatTimestamp(scene.startSeconds)} – {formatTimestamp(scene.endSeconds)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
              <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-300">KI-Szenenwerkzeug</p><h2 className="mt-2 text-2xl font-semibold">Szene neu generieren</h2></div><span className="rounded-xl bg-blue-400/10 px-3 py-2 text-[10px] font-semibold text-blue-200">Nur im Video-Abo</span></div>
              <p className="mt-3 text-xs leading-5 text-zinc-400">Ändere nur die ausgewählte Szene. Figuren, Look und Format werden anhand des Originalbildes beibehalten; der vorhandene Ton bleibt erhalten.</p>
              {selectedScene && <div className="mt-4 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.07] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Szene {selectedScene.number}</p><p className="mt-1 text-[11px] text-zinc-400">{formatTimestamp(selectedScene.startSeconds)} – {formatTimestamp(selectedScene.endSeconds)}</p></div><span className="text-[11px] text-fuchsia-200">{source.videoModelName}</span></div></div>}
              <label className="mt-4 block text-xs font-medium text-zinc-300">Was soll anders werden?<textarea value={sceneInstruction} maxLength={700} onChange={(event) => setSceneInstruction(event.target.value)} placeholder="Beispiel: Die Orange legt das Handy sichtbar auf den Tisch. Auf dem Display ist eine eindeutige fremde Nachricht zu sehen, danach reagiert die Erdbeere schockiert." className="mt-2 min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/40" /></label>
              <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-500"><span>Noch {formatVideoMinutes(getVideoOutputSecondsForQuota(source.videoSecondsRemaining, source.videoModel))} mit {getVideoModel(source.videoModel).shortName}</span><span>8 Sek. je Neugenerierung</span></div>
              <button type="button" disabled={regeneratingScene || sceneInstruction.trim().length < 5} onClick={() => void regenerateScene()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{regeneratingScene ? <><LoadingIcon className="animate-spin" /> Szene wird erstellt …</> : `Szene ${selectedScene?.number ?? 1} neu generieren`}</button>
              {sceneProgress && <p className="mt-3 rounded-xl border border-blue-400/15 bg-blue-400/[0.06] px-4 py-3 text-xs leading-5 text-blue-200">{sceneProgress}</p>}

              <div className="my-7 h-px bg-white/10" />
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
          <section className="mt-8"><h2 className="text-2xl font-semibold">Deine Studio-Versionen</h2><div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{source.versions.map((version) => <article key={version.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"><video src={version.videoUrl} controls preload="metadata" className="aspect-video w-full bg-black object-contain" /><div className="p-4"><p className="font-medium">{version.title}</p><p className="mt-1 text-xs text-zinc-500">{formatSeconds(version.durationSeconds || 0)} · {new Date(version.createdAt).toLocaleDateString("de-DE")}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => { setPlayerUrl(version.videoUrl); setPlayerTitle(version.title); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200">Im Player ansehen</button><a href={version.downloadUrl} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-xs font-semibold">Herunterladen</a></div></div></article>)}</div></section>
        )}
      </div>
    </main>
  );
}

function StudioOverview({ message }: { message?: string }) {
  const demoScenes = ["Intro", "Konflikt", "Reaktion", "Auflösung", "Finale"];
  return <div className="mt-10"><section className="relative overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/[0.1] via-violet-500/[0.04] to-blue-500/[0.08] p-5 sm:p-8"><div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl" /><div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-2xl"><div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200"><LockIcon /> Nur mit Video-Abo freigeschaltet</div><h2 className="mt-5 text-3xl font-semibold tracking-tight">So sieht dein Video Studio aus</h2><p className="mt-3 text-sm leading-7 text-zinc-400">Du siehst jede Szene auf einer Timeline, wählst einen Abschnitt aus und beschreibst nur die gewünschte Änderung. Danach kannst du die neue Version schneiden, vertonen und exportieren.</p>{message && <p className="mt-3 text-xs text-amber-200">{message}</p>}<div className="mt-6 flex flex-wrap gap-3"><a href="/ki-video-erstellen#video-abos" className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3 text-sm font-semibold">Video-Abo auswählen</a><a href="/konto" className="rounded-xl border border-white/10 px-5 py-3 text-sm font-medium">Meine Videos öffnen</a></div></div><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-fuchsia-200"><FilmIcon /></div></div>
    <div className="relative mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]"><div className="overflow-hidden rounded-2xl border border-white/10 bg-[#090910] shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" /></div><span className="text-[10px] uppercase tracking-wider text-zinc-500">Projektvorschau</span></div><div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-[#171022] via-[#0d1424] to-[#091015]"><div className="absolute left-[15%] top-[18%] h-44 w-44 rounded-full bg-fuchsia-500/20 blur-3xl" /><div className="absolute bottom-[12%] right-[16%] h-40 w-40 rounded-full bg-blue-500/20 blur-3xl" /><div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-black/35 text-xl text-white">▶</div></div><div className="border-t border-white/10 p-4"><div className="mb-3 flex items-center justify-between text-[10px] text-zinc-500"><span>Szenen-Timeline</span><span>00:00 / 00:30</span></div><div className="flex gap-1.5">{demoScenes.map((scene, index) => <div key={scene} className={`min-w-0 flex-1 rounded-lg border px-2 py-3 ${index === 2 ? "border-fuchsia-400/55 bg-fuchsia-500/20" : "border-white/10 bg-white/[0.04]"}`}><span className={`block truncate text-[10px] font-semibold ${index === 2 ? "text-fuchsia-100" : "text-zinc-400"}`}>Szene {index + 1}</span><span className="mt-1 block truncate text-[9px] text-zinc-600">{scene}</span></div>)}</div></div></div>
      <div className="rounded-2xl border border-white/10 bg-[#0c0c13] p-5"><p className="text-[10px] font-semibold uppercase tracking-wider text-blue-300">Szene 3 ausgewählt</p><h3 className="mt-2 text-lg font-semibold">Szene neu generieren</h3><div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3 text-xs leading-5 text-zinc-500">„Zeige die Nachricht klar auf dem Handy. Danach schaut die Erdbeere schockiert zur Orange.“</div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl border border-white/10 p-3"><span className="block text-[10px] text-zinc-600">Modell</span><strong className="mt-1 block text-xs text-zinc-300">Veo Fast</strong></div><div className="rounded-xl border border-white/10 p-3"><span className="block text-[10px] text-zinc-600">Abschnitt</span><strong className="mt-1 block text-xs text-zinc-300">00:16–00:24</strong></div></div><button type="button" disabled className="mt-4 w-full rounded-xl bg-gradient-to-r from-blue-600/50 to-violet-600/50 px-4 py-3 text-xs font-semibold text-white/70">Szene neu generieren</button><div className="mt-5 border-t border-white/10 pt-5"><p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300">Schnitt & Ton</p><div className="mt-3 h-2 rounded-full bg-white/10"><div className="h-2 w-2/3 rounded-full bg-fuchsia-500/60" /></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[9px] text-zinc-500"><span className="rounded-lg bg-white/[0.04] py-2">Tempo</span><span className="rounded-lg bg-white/[0.04] py-2">Ton</span><span className="rounded-lg bg-white/[0.04] py-2">Blenden</span></div></div></div></div></section>
    <div className="mt-5 grid gap-4 md:grid-cols-3"><OverviewFeature title="Einzelne Szenen ändern" text="Wähle einen 8-Sekunden-Abschnitt aus und beschreibe nur die konkrete Änderung." /><OverviewFeature title="Kontinuität bewahren" text="Das Startbild der Szene dient der KI als Referenz für Figuren, Stil und Bildaufbau." /><OverviewFeature title="Mehrere Versionen" text="Speichere neue Varianten, vergleiche sie im Player und lade deinen finalen Schnitt herunter." /></div></div>;
}

function OverviewFeature({ title, text }: { title: string; text: string }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500/10 text-sm text-fuchsia-200">✓</div><h3 className="mt-4 text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-5 text-zinc-500">{text}</p></article>;
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

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatVideoMinutes(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))} Sek.`;
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(seconds / 60)} Min.`;
}
