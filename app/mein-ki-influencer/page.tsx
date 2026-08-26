import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Header from "@/components/Header";
import PrivateInfluencerStudio from "@/components/PrivateInfluencerStudio";
import { hasPrivateInfluencerAccess } from "@/lib/private-influencer";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Mein privater KI-Influencer",
  description: "Privater Creator-Bereich für einen festen KI-Influencer und tägliche Social-Media-Videos.",
};

export default async function PrivateInfluencerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/anmelden?next=/mein-ki-influencer");

  if (!hasPrivateInfluencerAccess(user.email)) {
    return (
      <main className="min-h-screen bg-[#07070b] text-white">
        <Header active="account" />
        <section className="mx-auto max-w-2xl px-5 py-24 text-center">
          <h1 className="text-4xl font-semibold">Privater Creator-Bereich</h1>
          <p className="mt-4 text-sm leading-7 text-zinc-400">Dieser KI-Influencer ist ausschließlich für das freigeschaltete Betreiberkonto verfügbar.</p>
          <a href="/konto" className="mt-7 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold">Zurück zum Konto</a>
        </section>
      </main>
    );
  }

  return <PrivateInfluencerStudio />;
}
