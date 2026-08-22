import { del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { jobStore } from "@/lib/store";
import {
  checkVideoStatus as checkVeoVideoStatus,
} from "@/lib/veo";

import {
  checkVideoStatus as checkSeedanceVideoStatus,
  isSeedanceOperationName,
} from "@/lib/seedance";
import { trimAndStore } from "@/lib/video-backend/media";
import {
  recoverVideoFinalizationWorkflow,
  renderVideoWorkflow,
} from "@/workflows/render-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: {
    jobId?: unknown;
    session_id?: unknown;
    test_ffmpeg?: unknown;
    retry_generation?: unknown;
    skip_reference_image?: unknown;
    native_character_dialogue?: unknown;
    trash_tv_reaction_boost?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!jobId || !sessionId) {
    return NextResponse.json({ error: "jobId and session_id are required." }, { status: 400 });
  }

  let job = await jobStore.get(jobId);
  if (!job || job.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.paymentStatus !== "paid") {
    return NextResponse.json({ error: "Job is not paid." }, { status: 409 });
  }

  const retryGeneration = body.retry_generation === true;
  const skipReferenceImage = body.skip_reference_image === true;
  const nativeCharacterDialogue = body.native_character_dialogue === true;
  const trashTvReactionBoost = body.trash_tv_reaction_boost === true;

  if (body.test_ffmpeg === true) {
    if (job.status !== "done" || !job.videoUri?.startsWith("blob:") || job.targetDurationSeconds !== 8) {
      return NextResponse.json({ error: "A completed 8-second Blob video is required." }, { status: 409 });
    }

    const diagnosticPath = `diagnostics/${jobId}-ffmpeg-self-test.mp4`;
    let outputPathname: string | undefined;
    try {
      const output = await trimAndStore(job.videoUri, 7, diagnosticPath);
      outputPathname = output.pathname;
      return NextResponse.json({ ffmpegReady: true, sourceVideoUnchanged: true, jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "FFmpeg self-test failed.";
      return NextResponse.json({ ffmpegReady: false, error: message }, { status: 500 });
    } finally {
      if (outputPathname) {
        try {
          await del(outputPathname);
        } catch (cleanupError) {
          console.warn("Could not delete FFmpeg diagnostic Blob:", cleanupError);
        }
      }
    }
  }

  if (
    job.status === "done" &&
    (job.videoUri?.startsWith("blob:") || job.videoUri?.startsWith("local:")) &&
    !(retryGeneration && nativeCharacterDialogue)
  ) {
    return NextResponse.json({ recovered: true, alreadyComplete: true, jobId });
  }
  if (!job.targetDurationSeconds) {
    return NextResponse.json({ error: "The paid target duration is missing." }, { status: 409 });
  }

  let providerFailureMessage: string | undefined;
  if (job.currentOperationName) {
    try {
      const providerStatus =
  isSeedanceOperationName(
    job.currentOperationName,
  )
    ? await checkSeedanceVideoStatus(
        job.currentOperationName,
      )
    : await checkVeoVideoStatus(
        job.currentOperationName,
      );
      if (!providerStatus.done) {
        return NextResponse.json({ recovering: true, waitingForProvider: true, jobId }, { status: 202 });
      }
      if (providerStatus.videoUri) {
        job = {
          ...job,
          videoUri: providerStatus.videoUri,
          videoUrl: providerStatus.videoUrl,
          currentOperationName: undefined,
          currentOperationType: undefined,
          lastProviderPollAt: Date.now(),
        };
        await jobStore.set(jobId, job);
      }
    } catch (error) {
      providerFailureMessage = error instanceof Error
        ? error.message
        : "The previous provider operation could not be recovered.";

      if (!retryGeneration) {
        return NextResponse.json(
          { error: providerFailureMessage, retryAvailable: true },
          { status: 409 },
        );
      }
    }
  }

  const hasRecoverableProviderVideo =
    Boolean(job.videoUri) &&
    !job.videoUri?.startsWith("blob:") &&
    !job.videoUri?.startsWith("local:") &&
    !job.currentOperationName;

  if (!hasRecoverableProviderVideo && retryGeneration) {
    const previousRecoveryAttempts = job.manualRecoveryAttempts ?? 0;
    const audioFailureCanRetry = /issue with the audio|audio for your prompt/i.test(
  job.errorMessage ?? providerFailureMessage ?? "",
);

const internalProviderFailureCanRetry =
  /internal server issue|try again in a few minutes|internen Serverfehler/i.test(
    job.errorMessage ?? providerFailureMessage ?? "",
  );

const preProviderConfigurationFailureCanRetry =
  !job.currentOperationName &&
  /Veo-Rendering ist deaktiviert|Seedance-Rendering ist deaktiviert|SEEDANCE_WORKFLOW_RENDER_ENABLED ist deaktiviert/i.test(
    job.errorMessage ?? providerFailureMessage ?? "",
  );

const maximumRecoveryAttempts = preProviderConfigurationFailureCanRetry
  ? 2
  : trashTvReactionBoost
    ? 5
    : nativeCharacterDialogue
      ? 4
      : audioFailureCanRetry
        ? 2
        : internalProviderFailureCanRetry
          ? 4
          : 1;
    if (previousRecoveryAttempts >= maximumRecoveryAttempts) {
      return NextResponse.json(
        { error: "Dieser Auftrag hat die sichere Anzahl kostenloser Wiederherstellungsversuche erreicht." },
        { status: 409 },
      );
    }

    await jobStore.clearWorkflowStart(jobId);
    const claimed = await jobStore.claimWorkflowStart(
      jobId,
      `manual-recovery:${jobId}:${Date.now()}`,
    );
    if (!claimed) {
      return NextResponse.json({ regenerating: true, starting: true, jobId }, { status: 202 });
    }

    const resumeCompletedNativeSections =
      nativeCharacterDialogue &&
      job.nativeCharacterDialogue === true &&
      audioFailureCanRetry &&
      !trashTvReactionBoost &&
      Array.isArray(job.chapterVideoUris) &&
      job.chapterVideoUris.length > 0;

    await jobStore.set(jobId, {
      ...job,
      status: "processing",
      renderStage: "queued",
      progressPercent: 5,
      errorMessage: undefined,
      videoUri: undefined,
      videoUrl: undefined,
      videoUrls: undefined,
      chapterVideoUris: resumeCompletedNativeSections ? job.chapterVideoUris : undefined,
      currentOperationName: undefined,
      currentOperationType: undefined,
      currentChapter: 1,
      currentExtension: 0,
      retryCount: 0,
      nextAttemptAt: undefined,
      completedAt: undefined,
      manualRecoveryAttempts: previousRecoveryAttempts + 1,
      nativeCharacterDialogue,
      nativeDialogueAudioRetry:
        nativeCharacterDialogue &&
        (audioFailureCanRetry || job.nativeDialogueAudioRetry === true),
      trashTvReactionBoost,
      referenceImageUrl: skipReferenceImage ? undefined : job.referenceImageUrl,
      referenceImageMimeType: skipReferenceImage ? undefined : job.referenceImageMimeType,
    });

    try {
      const run = await start(renderVideoWorkflow, [jobId]);
      await jobStore.confirmWorkflowStarted(jobId, run.runId);
      await jobStore.update(jobId, (current) => ({
        ...current,
        workerId: run.runId,
      }));
      return NextResponse.json(
        {
          regenerating: true,
          recoveredFromPaidOrder: true,
          referenceImageSkipped: skipReferenceImage,
          nativeCharacterDialogue,
          trashTvReactionBoost,
          jobId,
        },
        { status: 202 },
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The paid video could not be restarted.";
      await jobStore.clearWorkflowStart(jobId);
      const latest = await jobStore.get(jobId);
      if (latest) {
        await jobStore.set(jobId, {
          ...latest,
          status: "error",
          renderStage: "failed",
          errorMessage: message,
          manualRecoveryAttempts: previousRecoveryAttempts,
        });
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!hasRecoverableProviderVideo) {
    return NextResponse.json(
      {
        error: providerFailureMessage || "No completed provider video is available for recovery.",
        retryAvailable: true,
      },
      { status: 409 },
    );
  }
  if (job.status === "processing" && job.renderStage === "trimming") {
    return NextResponse.json({ recovering: true, jobId }, { status: 202 });
  }

  await jobStore.set(jobId, {
    ...job,
    status: "processing",
    renderStage: "trimming",
    progressPercent: 92,
    errorMessage: undefined,
  });

  try {
    const run = await start(recoverVideoFinalizationWorkflow, [jobId]);
    const latest = await jobStore.get(jobId);
    if (latest) {
      await jobStore.set(jobId, { ...latest, workerId: run.runId });
    }
    return NextResponse.json({ recovering: true, jobId, workflowRunId: run.runId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recovery workflow could not be started.";
    const latest = await jobStore.get(jobId);
    if (latest) {
      await jobStore.set(jobId, { ...latest, status: "error", renderStage: "failed", errorMessage: message });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
