import Link from "next/link";

export const metadata = {
  title: "Keine Internetverbindung",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-[82vh] items-center justify-center bg-[#07070d] px-5 py-16 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl shadow-black/30 sm:p-11">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 text-lg font-black shadow-lg shadow-violet-950/40">
          KI
        </div>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">
          Verbindung unterbrochen
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Du bist gerade offline
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-400">
          Für Video-, Song- und Bildgenerierungen wird eine Internetverbindung
          benötigt. Sobald du wieder verbunden bist, kannst du direkt
          weitermachen.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          Erneut versuchen
        </Link>
      </section>
    </main>
  );
}
