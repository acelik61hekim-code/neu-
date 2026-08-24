"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isRunningAsApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export default function PwaInstaller() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(true);

  useEffect(() => {
    if (
      (window as Window & {
        __KI_VIDEO_STUDIO_NATIVE_APP__?: boolean;
      }).__KI_VIDEO_STUDIO_NATIVE_APP__ ||
      navigator.userAgent.includes("KIVideoStudioApp")
    ) {
      setIsInstalled(true);
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const installed = isRunningAsApp();
    const iosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent);

    setIsInstalled(installed);
    setIsIos(iosDevice);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setIsInstalled(false);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setShowIosHelp(false);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;

      if (choice.outcome === "accepted") {
        setInstallPrompt(null);
      }

      return;
    }

    if (isIos) {
      setShowIosHelp(true);
    }
  }

  if (isInstalled || (!installPrompt && !isIos)) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:block sm:px-0">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#11111a]/95 p-3 text-white shadow-2xl shadow-black/50 backdrop-blur-xl">
        {showIosHelp ? (
          <div className="flex items-start gap-3 px-1 py-0.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-sm font-black">
              KI
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Auf dem iPhone installieren</p>
              <p className="mt-1 text-xs leading-5 text-zinc-300">
                Tippe in Safari auf „Teilen“ und anschließend auf
                „Zum Home-Bildschirm“.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowIosHelp(false)}
              className="rounded-lg px-2 py-1 text-lg leading-none text-zinc-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Installationshinweis schließen"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-sm font-black shadow-lg shadow-violet-950/40">
              KI
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">KI Video Studio App</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Schnellzugriff vom Startbildschirm
              </p>
            </div>
            <button
              type="button"
              onClick={installApp}
              className="shrink-0 rounded-xl bg-violet-500 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Installieren
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
