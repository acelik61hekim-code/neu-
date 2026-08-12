"use client";

import { useMemo, useState } from "react";

import Header from "@/components/Header";
import { ArrowIcon, LockIcon, MusicIcon, SparklesIcon } from "@/components/Icons";
import { formatEuroPrice } from "@/lib/pricing";
import {
  SONG_PRICE_CENTS,
  type SongLanguage,
  type SongLength,
  type SongLyricsMode,
  type SongVocalStyle,
} from "@/lib/song";

const styles = ["Pop", "Hip-Hop / Rap", "R&B", "Afrobeats", "Elektronisch", "Rock", "Akustisch", "Cinematic", "Schlager", "Lo-Fi"];
const moods = ["Energiegeladen", "Emotional", "Romantisch", "Düster", "Entspannt", "Motivierend", "Fröhlich", "Episch"];

export default function SongsPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("Pop");
  const [mood, setMood] = useState("Energiegeladen");
  const [length, setLength] = useState<SongLength>("full3");
  const [lyricsMode, setLyricsMode] = useState<SongLyricsMode>("ai");
  const [lyrics, setLyrics] = useState("");
  const [language, setLanguage] = useState<SongLanguage>("de");
  const [vocalStyle, setVocalStyle] = useState<SongVocalStyle>("auto");
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = useMemo(() => formatEuroPrice(SONG_PRICE_CENTS[length]), [length]);

  async function checkout() {
    setError(null);
    if (description.trim().length < 10) {
      setError("Bitte beschreibe deine Songidee etwas genauer.");
      return;
    }
    if (lyricsMode === "custom" && lyrics.trim().length < 10) {
      setError("Bitte gib deine Lyrics ein.");
      return;
    }
    if (lyricsMode === "custom" && !rightsAccepted) {
      setError("Bitte bestätige, dass du die Lyrics verwenden darfst.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/create-song-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          style,
          mood,
          length,
          lyricsMode,
          lyrics: lyricsMode === "custom" ? lyrics : undefined,
          language,
          vocalStyle,
          rightsAccepted,
        }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Der sichere Checkout konnte nicht geöffnet werden.");
      window.location.href = data.url;
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Bitte versuche es erneut.");
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <Background />
      <Header active="song" />

      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <section className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200">
            <SparklesIcon /> Lyria 3 Musik-KI
          </div>
          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">
            Deine Idee wird zum
            <span className="block bg-gradient-to-r from-violet-300 via-fuchsia-300 to-blue-300 bg-clip-text text-transparent">fertigen Song</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            Erstelle reine Musik ohne Video – instrumental, mit neu geschriebenen KI-Lyrics oder mit deinem eigenen Songtext. Als hochwertige MP3 zum Anhören und Herunterladen.
          </p>
        </section>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
            <Field label="Songtitel" hint="optional">
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Zum Beispiel: Lichter der Nacht" className={inputClass} />
            </Field>

            <Field label="Worum geht es in deinem Song?" hint="Beschreibe Thema, Klang und besondere Wünsche">
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1500} rows={5} placeholder="Ein moderner, emotionaler Pop-Song über einen Neuanfang. Sanftes Piano im Intro, großer eingängiger Refrain und ein hoffnungsvolles Ende ..." className={inputClass} />
              <div className="mt-2 text-right text-[11px] text-zinc-600">{description.length} / 1500</div>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField label="Musikstil" value={style} onChange={setStyle} options={styles} />
              <SelectField label="Stimmung" value={mood} onChange={setMood} options={moods} />
            </div>

            <Field label="Songlänge">
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice active={length === "clip"} onClick={() => setLength("clip")} title="30 Sekunden" description="Hook, Loop oder Vorschau" badge="2,99 €" />
                <Choice active={length === "full2"} onClick={() => setLength("full2")} title="2 Minuten" description="Vollsong mit Strophen und Refrain" badge="7,99 €" />
                <Choice active={length === "full3"} onClick={() => setLength("full3")} title="3 Minuten" description="Vollsong mit Bridge und Outro" badge="9,99 €" recommended />
                <Choice active={false} onClick={() => undefined} title="4 Minuten" description="Qualitätstest läuft – noch nicht buchbar" badge="Demnächst" disabled />
              </div>
            </Field>

            <Field label="Lyrics und Gesang">
              <div className="grid gap-3 sm:grid-cols-3">
                <Choice compact active={lyricsMode === "instrumental"} onClick={() => setLyricsMode("instrumental")} title="Instrumental" description="Ohne Stimme" />
                <Choice compact active={lyricsMode === "ai"} onClick={() => setLyricsMode("ai")} title="KI-Lyrics" description="Text wird erstellt" />
                <Choice compact active={lyricsMode === "custom"} onClick={() => setLyricsMode("custom")} title="Eigene Lyrics" description="Dein Songtext" />
              </div>
            </Field>

            {lyricsMode === "custom" && (
              <Field label="Deine Lyrics" hint="[Verse], [Chorus] und [Bridge] helfen bei der Struktur">
                <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} maxLength={8000} rows={12} placeholder={"[Verse 1]\n...\n\n[Chorus]\n...\n\n[Verse 2]\n..."} className={`${inputClass} font-mono text-sm`} />
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-zinc-400">
                  <input type="checkbox" checked={rightsAccepted} onChange={(event) => setRightsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 accent-fuchsia-500" />
                  Ich bestätige, dass der Text von mir stammt oder ich die nötigen Rechte und Einwilligungen zur Nutzung habe.
                </label>
              </Field>
            )}

            {lyricsMode !== "instrumental" && (
              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Stimme"
                  value={vocalStyle}
                  onChange={(value) => setVocalStyle(value as SongVocalStyle)}
                  options={["auto", "female", "male", "duet", "choir"]}
                  labels={{ auto: "Automatisch", female: "Weibliche Stimme", male: "Männliche Stimme", duet: "Duett", choir: "Chor" }}
                />
                <SelectField
                  label="Sprache"
                  value={language}
                  onChange={(value) => setLanguage(value as SongLanguage)}
                  options={["de", "en", "auto"]}
                  labels={{ de: "Deutsch", en: "Englisch", auto: "Automatisch" }}
                />
              </div>
            )}
          </section>

          <aside className="h-fit rounded-3xl border border-fuchsia-400/15 bg-gradient-to-b from-fuchsia-500/[0.09] to-violet-500/[0.04] p-6 shadow-2xl shadow-fuchsia-950/20 lg:sticky lg:top-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 shadow-lg shadow-fuchsia-950/40">
              <MusicIcon />
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-fuchsia-300">Dein KI-Song</p>
            <h2 className="mt-2 text-2xl font-semibold">{length === "clip" ? "30-Sekunden-Song" : `${length === "full2" ? 2 : length === "full3" ? 3 : 4}-Minuten-Vollsong`}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {lyricsMode === "instrumental" ? "Originale Instrumentalmusik ohne Gesang." : lyricsMode === "custom" ? "Komponiert und gesungen mit deinen Lyrics." : "Komposition, Gesang und neue Lyrics aus deiner Idee."}
            </p>
            <div className="my-6 h-px bg-white/10" />
            <ul className="space-y-3 text-sm text-zinc-300">
              <Benefit>Hochwertige Stereo-MP3</Benefit>
              <Benefit>Nur Musik – kein Video nötig</Benefit>
              <Benefit>Sicherer Download nach Erstellung</Benefit>
              <Benefit>Originalkomposition mit SynthID</Benefit>
            </ul>
            <div className="my-6 h-px bg-white/10" />
            <div className="flex items-end justify-between">
              <span className="text-sm text-zinc-400">Einmalig</span>
              <span className="text-3xl font-semibold tracking-tight">{price}</span>
            </div>
            {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs leading-5 text-red-200">{error}</p>}
            <button onClick={() => void checkout()} disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/40 transition hover:from-fuchsia-500 hover:to-violet-500 disabled:cursor-wait disabled:opacity-60">
              {loading ? "Checkout wird geöffnet ..." : `Song für ${price} erstellen`}
              {!loading && <ArrowIcon />}
            </button>
            <p className="mt-4 flex items-center justify-center gap-2 text-[11px] text-zinc-500"><LockIcon /> Erst bezahlen, dann wird der Song erzeugt</p>
          </aside>
        </div>

        <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/5 pt-6 text-xs text-zinc-600 sm:flex-row">
          <p>© 2026 KI Video Studio</p>
          <p>KI-Songs und Videos an einem Ort</p>
        </footer>
      </div>
    </main>
  );
}

const inputClass = "w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-400/40 focus:ring-2 focus:ring-fuchsia-500/10";

function Background() {
  return <div className="pointer-events-none absolute inset-0"><div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-fuchsia-700/20 blur-[140px]" /><div className="absolute right-[-180px] top-[180px] h-[460px] w-[460px] rounded-full bg-violet-700/15 blur-[140px]" /><div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" /></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><div className="mb-2 flex items-center justify-between gap-4"><label className="text-sm font-medium text-zinc-200">{label}</label>{hint && <span className="text-[11px] text-zinc-600">{hint}</span>}</div>{children}</div>;
}

function SelectField({ label, value, onChange, options, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string> }) {
  return <Field label={label}><select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>{options.map((option) => <option key={option} value={option} className="bg-zinc-950">{labels[option] || option}</option>)}</select></Field>;
}

function Choice({ active, onClick, title, description, badge, recommended, compact, disabled }: { active: boolean; onClick: () => void; title: string; description: string; badge?: string; recommended?: boolean; compact?: boolean; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`relative rounded-2xl border text-left transition ${compact ? "p-3.5" : "p-4"} ${disabled ? "cursor-not-allowed border-white/5 bg-black/10 opacity-45" : active ? "border-fuchsia-400/40 bg-fuchsia-400/10 shadow-lg shadow-fuchsia-950/20" : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]"}`}>{recommended && <span className="absolute right-3 top-3 rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-fuchsia-200">Beliebt</span>}<div className="flex items-center justify-between gap-3"><span className={`text-sm font-medium ${active ? "text-white" : "text-zinc-300"}`}>{title}</span>{badge && <span className="text-xs font-semibold text-fuchsia-300">{badge}</span>}</div><p className="mt-1 text-[11px] leading-5 text-zinc-500">{description}</p></button>;
}

function Benefit({ children }: { children: React.ReactNode }) {
  return <li className="flex items-center gap-2.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/10 text-[10px] text-emerald-300">✓</span>{children}</li>;
}
