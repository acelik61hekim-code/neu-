export async function renderSongWorkflow(jobId: string): Promise<{ jobId: string; complete: boolean }> {
  "use workflow";

  try {
    await generateSongStep(jobId);
    return { jobId, complete: true };
  } catch (error) {
    await failSongStep(jobId, readableError(error));
    throw error;
  }
}

export default renderSongWorkflow;

async function generateSongStep(jobId: string): Promise<void> {
  "use step";
  const { generateAndStoreSong } = await import("@/lib/song-generation");
  await generateAndStoreSong(jobId);
}

generateSongStep.maxRetries = 5;

async function failSongStep(jobId: string, message: string): Promise<void> {
  "use step";
  const { songStore } = await import("@/lib/song-store");
  const job = await songStore.get(jobId);
  if (!job || job.status === "done") return;
  await songStore.set(jobId, {
    ...job,
    status: "error",
    renderStage: "failed",
    progressPercent: 0,
    errorMessage: message,
  });
}

function readableError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : typeof error === "string"
        ? error
        : "Die Songerstellung wurde unterbrochen.";
  if (/safety|blocked|sensitive|prohibited|copyright|artist|\b400\b/i.test(message)) {
    return "Der Musikdienst hat einzelne Wörter der Songidee oder Lyrics automatisch abgelehnt. Bitte formuliere mögliche doppeldeutige oder sensible Begriffe neutraler und verwende keine Künstlernamen oder bestehenden Liedtexte.";
  }
  if (/automatische Gesangsprüfung/i.test(message)) {
    return "Unsere Qualitätsprüfung hat Aussprache, Gesangstempo, Songlänge oder Audioqualität abgelehnt. Falls möglich, wurde bereits automatisch eine korrigierte Version erstellt. So liefern wir dir bewusst keinen fehlerhaften Song aus.";
  }
  if (/api internal error|provider internal error|upstream internal error|temporary internal error|upstream server|tim(?:ed|ing)? out|timeout|gateway timeout|service unavailable|temporarily unavailable|rate limit|too many requests|vorübergehender (?:interner )?fehler|vorübergehender musikdienst-fehler|\b(?:408|425|429|500|502|503|504)\b/i.test(message)) {
    return "Der Musikdienst antwortet momentan zu langsam oder ist vorübergehend ausgelastet. Dein bezahlter Auftrag bleibt sicher gespeichert und kann ohne neue Zahlung erneut gestartet werden.";
  }
  return message.slice(0, 600);
}
