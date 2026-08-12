"use client";

import { useMemo, useState } from "react";
import Header from "@/components/Header";
import { ArrowIcon, ImageIcon, LockIcon, SparklesIcon } from "@/components/Icons";
import StudioChooser, { type StudioMode } from "@/components/StudioChooser";
import { formatEuroPrice } from "@/lib/pricing";
import { IMAGE_PRICE_CENTS, type ImageAspectRatio, type ImageQuality, type ImageStyle } from "@/lib/image-product";

const styles: Array<{ value: ImageStyle; label: string }> = [
  { value: "photo", label: "Fotorealistisch" }, { value: "product", label: "Produktfotografie" },
  { value: "marketing", label: "Werbung / Social Media" }, { value: "poster", label: "Poster / Cover" },
  { value: "illustration", label: "Illustration" }, { value: "interior", label: "Architektur / Interior" },
  { value: "art", label: "Künstlerisch" },
];
const formats: Array<{ value: ImageAspectRatio; label: string; hint: string }> = [
  { value: "1:1", label: "Quadrat", hint: "Posts" }, { value: "4:5", label: "Hochformat", hint: "Instagram" },
  { value: "3:2", label: "Foto quer", hint: "Web / Print" }, { value: "2:3", label: "Foto hoch", hint: "Poster" },
  { value: "16:9", label: "Widescreen", hint: "Banner" }, { value: "9:16", label: "Story", hint: "Reels" },
];

export default function ImageStudio({ onStudioChange }: { onStudioChange: (mode: StudioMode) => void }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageStyle>("photo");
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>("1:1");
  const [quality, setQuality] = useState<ImageQuality>("professional");
  const [textInImage, setTextInImage] = useState("");
  const [colorMood, setColorMood] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [rightsAccepted, setRightsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = useMemo(() => formatEuroPrice(IMAGE_PRICE_CENTS[quality]), [quality]);

  async function checkout() {
    setError(null);
    if (prompt.trim().length < 10) { setError("Bitte beschreibe dein Wunschbild etwas genauer."); return; }
    if (!rightsAccepted) { setError("Bitte bestätige die Rechte- und Sicherheitsbedingungen."); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/create-image-checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, prompt, style, aspectRatio, quality, textInImage, colorMood, negativePrompt, rightsAccepted }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Der sichere Checkout konnte nicht geöffnet werden.");
      window.location.href = data.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bitte versuche es erneut.");
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07070b] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-180px] top-[-160px] h-[480px] w-[480px] rounded-full bg-cyan-700/20 blur-[140px]" />
        <div className="absolute right-[-180px] top-[160px] h-[460px] w-[460px] rounded-full bg-blue-700/15 blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>
      <Header active="image" onStudioChange={onStudioChange} />
      <div className="relative z-10 mx-auto max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <section className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-200"><SparklesIcon /> Professionelle Bild-KI</div>
          <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-6xl">Deine Vorstellung wird zum <span className="block bg-gradient-to-r from-cyan-300 via-blue-300 to-violet-300 bg-clip-text text-transparent">professionellen Bild</span></h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">Erstelle individuelle Fotos, Werbemotive, Produktbilder, Poster und Illustrationen nach deinen Wünschen – in professioneller 2K- oder Premium-4K-Qualität.</p>
          <StudioChooser active="image" onChange={onStudioChange} />
        </section>
        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-6 rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
            <Field label="Bildtitel" hint="optional"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Zum Beispiel: Sommer-Kampagne" className={inputClass} /></Field>
            <Field label="Beschreibe dein Wunschbild" hint="Motiv, Umgebung, Perspektive, Licht und Details"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2500} rows={7} placeholder="Ein luxuriöses Parfümflakon auf schwarzem Marmor, weiches goldenes Seitenlicht, dezente Spiegelung, hochwertige Werbefotografie, Nahaufnahme ..." className={inputClass} /><div className="mt-2 text-right text-[11px] text-zinc-600">{prompt.length} / 2500</div></Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Bildstil"><select value={style} onChange={(event) => setStyle(event.target.value as ImageStyle)} className={inputClass}>{styles.map((item) => <option key={item.value} value={item.value} className="bg-zinc-950">{item.label}</option>)}</select></Field>
              <Field label="Farben und Stimmung" hint="optional"><input value={colorMood} onChange={(event) => setColorMood(event.target.value)} maxLength={300} placeholder="Warm, elegant, Gold und Schwarz" className={inputClass} /></Field>
            </div>
            <Field label="Bildformat"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{formats.map((item) => <button key={item.value} type="button" onClick={() => setAspectRatio(item.value)} className={`rounded-xl border p-3 text-left transition ${aspectRatio === item.value ? "border-cyan-400/40 bg-cyan-400/10" : "border-white/10 bg-black/20 hover:border-white/20"}`}><span className="text-sm font-medium">{item.label}</span><span className="mt-1 block text-[11px] text-zinc-500">{item.value} · {item.hint}</span></button>)}</div></Field>
            <Field label="Text im Bild" hint="optional – wird exakt geschrieben"><input value={textInImage} onChange={(event) => setTextInImage(event.target.value)} maxLength={300} placeholder="Zum Beispiel: Deine Idee. Dein Moment." className={inputClass} /></Field>
            <Field label="Was soll vermieden werden?" hint="optional"><input value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} maxLength={500} placeholder="Keine Menschen, keine Schrift, keine grellen Farben ..." className={inputClass} /></Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-zinc-400"><input type="checkbox" checked={rightsAccepted} onChange={(event) => setRightsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-500" />Ich bestätige, dass meine Beschreibung keine unzulässigen Inhalte, fremden Markenlogos, geschützten Figuren oder täuschende Darstellungen realer Personen verlangt und ich nötige Nutzungsrechte besitze.</label>
          </section>
          <aside className="h-fit rounded-3xl border border-cyan-400/15 bg-gradient-to-b from-cyan-500/[0.09] to-blue-500/[0.04] p-6 shadow-2xl shadow-cyan-950/20 lg:sticky lg:top-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-950/40"><ImageIcon /></div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Dein KI-Bild</p>
            <h2 className="mt-2 text-2xl font-semibold">{quality === "professional" ? "Professional 2K" : "Premium 4K"}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Ein individuelles, professionell erzeugtes Bild im Format {aspectRatio}.</p>
            <div className="my-6 h-px bg-white/10" />
            <div className="grid gap-3"><Quality active={quality === "professional"} onClick={() => setQuality("professional")} title="Professional 2K" price="3,99 €" text="Schnell und hochwertig" /><Quality active={quality === "premium"} onClick={() => setQuality("premium")} title="Premium 4K" price="6,99 €" text="Maximale Details für Print & Werbung" /></div>
            <div className="my-6 h-px bg-white/10" />
            <ul className="space-y-3 text-sm text-zinc-300"><Benefit>Professionelle Komposition</Benefit><Benefit>JPG in hoher Auflösung</Benefit><Benefit>Sicherer Download</Benefit><Benefit>Individuell nach deinem Wunsch</Benefit></ul>
            <div className="my-6 h-px bg-white/10" />
            <div className="flex items-end justify-between"><span className="text-sm text-zinc-400">Einmalig</span><span className="text-3xl font-semibold tracking-tight">{price}</span></div>
            {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs leading-5 text-red-200">{error}</p>}
            <button onClick={() => void checkout()} disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-3.5 text-sm font-semibold shadow-lg shadow-cyan-950/40 transition hover:from-cyan-500 hover:to-blue-500 disabled:cursor-wait disabled:opacity-60">{loading ? "Checkout wird geöffnet ..." : `Bild für ${price} erstellen`}{!loading && <ArrowIcon />}</button>
            <p className="mt-4 flex items-center justify-center gap-2 text-[11px] text-zinc-500"><LockIcon /> Erst bezahlen, dann wird das Bild erzeugt</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

const inputClass = "w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-500/10";
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <div><div className="mb-2 flex items-center justify-between gap-4"><label className="text-sm font-medium text-zinc-200">{label}</label>{hint && <span className="text-[11px] text-zinc-600">{hint}</span>}</div>{children}</div>; }
function Quality({ active, onClick, title, price, text }: { active: boolean; onClick: () => void; title: string; price: string; text: string }) { return <button type="button" onClick={onClick} className={`rounded-xl border p-3 text-left transition ${active ? "border-cyan-400/40 bg-cyan-400/10" : "border-white/10 bg-black/20 hover:border-white/20"}`}><div className="flex justify-between gap-3"><span className="text-sm font-medium">{title}</span><span className="text-xs font-semibold text-cyan-300">{price}</span></div><p className="mt-1 text-[11px] text-zinc-500">{text}</p></button>; }
function Benefit({ children }: { children: React.ReactNode }) { return <li className="flex items-center gap-2.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/10 text-[10px] text-emerald-300">✓</span>{children}</li>; }
