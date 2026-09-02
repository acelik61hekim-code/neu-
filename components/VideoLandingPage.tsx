import Header from "@/components/Header";
import { ArrowIcon, FilmIcon, PlayIcon, SparklesIcon } from "@/components/Icons";
import TrackedLink from "@/components/TrackedLink";
import { formatEuroPrice, getVideoPriceCents } from "@/lib/pricing";

const startingPrice = formatEuroPrice(
  getVideoPriceCents(15, "google-veo-fast"),
);

const examples = [
  {
    title: "Direkte Konfrontation",
    description: "Mehrere Figuren, klare Handlung und sichtbare Reaktionen.",
    video: "/viral-templates/firepit-confrontation.mp4",
    poster: "/viral-templates/firepit-confrontation.webp",
  },
  {
    title: "Handy-Beweis",
    description: "Ein vertikaler Social-Clip mit wiedererkennbaren Figuren.",
    video: "/viral-templates/phone-evidence.mp4",
    poster: "/viral-templates/phone-evidence.webp",
  },
  {
    title: "Cliffhanger",
    description: "Eine kurze Geschichte mit offenem Ende für eine Serie.",
    video: "/viral-templates/caught-in-the-act.mp4",
    poster: "/viral-templates/caught-in-the-act.webp",
  },
] as const;

const benefits = [
  {
    title: "Story vor der Zahlung",
    text: "Der AI Director zeigt Handlung, Figuren und Szenenplan, bevor du ein Video bestellst.",
  },
  {
    title: "Dialog bleibt sichtbar",
    text: "Vorgegebene Sprechertexte werden in der Vorschau als wörtlich übernommener Dialog ausgewiesen.",
  },
  {
    title: "Für Social Media geplant",
    text: "Vertikale Reels und Shorts erhalten einen frühen Hook, klare Szenen und einen passenden Abschluss.",
  },
] as const;

export default function VideoLandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-220px] top-[-160px] h-[560px] w-[560px] rounded-full bg-violet-700/25 blur-[150px]" />
        <div className="absolute right-[-220px] top-[260px] h-[500px] w-[500px] rounded-full bg-blue-700/15 blur-[150px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <Header active="video" />

      <div className="relative z-10">
        <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.05fr_0.75fr] lg:items-center lg:gap-16 lg:pb-28 2xl:pt-20">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              KI-Video mit Story, Stimmen und Schnitt
            </div>

            <h1 className="mt-6 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-6xl 2xl:text-7xl">
              Deine Idee wird ein Video –
              <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">
                {" "}mit Dialog, den du vorher prüfst.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-pretty text-base leading-8 text-zinc-300 sm:text-lg">
              Beschreibe deine Szene oder füge deinen fertigen Dialog ein. Der AI Director plant daraus ein vertikales Reel oder ein filmisches Video – mit kostenloser Bildvorschau vor der Zahlung.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <TrackedLink
                href="/ki-video-erstellen#ai-director"
                location="hero_primary"
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3.5 text-sm font-semibold shadow-xl shadow-violet-950/40 transition hover:from-violet-500 hover:to-blue-500"
              >
                Videoidee eingeben
                <ArrowIcon className="transition group-hover:translate-x-0.5" />
              </TrackedLink>

              <TrackedLink
                href="#beispiele"
                location="hero_examples"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-6 py-3.5 text-sm font-semibold text-zinc-200 transition hover:border-violet-400/30 hover:bg-violet-400/10"
              >
                <PlayIcon className="text-violet-300" />
                Beispiele ansehen
              </TrackedLink>
            </div>

            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-400">
              <span>✓ Vorschau kostenlos</span>
              <span>✓ Keine Videokenntnisse nötig</span>
              <span>✓ Einzelkauf oder Abo</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[420px]">
            <div className="absolute -inset-5 rounded-[36px] bg-gradient-to-br from-violet-500/25 via-fuchsia-500/10 to-blue-500/20 blur-2xl" />
            <div className="relative overflow-hidden rounded-[30px] border border-white/15 bg-black shadow-2xl shadow-black/60">
              <video
                src="/viral-templates/caught-in-the-act.mp4"
                poster="/viral-templates/caught-in-the-act.webp"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Beispiel eines vertikalen KI-Storyvideos"
                className="aspect-[9/16] w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-5 pb-5 pt-20">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">Vertikale Storyszene</p>
                    <p className="mt-1 text-xs text-zinc-300">Beispiel aus einer Story-Vorlage</p>
                  </div>
                  <span className="rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[10px] font-semibold backdrop-blur">9:16</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/[0.08] bg-white/[0.025]">
          <div className="mx-auto grid max-w-7xl gap-4 px-5 py-8 sm:px-8 md:grid-cols-3">
            {benefits.map((benefit) => (
              <article key={benefit.title} className="rounded-2xl border border-white/[0.08] bg-black/20 p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200">
                  <SparklesIcon />
                </div>
                <h2 className="mt-4 text-base font-semibold">{benefit.title}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{benefit.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="beispiele" className="mx-auto max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 sm:py-28">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Echte Bewegung statt Werbeversprechen</p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Sieh dir den Stil an, bevor du selbst startest.</h2>
            <p className="mt-5 text-base leading-7 text-zinc-400">Diese kurzen Vorschauclips zeigen den visuellen Stil der Story-Vorlagen. Dein eigenes Video wird aus deiner Beschreibung und deinen gewählten Figuren geplant.</p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {examples.map((example) => (
              <article key={example.title} className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-xl shadow-black/25">
                <video
                  src={example.video}
                  poster={example.poster}
                  muted
                  controls
                  playsInline
                  preload="none"
                  aria-label={`KI-Videobeispiel: ${example.title}`}
                  className="aspect-[9/16] w-full bg-black object-cover"
                />
                <div className="p-5">
                  <h3 className="font-semibold">{example.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{example.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-white/[0.08] bg-[#0b0b12] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Wörtlicher Dialog</p>
                <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Du siehst vor der Zahlung, wer was sagen soll.</h2>
                <p className="mt-5 text-base leading-7 text-zinc-400">Wenn du Dialog vorgibst, markiert die Story-Vorschau ihn ausdrücklich als wörtlich übernommen. Reihenfolge und Wiederholungen bleiben Teil des Filmplans.</p>
              </div>

              <div className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-blue-500/[0.05] p-5 shadow-2xl shadow-black/25 sm:p-7">
                <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Vor der Erstellung prüfbar</p>
                    <p className="mt-1 text-sm font-semibold">Wörtlich übernommener Sprechertext</p>
                  </div>
                  <FilmIcon className="text-violet-300" />
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <p className="rounded-xl border border-white/10 bg-black/25 px-4 py-3"><strong className="text-violet-200">Ruby:</strong> <span className="text-zinc-300">„Sag mir jetzt die Wahrheit.“</span></p>
                  <p className="rounded-xl border border-white/10 bg-black/25 px-4 py-3"><strong className="text-blue-200">Bano:</strong> <span className="text-zinc-300">„Ich habe nichts verschwiegen.“</span></p>
                  <p className="rounded-xl border border-white/10 bg-black/25 px-4 py-3"><strong className="text-violet-200">Ruby:</strong> <span className="text-zinc-300">„Dann erklär mir diesen Ring.“</span></p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Drei Schritte</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">Von der Idee zur kostenlosen Vorschau.</h2>
          </div>

          <ol className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              ["01", "Idee oder Dialog eingeben", "Beschreibe Handlung, Stil und Sprechertexte in deinen eigenen Worten."],
              ["02", "Filmplan prüfen", "Der AI Director strukturiert Figuren, Szenen und den sichtbaren Dialog."],
              ["03", "Look bestätigen", "Erzeuge kostenlos das Vorschaubild. Erst danach wird die Zahlung freigeschaltet."],
            ].map(([number, title, text]) => (
              <li key={number} className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
                <span className="text-sm font-semibold text-violet-300">{number}</span>
                <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-zinc-400">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-5 pb-20 sm:px-8 sm:pb-28">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-violet-400/25 bg-gradient-to-br from-violet-600/25 via-fuchsia-600/10 to-blue-600/20 px-6 py-12 text-center shadow-2xl shadow-violet-950/25 sm:px-10 sm:py-16">
            <p className="text-sm font-medium text-violet-200">15 Sekunden ab {startingPrice} · Vorschau kostenlos</p>
            <h2 className="mx-auto mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">Beginne mit deiner Idee – nicht mit technischen Einstellungen.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-300">Im Studio kannst du zunächst die Story entwickeln. Modell, Format und Audio lassen sich bei Bedarf unter den Projekteinstellungen anpassen.</p>
            <TrackedLink
              href="/ki-video-erstellen#ai-director"
              location="final_cta"
              className="group mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-black transition hover:bg-zinc-200"
            >
              Kostenlos planen
              <ArrowIcon className="transition group-hover:translate-x-0.5" />
            </TrackedLink>
          </div>
        </section>
      </div>
    </main>
  );
}
