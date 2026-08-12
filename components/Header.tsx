"use client";

import { FilmIcon, MusicIcon } from "./Icons";

type HeaderProps = {
  active?: "video" | "song";
  onStudioChange?: (mode: "video" | "song") => void;
};

export default function Header({ active, onStudioChange }: HeaderProps) {
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
              Videos und Songs mit KI
            </p>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.035] p-1" aria-label="Studio auswählen">
          <button
            type="button"
            onClick={() => onStudioChange ? onStudioChange("video") : window.location.assign("/")}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${active === "video" ? "bg-violet-500/20 text-violet-100" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
          >
            <FilmIcon className="hidden sm:block" />
            Video
          </button>
          <button
            type="button"
            onClick={() => onStudioChange ? onStudioChange("song") : window.location.assign("/?studio=song")}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition sm:text-sm ${active === "song" ? "bg-fuchsia-500/20 text-fuchsia-100" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
          >
            <MusicIcon className="hidden sm:block" />
            Songs
          </button>
        </nav>
      </div>
    </header>
  );
}
