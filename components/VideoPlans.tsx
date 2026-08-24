"use client";

import { useCallback, useEffect, useState } from "react";

import { ArrowIcon, FilmIcon, LockIcon, SparklesIcon } from "@/components/Icons";
import { VIDEO_PLANS, type VideoPlan, type VideoPlanId } from "@/lib/video-plans";

export type VideoSubscriptionStatus = {
  active: boolean;
  plan?: VideoPlan;
  creditsUsed?: number;
  creditsRemaining?: number;
  studioEditsUsed?: number;
  studioEditsRemaining?: number;
  renewsAt?: number;
  cancelAtPeriodEnd?: boolean;
};

export default function VideoPlans({ onStatusChange }: { onStatusChange?: (status: VideoSubscriptionStatus) => void }) {
  const [status, setStatus] = useState<VideoSubscriptionStatus>({ active: false });
  const [loadingPlan, setLoadingPlan] = useState<VideoPlanId | "portal" | null>(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/video-subscription", { cache: "no-store" });
      const data = await response.json() as VideoSubscriptionStatus;
      setStatus(data);
      onStatusChange?.(data);
    } catch {
      onStatusChange?.({ active: false });
    }
  }, [onStatusChange]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function subscribe(planId: VideoPlanId) {
    setLoadingPlan(planId);
    setError("");
    try {
      const response = await fetch("/api/create-video-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (response.status === 401) {
        window.location.href = "/anmelden?next=/ki-video-erstellen%23video-abos";
        return;
      }
      if (!response.ok || !data.url) throw new Error(data.error || "Das Video-Abo konnte nicht geöffnet werden.");
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
      const response = await fetch("/api/video-subscription-portal", { method: "POST" });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Die Abo-Verwaltung konnte nicht geöffnet werden.");
      window.location.href = data.url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bitte versuche es erneut.");
      setLoadingPlan(null);
    }
  }

  return (
    <section id="video-abos" className="mt-16 scroll-mt-6">
      <div className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-xs font-medium text-blue-200"><SparklesIcon /> KI Video Studio Abos</div>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Drei Pakete für deine Videoproduktion</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Alle Pakete enthalten dieselben Modelle und das vollständige Video Studio. Du wählst nur dein monatliches Produktionsvolumen.</p>
      </div>

      {status.active && status.plan && (
        <div className="mx-auto mt-7 flex max-w-3xl flex-col gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">{status.plan.name} ist aktiv</p>
            <p className="mt-1 text-sm text-zinc-300"><strong className="text-white">{status.creditsRemaining ?? 0}</strong> Video-Credits · <strong className="text-white">{status.studioEditsRemaining ?? 0}</strong> Studio-Exporte übrig</p>
            {status.renewsAt && <p className="mt-1 text-[11px] text-zinc-500">{status.cancelAtPeriodEnd ? "Endet" : "Neues Kontingent"} am {new Date(status.renewsAt).toLocaleDateString("de-DE")}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/video-studio" className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-emerald-950">Video Studio öffnen</a>
            <button type="button" onClick={() => void openPortal()} disabled={loadingPlan === "portal"} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-zinc-300">Abo verwalten</button>
          </div>
        </div>
      )}

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        {VIDEO_PLANS.map((plan) => {
          const current = status.active && status.plan?.id === plan.id;
          return (
            <article key={plan.id} className={`relative flex flex-col rounded-3xl border p-6 ${plan.featured ? "border-violet-400/35 bg-gradient-to-b from-violet-500/[0.13] to-blue-500/[0.04] shadow-2xl shadow-violet-950/25" : "border-white/10 bg-white/[0.035]"}`}>
              {plan.featured && <span className="absolute right-5 top-5 rounded-full bg-violet-400/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-violet-200">Beliebt</span>}
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200"><FilmIcon /></div>
              <p className="mt-4 text-sm font-semibold text-white">{plan.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{plan.tagline}</p>
              <div className="mt-5 flex items-end gap-1"><span className="text-3xl font-semibold">{(plan.priceCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €</span><span className="pb-1 text-xs text-zinc-500">/ Monat</span></div>
              <div className="my-5 h-px bg-white/10" />
              <ul className="flex-1 space-y-3 text-sm text-zinc-300">
                <PlanBenefit>{plan.nearUnlimited ? "Sehr großes Kontingent: " : ""}<strong>{plan.creditsPerMonth} Video-Credits</strong></PlanBenefit>
                <PlanBenefit><strong>{plan.studioEditsPerMonth} Video-Studio-Exporte</strong></PlanBenefit>
                <PlanBenefit>Seedance Fast, Original und Google Veo</PlanBenefit>
                <PlanBenefit>Vollständiges Video Studio</PlanBenefit>
              </ul>
              <button type="button" disabled={Boolean(loadingPlan) || current} onClick={() => status.active ? void openPortal() : void subscribe(plan.id)} className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-60 ${plan.featured ? "bg-gradient-to-r from-violet-600 to-blue-600 text-white" : "border border-white/10 bg-white/[0.05] text-zinc-100 hover:bg-white/[0.09]"}`}>
                {current ? "Aktuelles Abo" : loadingPlan === plan.id || (status.active && loadingPlan === "portal") ? "Wird geöffnet ..." : status.active ? "Tarif verwalten" : `${plan.name} wählen`}{!current && loadingPlan !== plan.id && <ArrowIcon />}
              </button>
            </article>
          );
        })}
      </div>

      <div className="mx-auto mt-5 max-w-4xl rounded-2xl border border-white/10 bg-black/20 p-5 text-xs leading-6 text-zinc-400">
        <p className="font-semibold text-zinc-200">So funktionieren Video-Credits</p>
        <p className="mt-1">15 Sekunden Seedance 2 Fast verbrauchen 1 Credit. Seedance 2 Original und Google Veo verbrauchen 2 Credits je 15 Sekunden. Längere Videos werden entsprechend der Länge berechnet – der genaue Verbrauch wird vor der Bestellung angezeigt.</p>
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-zinc-500"><LockIcon /> Monatlich kündbar · Preise inkl. MwSt. · nicht genutzte Credits werden nicht übertragen</p>
      {error && <p className="mx-auto mt-4 max-w-xl rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-center text-xs text-red-200">{error}</p>}
    </section>
  );
}

function PlanBenefit({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2.5"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-[10px] text-emerald-300">✓</span><span>{children}</span></li>;
}
