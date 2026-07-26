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
