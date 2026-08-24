import Link from "next/link";

const CONTACT_EMAIL = "info@kivideostudio.de";

export default function SiteFooter() {
  return (
    <footer className="relative z-20 border-t border-white/[0.08] bg-[#07070b] text-white">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <p className="text-sm font-semibold tracking-wide">KI Video Studio</p>
          <p className="mt-1 text-xs text-zinc-500">
            Videos, Songs und Bilder professionell mit KI erstellen.
          </p>
        </div>

        <div className="sm:text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
            Kontakt &amp; Hilfe
          </p>
          <Link
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-1.5 inline-flex text-sm font-medium text-zinc-200 transition hover:text-violet-300 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            {CONTACT_EMAIL}
          </Link>
        </div>
      </div>

      <div className="border-t border-white/[0.05]">
        <div className="mx-auto max-w-[1500px] px-5 py-4 text-[11px] text-zinc-600 sm:px-8">
          © 2026 KI Video Studio
        </div>
      </div>
    </footer>
  );
}
