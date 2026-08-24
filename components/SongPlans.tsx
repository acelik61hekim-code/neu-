"use client";

import { useCallback, useEffect, useState } from "react";

import { ArrowIcon, LockIcon, SparklesIcon } from "@/components/Icons";
import { SONG_PLANS, type SongPlan, type SongPlanId } from "@/lib/song-plans";

export type SongSubscriptionStatus = {
  active: boolean;
  plan?: SongPlan;
  songsUsed?: number;
  songsRemaining?: number;
  editsUsed?: number;
  editsRemaining?: number;
  renewsAt?: number;
  cancelAtPeriodEnd?: boolean;
};

export default function SongPlans({ onStatusChange }: { onStatusChange?: (status: SongSubscriptionStatus) => void }) {
  const [status, setStatus] = useState<SongSubscriptionStatus>({ active: false });
  const [loadingPlan, setLoadingPlan] = useState<SongPlanId | "portal" | null>(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/song-subscription", { cache: "no-store" });
      const data = await response.json() as SongSubscriptionStatus;
      setStatus(data);
      onStatusChange?.(data);
    } catch {
      onStatusChange?.({ active: false });
    }
  }, [onStatusChange]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function subscribe(planId: SongPlanId) {
    setLoadingPlan(planId);
    setError("");
    try {
      const response = await fetch("/api/create-song-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (response.status === 401) {
        window.location.href = "/anmelden?next=/ki-song-erstellen%23song-abos";
        return;
      }
      if (!response.ok || !data.url) throw new Error(data.error || "Das Abo konnte nicht geöffnet werden.");
      window.location.href = data.url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bitte versuche es erneut.");
      setLoadingPlan(null);
    }
  }

  async function openPortal() {
    setLoadingPlan("portal");
    setError("");
    try {
      const response = await fetch("/api/song-subscription-portal", { method: "POST" });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Die Abo-Verwaltung konnte nicht geöffnet werden.");
      window.location.href = data.url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bitte versuche es erneut.");
      setLoadingPlan(null);
    }
  }

  return (
    <section id="song-abos" className="mt-12 scroll-mt-6">
      <div className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200"><SparklesIcon /> Song Studio Abos</div>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Ein Studio. Drei Größen.</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Alle Pakete enthalten dieselben Werkzeuge. Du wählst nur, wie viele neue Songs und KI-Bearbeitungen du monatlich brauchst.</p>
      </div>

      {status.active && status.plan && (
        <div className="mx-auto mt-7 flex max-w-3xl flex-col gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">{status.plan.name} ist aktiv</p>
            <p className="mt-1 text-sm text-zinc-300"><strong className="text-white">{status.songsRemaining ?? 0}</strong> Songs und <strong className="text-white">{status.editsRemaining ?? 0}</strong> KI-Bearbeitungen übrig</p>
            {status.renewsAt && <p className="mt-1 text-[11px] text-zinc-500">{status.cancelAtPeriodEnd ? "Endet" : "Neues Kontingent"} am {new Date(status.renewsAt).toLocaleDateString("de-DE")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/sound-studio" className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-emerald-950">Sound Studio öffnen</a>
            <button type="button" onClick={() => void openPortal()} disabled={loadingPlan === "portal"} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-300">Abo verwalten</button>
          </div>
        </div>
      )}

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        {SONG_PLANS.map((plan) => {
          const current = status.active && status.plan?.id === plan.id;
          return (
            <article key={plan.id} className={`relative flex flex-col rounded-3xl border p-6 ${plan.featured ? "border-fuchsia-400/35 bg-gradient-to-b from-fuchsia-500/[0.12] to-violet-500/[0.04] shadow-2xl shadow-fuchsia-950/25" : "border-white/10 bg-white/[0.035]"}`}>
              {plan.featured && <span className="absolute right-5 top-5 rounded-full bg-fuchsia-400/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-200">Beliebt</span>}
              <p className="text-sm font-semibold text-white">{plan.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{plan.tagline}</p>
              <div className="mt-5 flex items-end gap-1"><span className="text-3xl font-semibold">{(plan.priceCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</span><span className="pb-1 text-xs text-zinc-500">/ Monat</span></div>
              <div className="my-5 h-px bg-white/10" />
              <ul className="flex-1 space-y-3 text-sm text-zinc-300">
                <PlanBenefit>{plan.nearUnlimited ? "Nahezu unbegrenzt: " : ""}<strong>{plan.songsPerMonth} vollständige Songs</strong></PlanBenefit>
                <PlanBenefit><strong>{plan.aiEditsPerMonth} KI-Bearbeitungen</strong> einzelner Stellen</PlanBenefit>
                <PlanBenefit>Komplettes Sound Studio</PlanBenefit>
                <PlanBenefit>Manuelle Bearbeitung und Exporte unbegrenzt</PlanBenefit>
              </ul>
              <button type="button" disabled={Boolean(loadingPlan) || current} onClick={() => status.active ? void openPortal() : void subscribe(plan.id)} className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60 ${plan.featured ? "bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white" : "border border-white/10 bg-white/[0.05] text-zinc-100 hover:bg-white/[0.09]"}`}>
                {current ? "Aktuelles Abo" : loadingPlan === plan.id || (status.active && loadingPlan === "portal") ? "Wird geöffnet ..." : status.active ? "Tarif verwalten" : `${plan.name} wählen`}{!current && loadingPlan !== plan.id && <ArrowIcon />}
              </button>
            </article>
          );
        })}
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-zinc-500"><LockIcon /> Monatlich kündbar · Preise inkl. MwSt. · kein Übertrag in den Folgemonat · Studio Max gilt bis 200 Songs und 200 KI-Bearbeitungen pro Abrechnungsmonat</p>
      {error && <p className="mx-auto mt-4 max-w-xl rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-center text-xs text-red-200">{error}</p>}
    </section>
  );
}

function PlanBenefit({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2.5"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-[10px] text-emerald-300">✓</span><span>{children}</span></li>;
}
