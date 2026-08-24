"use client";

import Link from "next/link";

import { FilmIcon, ImageIcon, MusicIcon, SparklesIcon } from "@/components/Icons";
import { STUDIO_PATHS } from "@/lib/site";

export type StudioMode = "video" | "song" | "image";

export default function StudioChooser({
  active,
  onChange,
  compact = false,
}: {
  active: StudioMode;
  onChange: (mode: StudioMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/25 p-2 shadow-xl shadow-black/20 lg:grid-cols-4 ${compact ? "w-full max-w-4xl" : "mx-auto mt-7 w-full max-w-4xl"}`}
      aria-label="Was möchtest du erstellen?"
    >
      <Link
        href={STUDIO_PATHS.video}
        onClick={(event) => {
          event.preventDefault();
          onChange("video");
        }}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${active === "video" ? "bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-950/40" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
      >
        <FilmIcon />
        Video erstellen
      </Link>
      <Link
        href={STUDIO_PATHS.song}
        onClick={(event) => {
          event.preventDefault();
          onChange("song");
        }}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${active === "song" ? "bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white shadow-lg shadow-fuchsia-950/40" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
      >
        <MusicIcon />
        Song erstellen
      </Link>
      <Link
        href={STUDIO_PATHS.image}
        onClick={(event) => {
          event.preventDefault();
          onChange("image");
        }}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${active === "image" ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-950/40" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
      >
        <ImageIcon />
        Bild erstellen
      </Link>
      <Link
        href="/sound-studio"
        className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-zinc-400 transition hover:bg-fuchsia-500/10 hover:text-fuchsia-100"
      >
        <SparklesIcon />
        Sound Studio
      </Link>
    </div>
  );
}
