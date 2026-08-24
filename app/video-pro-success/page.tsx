"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import Header from "@/components/Header";
import { FilmIcon, LoadingIcon, WarningIcon } from "@/components/Icons";

export default function VideoProSuccessPage() {
  return <Suspense fallback={<Confirmation />}><ConfirmationContent /></Suspense>;
}

function ConfirmationContent() {
  const sessionId = useSearchParams().get("session_id");
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setState("error");
      setError("Der sichere Abo-Link ist unvollständig.");
      return;
    }
    void fetch("/api/confirm-video-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).then(async (response) => {
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Das Video-Abo konnte nicht bestätigt werden.");
      setState("done");
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Das Video-Abo konnte nicht bestätigt werden.");
      setState("error");
    });
  }, [sessionId]);

  return <Confirmation state={state} error={error} />;
}

function Confirmation({ state = "loading", error = "" }: { state?: "loading" | "done" | "error"; error?: string }) {
  return (
    <main className="min-h-screen bg-[#07070b] text-white">
      <Header active="video" />
      <div className="mx-auto flex min-h-[78vh] max-w-3xl items-center px-5 py-16">
        <section className="w-full rounded-3xl border border-violet-400/15 bg-white/[0.035] p-8 text-center shadow-2xl shadow-violet-950/20 sm:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
            {state === "loading" ? <LoadingIcon className="animate-spin" /> : state === "error" ? <WarningIcon /> : <FilmIcon />}
          </div>
          <h1 className="mt-6 text-3xl font-semibold">{state === "done" ? "Dein Video Studio ist freigeschaltet" : state === "error" ? "Abo wird noch geprüft" : "Dein Video-Abo wird aktiviert"}</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-zinc-400">{state === "done" ? "Du kannst ab jetzt Videos aus deinem Monatskontingent erstellen und fertige Videos im Video Studio bearbeiten." : state === "error" ? error : "Das dauert normalerweise nur wenige Sekunden."}</p>
          {state === "done" && <a href="/ki-video-erstellen?abo=aktiv#video-abos" className="mt-7 inline-flex rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3 text-sm font-semibold">Jetzt Videos erstellen</a>}
          {state === "error" && <button type="button" onClick={() => window.location.reload()} className="mt-7 rounded-xl border border-white/10 px-5 py-3 text-sm font-medium text-zinc-200">Erneut prüfen</button>}
        </section>
      </div>
    </main>
  );
}
