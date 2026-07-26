"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type Status = "pending" | "processing" | "done" | "error";

export default function SuccessPage() {
  return (
    <Suspense fallback={<main className="page" />}>
      <SuccessContent />
    </Suspense>
  );
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId");
  const [status, setStatus] = useState<Status>("pending");
  const [format, setFormat] = useState<"short" | "long">("short");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [totalScenes, setTotalScenes] = useState<number | null>(null);
  const [completedScenes, setCompletedScenes] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/video-status?jobId=${jobId}`);
      const data = await res.json();
      if (data.status) setStatus(data.status);
      if (data.format) setFormat(data.format);
      if (data.videoUrl) setVideoUrl(data.videoUrl);
      if (data.videoUrls) setVideoUrls(data.videoUrls);
      if (typeof data.totalScenes === "number") setTotalScenes(data.totalScenes);
      if (typeof data.completedScenes === "number") setCompletedScenes(data.completedScenes);
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
              {format === "long" && totalScenes
                ? `Zahlung bestätigt — Szene ${completedScenes} von ${totalScenes} wird erstellt. Das kann mehrere Minuten dauern.`
                : "Zahlung bestätigt — dein Video wird gerade erstellt. Das kann ein bis zwei Minuten dauern."}
            </p>
          </>
        )}
        {status === "done" && format === "short" && videoUrl && (
          <>
            <p className="status-line">Fertig — hier ist dein Video:</p>
            <video controls src={videoUrl} />
          </>
        )}
        {status === "done" && format === "long" && videoUrls.length > 0 && (
          <>
            <p className="status-line">Fertig — hier ist dein Video:</p>
            <PlaylistPlayer clips={videoUrls} />
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

function PlaylistPlayer({ clips }: { clips: string[] }) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  function handleEnded() {
    setIndex((prev) => (prev + 1 < clips.length ? prev + 1 : prev));
  }

  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, [index]);

  return (
    <div>
      <video ref={videoRef} controls autoPlay src={clips[index]} onEnded={handleEnded} />
      <p className="status-line" style={{ marginTop: 12, marginBottom: 0 }}>
        Clip {index + 1} von {clips.length}
      </p>
    </div>
  );
}
