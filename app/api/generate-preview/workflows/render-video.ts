type PreparedRenderJob = {
  jobId: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  editingStyle: string;
  generationStrategy: string;
  totalChapters: number;
  totalExtensions: number;
};

export async function renderVideoWorkflow(
  jobId: string,
): Promise<PreparedRenderJob> {
  "use workflow";

  return await prepareRenderJob(
    jobId,
  );
}

async function prepareRenderJob(
  jobId: string,
): Promise<PreparedRenderJob> {
  "use step";

  const {
    jobStore,
  } = await import(
    "@/lib/store"
  );

  const job =
    await jobStore.get(
      jobId,
    );

  if (!job) {
    throw new Error(
      `Render-Job ${jobId} wurde nicht gefunden.`,
    );
  }

  if (
    job.paymentStatus !==
    "paid"
  ) {
    throw new Error(
      `Render-Job ${jobId} ist nicht als bezahlt markiert.`,
    );
  }

  if (
    !job.targetDurationSeconds ||
    !job.aspectRatio ||
    !job.editingStyle ||
    !job.generationStrategy
  ) {
    throw new Error(
      `Render-Job ${jobId} enthält keine vollständige Video-Konfiguration.`,
    );
  }

  const now =
    Date.now();

  await jobStore.set(
    jobId,
    {
      ...job,

      status:
        "processing",

      renderStage:
        job.renderStage ===
        "queued"
          ? "planning"
          : job.renderStage,

      progressPercent:
        Math.max(
          job.progressPercent ??
            0,
          1,
        ),

      startedAt:
        job.startedAt ??
        now,
    },
  );

  return {
    jobId,

    targetDurationSeconds:
      job.targetDurationSeconds,

    aspectRatio:
      job.aspectRatio,

    editingStyle:
      job.editingStyle,

    generationStrategy:
      job.generationStrategy,

    totalChapters:
      job.totalChapters ??
      1,

    totalExtensions:
      job.totalExtensions ??
      0,
  };
}