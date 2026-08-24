"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Header from "@/components/Header";
import { LockIcon, SparklesIcon } from "@/components/Icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AuthMode = "login" | "register" | "forgot";

export default function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const configured = isSupabaseConfigured();
  const next = useMemo(() => {
    if (typeof window === "undefined") return "/konto";
    const value = new URLSearchParams(window.location.search).get("next") || "/konto";
    return value.startsWith("/") && !value.startsWith("//") ? value : "/konto";
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setMessage("");
    if (!configured) { setError("Die Kundenanmeldung wird gerade eingerichtet."); return; }
    if (!email.trim()) { setError("Bitte gib deine E-Mail-Adresse ein."); return; }
    if (mode !== "forgot" && password.length < 8) { setError("Das Passwort muss mindestens 8 Zeichen lang sein."); return; }
    if (mode === "register" && password !== passwordConfirm) { setError("Die beiden Passwörter stimmen nicht überein."); return; }
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    try {
      if (mode === "register") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (authError) throw authError;
        if (data.session) { router.push(next); router.refresh(); return; }
        setMessage("Fast geschafft: Öffne die Bestätigungs-E-Mail und bestätige dein Konto.");
      } else if (mode === "forgot") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/passwort-aendern`,
        });
        if (authError) throw authError;
        setMessage("Wir haben dir einen sicheren Link zum Zurücksetzen des Passworts geschickt.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.push(next); router.refresh();
      }
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Die Anmeldung ist fehlgeschlagen.";
      setError(/invalid login credentials/i.test(text) ? "E-Mail-Adresse oder Passwort ist falsch." : /email not confirmed/i.test(text) ? "Bitte bestätige zuerst deine E-Mail-Adresse." : text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#07070b] text-white">
      <Header active="account" />
      <div className="mx-auto grid min-h-[80vh] max-w-5xl items-center gap-8 px-5 py-12 lg:grid-cols-[1fr_440px] lg:px-8">
        <section><div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200"><SparklesIcon /> Dein persönliches KI Studio</div><h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Alle deine Kreationen an einem Ort.</h1><p className="mt-5 max-w-xl text-sm leading-7 text-zinc-400">Dein Abo, verbleibende Generierungen, Songs, Videos und Bilder bleiben sicher mit deinem Konto verbunden – auch auf einem neuen Gerät.</p><ul className="mt-7 space-y-3 text-sm text-zinc-300"><Benefit>Private Mediathek für Songs, Videos und Bilder</Benefit><Benefit>Abo und Monatskontingent jederzeit einsehen</Benefit><Benefit>Downloads und Sound Studio direkt wieder öffnen</Benefit></ul></section>
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="flex rounded-xl border border-white/10 bg-black/25 p-1"><button type="button" onClick={() => { setMode("login"); setError(""); setMessage(""); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${mode === "login" ? "bg-violet-600 text-white" : "text-zinc-400"}`}>Anmelden</button><button type="button" onClick={() => { setMode("register"); setError(""); setMessage(""); }} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${mode === "register" ? "bg-violet-600 text-white" : "text-zinc-400"}`}>Registrieren</button></div>
          <h2 className="mt-6 text-2xl font-semibold">{mode === "register" ? "Konto erstellen" : mode === "forgot" ? "Passwort zurücksetzen" : "Willkommen zurück"}</h2>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{mode === "register" ? "Nach der Registrierung bestätigst du einmal deine E-Mail-Adresse." : mode === "forgot" ? "Du erhältst einen sicheren Link per E-Mail." : "Melde dich an, um deine gespeicherten Inhalte zu sehen."}</p>
          <form onSubmit={submit} className="mt-6 space-y-4"><Field label="E-Mail-Adresse"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} placeholder="name@beispiel.de" /></Field>{mode !== "forgot" && <Field label="Passwort"><input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} placeholder="Mindestens 8 Zeichen" /></Field>}{mode === "register" && <Field label="Passwort wiederholen"><input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} className={inputClass} /></Field>}
            {error && <p className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs leading-5 text-red-200">{error}</p>}{message && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-xs leading-5 text-emerald-200">{message}</p>}
            <button type="submit" disabled={loading || !configured} className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3.5 text-sm font-semibold disabled:opacity-50">{loading ? "Bitte warten …" : mode === "register" ? "Kostenlos registrieren" : mode === "forgot" ? "Link anfordern" : "Sicher anmelden"}</button>
          </form>
          {mode === "login" && <button type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }} className="mt-4 w-full text-center text-xs text-violet-300">Passwort vergessen?</button>}{mode === "forgot" && <button type="button" onClick={() => setMode("login")} className="mt-4 w-full text-center text-xs text-violet-300">Zurück zur Anmeldung</button>}
          <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-zinc-600"><LockIcon /> Sichere, verschlüsselte Kontositzung</p>
        </section>
      </div>
    </main>
  );
}

const inputClass = "w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/40";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-xs font-medium text-zinc-300">{label}</span>{children}</label>; }
function Benefit({ children }: { children: React.ReactNode }) { return <li className="flex items-center gap-3"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/10 text-[10px] text-emerald-300">✓</span>{children}</li>; }
