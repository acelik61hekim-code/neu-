"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "@/components/Header";
import { ImageIcon, LoadingIcon, SparklesIcon, WarningIcon } from "@/components/Icons";

type ImageStatus = {
  status?: "pending" | "processing" | "done" | "error";
  paymentStatus?: "unpaid" | "paid" | "failed" | "refunded";
  renderStage?: "queued" | "generating" | "uploading" | "completed" | "failed";
  progressPercent?: number; title?: string; quality?: "professional" | "premium"; aspectRatio?: string; imageUrl?: string; errorMessage?: string;
};
const labels = { queued: "Dein Bildauftrag wird vorbereitet", generating: "Komposition, Licht und Details entstehen", uploading: "Das fertige Bild wird bereitgestellt", completed: "Dein Bild ist fertig", failed: "Die Bilderstellung wurde unterbrochen" } as const;

export default function ImageSuccessPage() { return <Suspense fallback={<Page status={{ status: "pending" }} />}><ImageSuccessContent /></Suspense>; }

function ImageSuccessContent() {
  const params = useSearchParams(); const jobId = params.get("jobId"); const sessionId = params.get("session_id");
  const [status, setStatus] = useState<ImageStatus>({ status: "pending", progressPercent: 0 });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  useEffect(() => {
    if (!jobId || !sessionId) { setStatus({ status: "error", errorMessage: "Der sichere Link zu deinem Bild ist unvollständig." }); return; }
    let stopped = false; let confirmed = false; let claimed = false; let refreshing = false; let interval: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (refreshing) return; refreshing = true;
      try {
        if (!confirmed) {
          const response = await fetch("/api/confirm-image-checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, sessionId }) });
          const data = await response.json() as { error?: string };
          if (!response.ok && response.status !== 202) throw new Error(data.error || "Die Zahlung wird geprüft.");
          confirmed = true;
        }
        if (!claimed) {
          const claimResponse = await fetch("/api/account/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "image", jobId, sessionId }) });
          claimed = claimResponse.ok || claimResponse.status === 401;
        }
        const response = await fetch(`/api/image-status?jobId=${encodeURIComponent(jobId)}&session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        const data = await response.json() as ImageStatus & { error?: string };
        if (!response.ok) throw new Error(data.error || "Der Bildstatus konnte nicht geladen werden.");
        if (stopped) return; setStatus(data); setConnectionError(null);
        if ((data.status === "done" || data.status === "error") && interval) clearInterval(interval);
      } catch (error) { if (!stopped) setConnectionError(error instanceof Error ? error.message : "Die Verbindung wird wiederhergestellt."); }
      finally { refreshing = false; }
    };
    void refresh(); interval = setInterval(() => void refresh(), 4000);
    return () => { stopped = true; if (interval) clearInterval(interval); };
  }, [jobId, sessionId]);
  return <Page status={status} connectionError={connectionError} />;
}

function Page({ status, connectionError }: { status: ImageStatus; connectionError?: string | null }) {
  const state = status.status ?? "pending"; const working = state === "pending" || state === "processing"; const done = state === "done";
  const progress = Math.max(0, Math.min(100, status.progressPercent ?? 0)); const stage = status.renderStage ? labels[status.renderStage] : "Deine Zahlung wird bestätigt";
  return <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
    <div className="pointer-events-none absolute inset-0"><div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-cyan-700/20 blur-[140px]" /><div className="absolute right-[-180px] top-[120px] h-[420px] w-[420px] rounded-full bg-blue-700/15 blur-[140px]" /><div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" /></div>
    <Header active="image" />
    <div className="relative z-10 mx-auto max-w-4xl px-5 pb-16 pt-12 sm:px-8 sm:pt-16">
      <section className="mx-auto mb-10 max-w-3xl text-center"><div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${done ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : state === "error" ? "border-red-400/20 bg-red-400/10 text-red-200" : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-300" : state === "error" ? "bg-red-300" : "animate-pulse bg-cyan-300"}`} />{done ? "Bild fertiggestellt" : state === "error" ? "Erstellung unterbrochen" : "KI-Bild wird erstellt"}</div><h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">{done ? "Dein Bild ist " : state === "error" ? "Das hat noch nicht " : "Deine Vorstellung wird jetzt "}<span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-violet-300 bg-clip-text text-transparent">{done ? "bereit" : state === "error" ? "geklappt" : "sichtbar"}</span></h1><p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400">{done ? "Sieh dir dein Bild an oder lade die hochauflösende Datei herunter." : state === "error" ? "Dein Auftrag ist sicher gespeichert. Unten findest du weitere Informationen." : "Du kannst die Seite geöffnet lassen. Der Fortschritt aktualisiert sich automatisch."}</p></section>
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-7"><div className="flex items-center gap-3"><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${done ? "bg-emerald-400/10 text-emerald-300" : state === "error" ? "bg-red-400/10 text-red-300" : "bg-gradient-to-br from-cyan-500/25 to-blue-500/25 text-cyan-200"}`}>{working ? <LoadingIcon className="animate-spin" /> : state === "error" ? <WarningIcon /> : <ImageIcon />}</div><div><p className="text-xs font-medium uppercase tracking-wider text-cyan-300">Bildstatus</p><h2 className="mt-1 text-lg font-semibold">{stage}</h2></div></div><span className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-300">{done ? "100 %" : `${progress} %`}</span></div>
        <div className="p-5 sm:p-7">
          {working && <div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500 transition-[width] duration-700" style={{ width: `${Math.max(progress, 3)}%` }} /></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><Step complete={status.paymentStatus === "paid"} active={status.paymentStatus !== "paid"} title="Zahlung" text="Sicher bestätigt" /><Step complete={progress >= 85} active={progress < 85} title="Bilderstellung" text="Komposition und Details" /><Step complete={done} active={progress >= 85} title="Download" text="Datei vorbereiten" /></div>{connectionError && <p className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/80">{connectionError} Dein Auftrag läuft unabhängig davon weiter.</p>}</div>}
          {done && status.imageUrl && <div className="text-center"><div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-cyan-400/15 bg-black/30"><img src={status.imageUrl} alt={status.title || "Erstelltes KI-Bild"} className="block h-auto w-full" /></div><p className="mt-4 text-sm text-zinc-400">{status.quality === "premium" ? "Premium 4K" : "Professional 2K"} · {status.aspectRatio}</p><a className="mt-5 inline-flex items-center justify-center rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold transition hover:bg-cyan-500" href={`${status.imageUrl}&download=1`}>Bild herunterladen</a></div>}
          {state === "error" && <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-5"><div className="flex items-start gap-3"><WarningIcon className="mt-0.5 text-red-300" /><div><p className="font-medium text-red-100">Die Bilderstellung konnte nicht abgeschlossen werden.</p><p className="mt-2 text-sm leading-6 text-red-100/70">{status.errorMessage || "Bitte versuche es später erneut oder wende dich an den Support."}</p></div></div></div>}
          <div className="mt-7 flex justify-center border-t border-white/10 pt-6"><a className="text-sm font-medium text-cyan-300 transition hover:text-cyan-200" href="/?studio=image">← Weiteres Bild erstellen</a></div>
        </div>
      </section>
    </div>
  </main>;
}

function Step({ active, complete, title, text }: { active: boolean; complete: boolean; title: string; text: string }) { return <div className={`rounded-2xl border p-4 ${active || complete ? "border-cyan-400/20 bg-cyan-400/[0.06]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${complete ? "bg-emerald-400/15 text-emerald-300" : active ? "bg-cyan-400/15 text-cyan-300" : "bg-white/5 text-zinc-600"}`}>{complete ? "✓" : active ? <SparklesIcon /> : "·"}</span><p className="text-sm font-medium">{title}</p></div><p className="mt-2 text-xs text-zinc-500">{text}</p></div>; }
