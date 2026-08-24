"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ArrowIcon, FilmIcon, LockIcon } from "./Icons";

type HeaderProps = {
  active?: "video" | "song" | "image" | "studio" | "account";
  onStudioChange?: (mode: "video" | "song" | "image") => void;
};

export default function Header({ active, onStudioChange }: HeaderProps) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createSupabaseBrowserClient();
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSignedIn(Boolean(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setSignedIn(Boolean(session));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  void active;
  void onStudioChange;

  return (
    <header className="relative z-20 border-b border-white/[0.08] bg-[#07070b]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3" aria-label="KI Video Studio Startseite">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-950/40 transition group-hover:scale-[1.03]">
            <FilmIcon />
          </div>

          <div>
            <p className="text-sm font-semibold tracking-wide text-white">
              KI Video Studio
            </p>

            <p className="text-xs text-zinc-500">
              Deine Ideen. Professionell erstellt.
            </p>
          </div>
        </Link>

        <Link
          href={signedIn ? "/konto" : "/anmelden?next=/konto"}
          className="group inline-flex min-w-[122px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-black/20 transition hover:border-violet-400/30 hover:bg-violet-500/10"
        >
          <LockIcon className="text-violet-300" />
          {signedIn ? "Mein Konto" : "Anmelden"}
          <ArrowIcon className="hidden text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-violet-300 sm:block" />
        </Link>
      </div>
    </header>
  );
}
