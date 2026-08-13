"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import Header from "@/components/Header";
import { FilmIcon, LoadingIcon, SparklesIcon, WarningIcon } from "@/components/Icons";

type Status = "pending" | "processing" | "done" | "error";

type VideoStatus = {
  status?: Status;
  paymentStatus?: "unpaid" | "paid" | "failed" | "refunded";
  renderStage?:
    | "queued"
    | "planning"
    | "waiting-provider"
    | "generating-opening"
    | "extending"
    | "generating-chapter"
    | "merging-chapters"
    | "trimming"
    | "completed"
    | "failed";
  progressPercent?: number;
  targetDurationSeconds?: number;
  aspectRatio?: "9:16" | "16:9";
  editingStyle?: "auto" | "social" | "cinematic" | "music-video";
  audioStyle?: "cinematic" | "emotional" | "upbeat" | "electronic" | "ambient" | "no-music";
  voiceMode?: "auto" | "dialogue" | "voiceover" | "no-voice";
  spokenLanguage?: "auto" | "de" | "en";
  hasReferenceImage?: boolean;
  currentChapter?: number;
  totalChapters?: number;
  currentExtension?: number;
  totalExtensions?: number;
  retryCount?: number;
  nextAttemptAt?: number;
  videoUrl?: string;
  errorMessage?: string;
};

const STAGE_LABELS: Record<NonNullable<VideoStatus["renderStage"]>, string> = {
  queued: "Dein Auftrag wird vorbereitet",
  planning: "Der Filmplan wird geprüft",
  "waiting-provider": "Google-Limit erreicht – automatischer neuer Versuch",
  "generating-opening": "Die erste Filmsequenz entsteht",
  extending: "Dein Film wird Szene für Szene erweitert",
  "generating-chapter": "Ein weiterer Filmabschnitt entsteht",
  "merging-chapters": "Die Filmabschnitte werden zusammengefügt",
  trimming: "Der finale Schnitt wird erstellt",
  completed: "Dein Video ist fertig",
  failed: "Die Erstellung wurde unterbrochen",
};

function formatDuration(seconds?: number): string | null {
  if (!seconds) return null;
  if (seconds < 60) return `${seconds} Sekunden`;
  const minutes = seconds / 60;
  return `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
}

function formatEditingStyle(style?: VideoStatus["editingStyle"]): string | null {
  switch (style) {
    case "cinematic":
      return "Kino / Film";
    case "music-video":
      return "Musikvideo";
    case "auto":
      return "Automatisch";
    case "social":
      return "Social / Reels";
    default:
      return null;
  }
}

function formatAudioStyle(style?: VideoStatus["audioStyle"]): string | null {
  switch (style) {
    case "cinematic": return "Filmische KI-Musik";
    case "emotional": return "Emotionale KI-Musik";
    case "upbeat": return "Energie-KI-Musik";
    case "electronic": return "Elektronische KI-Musik";
    case "ambient": return "Atmosphärischer KI-Ton";
    case "no-music": return "Ohne Musik";
    default: return null;
  }
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<SuccessShell />}>
      <SuccessContent />
    </Suspense>
  );
}

function SuccessShell() {
  return (
    <PageFrame>
      <StatusCard status="pending" progress={0} />
    </PageFrame>
  );
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId");
  const sessionId = searchParams.get("session_id");
  const [videoStatus, setVideoStatus] = useState<VideoStatus>({
    status: "pending",
    progressPercent: 0,
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !sessionId) {
      setVideoStatus({
        status: "error",
        errorMessage: "Der sichere Link zu deinem Video ist unvollständig.",
      });
      return;
    }

    let stopped = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let checkoutConfirmed = false;
    let refreshing = false;

    const refreshStatus = async () => {
      if (refreshing) return;
      refreshing = true;

      try {
        if (!checkoutConfirmed) {
          const confirmResponse = await fetch("/api/confirm-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, sessionId }),
          });
          const confirmation = (await confirmResponse.json()) as { error?: string };

          if (!confirmResponse.ok && confirmResponse.status !== 202) {
            throw new Error(confirmation.error || "Die Zahlung wird noch geprüft.");
          }

          checkoutConfirmed = true;
        }

        const response = await fetch(
          `/api/video-status?jobId=${encodeURIComponent(jobId)}&session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as VideoStatus & { error?: string };
        if (!response.ok) throw new Error(data.error || "Der Videostatus konnte nicht geladen werden.");
        if (stopped) return;

        setVideoStatus(data);
        setConnectionError(null);

        if (data.status === "done" || data.status === "error") {
          if (interval) clearInterval(interval);
        }
      } catch (error) {
        if (!stopped) {
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Die Verbindung wird gleich erneut hergestellt.",
          );
        }
      } finally {
        refreshing = false;
      }
    };

    void refreshStatus();
    interval = setInterval(() => void refreshStatus(), 4000);

    return () => {
      stopped = true;
      if (interval) clearInterval(interval);
    };
  }, [jobId, sessionId]);

  const status = videoStatus.status ?? "pending";
  const progress = Math.max(0, Math.min(100, videoStatus.progressPercent ?? 0));

  return (
    <PageFrame>
      <StatusCard
        status={status}
        progress={progress}
        videoStatus={videoStatus}
        connectionError={connectionError}
      />
    </PageFrame>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-violet-700/20 blur-[140px]" />
        <div className="absolute right-[-180px] top-[120px] h-[420px] w-[420px] rounded-full bg-blue-700/15 blur-[140px]" />
        <div className="absolute bottom-[-240px] left-1/3 h-[520px] w-[520px] rounded-full bg-indigo-700/10 blur-[150px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <Header />

      <div className="relative z-10 mx-auto max-w-5xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
        {children}

        <footer className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-zinc-600 sm:flex-row">
          <p>© 2026 KI Video Studio</p>
          <div className="flex items-center gap-5">
            <span>Datenschutz</span>
            <span>Impressum</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function StatusCard({
  status,
  progress,
  videoStatus = {},
  connectionError,
}: {
  status: Status;
  progress: number;
  videoStatus?: VideoStatus;
  connectionError?: string | null;
}) {
  const isWorking = status === "pending" || status === "processing";
  const isDone = status === "done";
  const paymentConfirmed =
    videoStatus.paymentStatus === "paid" ||
    status === "processing" ||
    isDone;
  const duration = formatDuration(videoStatus.targetDurationSeconds);
  const editingStyle = formatEditingStyle(videoStatus.editingStyle);
  const audioStyle = formatAudioStyle(videoStatus.audioStyle);
  const stageLabel = videoStatus.renderStage
    ? STAGE_LABELS[videoStatus.renderStage]
    : videoStatus.paymentStatus === "paid"
      ? "Zahlung bestätigt – dein Auftrag startet"
      : "Deine Zahlung wird bestätigt";

  return (
    <>
      <section className="mx-auto mb-10 max-w-3xl text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200">
          <span className={`h-1.5 w-1.5 rounded-full ${isDone ? "bg-emerald-300" : status === "error" ? "bg-red-300" : "animate-pulse bg-violet-300"}`} />
          {isDone ? "Video fertiggestellt" : status === "error" ? "Erstellung unterbrochen" : "KI-Video wird erstellt"}
        </div>

        <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
          {isDone ? "Dein Video ist " : status === "error" ? "Das hat noch nicht " : "Deine Idee wird jetzt "}
          <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">
            {isDone ? "bereit" : status === "error" ? "geklappt" : "zum Film"}
          </span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
          {isDone
            ? "Die Erstellung ist abgeschlossen. Du kannst dein Video jetzt ansehen und herunterladen."
            : status === "error"
              ? "Dein Auftrag ist sicher gespeichert. Unten findest du weitere Informationen."
              : "Du kannst diese Seite geöffnet lassen. Der Fortschritt aktualisiert sich automatisch."}
        </p>
      </section>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="border-b border-white/10 px-5 py-5 sm:px-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${isDone ? "bg-emerald-400/10 text-emerald-300" : status === "error" ? "bg-red-400/10 text-red-300" : "bg-gradient-to-br from-violet-500/25 to-blue-500/25 text-violet-200"}`}>
                {isWorking ? <LoadingIcon className="animate-spin" /> : status === "error" ? <WarningIcon /> : <FilmIcon />}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-violet-300">Produktionsstatus</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{stageLabel}</h2>
              </div>
            </div>

            <span className={`w-fit rounded-lg px-3 py-1.5 text-xs font-medium ${isDone ? "bg-emerald-400/10 text-emerald-300" : status === "error" ? "bg-red-400/10 text-red-300" : "bg-white/5 text-zinc-300"}`}>
              {isDone ? "100 % abgeschlossen" : status === "error" ? "Aktion erforderlich" : `${progress} % abgeschlossen`}
            </span>
          </div>
        </div>

        <div className="p-5 sm:p-7">
          {isWorking && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-blue-500 transition-[width] duration-700"
                  style={{ width: `${Math.max(progress, 2)}%` }}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {duration && <DetailPill>{duration}</DetailPill>}
                {videoStatus.aspectRatio && <DetailPill>{videoStatus.aspectRatio}</DetailPill>}
                {editingStyle && <DetailPill>{editingStyle}</DetailPill>}
                {audioStyle && <DetailPill>{audioStyle}</DetailPill>}
                {videoStatus.hasReferenceImage && <DetailPill>Bildreferenz aktiv</DetailPill>}
                {videoStatus.totalExtensions ? (
                  <DetailPill>
                    Sequenz {Math.min(videoStatus.currentExtension ?? 0, videoStatus.totalExtensions)} von {videoStatus.totalExtensions}
                  </DetailPill>
                ) : null}
                {videoStatus.totalChapters && videoStatus.totalChapters > 1 ? (
                  <DetailPill>
                    Abschnitt {Math.max(videoStatus.currentChapter ?? 1, 1)} von {videoStatus.totalChapters}
                  </DetailPill>
                ) : null}
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <ProgressStep
                  active={!paymentConfirmed}
                  complete={paymentConfirmed}
                  title={paymentConfirmed ? "Zahlung bestätigt" : "Zahlung wird bestätigt"}
                  description="Dein Auftrag geht sicher in die Produktion."
                />
                <ProgressStep active={progress < 92} complete={progress >= 92} title="Videoerstellung" description="Szenen, Bewegung und Ton entstehen." />
                <ProgressStep active={progress >= 92} complete={false} title="Finalisierung" description="Schnitt und Videodatei werden vorbereitet." />
              </div>

              {connectionError && (
                <p className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-amber-200/80">
                  Die Statusanzeige verbindet sich erneut. Dein Videoauftrag läuft davon unabhängig weiter.
                </p>
              )}

              {videoStatus.renderStage === "waiting-provider" && (
                <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3 text-xs leading-5 text-amber-100/80">
                  Dein bezahlter Auftrag ist sicher gespeichert. Die Video-KI versucht den Start automatisch erneut – ohne erneute Zahlung und ohne einen bereits gestarteten Abschnitt doppelt auszulösen.
                  {videoStatus.nextAttemptAt ? ` Nächster Versuch ungefähr um ${new Date(videoStatus.nextAttemptAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.` : ""}
                </p>
              )}
            </div>
          )}

          {isDone && videoStatus.videoUrl && (
            <div className="text-center">
              <div className={`mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black/40 ${videoStatus.aspectRatio === "9:16" ? "max-w-sm" : "max-w-4xl"}`}>
                <video className="block w-full" controls playsInline src={videoStatus.videoUrl} />
              </div>
              <a
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
                href={`${videoStatus.videoUrl}&download=1`}
              >
                Video herunterladen
              </a>
            </div>
          )}

          {status === "error" && (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-red-300"><WarningIcon /></div>
                <div>
                  <p className="font-medium text-red-100">Die Videoerstellung konnte nicht abgeschlossen werden.</p>
                  <p className="mt-2 text-sm leading-6 text-red-100/70">
                    {videoStatus.errorMessage ?? "Bitte versuche es später erneut oder wende dich an den Support."}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-7 flex justify-center border-t border-white/10 pt-6">
            <a className="text-sm font-medium text-violet-300 transition hover:text-violet-200" href="/">
              ← Zurück zum KI Video Studio
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function DetailPill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-zinc-400">{children}</span>;
}

function ProgressStep({
  active,
  complete,
  title,
  description,
}: {
  active: boolean;
  complete: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${active || complete ? "border-violet-400/20 bg-violet-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${complete ? "bg-emerald-400/15 text-emerald-300" : active ? "bg-violet-400/15 text-violet-300" : "bg-white/5 text-zinc-600"}`}>
          {complete ? "✓" : active ? <SparklesIcon /> : "·"}
        </span>
        <p className={`text-sm font-medium ${active || complete ? "text-white" : "text-zinc-500"}`}>{title}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  );
}
