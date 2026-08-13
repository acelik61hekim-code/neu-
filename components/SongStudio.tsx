"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Header from "@/components/Header";
import { ArrowIcon, LockIcon, MusicIcon, SparklesIcon } from "@/components/Icons";
import StudioChooser, { type StudioMode } from "@/components/StudioChooser";
import { formatEuroPrice } from "@/lib/pricing";
import {
  SONG_PRICE_CENTS,
  countLyricsWords,
  customLyricsPronunciationRisks,
  maximumCustomLyricsWords,
  minimumCustomLyricsWords,
  recommendedCustomLyricsWords,
  type SongLanguage,
  type SongLength,
  type SongLyricsMode,
  type SongVocalStyle,
} from "@/lib/song";

const styles = ["Pop", "Deutschrap / Straßenrap", "Hip-Hop / Rap", "Türkischer Arabesk", "Türkischer Arabesk-Pop / Fantezi", "R&B", "Afrobeats", "Elektronisch", "Rock", "Akustisch", "Cinematic", "Schlager", "Lo-Fi"];
const moods = ["Energiegeladen", "Emotional", "Hüzünlü / Sehnsüchtig", "Dramatisch", "Romantisch", "Düster", "Entspannt", "Motivierend", "Fröhlich", "Episch"];
type RevisionApproach = "character" | "new-melody" | "free";

export default function SongStudio({
  onStudioChange,
}: {
  onStudioChange: (mode: StudioMode) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("Pop");
  const [mood, setMood] = useState("Energiegeladen");
  const [length, setLength] = useState<SongLength>("full3");
  const [lyricsMode, setLyricsMode] = useState<SongLyricsMode>("ai");
  const [lyrics, setLyrics] = useState("");
  const [language, setLanguage] = useState<SongLanguage>("de");
  const [vocalStyle, setVocalStyle] = useState<SongVocalStyle>("auto");
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [voiceIdeaFile, setVoiceIdeaFile] = useState<File | null>(null);
  const [voiceIdeaUrl, setVoiceIdeaUrl] = useState<string | null>(null);
  const [voiceIdeaAnalysis, setVoiceIdeaAnalysis] = useState("");
  const [voiceIdeaConsent, setVoiceIdeaConsent] = useState(false);
  const [revisionMode, setRevisionMode] = useState(false);
  const [revisionApproach, setRevisionApproach] = useState<RevisionApproach>("character");
  const [referenceRightsAccepted, setReferenceRightsAccepted] = useState(false);
  const [compressingReference, setCompressingReference] = useState(false);
  const [analyzingVoiceIdea, setAnalyzingVoiceIdea] = useState(false);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const price = useMemo(() => formatEuroPrice(SONG_PRICE_CENTS[length]), [length]);
  const lyricsWordCount = useMemo(() => countLyricsWords(lyrics), [lyrics]);
  const minimumLyricsWords = minimumCustomLyricsWords(length);
  const maximumLyricsWords = maximumCustomLyricsWords(length, style);
  const recommendedLyricsWords = recommendedCustomLyricsWords(length, style);
  const lyricsPronunciationRisks = useMemo(() => customLyricsPronunciationRisks(lyrics), [lyrics]);
  const lyricsWordCountValid = lyricsWordCount >= minimumLyricsWords && lyricsWordCount <= maximumLyricsWords;

  useEffect(() => {
    return () => {
      if (voiceIdeaUrl) URL.revokeObjectURL(voiceIdeaUrl);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [voiceIdeaUrl]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("revise") === "1") {
      setRevisionMode(true);
      setLyricsMode("custom");
    }
  }, []);

  function setVoiceIdea(file: File) {
    const maximumBytes = revisionMode ? 100 * 1024 * 1024 : 12 * 1024 * 1024;
    if (file.size > maximumBytes) {
      setError(revisionMode ? "Die Audiodatei ist zu groß. Maximal erlaubt sind 100 MB." : "Die Sprachidee ist zu groß. Maximal erlaubt sind 12 MB.");
      return;
    }
    setError(null);
    if (voiceIdeaUrl) URL.revokeObjectURL(voiceIdeaUrl);
    setVoiceIdeaFile(file);
    setVoiceIdeaUrl(URL.createObjectURL(file));
    setVoiceIdeaAnalysis("");
    setVoiceIdeaConsent(false);
  }

  function removeVoiceIdea() {
    if (voiceIdeaUrl) URL.revokeObjectURL(voiceIdeaUrl);
    setVoiceIdeaFile(null);
    setVoiceIdeaUrl(null);
    setVoiceIdeaAnalysis("");
    setVoiceIdeaConsent(false);
    setError(null);
  }

  async function analyzeVoiceIdea(file = voiceIdeaFile): Promise<string> {
    if (!file) throw new Error("Bitte nimm zuerst eine Sprachidee auf oder lade eine Datei hoch.");
    if (!voiceIdeaConsent) throw new Error("Bitte bestätige zuerst die einmalige KI-Analyse deiner Aufnahme.");
    setAnalyzingVoiceIdea(true);
    setError(null);
    try {
      const formData = new FormData();
      const analysisFile = revisionMode || file.size > 3.8 * 1024 * 1024 ? await prepareReferenceForAnalysis(file) : file;
      formData.append("audio", analysisFile, analysisFile.name);
      formData.append("consent", "true");
      if (revisionMode) formData.append("purpose", "reference-song");
      const response = await fetch("/api/analyze-song-voice-idea", { method: "POST", body: formData });
      const data = await response.json() as { analysis?: string; error?: string };
      if (!response.ok || !data.analysis) throw new Error(data.error || "Die Sprachidee konnte nicht analysiert werden.");
      setVoiceIdeaAnalysis(data.analysis);
      return data.analysis;
    } finally {
      setAnalyzingVoiceIdea(false);
    }
  }

  async function prepareReferenceForAnalysis(file: File): Promise<File> {
    if (file.size <= 3.8 * 1024 * 1024 && file.type !== "audio/wav" && file.type !== "audio/x-wav" && file.type !== "audio/flac") return file;
    setCompressingReference(true);
    try {
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        const sampleRate = 8_000;
        const analysisSeconds = Math.min(decoded.duration, 220);
        const length = Math.ceil(analysisSeconds * sampleRate);
        const offline = new OfflineAudioContext(1, length, sampleRate);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const rendered = await offline.startRendering();
        const samples = rendered.getChannelData(0);
        const output = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(output);
        const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
        write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
        for (let index = 0; index < samples.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, samples[index]));
          view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        return new File([output], "referenzsong-analyse.wav", { type: "audio/wav" });
      } finally {
        await context.close();
      }
    } catch {
      throw new Error("Diese Audiodatei konnte im Browser nicht vorbereitet werden. Bitte nutze MP3, WAV oder M4A.");
    } finally {
      setCompressingReference(false);
    }
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Direkte Aufnahme wird von diesem Browser nicht unterstützt. Bitte lade stattdessen eine Audiodatei hoch.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || preferredType || "audio/webm";
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        const extension = mimeType.includes("mp4") ? "m4a" : "webm";
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (blob.size >= 1_000) setVoiceIdea(new File([blob], `sprachidee.${extension}`, { type: mimeType }));
        else setError("Die Aufnahme war zu kurz. Bitte versuche es noch einmal.");
      };
      recorder.start(500);
      setRecording(true);
    } catch {
      setError("Das Mikrofon konnte nicht geöffnet werden. Bitte erlaube den Mikrofonzugriff oder lade eine Datei hoch.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    setRecording(false);
  }

  async function checkout() {
    setError(null);
    if (description.trim().length < 10 && !voiceIdeaFile && !voiceIdeaAnalysis) {
      setError("Bitte beschreibe deine Songidee oder füge eine Sprachidee hinzu.");
      return;
    }
    if (lyricsMode === "custom" && lyrics.trim().length < 10) {
      setError("Bitte gib deine Lyrics ein.");
      return;
    }
    if (lyricsMode === "custom" && lyricsWordCount < minimumLyricsWords) {
      setError(`Für diese Songlänge brauchst du mindestens ${minimumLyricsWords} Wörter. So werden ganze Strophen nicht unnötig wiederholt.`);
      return;
    }
    if (lyricsMode === "custom" && lyricsWordCount > maximumLyricsWords) {
      setError(`Für diese Songlänge sind ${lyricsWordCount} Wörter zu viel. Bitte kürze den Text auf höchstens ${maximumLyricsWords} Wörter, damit der Gesang nicht gehetzt wird.`);
      return;
    }
    if (lyricsMode === "custom" && lyricsPronunciationRisks.length > 0) {
      setError(`${lyricsPronunciationRisks[0]}. Bitte schreibe jedes Wort normal aus. Lange Töne erzeugt die Musik-KI selbst.`);
      return;
    }
    if (lyricsMode === "custom" && !rightsAccepted) {
      setError("Bitte bestätige, dass du die Lyrics verwenden darfst.");
      return;
    }
    if (revisionMode && !voiceIdeaFile) {
      setError("Bitte lade zuerst den fertigen Ausgangssong hoch.");
      return;
    }
    if (revisionMode && !referenceRightsAccepted) {
      setError("Bitte bestätige, dass du den Ausgangssong verwenden und neu bearbeiten darfst.");
      return;
    }

    setLoading(true);
    try {
      const analyzedVoiceIdea = voiceIdeaFile && !voiceIdeaAnalysis
        ? await analyzeVoiceIdea(voiceIdeaFile)
        : voiceIdeaAnalysis;
      const response = await fetch("/api/create-song-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          style,
          mood,
          length,
          lyricsMode,
          lyrics: lyricsMode === "custom" ? lyrics : undefined,
          language,
          vocalStyle,
          rightsAccepted,
          voiceIdeaAnalysis: analyzedVoiceIdea || undefined,
          revisionMode,
          revisionApproach: revisionMode ? revisionApproach : undefined,
          referenceRightsAccepted,
        }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Der sichere Checkout konnte nicht geöffnet werden.");
      window.location.href = data.url;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Bitte versuche es erneut.");
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <Background />
      <Header active="song" onStudioChange={onStudioChange} />

      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <section className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200">
            <SparklesIcon /> Lyria 3 Musik-KI
          </div>
          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
            Deine Idee wird zum
            <span className="block bg-gradient-to-r from-violet-300 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">fertigen Song</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            Erstelle reine Musik ohne Video – instrumental, mit neu geschriebenen KI-Lyrics oder mit deinem eigenen Songtext. Als hochwertige MP3 zum Anhören und Herunterladen.
          </p>
          <StudioChooser active="song" onChange={onStudioChange} />
          <div className="mx-auto mt-5 flex max-w-xl rounded-2xl border border-white/10 bg-black/25 p-1.5">
            <button type="button" onClick={() => { setRevisionMode(false); removeVoiceIdea(); }} className={`flex-1 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${!revisionMode ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-white"}`}>Neuen Song erstellen</button>
            <button type="button" onClick={() => { setRevisionMode(true); setLyricsMode("custom"); setRightsAccepted(false); setVoiceIdeaConsent(false); setVoiceIdeaAnalysis(""); }} className={`flex-1 rounded-xl px-4 py-2.5 text-xs font-semibold transition ${revisionMode ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-white"}`}>Fertigen Song bearbeiten</button>
          </div>
        </section>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
            {revisionMode && (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 text-sm leading-6 text-zinc-300">
                <p className="font-semibold text-cyan-100">Song als neue Version bearbeiten</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">Die KI analysiert Klang, Tempo, Aufbau und Gesangsart. Danach entsteht eine neue Originalversion mit deinen geänderten Lyrics und Einstellungen. Eine exakt identische Melodie oder Stimme kann technisch nicht garantiert werden.</p>
              </div>
            )}
            <Field label="Songtitel" hint="optional">
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Zum Beispiel: Lichter der Nacht" className={inputClass} />
            </Field>

            <Field label="Worum geht es in deinem Song?" hint="Beschreibe Thema, Klang und besondere Wünsche">
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={6000} rows={8} placeholder="Beschreibe ausführlich Thema, Handlung, Klang, Instrumente, Stimmung, Aufbau, Refrain und alle besonderen Wünsche für deinen Song ..." className={inputClass} />
              <div className="mt-2 text-right text-[11px] text-zinc-600">{description.length} / 6000</div>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField label="Musikstil" value={style} onChange={(value) => {
                setStyle(value);
                if (value === "Deutschrap / Straßenrap") setLanguage("de");
                if (value === "Türkischer Arabesk") {
                  setLanguage("tr");
                  setMood("Hüzünlü / Sehnsüchtig");
                }
              }} options={styles} />
              <SelectField label="Stimmung" value={mood} onChange={setMood} options={moods} />
            </div>
            {style === "Deutschrap / Straßenrap" && (
              <div className="rounded-2xl border border-fuchsia-400/15 bg-fuchsia-500/[0.045] px-4 py-3 text-xs leading-5 text-zinc-400">
                Automatisch mit natürlichen deutschen Rap-Lyrics, zwei langen Strophen, sauberem Reimschema und einer zusammenhängenden Geschichte. Keine erfundene Grammatik und keine automatisch eingestreuten Klischeewörter.
              </div>
            )}
            {style === "Türkischer Arabesk" && (
              <div className="rounded-2xl border border-fuchsia-400/15 bg-fuchsia-500/[0.045] px-4 py-3 text-xs leading-5 text-zinc-400">
                Automatisch langsam, dramatisch und tief traurig mit großem Streichorchester, Piano und dezentem Bağlama – kein orientalischer Tanzklang und keine dominante Darbuka, Oud oder Kanun.
              </div>
            )}

            <Field label={revisionMode ? "Fertigen Ausgangssong hochladen" : "Sprachidee oder Melodie"} hint={revisionMode ? "MP3, WAV, M4A · bis 100 MB" : "optional · bis 12 MB"}>
              <div className="rounded-2xl border border-fuchsia-400/15 bg-fuchsia-500/[0.045] p-4">
                <p className="text-xs leading-5 text-zinc-400">
                  {revisionMode ? "Lade deinen gekauften oder eigenen Song hoch. Die KI erkennt Tempo, Groove, Instrumente, Aufbau und den allgemeinen Gesangscharakter; die Datei selbst wird nicht dauerhaft gespeichert." : "Erkläre deinen Musikwunsch oder summe bzw. singe eine Melodie vor. Die KI erkennt Stimmung, Tempo, Rhythmus und Aufbau – deine Stimme wird nicht geklont."}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  {!revisionMode && <button type="button" onClick={() => recording ? stopRecording() : void startRecording()} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${recording ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-white/10 bg-black/25 text-zinc-200 hover:border-fuchsia-400/30"}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${recording ? "animate-pulse bg-red-400" : "bg-fuchsia-400"}`} />
                    {recording ? "Aufnahme beenden" : "Sprachidee aufnehmen"}
                  </button>}
                  <label className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-fuchsia-400/30">
                    {revisionMode ? "Ausgangssong auswählen" : "Audiodatei hochladen"}
                    <input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/flac,audio/webm" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) setVoiceIdea(file); event.target.value = ""; }} />
                  </label>
                </div>
                {voiceIdeaFile && voiceIdeaUrl && (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-xs font-medium text-zinc-200">{voiceIdeaFile.name}</p><p className="mt-1 text-[11px] text-zinc-500">{(voiceIdeaFile.size / 1024 / 1024).toFixed(1)} MB</p></div>
                      <button type="button" onClick={removeVoiceIdea} className="text-xs text-zinc-500 transition hover:text-red-300">Entfernen</button>
                    </div>
                    <audio controls preload="metadata" src={voiceIdeaUrl} className="mt-3 h-10 w-full" />
                    <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-zinc-400">
                      <input type="checkbox" checked={voiceIdeaConsent} onChange={(event) => setVoiceIdeaConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-fuchsia-500" />
                       {revisionMode ? "Ich stimme der einmaligen KI-Analyse dieses Songs zu. Die Audiodatei wird nicht dauerhaft gespeichert und die Stimme nicht geklont." : "Ich stimme zu, dass diese Aufnahme einmalig durch die Musik-KI analysiert wird. Die Audiodatei wird nicht dauerhaft gespeichert und meine Stimme nicht geklont."}
                    </label>
                    <button type="button" onClick={() => void analyzeVoiceIdea().catch((analysisError) => setError(analysisError instanceof Error ? analysisError.message : "Die Analyse ist fehlgeschlagen."))} disabled={analyzingVoiceIdea} className="mt-3 w-full rounded-lg bg-fuchsia-500/15 px-3 py-2.5 text-xs font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/25 disabled:cursor-wait disabled:opacity-60">
                       {compressingReference ? "Analysefassung wird vorbereitet ..." : analyzingVoiceIdea ? (revisionMode ? "Song wird analysiert ..." : "Sprachidee wird verstanden ...") : voiceIdeaAnalysis ? "Erneut analysieren" : revisionMode ? "Ausgangssong analysieren" : "Sprachidee analysieren"}
                    </button>
                  </div>
                )}
                {voiceIdeaAnalysis && <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3"><p className="text-[11px] font-medium uppercase tracking-wider text-emerald-300">{revisionMode ? "Ausgangssong analysiert" : "Musikwunsch erkannt"}</p><p className="mt-2 text-xs leading-5 text-zinc-400">{voiceIdeaAnalysis}</p></div>}
              </div>
            </Field>

            {revisionMode && (
              <Field label="Was soll musikalisch verändert werden?">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Choice compact active={revisionApproach === "character"} onClick={() => setRevisionApproach("character")} title="Klang nah halten" description="Tempo, Groove und Aufbau möglichst ähnlich" />
                  <Choice compact active={revisionApproach === "new-melody"} onClick={() => setRevisionApproach("new-melody")} title="Neue Melodie" description="Ähnlicher Stil, aber neue Hook und Melodie" />
                  <Choice compact active={revisionApproach === "free"} onClick={() => setRevisionApproach("free")} title="Frei verändern" description="Arrangement, Melodie und Stimme neu denken" />
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-zinc-400">
                  <input type="checkbox" checked={referenceRightsAccepted} onChange={(event) => setReferenceRightsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 accent-fuchsia-500" />
                  Ich bestätige, dass mir der Song gehört oder ich die notwendigen Rechte und Erlaubnisse für diese neue Version habe.
                </label>
              </Field>
            )}

            <Field label="Songlänge">
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice active={length === "clip"} onClick={() => setLength("clip")} title="30 Sekunden" description="Hook, Loop oder Vorschau" badge="2,99 €" />
                <Choice active={length === "full2"} onClick={() => setLength("full2")} title="2 Minuten" description="Vollsong mit Strophen und Refrain" badge="7,99 €" />
                <Choice active={length === "full3"} onClick={() => setLength("full3")} title="3 Minuten" description="Vollsong mit Bridge und Outro" badge="9,99 €" recommended />
                <Choice active={false} onClick={() => undefined} title="4 Minuten" description="Qualitätstest läuft – noch nicht buchbar" badge="Demnächst" disabled />
              </div>
            </Field>

            <Field label="Lyrics und Gesang">
              <div className="grid gap-3 sm:grid-cols-3">
                <Choice compact active={lyricsMode === "instrumental"} onClick={() => setLyricsMode("instrumental")} title="Instrumental" description="Ohne Stimme" />
                <Choice compact active={lyricsMode === "ai"} onClick={() => setLyricsMode("ai")} title="KI-Lyrics" description="Text wird erstellt" />
                <Choice compact active={lyricsMode === "custom"} onClick={() => setLyricsMode("custom")} title="Eigene Lyrics" description="Dein Songtext" />
              </div>
            </Field>

            {lyricsMode === "custom" && (
              <Field label="Deine Lyrics" hint="[Verse], [Chorus] und [Bridge] helfen bei der Struktur">
                <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} maxLength={8000} rows={12} placeholder={"[Verse 1]\n...\n\n[Chorus]\n...\n\n[Verse 2]\n..."} className={`${inputClass} font-mono text-sm`} />
                <div className={`mt-2 flex items-center justify-between gap-3 text-[11px] ${lyricsWordCountValid ? "text-emerald-400/70" : "text-amber-300/70"}`}><span>{lyricsWordCount} Wörter</span><span>{minimumLyricsWords}–{maximumLyricsWords} erlaubt</span></div>
                <p className="mt-1 text-[11px] leading-5 text-zinc-500">Für {style} und diese Länge empfohlen: {recommendedLyricsWords.minimum}–{recommendedLyricsWords.maximum} Wörter. Das sorgt für ein natürlicheres Gesangstempo.</p>
                {lyricsPronunciationRisks.length > 0 && <p className="mt-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-200/80">{lyricsPronunciationRisks[0]}. Bitte normal schreiben, zum Beispiel „değil“ statt „değiiil“.</p>}
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-zinc-400">
                  <input type="checkbox" checked={rightsAccepted} onChange={(event) => setRightsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 accent-fuchsia-500" />
                  Ich bestätige, dass der Text von mir stammt oder ich die nötigen Rechte und Einwilligungen zur Nutzung habe.
                </label>
              </Field>
            )}

            {lyricsMode !== "instrumental" && (
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Stimme"
                  value={vocalStyle}
                  onChange={(value) => setVocalStyle(value as SongVocalStyle)}
                  options={["auto", "female", "male", "duet", "choir"]}
                  labels={{ auto: "Automatisch", female: "Weibliche Stimme", male: "Männliche Stimme", duet: "Duett", choir: "Chor" }}
                />
                <SelectField
                  label="Sprache"
                  value={language}
                  onChange={(value) => setLanguage(value as SongLanguage)}
                  options={["de", "tr", "en", "auto"]}
                  labels={{ de: "Deutsch", tr: "Türkçe", en: "Englisch", auto: "Automatisch" }}
                />
              </div>
            )}

          </section>

          <aside className="h-fit rounded-3xl border border-fuchsia-400/15 bg-gradient-to-b from-fuchsia-500/[0.09] to-violet-500/[0.04] p-6 shadow-2xl shadow-fuchsia-950/20 lg:sticky lg:top-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 shadow-lg shadow-fuchsia-950/40">
              <MusicIcon />
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-fuchsia-300">Dein KI-Song</p>
            <h2 className="mt-2 text-2xl font-semibold">{length === "clip" ? "30-Sekunden-Song" : `${length === "full2" ? 2 : length === "full3" ? 3 : 4}-Minuten-Vollsong`}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {revisionMode ? "Eine neue Originalversion nach der Analyse deines Ausgangssongs und deinen Änderungen." : lyricsMode === "instrumental" ? "Originale Instrumentalmusik ohne Gesang." : lyricsMode === "custom" ? "Komponiert und gesungen mit deinen Lyrics." : "Komposition, Gesang und neue Lyrics aus deiner Idee."}
            </p>
            <div className="my-6 h-px bg-white/10" />
            <ul className="space-y-3 text-sm text-zinc-300">
              <Benefit>Hochwertige Stereo-MP3</Benefit>
              <Benefit>Nur Musik – kein Video nötig</Benefit>
              <Benefit>Sicherer Download nach Erstellung</Benefit>
              <Benefit>Originalkomposition mit SynthID</Benefit>
            </ul>
            <div className="my-6 h-px bg-white/10" />
            <div className="flex items-end justify-between">
              <span className="text-sm text-zinc-400">Einmalig</span>
              <span className="text-3xl font-semibold tracking-tight">{price}</span>
            </div>
            {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs leading-5 text-red-200">{error}</p>}
            <button onClick={() => void checkout()} disabled={loading || analyzingVoiceIdea || recording} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/40 transition hover:from-fuchsia-500 hover:to-violet-500 disabled:cursor-wait disabled:opacity-60">
              {compressingReference ? "Audiodatei wird vorbereitet ..." : analyzingVoiceIdea ? (revisionMode ? "Ausgangssong wird analysiert ..." : "Sprachidee wird analysiert ...") : loading ? "Checkout wird geöffnet ..." : revisionMode ? `Neue Version für ${price} erstellen` : `Song für ${price} erstellen`}
              {!loading && <ArrowIcon />}
            </button>
            <p className="mt-4 flex items-center justify-center gap-2 text-[11px] text-zinc-500"><LockIcon /> Erst bezahlen, dann wird der Song erzeugt</p>
          </aside>
        </div>

        <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-zinc-600 sm:flex-row">
          <p>© 2026 KI Video Studio</p>
          <p>KI-Songs und Videos an einem Ort</p>
        </footer>
      </div>
    </main>
  );
}

const inputClass = "w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-400/40 focus:ring-2 focus:ring-fuchsia-500/10";

function Background() {
  return <div className="pointer-events-none absolute inset-0"><div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-fuchsia-700/20 blur-[140px]" /><div className="absolute right-[-180px] top-[180px] h-[460px] w-[460px] rounded-full bg-violet-700/15 blur-[140px]" /><div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" /></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><div className="mb-2 flex items-center justify-between gap-4"><label className="text-sm font-medium text-zinc-200">{label}</label>{hint && <span className="text-[11px] text-zinc-600">{hint}</span>}</div>{children}</div>;
}

function SelectField({ label, value, onChange, options, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return <Field label={label}><select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>{options.map((option) => <option key={option} value={option} className="bg-zinc-950">{labels[option] || option}</option>)}</select></Field>;
}

function Choice({ active, onClick, title, description, badge, recommended, compact, disabled }: { active: boolean; onClick: () => void; title: string; description: string; badge?: string; recommended?: boolean; compact?: boolean; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`relative rounded-2xl border text-left transition ${compact ? "p-3.5" : "p-4"} ${disabled ? "cursor-not-allowed border-white/5 bg-black/10 opacity-45" : active ? "border-fuchsia-400/40 bg-fuchsia-400/10 shadow-lg shadow-fuchsia-950/20" : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]"}`}>{recommended && <span className="absolute right-3 top-3 rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-fuchsia-200">Beliebt</span>}<div className="flex items-center justify-between gap-3"><span className={`text-sm font-medium ${active ? "text-white" : "text-zinc-300"}`}>{title}</span>{badge && <span className="text-xs font-semibold text-fuchsia-300">{badge}</span>}</div><p className="mt-1 text-[11px] leading-5 text-zinc-500">{description}</p></button>;
}

function Benefit({ children }: { children: React.ReactNode }) {
  return <li className="flex items-center gap-2.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/10 text-[10px] text-emerald-300">✓</span>{children}</li>;
}
