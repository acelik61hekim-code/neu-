"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";

import Chat from "@/components/Chat";
import Header from "@/components/Header";
import StoryPreview from "@/components/StoryPreview";
import SongStudio from "@/components/SongStudio";
import ImageStudio from "@/components/ImageStudio";
import StudioChooser, { type StudioMode } from "@/components/StudioChooser";
import {
  formatEuroPrice,
  getVideoPriceCents,
  isReleasedVideoDuration,
} from "@/lib/pricing";
import { STUDIO_PATHS } from "@/lib/site";
import { requestAutomaticVoiceover } from "@/services/voiceoverClient";

import type {
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

const VIDEO_DURATION_OPTIONS: Array<{
  value: VideoDurationSeconds;
  label: string;
}> = [
  { value: 8, label: "8 Sek." },
  { value: 30, label: "30 Sek." },
  { value: 60, label: "1 Min." },
  { value: 120, label: "2 Min." },
  { value: 180, label: "3 Min." },
  { value: 240, label: "4 Min." },
  { value: 300, label: "5 Min." },
];

const VIDEO_FORMAT_OPTIONS: Array<{
  value: VideoAspectRatio;
  label: string;
  description: string;
}> = [
  {
    value: "9:16",
    label: "9:16 Vertikal",
    description: "Reels, Shorts, TikTok",
  },
  {
    value: "16:9",
    label: "16:9 Widescreen",
    description: "Kino, Film, YouTube",
  },
];

const VIDEO_STYLE_OPTIONS: Array<{
  value: VideoEditingStyle;
  label: string;
  description: string;
}> = [
  {
    value: "social",
    label: "Social / Reels",
    description:
      "Schneller, direkter Schnitt mit frühem Hook.",
  },
  {
    value: "cinematic",
    label: "Kino / Film",
    description:
      "Filmische Einstellungen, motivierte Schnitte und längere Takes.",
  },
  {
    value: "music-video",
    label: "Musikvideo",
    description:
      "Rhythmische Bildsprache für Songs und Musik.",
  },
  {
    value: "auto",
    label: "Auto",
    description:
      "Der AI Director wählt die passende Filmsprache.",
  },
];

const AUDIO_STYLE_OPTIONS: Array<{
  value: VideoAudioStyle;
  label: string;
}> = [
  { value: "cinematic", label: "Filmisch" },
  { value: "emotional", label: "Emotional" },
  { value: "upbeat", label: "Energie" },
  { value: "electronic", label: "Elektronisch" },
  { value: "ambient", label: "Atmosphärisch" },
  { value: "no-music", label: "Keine Musik" },
];

const VOICE_MODE_OPTIONS: Array<{
  value: VideoVoiceMode;
  label: string;
}> = [
  { value: "auto", label: "Automatisch" },
  { value: "dialogue", label: "Dialog (in Arbeit)" },
  { value: "voiceover", label: "Voice-over" },
  { value: "no-voice", label: "Ohne Sprache" },
];

const SPOKEN_LANGUAGE_OPTIONS: Array<{
  value: VideoSpokenLanguage;
  label: string;
}> = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
  { value: "auto", label: "Automatisch" },
];

type PreviewApiResponse = {
  success?: boolean;
  imageData?: string;
  mimeType?: string;
  referenceImageUri?: string;
  error?: string;
};

async function optimizeReferenceImage(file: File): Promise<string> {
  const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!supportedTypes.includes(file.type)) {
    throw new Error("Bitte lade ein JPG-, PNG- oder WebP-Bild hoch.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Das Originalbild darf höchstens 15 MB groß sein.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
      element.src = objectUrl;
    });

    const maximumDimension = 1000;
    const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Bild konnte nicht vorbereitet werden.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let optimized = canvas.toDataURL("image/jpeg", 0.8);
    if (optimized.length > 1_200_000) {
      optimized = canvas.toDataURL("image/jpeg", 0.65);
    }
    if (optimized.length > 1_200_000) {
      throw new Error("Das Bild ist trotz Optimierung noch zu groß. Bitte verwende ein kleineres Bild.");
    }
    return optimized;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function HomePage({
  initialStudio = "video",
}: {
  initialStudio?: StudioMode;
}) {
  const [studioMode, setStudioMode] = useState<StudioMode>(initialStudio);

  useEffect(() => {
    const requestedStudio = new URLSearchParams(window.location.search).get("studio");
    if (requestedStudio === "song" || requestedStudio === "image") setStudioMode(requestedStudio);
  }, []);

  function selectStudio(mode: StudioMode) {
    const targetPath = STUDIO_PATHS[mode];
    if (window.location.pathname !== targetPath) {
      window.location.assign(targetPath);
      return;
    }
    setStudioMode(mode);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [story, setStory] = useState("");

  const [
    targetDurationSeconds,
    setTargetDurationSeconds,
  ] = useState<VideoDurationSeconds>(
    30,
  );

  const [
    aspectRatio,
    setAspectRatio,
  ] = useState<VideoAspectRatio>(
    "9:16",
  );

  const [
    editingStyle,
    setEditingStyle,
  ] = useState<VideoEditingStyle>(
    "social",
  );

  const [audioStyle, setAudioStyle] =
    useState<VideoAudioStyle>("cinematic");

  const [voiceMode, setVoiceMode] =
    useState<VideoVoiceMode>("auto");

  const [spokenLanguage, setSpokenLanguage] =
    useState<VideoSpokenLanguage>("de");

  const [voiceoverText, setVoiceoverText] =
    useState("");

  const [voiceoverLoading, setVoiceoverLoading] =
    useState(false);

  const [closingText, setClosingText] =
    useState("");

  const [referenceImages, setReferenceImages] =
    useState<Array<{ dataUrl: string; name: string }>>([]);

  const [
    chatSessionKey,
    setChatSessionKey,
  ] = useState(0);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [
    previewLoading,
    setPreviewLoading,
  ] = useState(false);

  const [
    previewImage,
    setPreviewImage,
  ] = useState<string | null>(
    null,
  );

  const [
    previewApproved,
    setPreviewApproved,
  ] = useState(false);

  const [previewReferenceUri, setPreviewReferenceUri] =
    useState<string | null>(null);

  const [previewReferenceMimeType, setPreviewReferenceMimeType] =
    useState<string | null>(null);

  function resetPlannedProject() {
    setStory("");
    setPreviewImage(null);
    setPreviewApproved(false);
    setPreviewReferenceUri(null);
    setPreviewReferenceMimeType(null);
    setError(null);

    /*
     * Chat besitzt eigene Gesprächs- und Filmplan-States.
     * Durch einen neuen Key wird der Chat sauber neu gestartet,
     * sobald Dauer, Format oder Schnittstil geändert werden.
     */
    setChatSessionKey(
      (previous) =>
        previous + 1,
    );
  }

  function selectDuration(
    value: VideoDurationSeconds,
  ) {
    if (
      value ===
      targetDurationSeconds
    ) {
      return;
    }

    setTargetDurationSeconds(
      value,
    );

    if (voiceMode === "dialogue") {
      setVoiceMode("auto");
    }

    resetPlannedProject();
  }

  function selectAspectRatio(
    value: VideoAspectRatio,
  ) {
    if (
      value === aspectRatio
    ) {
      return;
    }

    setAspectRatio(value);

    resetPlannedProject();
  }

  function selectEditingStyle(
    value: VideoEditingStyle,
  ) {
    if (
      value === editingStyle
    ) {
      return;
    }

    setEditingStyle(value);

    resetPlannedProject();
  }

  function selectAudioStyle(value: VideoAudioStyle) {
    if (value === audioStyle) return;
    setAudioStyle(value);
    resetPlannedProject();
  }

  function selectVoiceMode(value: VideoVoiceMode) {
    if (value === "dialogue") {
      setError(
        "Der Dialogmodus wird gerade qualitativ überarbeitet. Nutze Voice-over für eine durchgehend stabile Stimme.",
      );
      return;
    }

    if (value === voiceMode) return;
    setVoiceMode(value);
    resetPlannedProject();
  }

  function selectSpokenLanguage(value: VideoSpokenLanguage) {
    if (value === spokenLanguage) return;
    setSpokenLanguage(value);
    resetPlannedProject();
  }

  async function handleReferenceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    const availableSlots = 3 - referenceImages.length;
    if (availableSlots <= 0) {
      setError("Du kannst höchstens drei Referenzbilder verwenden.");
      return;
    }

    try {
      setPreviewLoading(true);
      setError(null);
      const selectedFiles = files.slice(0, availableSlots);
      const optimized = await Promise.all(
        selectedFiles.map(async (file) => ({
          dataUrl: await optimizeReferenceImage(file),
          name: file.name,
        })),
      );
      setReferenceImages((current) => [...current, ...optimized]);
      setPreviewImage(null);
      setPreviewApproved(false);
      setPreviewReferenceUri(null);
      setPreviewReferenceMimeType(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Das Bild konnte nicht vorbereitet werden.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function removeReferenceImage(index: number) {
    setReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setPreviewImage(null);
    setPreviewApproved(false);
    setPreviewReferenceUri(null);
    setPreviewReferenceMimeType(null);
  }

  function handleStoryChange(
    updatedStory: string,
  ) {
    setStory(updatedStory);

    /*
     * Sobald sich die Story ändert,
     * ist eine vorherige Vorschau
     * nicht mehr gültig.
     */
    setPreviewImage(null);
    setPreviewApproved(false);
    setPreviewReferenceUri(null);
    setPreviewReferenceMimeType(null);

    if (error) {
      setError(null);
    }
  }

  async function handleAutomaticVoiceover() {
    let plannedStory: unknown;

    try {
      plannedStory = JSON.parse(story);
    } catch {
      setError(
        "Schließe zuerst die Geschichte mit dem AI Director ab.",
      );
      return;
    }

    if (
      typeof plannedStory !== "object" ||
      plannedStory === null ||
      !("moviePlan" in plannedStory)
    ) {
      setError(
        "Schließe zuerst die Geschichte mit dem AI Director ab.",
      );
      return;
    }

    try {
      setVoiceoverLoading(true);
      setError(null);

      const automaticVoiceover =
        await requestAutomaticVoiceover(
          plannedStory,
          targetDurationSeconds,
          spokenLanguage,
        );

      setVoiceoverText(automaticVoiceover);
    } catch (voiceoverError) {
      setError(
        voiceoverError instanceof Error
          ? voiceoverError.message
          : "Der Sprechertext konnte nicht automatisch erstellt werden.",
      );
    } finally {
      setVoiceoverLoading(false);
    }
  }

  function getPreviewPrompt(): string {
    const cleanedStory =
      story.trim();

    if (!cleanedStory) {
      return "";
    }

    /*
     * Wenn der Story Architect bereits
     * seine JSON-Story erstellt hat,
     * verwenden wir bevorzugt den
     * Opening-Prompt.
     */
    try {
      const parsed =
        JSON.parse(
          cleanedStory,
        ) as {
          title?: string;
          summary?: string;

          moviePlan?: {
            opening?: {
              veoPrompt?: string;
              action?: string;
              hook?: string;
            };
          };
        };

      const openingPrompt =
        parsed.moviePlan?.opening
          ?.veoPrompt;

      if (
        typeof openingPrompt ===
          "string" &&
        openingPrompt.trim()
      ) {
        return openingPrompt.trim();
      }

      const summary =
        parsed.summary;

      if (
        typeof summary ===
          "string" &&
        summary.trim()
      ) {
        return [
          parsed.title ?? "",
          summary,
        ]
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      /*
       * Während des Gesprächs ist story
       * noch normaler Text und kein JSON.
       */
    }

    return cleanedStory;
  }

  async function handleGeneratePreview() {
    const previewPrompt =
      getPreviewPrompt();

    if (!previewPrompt) {
      setError(
        "Erstelle zuerst deine Story mit dem AI Director.",
      );

      return;
    }

    if (voiceMode === "voiceover" && !voiceoverText.trim()) {
      setError(
        "Bitte gib unter Audio den exakten Sprechertext ein.",
      );
      return;
    }

    try {
      setPreviewLoading(true);

      setError(null);

      setPreviewApproved(false);

      const response =
        await fetch(
          "/api/generate-preview",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              prompt:
                previewPrompt,

              aspectRatio,

              editingStyle,

              referenceImages:
                referenceImages.map((image) => image.dataUrl),
            }),
          },
        );

      const data =
        (await response.json()) as PreviewApiResponse;

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Die Vorschau konnte nicht erstellt werden.",
        );
      }

      if (!data.imageData) {
        throw new Error(
          "Die Bilddaten der Vorschau fehlen.",
        );
      }

      if (!data.referenceImageUri || !data.mimeType) {
        throw new Error("Die sichere Referenz der Vorschau fehlt.");
      }

      const mimeType =
        data.mimeType ||
        "image/png";

      const dataUrl =
        `data:${mimeType};base64,${data.imageData}`;

      setPreviewImage(
        dataUrl,
      );

      setPreviewReferenceUri(data.referenceImageUri);
      setPreviewReferenceMimeType(data.mimeType);
    } catch (
      caughtError
    ) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Die Vorschau konnte nicht erstellt werden.";

      setError(message);

      setPreviewImage(
        null,
      );

      setPreviewReferenceUri(null);
      setPreviewReferenceMimeType(null);
    } finally {
      setPreviewLoading(
        false,
      );
    }
  }

  async function handleCreateVideo() {
    const cleanedStory =
      story.trim();

    if (!cleanedStory) {
      setError(
        "Beantworte zuerst die Fragen des AI Directors.",
      );

      return;
    }

    /*
     * NEU:
     * Ohne bestätigte Vorschau
     * gibt es noch keine Zahlung.
     */
    if (
      !previewImage ||
      !previewApproved ||
      !previewReferenceUri ||
      !previewReferenceMimeType
    ) {
      setError(
        "Erstelle und bestätige zuerst deine Vorschau.",
      );

      return;
    }

    try {
      setLoading(true);

      setError(null);

      const response =
        await fetch(
          "/api/create-checkout-session",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                prompt:
                  cleanedStory,

                /*
                 * "format" bleibt vorerst für die bestehende
                 * Checkout-Route erhalten.
                 */
                format:
                  "long",

                targetDurationSeconds,

                aspectRatio,

                editingStyle,

                audioStyle,

                voiceMode,

                spokenLanguage,

                voiceoverText,

                closingText,

                referenceImageUri:
                  previewReferenceUri,

                referenceImageMimeType:
                  previewReferenceMimeType,
              }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Die Stripe-Bezahlung konnte nicht vorbereitet werden.",
        );
      }

      /*
       * Deine bestehende Route
       * liefert momentan data.url.
       */
      if (!data.url) {
        throw new Error(
          "Die Weiterleitungsadresse von Stripe fehlt.",
        );
      }

      window.location.href =
        data.url;
    } catch (
      caughtError
    ) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Ein unbekannter Fehler ist aufgetreten.";

      setError(message);

      setLoading(false);
    }
  }

  if (studioMode === "song") {
    return <SongStudio onStudioChange={selectStudio} />;
  }

  if (studioMode === "image") {
    return <ImageStudio onStudioChange={selectStudio} />;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-violet-700/20 blur-[140px]" />

        <div className="absolute right-[-180px] top-[120px] h-[420px] w-[420px] rounded-full bg-blue-700/15 blur-[140px]" />

        <div className="absolute bottom-[-240px] left-1/3 h-[520px] w-[520px] rounded-full bg-indigo-700/10 blur-[150px]" />

        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <Header active="video" onStudioChange={selectStudio} />

      <div className="relative z-10 mx-auto max-w-[1500px] px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        <section className="mx-auto mb-12 max-w-4xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />

            KI-gestützte
            Story- und
            Videoerstellung
          </div>

          <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl">
            Verwandle deine
            Idee in eine

            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">
              {" "}
              filmreife Story
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-pretty text-sm leading-7 text-zinc-400 sm:text-base">
            Entwickle deine
            Geschichte gemeinsam
            mit einem KI-Regisseur,
            prüfe zuerst eine
            visuelle Vorschau und
            erzeuge anschließend
            dein professionelles
            Video.
          </p>

          <StudioChooser active="video" onChange={selectStudio} />
        </section>

        <section className="mb-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="border-b border-white/10 px-5 py-4 sm:px-6">
            <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
              Projekt-Einstellungen
            </p>

            <h2 className="mt-1 text-lg font-semibold text-white">
              Länge, Format und Filmsprache
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Diese Auswahl bestimmt den Filmplan des AI Directors.
              Kino ist dabei nicht einfach Social-Video in 16:9:
              der Schnittstil wird separat geplant.
            </p>
          </div>

          <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-3">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Videolänge
              </p>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
                {VIDEO_DURATION_OPTIONS.map(
                  (option) => {
                    const released =
                      isReleasedVideoDuration(option.value);

                    return (
                      <button
                      key={
                        option.value
                      }
                      type="button"
                      onClick={() =>
                        selectDuration(
                          option.value,
                        )
                      }
                      disabled={
                        loading ||
                        previewLoading ||
                        !released
                      }
                      className={`rounded-xl border px-3 py-3 text-sm font-medium transition disabled:cursor-not-allowed ${
                        targetDurationSeconds ===
                        option.value
                          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                          : released
                            ? "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:bg-white/5 hover:text-white"
                            : "border-white/5 bg-black/10 text-zinc-600"
                      }`}
                    >
                        <span className="block">{option.label}</span>
                        <span className="mt-1 block text-xs font-normal">
                          {formatEuroPrice(getVideoPriceCents(option.value))}
                        </span>
                        {!released && (
                          <span className="mt-1 block text-[10px] font-normal uppercase tracking-wide text-amber-300/70">
                            Qualitätstest läuft
                          </span>
                        )}
                      </button>
                    );
                  },
                )}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-600">
                Für einen vollständigen Satz und einen sauberen Abschluss darf das fertige Video technisch bis zu 2 Sekunden länger auslaufen.
              </p>
            </div>

            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Bildformat
              </p>

              <div className="space-y-2">
                {VIDEO_FORMAT_OPTIONS.map(
                  (option) => (
                    <button
                      key={
                        option.value
                      }
                      type="button"
                      onClick={() =>
                        selectAspectRatio(
                          option.value,
                        )
                      }
                      disabled={
                        loading ||
                        previewLoading
                      }
                      className={`w-full rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        aspectRatio ===
                        option.value
                          ? "border-violet-400/50 bg-violet-500/15"
                          : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5"
                      }`}
                    >
                      <span className="block text-sm font-medium text-white">
                        {
                          option.label
                        }
                      </span>

                      <span className="mt-1 block text-xs text-zinc-500">
                        {
                          option.description
                        }
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Schnittstil
              </p>

              <div className="space-y-2">
                {VIDEO_STYLE_OPTIONS.map(
                  (option) => (
                    <button
                      key={
                        option.value
                      }
                      type="button"
                      onClick={() =>
                        selectEditingStyle(
                          option.value,
                        )
                      }
                      disabled={
                        loading ||
                        previewLoading
                      }
                      className={`w-full rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        editingStyle ===
                        option.value
                          ? "border-violet-400/50 bg-violet-500/15"
                          : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5"
                      }`}
                    >
                      <span className="block text-sm font-medium text-white">
                        {
                          option.label
                        }
                      </span>

                      <span className="mt-1 block text-xs leading-5 text-zinc-500">
                        {
                          option.description
                        }
                      </span>
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 p-5 sm:p-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                  KI-Musik, Ton und Stimmen
                </p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  Audio passend zum Video erzeugen
                </h3>
              </div>
              <span className="w-fit rounded-lg bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                Im Videopreis inklusive
              </span>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">Musikstil</p>
                <div className="grid grid-cols-2 gap-2">
                  {AUDIO_STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => selectAudioStyle(option.value)}
                      disabled={loading || previewLoading}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                        audioStyle === option.value
                          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                          : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">Stimmen</p>
                <div className="grid grid-cols-2 gap-2">
                  {VOICE_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => selectVoiceMode(option.value)}
                      disabled={
                        loading ||
                        previewLoading ||
                        option.value === "dialogue"
                      }
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                        voiceMode === option.value
                          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                          : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-amber-300/90">
                  Dialog wird gerade qualitativ überarbeitet. Für eine durchgehend identische Stimme nutze Voice-over.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-zinc-500">Gesprochene Sprache</p>
                <div className="grid grid-cols-3 gap-2">
                  {SPOKEN_LANGUAGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => selectSpokenLanguage(option.value)}
                      disabled={loading || previewLoading}
                      className={`rounded-xl border px-2 py-2 text-xs font-medium transition disabled:opacity-50 ${
                        spokenLanguage === option.value
                          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                          : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-zinc-600">
                  Bei Voice-over wird die durchgehend identische Studiostimme separat erzeugt und sauber mit Musik und Umgebung gemischt.
                </p>
                {voiceMode === "auto" && targetDurationSeconds > 8 ? (
                  <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                    Automatisch verwendet bei längeren Videos vorerst keine gesprochene Stimme, damit es zwischen den Abschnitten keinen Stimmenwechsel gibt.
                  </p>
                ) : null}
              </div>
            </div>

            {voiceMode === "voiceover" && (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-zinc-400">
                    Exakter Sprechertext
                  </span>
                  <textarea
                    value={voiceoverText}
                    onChange={(event) => setVoiceoverText(event.target.value)}
                    maxLength={4000}
                    rows={5}
                    placeholder="Schreibe hier Wort für Wort, was die Stimme sagen soll."
                    disabled={loading || previewLoading || voiceoverLoading}
                    className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-400/50 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleAutomaticVoiceover}
                    disabled={loading || previewLoading || voiceoverLoading || !story.trim()}
                    className="mt-3 rounded-xl border border-violet-400/40 bg-violet-500/15 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {voiceoverLoading
                      ? "Sprechertext wird erstellt …"
                      : voiceoverText.trim()
                        ? "Sprechertext neu erstellen"
                        : "Sprechertext automatisch erstellen"}
                  </button>
                  <span className="mt-1 block text-[11px] text-zinc-600">
                    Wird nach dem Filmplan automatisch erstellt und bleibt vor der Zahlung vollständig bearbeitbar. Das Video darf für einen vollständigen Satz bis zu 2 Sekunden länger auslaufen.
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-zinc-400">
                    Saubere Schluss-Einblendung (optional)
                  </span>
                  <textarea
                    value={closingText}
                    onChange={(event) => setClosingText(event.target.value)}
                    maxLength={160}
                    rows={5}
                    placeholder={"KI VIDEO STUDIO\nki-video-studio.vercel.app"}
                    disabled={loading || previewLoading}
                    className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-violet-400/50 disabled:opacity-50"
                  />
                  <span className="mt-1 block text-[11px] text-zinc-600">
                    Wird technisch gerendert, damit keine Fantasieschrift entsteht.
                  </span>
                </label>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Chat
            key={
              chatSessionKey
            }
            loading={
              loading ||
              previewLoading
            }
            error={error}
            onStoryChange={
              handleStoryChange
            }
            onVoiceoverTextChange={
              setVoiceoverText
            }
            targetDurationSeconds={
              targetDurationSeconds
            }
            aspectRatio={
              aspectRatio
            }
            editingStyle={
              editingStyle
            }
            audioStyle={audioStyle}
            voiceMode={voiceMode}
            spokenLanguage={spokenLanguage}
            voiceoverText={voiceoverText}
            closingText={closingText}
          />

          <div className="space-y-6">
            <StoryPreview
              prompt={story}
              loading={loading}
              targetDurationSeconds={
                targetDurationSeconds
              }
              aspectRatio={aspectRatio}
              onCreateVideo={
                handleCreateVideo
              }
            />

            <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div className="border-b border-white/10 px-5 py-4 sm:px-6">
                <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                  Vorschau vor der
                  Zahlung
                </p>

                <h2 className="mt-1 text-lg font-semibold text-white">
                  Prüfe zuerst den
                  Look deines Videos
                </h2>

                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Wir erzeugen ein
                  Beispielbild aus
                  deinem Filmplan.
                  Erst wenn dir
                  Stil, Figur,
                  Umgebung und
                  Qualität gefallen,
                  bestätigst du die
                  Vorschau und gehst
                  zur Zahlung.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
                    {
                      VIDEO_DURATION_OPTIONS.find(
                        (option) =>
                          option.value ===
                          targetDurationSeconds,
                      )?.label
                    }
                  </span>

                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
                    {aspectRatio}
                  </span>

                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
                    {
                      VIDEO_STYLE_OPTIONS.find(
                        (option) =>
                          option.value ===
                          editingStyle,
                      )?.label
                    }
                  </span>

                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
                    {AUDIO_STYLE_OPTIONS.find((option) => option.value === audioStyle)?.label} · KI-Audio
                  </span>
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">Eigenes Bild als Referenz</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Optional: Lade eine Person, Figur, ein Produkt oder einen Stil hoch. Die KI übernimmt die sichtbaren Merkmale in Vorschau und Video.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-emerald-400/10 px-2 py-1 text-[10px] font-medium text-emerald-300">
                      inklusive
                    </span>
                  </div>

                  {referenceImages.length > 0 && (
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {referenceImages.map((image, index) => (
                        <div key={`${image.name}-${index}`} className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
                          <img
                            src={image.dataUrl}
                            alt={`Hochgeladene Bildreferenz ${index + 1}`}
                            className="aspect-square w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeReferenceImage(index)}
                            disabled={previewLoading || loading}
                            className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
                            aria-label={`${image.name} entfernen`}
                          >
                            Entfernen
                          </button>
                          <p className="truncate px-2 py-1.5 text-[10px] text-zinc-500">{image.name}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {referenceImages.length < 3 && (
                    <label className="mt-4 flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-violet-400/30 bg-violet-400/[0.06] px-4 py-3 text-sm font-medium text-violet-200 transition hover:bg-violet-400/10">
                      {referenceImages.length === 0 ? "Bilder auswählen" : "Weiteres Bild hinzufügen"}
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => void handleReferenceImageChange(event)}
                        disabled={previewLoading || loading}
                        className="hidden"
                      />
                    </label>
                  )}

                  <p className="mt-3 text-[10px] leading-4 text-zinc-600">
                    Bis zu 3 Bilder. Verwende nur Bilder, für die du die nötigen Rechte und Einwilligungen besitzt. JPG, PNG oder WebP, je Original bis 15 MB.
                  </p>
                </div>

                {!previewImage && (
                  <button
                    type="button"
                    onClick={() =>
                      void handleGeneratePreview()
                    }
                    disabled={
                      previewLoading ||
                      loading ||
                      !story.trim()
                    }
                    className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {previewLoading
                      ? "Vorschau wird erstellt ..."
                      : "🖼 Vorschau erstellen"}
                  </button>
                )}

                {previewImage && (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                      <img
                        src={
                          previewImage
                        }
                        alt="KI-Vorschau des geplanten Videos"
                        className={`w-full object-cover ${
                          aspectRatio ===
                          "16:9"
                            ? "aspect-video"
                            : "aspect-[9/16]"
                        }`}
                      />
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs leading-5 text-zinc-400">
                        Die Vorschau
                        zeigt den
                        geplanten
                        visuellen
                        Stil und das
                        Motiv. Das
                        spätere
                        Video kann
                        bei Bewegung,
                        Kameraführung
                        und Details
                        leicht
                        abweichen.
                      </p>
                    </div>

                    {!previewApproved ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewApproved(
                              true,
                            )
                          }
                          disabled={
                            previewLoading
                          }
                          className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                        >
                          ✓ Gefällt mir
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleGeneratePreview()
                          }
                          disabled={
                            previewLoading
                          }
                          className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
                        >
                          {previewLoading
                            ? "Erstellt ..."
                            : "↻ Neue Vorschau"}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                        <p className="text-sm font-medium text-emerald-200">
                          ✓ Vorschau
                          bestätigt
                        </p>

                        <p className="mt-1 text-xs leading-5 text-emerald-200/70">
                          Du kannst
                          jetzt das
                          Video
                          bestellen
                          und zur
                          Zahlung
                          weitergehen.
                        </p>

                        <button
                          type="button"
                          onClick={() =>
                            void handleCreateVideo()
                          }
                          disabled={
                            loading
                          }
                          className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {loading
                            ? "Stripe wird geöffnet ..."
                            : "🎬 Video erstellen & bezahlen"}
                        </button>

                        <p className="mt-3 text-center text-xs leading-5 text-zinc-500">
                          Sicher bezahlen mit Karte, PayPal, Klarna, Apple Pay oder Link – je nach Verfügbarkeit.
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setPreviewImage(
                          null,
                        );

                        setPreviewApproved(
                          false,
                        );

                        setPreviewReferenceUri(
                          null,
                        );

                        setPreviewReferenceMimeType(
                          null,
                        );
                      }}
                      disabled={
                        previewLoading ||
                        loading
                      }
                      className="w-full text-center text-xs text-zinc-500 transition hover:text-zinc-300 disabled:opacity-50"
                    >
                      Vorschau
                      verwerfen
                    </button>
                  </div>
                )}

                {!story.trim() && (
                  <p className="text-center text-xs leading-5 text-zinc-500">
                    Erstelle zuerst
                    links mit dem AI
                    Director deine
                    Story.
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>

        <footer className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-zinc-600 sm:flex-row">
          <p>
            © 2026 KI Video Studio
          </p>

          <div className="flex items-center gap-5">
            <button
              type="button"
              className="transition hover:text-zinc-300"
            >
              Datenschutz
            </button>

            <button
              type="button"
              className="transition hover:text-zinc-300"
            >
              Impressum
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
