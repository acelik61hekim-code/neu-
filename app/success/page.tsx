"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "pending" | "processing" | "done" | "error";

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId");

  const [status, setStatus] = useState<Status>("pending");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/video-status?jobId=${jobId}`);
      const data = await res.json();

      if (data.status) setStatus(data.status);
      if (data.videoUrl) setVideoUrl(data.videoUrl);
      if (data.errorMessage) setErrorMessage(data.errorMessage);

      if (data.status === "done" || data.status === "error") {
        clearInterval(interval);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [jobId]);

  return (
    <main className="page">
      <div className="filmstrip">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>

      <div className="status-box">
        {status !== "done" && status !== "error" && (
          <>
            <div className="reel" />
            <p className="status-line">
              Zahlung bestätigt — dein Video wird gerade erstellt. Das kann
              ein bis zwei Minuten dauern.
            </p>
          </>
        )}

        {status === "done" && videoUrl && (
          <>
            <p className="status-line">Fertig — hier ist dein Video:</p>
            <video controls src={videoUrl} />
          </>
        )}

        {status === "error" && (
          <p className="error-msg">
            {errorMessage ?? "Bei der Videoerstellung ist etwas schiefgelaufen."}
          </p>
        )}

        <a className="back-link" href="/">
          ← Neues Video erstellen
        </a>
      </div>
    </main>
  );
}
