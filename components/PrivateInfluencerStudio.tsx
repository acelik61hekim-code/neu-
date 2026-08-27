"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import { LoadingIcon, SparklesIcon } from "@/components/Icons";
import type { VoiceoverVoiceName } from "@/lib/audio-options";

type StoredImage = {
  pathname: string;
  name: string;
  mimeType: string;
};

type ImageItem = StoredImage & {
  previewUrl: string;
  file?: File;
};

type ProfileResponse = {
  access?: boolean;
  uploadPrefix?: string;
  profile?: null | {
    displayName: string;
    appearance: string;
    personality: string;
    contentStyle: string;
    audience: string;
    defaultCallToAction: string;
    voiceName: VoiceoverVoiceName;
    images: StoredImage[];
    imageUrls: string[];
  };
  error?: string;
};

type FormState = {
  displayName: string;
  appearance: string;
  personality: string;
  contentStyle: string;
  audience: string;
  defaultCallToAction: string;
  voiceName: VoiceoverVoiceName;
};

const EMPTY_FORM: FormState = {
  displayName: "",
  appearance: "",
  personality: "selbstbewusst, sympathisch und glaubwürdig",
  contentStyle: "modern, hochwertig, direkt und natürlich vor der Kamera",
  audience: "Menschen, die kreative KI-Videos, Songs und Bilder erstellen möchten",
  defaultCallToAction: "Besuche kivideostudio.de und probiere deine eigene Idee aus.",
  voiceName: "Kore",
};

const DAILY_GOALS = [
  { value: "Mehrwert", label: "Tipp & Mehrwert" },
  { value: "Werbung", label: "Werbung" },
  { value: "Story", label: "Persönliche Story" },
  { value: "Trend", label: "Trend/Reaktion" },
] as const;

async function optimizeImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Bitte verwende nur JPG-, PNG- oder WebP-Bilder.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Ein Originalbild darf höchstens 15 MB groß sein.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
      element.src = objectUrl;
    });
    const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Bild konnte nicht vorbereitet werden.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.78),
    );
    if (!blob) throw new Error("Das Bild konnte nicht vorbereitet werden.");
    if (blob.size > 1_200_000) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.6),
      );
    }
    if (!blob || blob.size > 1_500_000) {
      throw new Error("Das Bild ist trotz Optimierung noch zu groß. Bitte verwende ein kleineres Bild.");
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "referenz"}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function PrivateInfluencerStudio() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [uploadPrefix, setUploadPrefix] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState<(typeof DAILY_GOALS)[number]["value"]>("Mehrwert");
  const [duration, setDuration] = useState<15 | 30 | 60>(30);

  const complete = useMemo(
    () => Boolean(form.displayName.trim() && form.appearance.trim() && images.length > 0),
    [form.appearance, form.displayName, images.length],
  );

  useEffect(() => {
    void fetch("/api/influencer/profile", { cache: "no-store" })
      .then(async (response) => {
        const value = (await response.json()) as ProfileResponse;
        if (!response.ok) throw new Error(value.error || "Der private Bereich konnte nicht geladen werden.");
        setUploadPrefix(value.uploadPrefix || "");
        if (value.profile) {
          const { images: storedImages, imageUrls, ...storedForm } = value.profile;
          setForm(storedForm);
          setImages(
            storedImages.map((image, index) => ({
              ...image,
              previewUrl: imageUrls[index],
            })),
          );
          setRightsConfirmed(true);
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Der private Bereich konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, []);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const slots = 3 - images.length;
    if (slots <= 0) {
      setError("Du kannst höchstens drei feste Referenzbilder verwenden.");
      return;
    }

    try {
      const prepared = await Promise.all(
        Array.from(files)
          .slice(0, slots)
          .map(async (file) => {
            const optimized = await optimizeImage(file);
            return {
              pathname: "",
              name: optimized.name,
              mimeType: optimized.type,
              previewUrl: URL.createObjectURL(optimized),
              file: optimized,
            } satisfies ImageItem;
          }),
      );
      setImages((current) => [...current, ...prepared]);
      setMessage("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Bilder konnten nicht vorbereitet werden.");
    }
  }

  function removeImage(index: number) {
    setImages((current) => {
      const removed = current[index];
      if (removed?.file) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_image, itemIndex) => itemIndex !== index);
    });
    setMessage("");
  }

  async function persistProfile() {
    if (!complete) throw new Error("Trage einen Namen, das Aussehen und mindestens ein Referenzbild ein.");
    if (!rightsConfirmed) throw new Error("Bestätige bitte die Bildrechte und Einwilligung.");
    if (!uploadPrefix) throw new Error("Der private Upload ist noch nicht bereit.");

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const storedImages = await Promise.all(
        images.map(async (image) => {
          if (!image.file) {
            return { pathname: image.pathname, name: image.name, mimeType: image.mimeType };
          }
          const formData = new FormData();
          formData.set("file", image.file);
          const response = await fetch("/api/influencer/upload-image", {
            method: "POST",
            body: formData,
          });
          const result = (await response.json()) as {
            pathname?: string;
            name?: string;
            mimeType?: string;
            error?: string;
          };
          if (!response.ok || !result.pathname || !result.mimeType) {
            throw new Error(result.error || "Das Referenzbild konnte nicht sicher gespeichert werden.");
          }
          return {
            pathname: result.pathname,
            name: result.name || image.name,
            mimeType: result.mimeType,
          };
        }),
      );

      const response = await fetch("/api/influencer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, images: storedImages }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error || "Das Profil konnte nicht gespeichert werden.");

      const refreshed = (await fetch("/api/influencer/profile", { cache: "no-store" }).then((item) => item.json())) as ProfileResponse;
      if (refreshed.profile) {
        const { images: refreshedImages, imageUrls, ...storedForm } = refreshed.profile;
        images.forEach((image) => {
          if (image.file) URL.revokeObjectURL(image.previewUrl);
        });
        setForm(storedForm);
        setImages(
          refreshedImages.map((image, index) => ({
            ...image,
            previewUrl: imageUrls[index],
          })),
        );
      }
      setMessage("Dein KI-Influencer ist privat gespeichert.");
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    try {
      await persistProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Das Profil konnte nicht gespeichert werden.");
    }
  }

  async function createDailyPost() {
    if (!topic.trim()) {
      setError("Gib zuerst das heutige Thema ein.");
      return;
    }

    try {
      await persistProfile();
      const voiceDescription = form.voiceName === "Kore" ? "weiblicher" : "männlicher";
      const prompt = [
        `Erstelle ein professionelles vertikales ${duration}-Sekunden-Creator-Video für Social Media.`,
        `${form.displayName} ist die einzige sichtbare Hauptfigur und spricht direkt zur Kamera auf natürlichem Deutsch.`,
        `Heutiges Thema: ${topic.trim()}. Ziel des Beitrags: ${goal}.`,
        `Feste Identität und Aussehen: ${form.appearance}. Verwende die beigefügten privaten Referenzbilder verbindlich und bewahre Gesicht, Körperproportionen und wiedererkennbare Merkmale in jeder Szene.`,
        `Persönlichkeit: ${form.personality}. Content-Stil: ${form.contentStyle}. Zielgruppe: ${form.audience}.`,
        `Schreibe einen klaren Einstieg in den ersten zwei Sekunden, danach drei bis fünf kurze, glaubwürdige Sätze mit konkretem Inhalt und am Ende diesen Aufruf: ${form.defaultCallToAction}`,
        `Stimme: konstante ${voiceDescription} Studio-Stimme. Nur ${form.displayName} spricht. Kein Erzähler, keine zweite Stimme und kein zusätzlicher vom Videomodell erzeugter Dialog.`,
        "Zeige natürliche Mimik, passende Handbewegungen und abwechslungsreiche, aber zusammenhängende Kameraeinstellungen. Keine Untertitel, keine eingeblendeten Fantasietexte und keine weiteren Personen.",
      ].join("\n\n");

      sessionStorage.setItem(
        "private-influencer-draft-v1",
        JSON.stringify({ prompt, duration, voiceName: form.voiceName, createdAt: Date.now() }),
      );
      window.location.assign("/ki-video-erstellen?influencer=1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der Tagesbeitrag konnte nicht vorbereitet werden.");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#07070b] text-white">
        <Header active="account" />
        <div className="flex min-h-[70vh] items-center justify-center text-violet-200"><LoadingIcon className="animate-spin" /></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07070b] text-white">
      <Header active="account" />
      <div className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-xs font-semibold text-violet-200">Privat · nur für dein Konto</span>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Mein KI-Influencer</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">Speichere Identität, Stimme und Auftreten einmal. Für den täglichen Beitrag brauchst du danach nur noch ein Thema.</p>
          </div>
          <Link href="/konto" className="text-sm font-semibold text-violet-300">← Zurück zu meinen Inhalten</Link>
        </div>

        <div className="mt-10 grid gap-7 xl:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-200"><SparklesIcon /></span><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Feste Identität</p><h2 className="mt-1 text-2xl font-semibold">Dein privates Creator-Profil</h2></div></div>

            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <Field label="Name des Influencers"><input value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} maxLength={60} placeholder="z. B. Ruby" className="input" /></Field>
              <Field label="Feste Stimme"><select value={form.voiceName} onChange={(event) => updateField("voiceName", event.target.value as VoiceoverVoiceName)} className="input"><option value="Kore">Weibliche Stimme</option><option value="Charon">Männliche Stimme</option></select></Field>
              <Field label="Aussehen und wiedererkennbare Merkmale" wide><textarea value={form.appearance} onChange={(event) => updateField("appearance", event.target.value)} maxLength={800} rows={4} placeholder="Gesicht, Haare, Kleidung, Farben und besondere Merkmale …" className="input resize-none" /></Field>
              <Field label="Persönlichkeit"><textarea value={form.personality} onChange={(event) => updateField("personality", event.target.value)} maxLength={500} rows={4} className="input resize-none" /></Field>
              <Field label="Content-Stil"><textarea value={form.contentStyle} onChange={(event) => updateField("contentStyle", event.target.value)} maxLength={500} rows={4} className="input resize-none" /></Field>
              <Field label="Zielgruppe"><textarea value={form.audience} onChange={(event) => updateField("audience", event.target.value)} maxLength={300} rows={3} className="input resize-none" /></Field>
              <Field label="Standard-Aufruf am Ende"><textarea value={form.defaultCallToAction} onChange={(event) => updateField("defaultCallToAction", event.target.value)} maxLength={220} rows={3} className="input resize-none" /></Field>
            </div>

            <div className="mt-7 border-t border-white/10 pt-7">
              <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">Feste Referenzbilder</h3><p className="mt-1 text-xs leading-5 text-zinc-500">Am besten funktionieren ein Porträt, eine Halbfigur und eine Ganzkörperansicht derselben Figur.</p></div><span className="text-xs text-zinc-500">{images.length}/3</span></div>
              {images.length > 0 && <div className="mt-4 grid grid-cols-3 gap-3">{images.map((image, index) => <div key={`${image.pathname}-${image.name}-${index}`} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/30"><img src={image.previewUrl} alt={`Referenz ${index + 1}`} className="aspect-square w-full object-cover" /><button type="button" onClick={() => removeImage(index)} className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-1 text-[10px] font-semibold">Entfernen</button></div>)}</div>}
              {images.length < 3 && <label className="mt-4 flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-violet-400/30 bg-violet-400/[0.06] px-5 py-4 text-sm font-semibold text-violet-200 transition hover:bg-violet-400/10">{images.length ? "Weiteres Bild hinzufügen" : "Referenzbilder auswählen"}<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { void addImages(event.target.files); event.target.value = ""; }} /></label>}
              <label className="mt-4 flex items-start gap-3 text-xs leading-5 text-zinc-400"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-violet-500" /><span>Ich besitze die nötigen Bildrechte und Einwilligungen und verwende keine reale Person ohne deren Erlaubnis.</span></label>
              <button type="button" onClick={() => void saveProfile()} disabled={saving || !complete} className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Wird gespeichert …" : "KI-Influencer privat speichern"}</button>
            </div>
          </section>

          <aside className="h-fit rounded-3xl border border-violet-400/25 bg-gradient-to-b from-violet-500/[0.16] to-blue-500/[0.07] p-6 sm:p-8 xl:sticky xl:top-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Täglicher Beitrag</p>
            <h2 className="mt-2 text-2xl font-semibold">Heute posten</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Ein Thema reicht. Der Creator-Brief übernimmt automatisch deine gespeicherte Identität, Zielgruppe, Stimme und deinen Stil.</p>
            <label className="mt-6 block text-xs font-semibold text-zinc-300">Was soll heute erzählt werden?</label>
            <textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={6} maxLength={1200} placeholder="z. B. Zeige drei Vorteile von KI Video Studio und erkläre, warum Creator damit schneller posten können." className="input mt-2 resize-none" />
            <p className="mt-5 text-xs font-semibold text-zinc-300">Ziel</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{DAILY_GOALS.map((item) => <button key={item.value} type="button" onClick={() => setGoal(item.value)} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${goal === item.value ? "border-violet-300/50 bg-violet-500/25 text-white" : "border-white/10 text-zinc-400"}`}>{item.label}</button>)}</div>
            <p className="mt-5 text-xs font-semibold text-zinc-300">Videolänge</p>
            <div className="mt-2 grid grid-cols-3 gap-2">{([15, 30, 60] as const).map((seconds) => <button key={seconds} type="button" onClick={() => setDuration(seconds)} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${duration === seconds ? "border-blue-300/50 bg-blue-500/20 text-white" : "border-white/10 text-zinc-400"}`}>{seconds} Sek.</button>)}</div>
            <button type="button" onClick={() => void createDailyPost()} disabled={saving || !complete || !topic.trim()} className="mt-7 w-full rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-4 text-sm font-bold shadow-lg shadow-violet-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Profil wird vorbereitet …" : "Beitrag im Video Studio vorbereiten →"}</button>
            <p className="mt-3 text-center text-[11px] leading-5 text-zinc-500">Es wird noch kein kostenpflichtiges Video gestartet. Du prüfst zuerst Dialog, Szenen und Vorschau.</p>
          </aside>
        </div>

        {(message || error) && <div role={error ? "alert" : "status"} className={`mt-6 rounded-2xl border px-5 py-4 text-sm ${error ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}>{error || message}</div>}
      </div>
      <style jsx global>{`.input{width:100%;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;background:rgba(0,0,0,.25);padding:.75rem 1rem;color:white;outline:none;transition:border-color .2s}.input:focus{border-color:rgba(167,139,250,.55)}.input::placeholder{color:#52525b}.input option{background:#18181b;color:white}`}</style>
    </main>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? "block sm:col-span-2" : "block"}><span className="mb-2 block text-xs font-semibold text-zinc-300">{label}</span>{children}</label>;
}
