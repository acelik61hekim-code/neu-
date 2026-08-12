"use client";

import {
  DocumentIcon,
  LockIcon,
  PlayIcon,
  SparklesIcon,
} from "./Icons";

type StoryPreviewProps = {
  prompt: string;
  loading: boolean;

  /*
   * Bleibt vorübergehend in den Props,
   * damit app/page.tsx nicht erneut geändert
   * werden muss.
   *
   * Die Zahlung wird NICHT mehr von dieser
   * Komponente gestartet. Das passiert erst
   * nach bestätigter Bild-Vorschau in page.tsx.
   */
  onCreateVideo: () => void;
};

const storyFeatures = [
  "Titel und Story-Konzept",
  "Charaktere und Umgebung",
  "Opening + 8 direkte Fortsetzungen",
  "Kamera-, Licht- und Veo-Regie",
  "Musik, Dialoge und Soundeffekte",
  "Kontinuität für ein zusammenhängendes Video",
];

export default function StoryPreview(
  props: StoryPreviewProps,
) {
  const {
    prompt,
    loading,
  } = props;

  const hasPrompt =
    prompt.trim().length > 0;

  /*
   * Wir lesen einige Story-Daten aus dem JSON,
   * sobald der Story Architect fertig ist.
   *
   * Während des normalen Chats ist prompt
   * noch einfacher Text. Deshalb ist der
   * JSON-Parse in try/catch gekapselt.
   */
  let storyTitle = "";
  let storySummary = "";
  let storyGenre = "";
  let storyMood = "";
  let hasMoviePlan = false;

  try {
    const parsed = JSON.parse(
      prompt,
    ) as {
      title?: string;
      summary?: string;
      genre?: string;
      mood?: string;
      moviePlan?: {
        targetDurationSeconds?: number;
        generatedDurationSeconds?: number;
        aspectRatio?: string;
        continuations?: unknown[];
      };
    };

    storyTitle =
      typeof parsed.title === "string"
        ? parsed.title
        : "";

    storySummary =
      typeof parsed.summary === "string"
        ? parsed.summary
        : "";

    storyGenre =
      typeof parsed.genre === "string"
        ? parsed.genre
        : "";

    storyMood =
      typeof parsed.mood === "string"
        ? parsed.mood
        : "";

    hasMoviePlan =
      Boolean(
        parsed.moviePlan &&
          parsed.moviePlan.aspectRatio === "9:16" &&
          Array.isArray(
            parsed.moviePlan.continuations,
          ) &&
          parsed.moviePlan.continuations.length === 8,
      );
  } catch {
    /*
     * Noch kein fertiges Story-JSON.
     */
  }

  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300">
            <DocumentIcon />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white">
              Story-Vorschau
            </h2>

            <p className="mt-0.5 text-xs text-zinc-500">
              Dein zukünftiges 1-Minuten-Videoprojekt
            </p>
          </div>
        </div>

        <span
          className={`rounded-lg px-2.5 py-1 text-xs ${
            hasMoviePlan
              ? "bg-emerald-400/10 text-emerald-300"
              : hasPrompt
                ? "bg-violet-400/10 text-violet-300"
                : "bg-white/5 text-zinc-500"
          }`}
        >
          {hasMoviePlan
            ? "Filmplan fertig"
            : hasPrompt
              ? "Idee vorhanden"
              : "Noch leer"}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.18),transparent_45%)]" />

          <div className="relative flex aspect-[9/16] max-h-[420px] items-center justify-center">
            <div className="px-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 backdrop-blur">
                <PlayIcon />
              </div>

              <p className="mt-4 text-sm font-medium text-zinc-300">
                1-Minuten-Video
              </p>

              <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-zinc-600">
                Bevor das Video gekauft und generiert wird,
                erscheint darunter zuerst ein KI-Vorschaubild.
              </p>
            </div>
          </div>

          <div className="absolute bottom-3 left-3 rounded-lg border border-white/10 bg-black/50 px-2.5 py-1 text-xs text-zinc-400 backdrop-blur">
            9:16
          </div>

          <div className="absolute bottom-3 right-3 rounded-lg border border-white/10 bg-black/50 px-2.5 py-1 text-xs text-zinc-400 backdrop-blur">
            ca. 1 Minute
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2 text-violet-300">
            <SparklesIcon />

            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              Deine Story
            </span>
          </div>

          <div className="min-h-28 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            {hasPrompt ? (
              hasMoviePlan ? (
                <div>
                  {storyTitle && (
                    <h3 className="font-semibold text-white">
                      {storyTitle}
                    </h3>
                  )}

                  {storySummary && (
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {storySummary}
                    </p>
                  )}

                  {(storyGenre ||
                    storyMood) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {storyGenre && (
                        <span className="rounded-lg bg-violet-400/10 px-2.5 py-1 text-xs text-violet-300">
                          {storyGenre}
                        </span>
                      )}

                      {storyMood && (
                        <span className="rounded-lg bg-blue-400/10 px-2.5 py-1 text-xs text-blue-300">
                          {storyMood}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                  {prompt}
                </p>
              )
            ) : (
              <p className="text-sm leading-6 text-zinc-600">
                Sobald du deine Videoidee im Story-Assistenten
                eingibst, erscheint sie hier als Grundlage
                für dein Projekt.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Videoformat
          </p>

          <div className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">
                  Vertical Short Film
                </p>

                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  Optimiert für TikTok, YouTube Shorts und Reels.
                </p>
              </div>

              <span className="shrink-0 rounded-lg bg-black/20 px-2.5 py-1 text-xs font-medium text-violet-200">
                9:16
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Der AI Director erstellt
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {storyFeatures.map(
              (feature) => (
                <div
                  key={feature}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5"
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-400/10 text-xs text-violet-300">
                    ✓
                  </div>

                  <span className="text-xs leading-5 text-zinc-400">
                    {feature}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="mt-auto pt-8">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
                <LockIcon />
              </div>

              <div>
                <p className="text-sm font-medium text-white">
                  Erst Vorschau, dann Zahlung
                </p>

                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Du bezahlst noch nichts. Erstelle zuerst
                  das Vorschaubild unter diesem Bereich.
                  Nur wenn dir der Look gefällt und du ihn
                  bestätigst, wird die Zahlung freigeschaltet.
                </p>
              </div>
            </div>
          </div>

          {loading && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <span className="h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
              Vorgang läuft ...
            </div>
          )}
        </div>
      </div>
    </section>
  );
}