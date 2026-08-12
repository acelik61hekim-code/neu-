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
  const message = error instanceof Error ? error.message : "Die Songerstellung wurde unterbrochen.";
  if (/safety|blocked|copyright|artist/i.test(message)) {
    return "Die Anfrage wurde vom Musikdienst aus Sicherheits- oder Urheberrechtsgründen abgelehnt. Bitte beschreibe einen eigenen Stil ohne Namen bekannter Künstler oder geschützte Songtexte.";
  }
  return message.slice(0, 600);
}
