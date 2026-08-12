import { FilmIcon } from "./Icons";

export default function Header() {
  return (
    <header className="relative z-10 border-b border-white/10 bg-black/20 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-950/40">
            <FilmIcon />
          </div>

          <div>
            <p className="text-sm font-semibold tracking-wide text-white">
              KI Video Studio
            </p>

            <p className="text-xs text-zinc-500">
              Von der Idee zum fertigen Video
            </p>
          </div>
        </div>

        <button
          type="button"
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
        >
          Anmelden
        </button>
      </div>
    </header>
  );
}