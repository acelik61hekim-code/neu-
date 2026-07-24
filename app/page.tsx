"use client";

import { useState } from "react";

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    if (prompt.trim().length < 3) {
      setError("Bitte beschreibe dein Video etwas genauer.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Etwas ist schiefgelaufen.");
        setLoading(false);
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError("Verbindung zum Server fehlgeschlagen.");
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="filmstrip">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className="title-card">
        <p className="eyebrow">Szene 1 · Aufnahme 1</p>
        <h1>Dein Prompt. Dein Video.</h1>
        <p className="subtitle">
          Beschreibe, was du sehen willst. Wir erstellen daraus ein Video mit
          Google Veo — bezahlt wird erst, wenn du auf „Video erstellen"
          klickst.
        </p>
      </div>

      <div className="slate">
        <div className="slate-top">
          <span>KI-VIDEO-STUDIO</span>
          <span>TEXT → VIDEO</span>
        </div>
        <div className="slate-body">
          <textarea
            placeholder="z.B. Ein Leuchtturm bei Sonnenuntergang, Wellen brechen an den Felsen, ruhige Kameraführung"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="slate-footer">
            <span className="price">
              Einmalig <strong>4,99 €</strong> pro Video
            </span>
            <button className="cta" onClick={handleSubmit} disabled={loading}>
              {loading ? "Einen Moment …" : "Video erstellen"}
            </button>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
      </div>
    </main>
  );
}
