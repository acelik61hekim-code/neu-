"use client";

import { useState } from "react";

import Chat from "@/components/Chat";
import Header from "@/components/Header";
import StoryPreview from "@/components/StoryPreview";

import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoEditingStyle,
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

type PreviewApiResponse = {
  success?: boolean;
  imageData?: string;
  mimeType?: string;
  error?: string;
};

export default function HomePage() {
  const [story, setStory] = useState("");

  const [
    targetDurationSeconds,
    setTargetDurationSeconds,
  ] = useState<VideoDurationSeconds>(
    60,
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

  function resetPlannedProject() {
    setStory("");
    setPreviewImage(null);
    setPreviewApproved(false);
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

    if (error) {
      setError(null);
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

      const mimeType =
        data.mimeType ||
        "image/png";

      const dataUrl =
        `data:${mimeType};base64,${data.imageData}`;

      setPreviewImage(
        dataUrl,
      );
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
      !previewApproved
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-violet-700/20 blur-[140px]" />

        <div className="absolute right-[-180px] top-[120px] h-[420px] w-[420px] rounded-full bg-blue-700/15 blur-[140px]" />

        <div className="absolute bottom-[-240px] left-1/3 h-[520px] w-[520px] rounded-full bg-indigo-700/10 blur-[150px]" />

        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <Header />

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
                  (option) => (
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
                        previewLoading
                      }
                      className={`rounded-xl border px-3 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        targetDurationSeconds ===
                        option.value
                          ? "border-violet-400/50 bg-violet-500/15 text-violet-100"
                          : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {
                        option.label
                      }
                    </button>
                  ),
                )}
              </div>
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
            targetDurationSeconds={
              targetDurationSeconds
            }
            aspectRatio={
              aspectRatio
            }
            editingStyle={
              editingStyle
            }
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
                </div>
              </div>

              <div className="p-5 sm:p-6">
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
