import Link from "next/link";

import { STUDIO_PATHS } from "@/lib/site";

export type SeoFaq = {
  question: string;
  answer: string;
};

export default function SeoContent({
  eyebrow,
  title,
  intro,
  benefits,
  steps,
  faqs,
  active,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  benefits: string[];
  steps: string[];
  faqs: SeoFaq[];
  active: "video" | "song" | "image";
}) {
  return (
    <section className="border-t border-white/10 bg-[#09090e] px-5 py-16 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">{eyebrow}</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        <p className="mt-5 max-w-3xl text-sm leading-7 text-zinc-400 sm:text-base">{intro}</p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {benefits.map((benefit) => (
            <div key={benefit} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-6 text-zinc-300">
              <span className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-200">✓</span>
              {benefit}
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-2xl font-semibold">So funktioniert es</h2>
            <ol className="mt-5 space-y-4">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-4 text-sm leading-6 text-zinc-400">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10 text-xs font-semibold text-violet-200">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h2 className="text-2xl font-semibold">Häufige Fragen</h2>
            <div className="mt-5 space-y-3">
              {faqs.map((faq) => (
                <details key={faq.question} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-200">{faq.question}</summary>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-14 border-t border-white/10 pt-8">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Weitere KI-Studios</p>
          <nav className="mt-4 flex flex-wrap gap-3" aria-label="Weitere KI-Angebote">
            {active !== "video" && <Link className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-violet-400/30 hover:text-white" href={STUDIO_PATHS.video}>KI-Video erstellen</Link>}
            {active !== "song" && <Link className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-fuchsia-400/30 hover:text-white" href={STUDIO_PATHS.song}>KI-Song erstellen</Link>}
            {active !== "image" && <Link className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition hover:border-cyan-400/30 hover:text-white" href={STUDIO_PATHS.image}>KI-Bild erstellen</Link>}
          </nav>
        </div>
      </div>
    </section>
  );
}
