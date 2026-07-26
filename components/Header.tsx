export default function Header() {
  return (
    <header className="w-full border-b border-neutral-800 bg-black/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold text-white">
            🎬 KI Video Studio
          </h1>

          <p className="text-sm text-neutral-400">
            Erstelle komplette KI-Filme mit einem Satz.
          </p>
        </div>

        <button className="rounded-xl border border-neutral-700 px-5 py-2 text-white transition hover:bg-neutral-900">
          Login
        </button>
      </div>
    </header>
  );
}
