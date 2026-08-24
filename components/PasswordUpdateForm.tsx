"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import Header from "@/components/Header";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function PasswordUpdateForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Das Passwort muss mindestens 8 Zeichen lang sein."); return; }
    if (password !== confirm) { setError("Die Passwörter stimmen nicht überein."); return; }
    setLoading(true);
    const { error: authError } = await createSupabaseBrowserClient().auth.updateUser({ password });
    setLoading(false);
    if (authError) { setError(authError.message); return; }
    router.push("/konto?passwort=aktualisiert"); router.refresh();
  }
  return <main className="min-h-screen bg-[#07070b] text-white"><Header active="account" /><div className="mx-auto flex min-h-[75vh] max-w-lg items-center px-5"><section className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-7"><h1 className="text-3xl font-semibold">Neues Passwort</h1><p className="mt-3 text-sm text-zinc-400">Lege ein neues Passwort mit mindestens 8 Zeichen fest.</p><form onSubmit={submit} className="mt-6 space-y-4"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Neues Passwort" className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none" /><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Passwort wiederholen" className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none" />{error && <p className="text-xs text-red-300">{error}</p>}<button disabled={loading} className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold">{loading ? "Wird gespeichert …" : "Passwort speichern"}</button></form></section></div></main>;
}
