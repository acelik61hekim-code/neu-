"use client";

import { upload } from "@vercel/blob/client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  sourceVersion?: number;
  sourceKind?: "generated" | "upload";
};

type UploadAccess = {
  planName: string;
  editsRemaining: number;
};

type Version = {
  label: string;
  audioUrl: string;
  editId?: string;
  editToken?: string;
  uploadPathname?: string;
};

type UploadAiMode = "cover" | "extend";

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
  const [uploadAiMode, setUploadAiMode] = useState<UploadAiMode>("cover");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [confirmedAudioRights, setConfirmedAudioRights] = useState(false);
  const [editsRemaining, setEditsRemaining] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [uploadAccess, setUploadAccess] = useState<UploadAccess | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const createdAudioUrls = useRef<string[]>([]);
  const ownAudioFileRef = useRef<File | null>(null);

  const params = useMemo(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search), []);
  const jobId = params.get("jobId") || "";
  const sessionId = params.get("session_id") || "";
  const accessToken = params.get("access_token") || "";
  const sourceVersion = params.get("version") || "1";
  const currentVersion = versions[versionIndex];

  useEffect(() => {
    if (!jobId) {
      void fetch("/api/song-studio/access", { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json() as UploadAccess & {
            error?: string;
            needsSubscription?: boolean;
          };

          if (!response.ok) {
            setNeedsSubscription(Boolean(data.needsSubscription));
            throw new Error(
              data.error ||
                "Der Zugang zum Sound Studio konnte nicht geprüft werden.",
            );
          }

          setUploadAccess(data);
          setEditsRemaining(data.editsRemaining);
          setError("");
        })
        .catch((reason) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Der Zugang zum Sound Studio konnte nicht geprüft werden.",
          ),
        )
        .finally(() => setLoading(false));
      return;
    }
    const accessQuery = sessionId ? `session_id=${encodeURIComponent(sessionId)}` : `access_token=${encodeURIComponent(accessToken)}`;
    void fetch(`/api/song-studio/source?jobId=${encodeURIComponent(jobId)}&${accessQuery}&version=${encodeURIComponent(sourceVersion)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as StudioSource & { error?: string; needsSubscription?: boolean };
        if (!response.ok) {
          setNeedsSubscription(Boolean(data.needsSubscription));
          throw new Error(data.error || "Der Song konnte nicht geöffnet werden.");
        }
        setSource(data);
        setUploadAccess({
          planName: data.planName,
          editsRemaining: data.editsRemaining,
        });
        setVersions([{ label: "Original", audioUrl: data.audioUrl }]);
        setEditsRemaining(data.editsRemaining);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Der Song konnte nicht geöffnet werden."))
      .finally(() => setLoading(false));
  }, [accessToken, jobId, sessionId, sourceVersion]);

  useEffect(() => {
    return () => {
      createdAudioUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

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

  function handleOwnAudioUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const supportedExtension = /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
    if (!file.type.startsWith("audio/") && !supportedExtension) {
      setError("Bitte wähle eine Audiodatei als MP3, WAV, M4A, AAC, OGG oder FLAC aus.");
      return;
    }

    if (file.size > 200 * 1024 * 1024) {
      setError("Die Audiodatei darf höchstens 200 MB groß sein.");
      return;
    }

    const audioUrl = URL.createObjectURL(file);
    createdAudioUrls.current.push(audioUrl);
    ownAudioFileRef.current = file;

    const title = file.name.replace(/\.[^.]+$/, "").trim() || "Eigene Audiodatei";
    const access = uploadAccess ?? {
      planName: source?.planName || "Song-Abo",
      editsRemaining,
    };

    setSource({
      title,
      style: `Eigener Upload · ${file.name.split(".").pop()?.toUpperCase() || "Audio"}`,
      lyrics: "",
      audioUrl,
      canRegenerate: false,
      planName: access.planName,
      editsRemaining: access.editsRemaining,
      sourceKind: "upload",
    });
    setVersions([{ label: "Original-Upload", audioUrl }]);
    setVersionIndex(0);
    setGainPercent(100);
    setFadeIn(0);
    setFadeOut(0);
    setInstruction("");
    setReplacementLyrics("");
    setUploadAiMode("cover");
    setUploadProgress(0);
    setConfirmedAudioRights(false);
    setEditMessage("Eigene Audiodatei geladen. Du kannst sie manuell bearbeiten, mit KI neu arrangieren oder ab einem gewählten Zeitpunkt erweitern.");
    setError("");
  }

  function createManualVersion(mode: "remove" | "silence" | "keep") {
    if (!audioBuffer || selectionEnd <= selectionStart) return;

    try {
      const edited = editAudioBuffer(
        audioBuffer,
        selectionStart,
        selectionEnd,
        mode,
      );
      const audioUrl = URL.createObjectURL(encodeWav(edited));
      createdAudioUrls.current.push(audioUrl);

      const label =
        mode === "remove"
          ? "Schnitt"
          : mode === "silence"
            ? "Stumm"
            : "Ausschnitt";

      setVersions((current) => {
        setVersionIndex(current.length);
        return [
          ...current,
          {
            label: `${label} ${current.length}`,
            audioUrl,
          },
        ];
      });
      setEditMessage(
        mode === "remove"
          ? "Die Markierung wurde entfernt und als neue Version gespeichert."
          : mode === "silence"
            ? "Die Markierung wurde stummgeschaltet und als neue Version gespeichert."
            : "Nur die Markierung wurde als neue Version übernommen.",
      );
      setError("");
    } catch {
      setError("Die manuelle Bearbeitung konnte in diesem Browser nicht erstellt werden.");
    }
  }

  async function ensureCurrentVersionUploaded(): Promise<string> {
    if (!currentVersion) {
      throw new Error("Bitte öffne zuerst eine Audiodatei.");
    }

    const targetVersionIndex = versionIndex;

    if (currentVersion.uploadPathname) {
      return currentVersion.uploadPathname;
    }

    let body: Blob;
    let originalName: string;

    if (versionIndex === 0 && ownAudioFileRef.current) {
      body = ownAudioFileRef.current;
      originalName = ownAudioFileRef.current.name;
    } else {
      const response = await fetch(currentVersion.audioUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Die aktuelle Studioversion konnte nicht für die KI vorbereitet werden.");
      }
      body = await response.blob();
      originalName = `${source?.title || "song"}-${currentVersion.label}.mp3`;
    }

    if (body.size > 200 * 1024 * 1024) {
      throw new Error("Für die KI darf die Audiodatei höchstens 200 MB groß sein.");
    }

    const contentType = inferAudioContentType(originalName, body.type);
    const extension = audioExtensionForContentType(contentType, originalName);
    setUploadProgress(1);

    const blob = await upload(
      `song-studio-uploads/${Date.now()}-${safeFilename(source?.title || "song")}.${extension}`,
      body,
      {
        access: "private",
        handleUploadUrl: "/api/song-studio/upload-audio",
        multipart: true,
        contentType,
        onUploadProgress: ({ percentage }) => {
          setUploadProgress(Math.max(1, Math.round(percentage)));
        },
      },
    );

    setVersions((current) => current.map((version, index) =>
      index === targetVersionIndex
        ? { ...version, uploadPathname: blob.pathname }
        : version,
    ));
    setUploadProgress(100);
    return blob.pathname;
  }

  async function regenerateSelection() {
    if (!source || !instruction.trim()) {
      setError("Beschreibe bitte zuerst, wie die markierte Stelle verändert werden soll.");
      return;
    }
    if (source.sourceKind !== "upload" && (selectionEnd - selectionStart < 1 || selectionEnd - selectionStart > 30)) {
      setError("Markiere für die KI-Bearbeitung einen Abschnitt zwischen 1 und 30 Sekunden.");
      return;
    }
    if (source.sourceKind === "upload" && !confirmedAudioRights) {
      setError("Bitte bestätige zuerst, dass du diese Audiodatei verwenden und bearbeiten darfst.");
      return;
    }
    setEditLoading(true);
    setEditMessage(
      source.sourceKind === "upload"
        ? "Die aktuelle Studioversion wird sicher hochgeladen und von der KI verarbeitet …"
        : "Die neue Version wird komponiert …",
    );
    setError("");
    try {
      const isOwnUpload = source.sourceKind === "upload";
      const pathname = isOwnUpload
        ? await ensureCurrentVersionUploaded()
        : undefined;
      const response = await fetch(
        isOwnUpload ? "/api/song-studio/upload-ai" : "/api/song-studio/edit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isOwnUpload
              ? {
                  pathname,
                  mode: uploadAiMode,
                  instruction,
                  lyrics: replacementLyrics,
                  continueAtSeconds: selectionEnd,
                  durationSeconds: duration,
                  title: source.title,
                  rightsConfirmed: true,
                }
              : {
                  jobId,
                  sessionId: sessionId || undefined,
                  accessToken: accessToken || undefined,
                  sourceEditId: currentVersion?.editId,
                  sourceEditToken: currentVersion?.editToken,
                  sourceVersion: source.sourceVersion || Number(sourceVersion) || 1,
                  startSeconds: selectionStart,
                  endSeconds: selectionEnd,
                  instruction,
                  lyrics: replacementLyrics,
                },
          ),
        },
      );
      const data = await response.json() as { editId?: string; editToken?: string; editsRemaining?: number; error?: string };
      if (!response.ok || !data.editId || !data.editToken) throw new Error(data.error || "Die KI-Bearbeitung konnte nicht gestartet werden.");
      setEditsRemaining(data.editsRemaining ?? editsRemaining);
      await waitForEdit(
        data.editId,
        data.editToken,
        isOwnUpload
          ? uploadAiMode === "cover"
            ? "KI-Arrangement"
            : "KI-Erweiterung"
          : "Version",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Die KI-Bearbeitung ist fehlgeschlagen.");
      setEditLoading(false);
      setEditMessage("");
    }
  }

  async function waitForEdit(editId: string, editToken: string, labelPrefix = "Version") {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      const response = await fetch(`/api/song-studio/edit-status?editId=${encodeURIComponent(editId)}&edit_token=${encodeURIComponent(editToken)}`, { cache: "no-store" });
      const data = await response.json() as { status?: string; audioUrl?: string; error?: string };
      if (!response.ok || data.status === "error") throw new Error(data.error || "Die KI-Bearbeitung ist fehlgeschlagen.");
      if (data.status === "done" && data.audioUrl) {
        setVersions((current) => {
          const next: Version = {
            label: `${labelPrefix} ${current.length}`,
            audioUrl: data.audioUrl!,
            editId,
            editToken,
          };
          setVersionIndex(current.length);
          return [...current, next];
        });
        setInstruction("");
        setReplacementLyrics("");
        setUploadProgress(0);
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
    if (uploadAccess) {
      return (
        <Shell>
          <UploadAudioEntry
            planName={uploadAccess.planName}
            onFileChange={handleOwnAudioUpload}
          />
        </Shell>
      );
    }

    return (
      <Shell>
        <LockedStudioPreview
          message={
            needsSubscription
              ? error
              : "Hier siehst du das vollständige Sound Studio. Mit einem Song-Abo kannst du auch eigene Audiodateien hochladen und bearbeiten."
          }
        />
        <SongPlans />
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200"><SparklesIcon /> {source.planName} Sound Studio</div>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Dein Song. Dein Studio.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
          {source.sourceKind === "upload"
            ? "Bearbeite deine eigene Audiodatei manuell oder erstelle mit KI ein neues Arrangement und passende Erweiterungen. Jede Fassung bleibt als eigene Version erhalten."
            : "Markiere die Stelle direkt in der Wellenform, höre sie als Schleife und generiere nur diesen Abschnitt neu. Manuelle Bearbeitungen und WAV-Exporte sind unbegrenzt."}
        </p>
      </section>

      <div className="mt-10 grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/30 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-200"><MusicIcon /></div><div className="min-w-0"><p className="truncate font-semibold">{source.title}</p><p className="mt-1 text-xs text-zinc-500">{source.style}</p></div></div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/20">
                Eigene Datei öffnen
                <input
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac,audio/x-flac,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                  className="sr-only"
                  onChange={handleOwnAudioUpload}
                />
              </label>
              <select value={versionIndex} onChange={(event) => setVersionIndex(Number(event.target.value))} className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200">{versions.map((version, index) => <option key={`${version.label}-${index}`} value={index}>{version.label}</option>)}</select>
            </div>
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
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => createManualVersion("remove")} disabled={!audioBuffer || selectionEnd - selectionStart >= duration - 0.1} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40">Markierung entfernen</button>
            <button type="button" onClick={() => createManualVersion("silence")} disabled={!audioBuffer} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40">Markierung stummschalten</button>
            <button type="button" onClick={() => createManualVersion("keep")} disabled={!audioBuffer} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40">Nur Markierung behalten</button>
            <button type="button" onClick={() => void exportAudio("selection")} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200">Markierung als WAV</button>
            <button type="button" onClick={() => void exportAudio("full")} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-200">Ganzen Song als WAV</button>
          </div>
        </section>

        <aside className="h-fit rounded-3xl border border-fuchsia-400/20 bg-gradient-to-b from-fuchsia-500/[0.11] to-violet-500/[0.04] p-6 xl:sticky xl:top-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">
            {source.sourceKind === "upload" ? "KI für eigene Audiodatei" : "KI-Abschnitt ersetzen"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {source.sourceKind === "upload" ? "Verändern oder erweitern" : "Nur diese Sekunden neu"}
          </h2>
          <p className="mt-2 text-xs leading-5 text-zinc-400">
            {source.sourceKind === "upload"
              ? "Die KI arbeitet mit der aktuell ausgewählten Studioversion. Dein Original wird niemals überschrieben."
              : "Die restliche Songidee bleibt erhalten. Beschreibe konkret Instrumente, Energie, Stimme oder Übergang der markierten Stelle."}
          </p>

          {source.sourceKind === "upload" && (
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5">
              <button
                type="button"
                onClick={() => setUploadAiMode("cover")}
                className={`rounded-xl px-3 py-2.5 text-xs font-semibold transition ${uploadAiMode === "cover" ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                Neu arrangieren
              </button>
              <button
                type="button"
                onClick={() => setUploadAiMode("extend")}
                className={`rounded-xl px-3 py-2.5 text-xs font-semibold transition ${uploadAiMode === "extend" ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                Song erweitern
              </button>
            </div>
          )}

          {source.sourceKind === "upload" && (
            <p className="mt-3 rounded-xl border border-blue-400/15 bg-blue-400/[0.07] px-3 py-3 text-xs leading-5 text-blue-100">
              {uploadAiMode === "cover"
                ? "Erstellt eine vollständige neue Studioversion mit dem gewünschten Stil, Arrangement, Instrumenten oder Gesang."
                : `Setzt den Song ab dem Ende deiner Markierung bei ${formatTime(selectionEnd)} musikalisch passend fort.`}
            </p>
          )}

          <label className="mt-5 block text-xs font-medium text-zinc-300">
            {source.sourceKind === "upload"
              ? uploadAiMode === "cover"
                ? "Wie soll die neue Version klingen?"
                : "Was soll die KI hinzufügen?"
              : "Was soll sich ändern?"}
          </label>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={5}
            maxLength={1000}
            placeholder={source.sourceKind === "upload"
              ? uploadAiMode === "cover"
                ? "Zum Beispiel: Moderner emotionaler Pop, warme Live-Drums, breiter Refrain, klare weibliche Stimme und hochwertiger Radio-Mix …"
                : "Zum Beispiel: Nach dem Refrain ein achttaktiges Gitarrensolo ergänzen, danach mit ruhigem Piano in einen letzten großen Refrain überleiten …"
              : "Zum Beispiel: Refrain größer und emotionaler, kräftigere Drums, Stimme klar und ohne Adlibs, weicher Übergang zurück zur Strophe …"}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/40"
          />
          <label className="mt-4 block text-xs font-medium text-zinc-300">
            {source.sourceKind === "upload" && uploadAiMode === "extend" ? "Lyrics für die Erweiterung" : "Neue Lyrics"} <span className="text-zinc-600">optional</span>
          </label>
          <textarea
            value={replacementLyrics}
            onChange={(event) => setReplacementLyrics(event.target.value)}
            rows={4}
            maxLength={12000}
            placeholder={source.sourceKind === "upload"
              ? "Leer lassen, wenn die KI instrumental arbeiten oder selbst passende Vocals gestalten soll."
              : "Wenn der Text gleich bleiben soll, leer lassen."}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/40"
          />

          {source.sourceKind === "upload" && (
            <label className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[11px] leading-5 text-zinc-400">
              <input
                type="checkbox"
                checked={confirmedAudioRights}
                onChange={(event) => setConfirmedAudioRights(event.target.checked)}
                className="mt-0.5 accent-fuchsia-500"
              />
              <span>Ich darf diese Audiodatei verwenden, bearbeiten und an die Musik-KI übergeben.</span>
            </label>
          )}
          {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-3 text-xs leading-5 text-red-200">{error}</p>}
          {editMessage && <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-3 text-xs leading-5 text-emerald-200">{editMessage}</p>}
          {editLoading && source.sourceKind === "upload" && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] text-zinc-500"><span>Audiodatei wird vorbereitet</span><span>{uploadProgress} %</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-fuchsia-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void regenerateSelection()}
            disabled={editLoading || editsRemaining <= 0 || (source.sourceKind === "upload" && !confirmedAudioRights)}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {editLoading
              ? <><LoadingIcon className="animate-spin" /> KI-Version wird erstellt …</>
              : source.sourceKind === "upload"
                ? uploadAiMode === "cover"
                  ? "Neue KI-Version erstellen"
                  : "Song ab Markierung erweitern"
                : "Markierte Stelle neu generieren"}
          </button>
          <p className="mt-3 text-center text-[11px] text-zinc-500">{editsRemaining} KI-Bearbeitungen in diesem Monat übrig</p>
        </aside>
      </div>
    </Shell>
  );
}

function UploadAudioEntry({
  planName,
  onFileChange,
}: {
  planName: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
          ✓ {planName} aktiv
        </div>
        <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
          Deinen eigenen Song bearbeiten
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
          Lade eine eigene Audiodatei hoch. Danach kannst du sie sekundengenau
          bearbeiten, mit KI neu arrangieren oder ab einer gewählten Stelle
          musikalisch passend erweitern.
        </p>
      </section>

      <section className="mx-auto mt-10 max-w-3xl rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/[0.1] via-violet-500/[0.05] to-blue-500/[0.08] p-6 text-center shadow-2xl shadow-black/30 sm:p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-fuchsia-500/15 text-fuchsia-200">
          <MusicIcon className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold">Audiodatei auswählen</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-400">
          Unterstützt werden MP3, WAV, M4A, AAC, OGG und FLAC bis 200 MB.
          Deine Originaldatei bleibt unverändert; manuelle und KI-Bearbeitungen
          werden immer als neue Versionen angelegt.
        </p>

        <label className="mt-7 inline-flex cursor-pointer items-center justify-center rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white transition hover:brightness-110">
          Eigene Datei hochladen
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac,audio/x-flac,.mp3,.wav,.m4a,.aac,.ogg,.flac"
            className="sr-only"
            onChange={onFileChange}
          />
        </label>

        <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
          {[
            ["KI-Arrangement", "Stil, Instrumente, Energie und Gesang als neue Version gestalten."],
            ["Song erweitern", "Ab dem gewählten Zeitpunkt einen passenden neuen Teil hinzufügen."],
            ["Manuell & Export", "Schneiden, blenden, Lautstärke ändern und als WAV herunterladen."],
          ].map(([title, description]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-semibold text-white">{title}</p>
              <p className="mt-1 text-[11px] leading-5 text-zinc-500">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </>
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
          <p className="text-xs font-semibold uppercase tracking-wider text-fuchsia-300">KI für jeden Song</p><h2 className="mt-2 text-xl font-semibold">Verändern oder erweitern</h2><p className="mt-2 text-xs leading-5 text-zinc-400">Eigene Audiodatei hochladen, als neue Studioversion arrangieren oder ab einem gewählten Zeitpunkt musikalisch fortsetzen.</p>
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1.5 opacity-70"><button disabled className="rounded-lg bg-fuchsia-600 px-2 py-2 text-[11px] font-semibold">Neu arrangieren</button><button disabled className="rounded-lg px-2 py-2 text-[11px] text-zinc-400">Song erweitern</button></div>
          <label className="mt-4 block text-xs font-medium text-zinc-300">Wie soll die neue Version klingen?</label><textarea disabled rows={5} value="Moderner emotionaler Pop, warme Live-Drums, breiter Refrain und hochwertiger Radio-Mix." readOnly className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-zinc-500" />
          <label className="mt-4 block text-xs font-medium text-zinc-300">Neue Lyrics <span className="text-zinc-600">optional</span></label><textarea disabled rows={4} value="Neue Zeilen können genau für diese Stelle eingetragen werden." readOnly className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm text-zinc-600" />
          <a href="#song-abos" className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-3 text-sm font-semibold"><LockIcon /> Mit Abo freischalten</a>
          <p className="mt-3 text-center text-[11px] text-zinc-500">Eigene Uploads und erstellte KI-Songs als neue Versionen bearbeiten</p>
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

function inferAudioContentType(filename: string, suppliedType: string): string {
  const normalized = suppliedType.trim().toLowerCase();
  const supported = new Set([
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/flac",
    "audio/x-flac",
  ]);

  if (supported.has(normalized)) return normalized;
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "aac") return "audio/aac";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "flac") return "audio/flac";
  return "audio/mpeg";
}

function audioExtensionForContentType(contentType: string, filename: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  if (contentType.includes("aac")) return "aac";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("flac")) return "flac";
  const original = filename.split(".").pop()?.toLowerCase();
  if (original && ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(original)) {
    return original;
  }
  return "mp3";
}

function editAudioBuffer(
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
  mode: "remove" | "silence" | "keep",
): AudioBuffer {
  const startFrame = Math.max(
    0,
    Math.min(buffer.length, Math.floor(startSeconds * buffer.sampleRate)),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate)),
  );
  const selectedFrames = endFrame - startFrame;
  const outputFrames =
    mode === "keep"
      ? selectedFrames
      : mode === "remove"
        ? Math.max(1, buffer.length - selectedFrames)
        : buffer.length;
  const context = new OfflineAudioContext(
    buffer.numberOfChannels,
    outputFrames,
    buffer.sampleRate,
  );
  const output = context.createBuffer(
    buffer.numberOfChannels,
    outputFrames,
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = output.getChannelData(channel);

    if (mode === "keep") {
      target.set(source.subarray(startFrame, endFrame));
      continue;
    }

    target.set(source.subarray(0, Math.min(startFrame, target.length)));

    if (mode === "remove") {
      target.set(source.subarray(endFrame), startFrame);
      continue;
    }

    target.set(source.subarray(endFrame), endFrame);
  }

  return output;
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
