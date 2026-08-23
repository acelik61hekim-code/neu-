"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Header from "@/components/Header";
import { LoadingIcon, LockIcon, MusicIcon, SparklesIcon } from "@/components/Icons";
import SongPlans from "@/components/SongPlans";

type StudioSource = {
  title: string;
  style: string;
  lyrics: string;
  audioUrl: string;
  canRegenerate: boolean;
  planName: string;
  editsRemaining: number;
};

type Version = {
  label: string;
  audioUrl: string;
  editId?: string;
  editToken?: string;
};

export default function SoundStudio() {
  const [source, setSource] = useState<StudioSource | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionIndex, setVersionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [needsSubscription, setNeedsSubscription] = useState(false);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(10);
  const [loopSelection, setLoopSelection] = useState(true);
  const [gainPercent, setGainPercent] = useState(100);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [replacementLyrics, setReplacementLyrics] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [editsRemaining, setEditsRemaining] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const params = useMemo(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search), []);
  const jobId = params.get("jobId") || "";
  const sessionId = params.get("session_id") || "";
  const accessToken = params.get("access_token") || "";
  const currentVersion = versions[versionIndex];

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      setError("Öffne das Sound Studio bitte über den Button bei deinem fertigen Song.");
      return;
    }
    const accessQuery = sessionId ? `session_id=${encodeURIComponent(sessionId)}` : `access_token=${encodeURIComponent(accessToken)}`;
    void fetch(`/api/song-studio/source?jobId=${encodeURIComponent(jobId)}&${accessQuery}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as StudioSource & { error?: string; needsSubscription?: boolean };
        if (!response.ok) {
          setNeedsSubscription(Boolean(data.needsSubscription));
          throw new Error(data.error || "Der Song konnte nicht geöffnet werden.");
        }
        setSource(data);
        setVersions([{ label: "Original", audioUrl: data.audioUrl }]);
        setEditsRemaining(data.editsRemaining);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Der Song konnte nicht geöffnet werden."))
      .finally(() => setLoading(false));
  }, [accessToken, jobId, sessionId]);

  useEffect(() => {
    if (!currentVersion?.audioUrl) return;
    let stopped = false;
    setAudioBuffer(null);
    void fetch(currentVersion.audioUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Die Audiodatei konnte nicht für die Wellenform geladen werden.");
        return response.arrayBuffer();
      })
      .then(async (bytes) => {
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(bytes.slice(0));
          if (stopped) return;
          setAudioBuffer(decoded);
          setDuration(decoded.duration);
          setSelectionStart(0);
          setSelectionEnd(Math.min(10, decoded.duration));
        } finally {
          await context.close();
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Die Audiodatei konnte nicht gelesen werden."));
    return () => { stopped = true; };
  }, [currentVersion?.audioUrl]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,0.035)";
    context.fillRect(0, 0, width, height);
    const startX = duration ? (selectionStart / duration) * width : 0;
    const endX = duration ? (selectionEnd / duration) * width : 0;
    context.fillStyle = "rgba(217,70,239,0.16)";
    context.fillRect(startX, 0, Math.max(2, endX - startX), height);
    const channel = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(channel.length / width));
    context.strokeStyle = "rgba(232,121,249,0.9)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x < width; x += 1) {
      let min = 1;
      let max = -1;
      const offset = Math.floor(x * samplesPerPixel);
      for (let index = 0; index < samplesPerPixel; index += 1) {
        const sample = channel[offset + index] ?? 0;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      context.moveTo(x, (1 + min) * height / 2);
      context.lineTo(x, (1 + max) * height / 2);
    }
    context.stroke();
    context.strokeStyle = "rgba(255,255,255,0.7)";
    context.beginPath(); context.moveTo(startX, 0); context.lineTo(startX, height); context.moveTo(endX, 0); context.lineTo(endX, height); context.stroke();
  }, [audioBuffer, duration, selectionEnd, selectionStart]);

  useEffect(() => {
    drawWaveform();
    window.addEventListener("resize", drawWaveform);
    return () => window.removeEventListener("resize", drawWaveform);
  }, [drawWaveform]);

  function playSelection() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = selectionStart;
    void audio.play();
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || audio.currentTime < selectionEnd) return;
    if (loopSelection) {
      audio.currentTime = selectionStart;
      void audio.play();
    } else {
      audio.pause();
    }
  }

  async function regenerateSelection() {
    if (!source || !instruction.trim()) {
      setError("Beschreibe bitte zuerst, wie die markierte Stelle verändert werden soll.");
      return;
    }
    if (selectionEnd - selectionStart < 1 || selectionEnd - selectionStart > 30) {
      setError("Markiere für die KI-Bearbeitung einen Abschnitt zwischen 1 und 30 Sekunden.");
      return;
    }
    setEditLoading(true);
    setEditMessage("Die neue Version wird komponiert …");
    setError("");
    try {
      const response = await fetch("/api/song-studio/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          sessionId: sessionId || undefined,
          accessToken: accessToken || undefined,
          sourceEditId: currentVersion?.editId,
          sourceEditToken: currentVersion?.editToken,
          startSeconds: selectionStart,
          endSeconds: selectionEnd,
          instruction,
          lyrics: replacementLyrics,
        }),
      });
      const data = await response.json() as { editId?: string; editToken?: string; editsRemaining?: number; error?: string };
      if (!response.ok || !data.editId || !data.editToken) throw new Error(data.error || "Die KI-Bearbeitung konnte nicht gestartet werden.");
      setEditsRemaining(data.editsRemaining ?? editsRemaining);
      await waitForEdit(data.editId, data.editToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die KI-Bearbeitung ist fehlgeschlagen.");
      setEditLoading(false);
      setEditMessage("");
    }
  }

  async function waitForEdit(editId: string, editToken: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      const response = await fetch(`/api/song-studio/edit-status?editId=${encodeURIComponent(editId)}&edit_token=${encodeURIComponent(editToken)}`, { cache: "no-store" });
      const data = await response.json() as { status?: string; audioUrl?: string; error?: string };
      if (!response.ok || data.status === "error") throw new Error(data.error || "Die KI-Bearbeitung ist fehlgeschlagen.");
      if (data.status === "done" && data.audioUrl) {
        const next: Version = { label: `Version ${versions.length}`, audioUrl: data.audioUrl, editId, editToken };
        setVersions((current) => [...current, next]);
        setVersionIndex(versions.length);
        setInstruction("");
        setReplacementLyrics("");
        setEditMessage("Neue Studioversion ist fertig.");
        setEditLoading(false);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 6_000));
    }
    throw new Error("Die Bearbeitung dauert länger als erwartet. Bitte versuche es erneut.");
  }

  async function exportAudio(mode: "selection" | "full") {
    if (!audioBuffer) return;
    setError("");
    try {
      const from = mode === "selection" ? selectionStart : 0;
      const to = mode === "selection" ? selectionEnd : audioBuffer.duration;
      const exportDuration = Math.max(0.1, to - from);
      const output = new OfflineAudioContext(audioBuffer.numberOfChannels, Math.ceil(exportDuration * audioBuffer.sampleRate), audioBuffer.sampleRate);
      const sourceNode = output.createBufferSource();
      const gain = output.createGain();
      const level = gainPercent / 100;
      gain.gain.setValueAtTime(level, 0);
      const effectiveFadeIn = Math.min(fadeIn, exportDuration / 2);
      const effectiveFadeOut = Math.min(fadeOut, exportDuration / 2);
      if (effectiveFadeIn > 0) {
        gain.gain.setValueAtTime(0, 0);
        gain.gain.linearRampToValueAtTime(level, effectiveFadeIn);
      }
      if (effectiveFadeOut > 0) {
        gain.gain.setValueAtTime(level, exportDuration - effectiveFadeOut);
        gain.gain.linearRampToValueAtTime(0, exportDuration);
      }
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(gain).connect(output.destination);
      sourceNode.start(0, from, exportDuration);
      const rendered = await output.startRendering();
      const blob = encodeWav(rendered);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFilename(source?.title || "song")}-${mode === "selection" ? "ausschnitt" : "studio"}.wav`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setError("Der WAV-Export konnte in diesem Browser nicht erstellt werden.");
    }
  }

  if (loading) return <Shell><div className="flex min-h-[60vh] items-center justify-center text-fuchsia-200"><LoadingIcon className="animate-spin" /></div></Shell>;

  if (!source) {
    return (
      <Shell>
        <LockedStudioPreview message={needsSubscription ? error : "Hier siehst du das vollständige Sound Studio. Nach dem Abo öffnest du einen fertigen Song und alle Werkzeuge werden freigeschaltet."} />
        <SongPlans />
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200"><SparklesIcon /> {source.planName} Sound Studio</div>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Dein Song. Sekundengenau.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">Markiere die Stelle direkt in der Wellenform, höre sie als Schleife und generiere nur diesen Abschnitt neu. Manuelle Bearbeitungen und WAV-Exporte sind unbegrenzt.</p>
      </section>

      <div className="mt-10 grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/30 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-200"><MusicIcon /></div><div className="min-w-0"><p className="truncate font-semibold">{source.title}</p><p className="mt-1 text-xs text-zinc-500">{source.style}</p></div></div>
            <select value={versionIndex} onChange={(event) => setVersionIndex(Number(event.target.value))} className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200">{versions.map((version, index) => <option key={`${version.label}-${index}`} value={index}>{version.label}</option>)}</select>
          </div>

          <audio ref={audioRef} src={currentVersion.audioUrl} onTimeUpdate={onTimeUpdate} controls preload="metadata" className="mt-6 w-full" />
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-3">
            <canvas ref={canvasRef} className="h-48 w-full" aria-label="Wellenform des Songs" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Range label="Start" value={selectionStart} max={Math.max(0, duration - 1)} onChange={(value) => setSelectionStart(Math.min(value, selectionEnd - 1))} />
            <Range label="Ende" value={selectionEnd} min={1} max={duration || 1} onChange={(value) => setSelectionEnd(Math.max(value, selectionStart + 1))} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={playSelection} className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-xs font-semibold">Markierung anhören</button>
            <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={loopSelection} onChange={(event) => setLoopSelection(event.target.checked)} className="accent-fuchsia-500" /> Als Schleife abspielen</label>
            <span className="ml-auto text-xs text-fuchsia-200">{formatTime(selectionStart)}–{formatTime(selectionEnd)} · {(selectionEnd - selectionStart).toFixed(1)} Sek.</span>
          </div>

          <div className="my-7 h-px bg-white/10" />
          <h2 className="text-lg font-semibold">Manueller Feinschliff</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Range label={`Lautstärke ${gainPercent}%`} value={gainPercent} min={0} max={150} step={1} onChange={setGainPercent} time={false} />
            <Range label={`Fade-in ${fadeIn.toFixed(1)} s`} value={fadeIn} min={0} max={5} onChange={setFadeIn} time={false} />
            <Range label={`Fade-out ${fadeOut.toFixed(1)} s`} value={fadeOut} min={0} max={5} onChange={setFadeOut} time={false} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => void exportAudio("selection")} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200">Markierung als WAV</button><button type="button" onClick={() => void exportAudio("full")} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200">Ganzen Song als WAV</button></div>
        </section>

        <aside className="h-fit rounded-3xl border border-fuchsia-400/20 bg-gradient-to-b from-fuchsia-500/[0.11] to-violet-500/[0.04] p-6 xl:sticky xl:top-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">KI-Abschnitt ersetzen</p>
          <h2 className="mt-2 text-xl font-semibold">Nur diese Sekunden neu</h2>
          <p className="mt-2 text-xs leading-5 text-zinc-400">Die restliche Songidee bleibt erhalten. Beschreibe konkret Instrumente, Energie, Stimme oder Übergang der markierten Stelle.</p>
          <label className="mt-5 block text-xs font-medium text-zinc-300">Was soll sich ändern?</label>
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={5} maxLength={1000} placeholder="Zum Beispiel: Refrain größer und emotionaler, kräftigere Drums, Stimme klar und ohne Adlibs, weicher Übergang zurück zur Strophe …" className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/40" />
          <label className="mt-4 block text-xs font-medium text-zinc-300">Neue Lyrics für diese Stelle <span className="text-zinc-600">optional</span></label>
          <textarea value={replacementLyrics} onChange={(event) => setReplacementLyrics(event.target.value)} rows={4} maxLength={4000} placeholder="Wenn der Text gleich bleiben soll, leer lassen." className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/40" />
          {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-3 text-xs leading-5 text-red-200">{error}</p>}
          {editMessage && <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-3 text-xs leading-5 text-emerald-200">{editMessage}</p>}
          <button type="button" onClick={() => void regenerateSelection()} disabled={editLoading || !source.canRegenerate || editsRemaining <= 0} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{editLoading ? <><LoadingIcon className="animate-spin" /> Stelle wird neu erstellt …</> : "Markierte Stelle neu generieren"}</button>
          <p className="mt-3 text-center text-[11px] text-zinc-500">{editsRemaining} KI-Bearbeitungen in diesem Monat übrig</p>
        </aside>
      </div>
    </Shell>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white"><div className="pointer-events-none absolute inset-0"><div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-fuchsia-700/20 blur-[140px]" /><div className="absolute right-[-180px] top-[160px] h-[460px] w-[460px] rounded-full bg-violet-700/15 blur-[140px]" /></div><Header active="studio" /><div className="relative z-10 mx-auto max-w-7xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">{children}</div></main>;
}

function LockedStudioPreview({ message }: { message: string }) {
  const bars = [28, 46, 70, 38, 82, 58, 34, 76, 94, 62, 44, 88, 52, 72, 40, 66, 90, 54, 34, 78, 60, 86, 48, 70, 32, 56, 80, 42, 68, 36, 74, 50, 84, 64, 38, 72, 92, 58, 44, 76, 52, 86, 34, 62, 78, 46, 68, 40];
  return (
    <>
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200"><LockIcon /> Öffentliche Studio-Vorschau</div>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Sieh das Sound Studio vor dem Abo</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">{message}</p>
        <p className="mt-3 text-xs text-fuchsia-200">Ansehen ist kostenlos · Bearbeiten wird erst mit einem aktiven Abo freigeschaltet</p>
      </section>

      <div className="relative mt-10 grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/30 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-200"><MusicIcon /></div><div><p className="font-semibold">Demo-Song · Studiovorschau</p><p className="mt-1 text-xs text-zinc-500">Moderner Pop · 2:48 Minuten</p></div></div>
            <select disabled className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-400"><option>Original</option><option>Version 1</option></select>
          </div>

          <div className="mt-6 flex items-center gap-4 rounded-xl border border-white/10 bg-black/25 p-3 opacity-70"><button type="button" disabled className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-600 text-xs">▶</button><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[38%] rounded-full bg-fuchsia-500" /></div><span className="text-[11px] text-zinc-400">1:04 / 2:48</span></div>
          <div className="relative mt-5 flex h-48 items-center gap-1 overflow-hidden rounded-2xl border border-white/10 bg-black/25 px-3">
            <div className="absolute inset-y-0 left-[28%] right-[44%] border-x border-fuchsia-300/70 bg-fuchsia-500/15" />
            {bars.map((height, index) => <span key={index} className="z-10 flex-1 rounded-full bg-gradient-to-t from-violet-500/55 to-fuchsia-300/90" style={{ height: `${height}%` }} />)}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><PreviewControl label="Start" value="0:47.2" /><PreviewControl label="Ende" value="1:04.8" /></div>
          <div className="mt-4 flex flex-wrap items-center gap-3 opacity-65"><button type="button" disabled className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-xs font-semibold">Markierung anhören</button><span className="text-xs text-zinc-400">☑ Als Schleife abspielen</span><span className="ml-auto text-xs text-fuchsia-200">17,6 Sek.</span></div>
          <div className="my-7 h-px bg-white/10" />
          <h2 className="text-lg font-semibold">Manueller Feinschliff</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3"><PreviewControl label="Lautstärke" value="100 %" /><PreviewControl label="Fade-in" value="1,5 s" /><PreviewControl label="Fade-out" value="2,0 s" /></div>
          <div className="mt-5 flex flex-wrap gap-3 opacity-55"><button disabled className="rounded-xl border border-white/10 px-4 py-2.5 text-xs">Markierung als WAV</button><button disabled className="rounded-xl border border-white/10 px-4 py-2.5 text-xs">Ganzen Song als WAV</button></div>
          <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-[#09090e]/95 via-transparent to-transparent p-6 pointer-events-none"><div className="rounded-full border border-fuchsia-400/25 bg-[#111018]/95 px-4 py-2 text-xs font-semibold text-fuchsia-100 shadow-xl"><LockIcon /> Werkzeuge werden mit deinem Abo freigeschaltet</div></div>
        </section>

        <aside className="h-fit rounded-3xl border border-fuchsia-400/20 bg-gradient-to-b from-fuchsia-500/[0.11] to-violet-500/[0.04] p-6 xl:sticky xl:top-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">KI-Abschnitt ersetzen</p><h2 className="mt-2 text-xl font-semibold">Nur diese Sekunden neu</h2><p className="mt-2 text-xs leading-5 text-zinc-400">Der Kunde beschreibt die Änderung. Die KI erstellt eine neue Version, ohne dass der ganze Song neu begonnen werden muss.</p>
          <label className="mt-5 block text-xs font-medium text-zinc-300">Was soll sich ändern?</label><textarea disabled rows={5} value="Refrain größer und emotionaler, kräftigere Drums und eine klare Stimme ohne Adlibs." readOnly className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-zinc-500" />
          <label className="mt-4 block text-xs font-medium text-zinc-300">Neue Lyrics <span className="text-zinc-600">optional</span></label><textarea disabled rows={4} value="Neue Zeilen können genau für diese Stelle eingetragen werden." readOnly className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-zinc-600" />
          <a href="#song-abos" className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-3 text-sm font-semibold"><LockIcon /> Mit Abo freischalten</a>
          <p className="mt-3 text-center text-[11px] text-zinc-500">Danach einen fertigen Song auswählen und direkt loslegen</p>
        </aside>
      </div>
    </>
  );
}

function PreviewControl({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3 opacity-70"><span className="flex items-center justify-between text-xs text-zinc-400"><span>{label}</span><span className="font-medium text-fuchsia-200">{value}</span></span><div className="relative mt-3 h-1.5 rounded-full bg-white/10"><span className="absolute left-0 top-0 h-full w-[58%] rounded-full bg-fuchsia-500" /><span className="absolute left-[58%] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-fuchsia-500" /></div></div>;
}

function Range({ label, value, onChange, min = 0, max, step = 0.1, time = true }: { label: string; value: number; onChange: (value: number) => void; min?: number; max: number; step?: number; time?: boolean }) {
  return <label className="block rounded-xl border border-white/10 bg-black/20 p-3"><span className="flex items-center justify-between text-xs text-zinc-400"><span>{label}</span>{time && <span className="font-medium text-fuchsia-200">{formatTime(value)}</span>}</span><input type="range" value={Number.isFinite(value) ? value : 0} min={min} max={Math.max(min, max)} step={step} onChange={(event) => onChange(Number(event.target.value))} className="mt-3 w-full accent-fuchsia-500" /></label>;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe % 60).toFixed(1).padStart(4, "0")}`;
}

function safeFilename(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "song";
}

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const output = new ArrayBuffer(44 + frames * channels * bytesPerSample);
  const view = new DataView(output);
  const write = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  write(0, "RIFF"); view.setUint32(4, 36 + frames * channels * bytesPerSample, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true); view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, frames * channels * bytesPerSample, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([output], { type: "audio/wav" });
}
