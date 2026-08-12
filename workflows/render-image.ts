export async function renderImageWorkflow(jobId: string): Promise<{ jobId: string; complete: boolean }> {
  "use workflow";
  try {
    await generateImageStep(jobId);
    return { jobId, complete: true };
  } catch (error) {
    await failImageStep(jobId, readableError(error));
    throw error;
  }
}

async function generateImageStep(jobId: string): Promise<void> {
  "use step";
  const { generateAndStoreProfessionalImage } = await import("@/lib/image-generation");
  await generateAndStoreProfessionalImage(jobId);
}

async function failImageStep(jobId: string, message: string): Promise<void> {
  "use step";
  const { imageStore } = await import("@/lib/image-store");
  const job = await imageStore.get(jobId);
  if (!job || job.status === "done") return;
  await imageStore.set(jobId, { ...job, status: "error", renderStage: "failed", progressPercent: 0, errorMessage: message });
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Die Bilderstellung wurde unterbrochen.";
  if (/safety|blocked|policy|copyright/i.test(message)) return "Die Anfrage wurde aus Sicherheits- oder Urheberrechtsgründen abgelehnt. Bitte beschreibe ein eigenes Motiv ohne bekannte Figuren, Markenlogos oder lebende Künstler.";
  return message.slice(0, 600);
}

export default renderImageWorkflow;
