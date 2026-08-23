import { Redis } from "@upstash/redis";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type {
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoGenerationStrategy,
  VideoProvider,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

export type VideoFormat =
  | "short"
  | "long";

export type VideoJobStatus =
  | "pending"
  | "processing"
  | "done"
  | "error";

export type VideoPaymentStatus =
  | "unpaid"
  | "paid"
  | "failed"
  | "refunded";

export type VideoRenderStage =
  | "queued"
  | "planning"
  | "waiting-provider"
  | "generating-opening"
  | "extending"
  | "generating-chapter"
  | "merging-chapters"
  | "trimming"
  | "completed"
  | "failed";

export type VideoJob = {
  /*
   * =========================================================
   * BESTEHENDE FELDER
   * =========================================================
   *
   * Diese Felder bleiben erhalten, damit Checkout,
   * Webhook, video-status und ältere Renderpfade
   * weiterhin funktionieren.
   */
  status:
    VideoJobStatus;

  prompt:
    string;

  format:
    VideoFormat;

  videoUrl?: string;
  videoUrls?: string[];

  totalScenes?: number;
  completedScenes?: number;

  errorMessage?: string;

  createdAt:
    number;

  /*
   * =========================================================
   * BEZAHLTE PROJEKT-KONFIGURATION
   * =========================================================
   *
   * Noch optional, damit bereits vorhandene Jobs und
   * bestehende Call-Sites rückwärtskompatibel bleiben.
   *
   * Neue Jobs sollen diese Werte nach erfolgreicher
   * Stripe-Zahlung dauerhaft speichern.
   */
  targetDurationSeconds?:
    VideoDurationSeconds;

  aspectRatio?:
    VideoAspectRatio;

  editingStyle?:
    VideoEditingStyle;

  audioStyle?:
    VideoAudioStyle;

  voiceMode?:
    VideoVoiceMode;

  spokenLanguage?:
    VideoSpokenLanguage;

  /*
   * Bei einem Musikvideo ersetzt diese private Originaldatei die
   * komplette Seedance-Tonspur im finalen Schnitt. Die technische
   * Renderlänge kann auf den nächsten Tarifblock aufgerundet sein;
   * musicVideoAudioDurationSeconds bleibt die exakte Ausgabelänge.
   */
  musicVideoAudioUri?: string;
  musicVideoAudioMimeType?: string;
  musicVideoAudioName?: string;
  musicVideoAudioDurationSeconds?: number;
  musicVideoAudioAnalysis?: string;

  /*
   * Exakter Sprechertext und sauber gerenderte Schluss-Einblendung.
   * Beide werden erst in der technischen Nachbearbeitung hinzugefügt,
   * damit Veo keine Fantasieschrift oder fehlerhafte Aussprache erzeugt.
   */
  voiceoverText?: string;

  closingText?: string;

  /*
   * Freigegebenes KI-Vorschaubild. Dieses private Bild
   * wird beim ersten Veo-Abschnitt wirklich als visuelle
   * Referenz verwendet.
   */
  referenceImageUrl?:
    string;

  referenceImageMimeType?:
    string;

  provider?:
    VideoProvider;

  generationStrategy?:
    VideoGenerationStrategy;

  /*
   * =========================================================
   * PAYMENT
   * =========================================================
   */
  paymentStatus?:
    VideoPaymentStatus;

  stripeSessionId?:
    string;

  paidAt?:
    number;

  /*
   * =========================================================
   * RENDER-FORTSCHRITT
   * =========================================================
   */
  renderStage?:
    VideoRenderStage;

  progressPercent?:
    number;

  currentChapter?:
    number;

  totalChapters?:
    number;

  currentExtension?:
    number;

  totalExtensions?:
    number;

  /*
   * Die originale Google/Veo-URI wird für Extensions
   * benötigt. videoUrl kann weiterhin die für Browser
   * geeignete Download-/Anzeigeadresse enthalten.
   */
  videoUri?:
    string;

  chapterVideoUris?:
    string[];

  /*
   * =========================================================
   * AKTUELLE PROVIDER-OPERATION
   * =========================================================
   *
   * Workflow-Steps dürfen externe Provider-Aufrufe nicht
   * "vergessen". Deshalb speichern wir den aktuell laufenden
   * Veo-Operation-Namen persistent.
   *
   * So kann ein Workflow nach Sleep, Redeploy oder Retry
   * dieselbe Operation weiter abfragen, statt blind einen
   * neuen kostenpflichtigen Render zu starten.
   */
  currentOperationName?:
    string;

  currentOperationType?:
    | "opening"
    | "extension"
    | "chapter-opening";

  lastProviderRequestAt?:
    number;

  lastProviderPollAt?:
    number;

  openingStartedAt?:
    number;

  openingCompletedAt?:
    number;

  /*
   * =========================================================
   * RETRIES / QUEUE / WORKER
   * =========================================================
   *
   * Diese Felder bilden die Grundlage für einen
   * wiederaufnehmbaren Render-Worker.
   */
  retryCount?:
    number;

  manualRecoveryAttempts?:
    number;

  /*
   * Bei einer ausdrücklichen Neufassung sprechen die sichtbaren Figuren
   * direkt im Veo-Material. In diesem Modus darf die Nachbearbeitung keine
   * zusätzliche Dialog- oder Voiceover-Spur über das Video legen.
   */
  nativeCharacterDialogue?:
    boolean;

  nativeDialogueAudioRetry?:
    boolean;

  trashTvReactionBoost?:
    boolean;

  maxRetries?:
    number;

  nextAttemptAt?:
    number;

  workerId?:
    string;

  claimedAt?:
    number;

  leaseExpiresAt?:
    number;

  /*
   * =========================================================
   * ZEITSTEMPEL
   * =========================================================
   */
  updatedAt?:
    number;

  startedAt?:
    number;

  completedAt?:
    number;
};

const keyFor = (
  jobId: string,
) =>
  `job:${jobId}`;


const workflowStartKeyFor = (
  jobId: string,
) =>
  `job:${jobId}:workflow-start`;

const VIDEO_PROVIDER_PAUSE_KEY = "video-provider:checkout-pause";

export type VideoProviderPause = {
  until: number;
  reason: string;
  sourceJobId: string;
  httpStatus?: number;
  updatedAt: number;
};

const hasUpstashConfig =
  Boolean(
    process.env
      .UPSTASH_REDIS_REST_URL,
  ) &&
  Boolean(
    process.env
      .UPSTASH_REDIS_REST_TOKEN,
  );

const redis =
  hasUpstashConfig
    ? new Redis({
        url:
          process.env
            .UPSTASH_REDIS_REST_URL!,

        token:
          process.env
            .UPSTASH_REDIS_REST_TOKEN!,
      })
    : null;

/*
 * Bestehende Laufzeit-Fallback-Lösung.
 *
 * Lokal funktioniert das ohne Redis.
 * Auf Vercel ist Redis die dauerhafte Quelle.
 */
declare global {
  var __videoJobs:
    | Map<
        string,
        VideoJob
      >
    | undefined;
}


type WorkflowStartClaim = {
  value: string;
  expiresAt: number;
};

declare global {
  var __videoWorkflowStartClaims:
    | Map<
        string,
        WorkflowStartClaim
      >
    | undefined;
}

const memoryStore =
  global.__videoJobs ??
  (global.__videoJobs =
    new Map<
      string,
      VideoJob
    >());

const localStorePath = join(
  process.cwd(),
  ".video-backend-backups",
  "local-video-jobs.json",
);

function persistLocalMemoryStore(): void {
  if (process.env.NODE_ENV !== "development" || redis) return;

  try {
    mkdirSync(dirname(localStorePath), { recursive: true });
    const temporaryPath = `${localStorePath}.tmp`;
    writeFileSync(
      temporaryPath,
      JSON.stringify(Object.fromEntries(memoryStore.entries())),
      "utf8",
    );
    renameSync(temporaryPath, localStorePath);
  } catch (error) {
    console.error("Lokaler Videoauftrag konnte nicht gesichert werden:", error);
  }
}

declare global {
  var __videoProviderPause:
    | VideoProviderPause
    | undefined;
}

function hydrateLocalMemoryStore(): void {
  if (process.env.NODE_ENV !== "development" || redis || !existsSync(localStorePath)) return;

  try {
    const storedJobs = JSON.parse(readFileSync(localStorePath, "utf8")) as Record<string, VideoJob>;
    for (const [jobId, job] of Object.entries(storedJobs)) {
      if (!memoryStore.has(jobId)) memoryStore.set(jobId, job);
    }
  } catch (error) {
    console.error("Lokale Videoaufträge konnten nicht wiederhergestellt werden:", error);
  }
}

hydrateLocalMemoryStore();
persistLocalMemoryStore();


const memoryWorkflowStartClaims =
  global.__videoWorkflowStartClaims ??
  (global.__videoWorkflowStartClaims =
    new Map<
      string,
      WorkflowStartClaim
    >());

const JOB_TTL_SECONDS =
  60 * 60 * 24;

function withUpdatedAt(
  job: VideoJob,
): VideoJob {
  return {
    ...job,

    updatedAt:
      Date.now(),
  };
}

function getMemoryWorkflowStartClaim(
  jobId: string,
): WorkflowStartClaim | undefined {
  const claim =
    memoryWorkflowStartClaims.get(
      jobId,
    );

  if (!claim) {
    return undefined;
  }

  if (
    claim.expiresAt <=
    Date.now()
  ) {
    memoryWorkflowStartClaims.delete(
      jobId,
    );

    return undefined;
  }

  return claim;
}

export const jobStore = {
  async get(
    jobId: string,
  ): Promise<
    VideoJob | undefined
  > {
    if (redis) {
      const data =
        await redis.get<
          VideoJob
        >(
          keyFor(
            jobId,
          ),
        );

      return (
        data ??
        undefined
      );
    }

    return memoryStore.get(
      jobId,
    );
  },

  async set(
    jobId: string,
    job: VideoJob,
  ): Promise<void> {
    const storedJob =
      withUpdatedAt(
        job,
      );

    if (redis) {
      await redis.set(
        keyFor(
          jobId,
        ),
        storedJob,
        {
          ex:
            JOB_TTL_SECONDS,
        },
      );

      return;
    }

    memoryStore.set(
      jobId,
      storedJob,
    );
    persistLocalMemoryStore();
  },

  async getProviderPause(): Promise<VideoProviderPause | undefined> {
    const pause = redis
      ? await redis.get<VideoProviderPause>(VIDEO_PROVIDER_PAUSE_KEY)
      : global.__videoProviderPause;

    if (!pause) return undefined;
    if (pause.until > Date.now()) return pause;

    if (redis) {
      await redis.del(VIDEO_PROVIDER_PAUSE_KEY);
    } else {
      global.__videoProviderPause = undefined;
    }

    return undefined;
  },

  async pauseProvider(
    pause: Omit<VideoProviderPause, "updatedAt">,
  ): Promise<void> {
    const storedPause: VideoProviderPause = {
      ...pause,
      updatedAt: Date.now(),
    };
    const ttlSeconds = Math.max(60, Math.ceil((pause.until - Date.now()) / 1000));

    if (redis) {
      await redis.set(VIDEO_PROVIDER_PAUSE_KEY, storedPause, { ex: ttlSeconds });
    } else {
      global.__videoProviderPause = storedPause;
    }
  },

  async clearProviderPause(sourceJobId?: string): Promise<void> {
    if (sourceJobId) {
      const current = await this.getProviderPause();
      if (current && current.sourceJobId !== sourceJobId) return;
    }

    if (redis) {
      await redis.del(VIDEO_PROVIDER_PAUSE_KEY);
    } else {
      global.__videoProviderPause = undefined;
    }
  },

  /*
   * =========================================================
   * ATOMARER WORKFLOW-START-CLAIM
   * =========================================================
   *
   * Redis SET ... NX sorgt dafür, dass bei parallelen
   * Stripe-Webhook-Zustellungen nur EIN Request den
   * Workflow-Start übernehmen darf.
   *
   * Der Claim ist absichtlich getrennt vom normalen
   * VideoJob-JSON. Das normale update() ist nicht atomar.
   */
  async claimWorkflowStart(
    jobId: string,
    claimId: string,
    ttlSeconds =
      5 * 60,
  ): Promise<boolean> {
    const cleanedClaimId =
      claimId.trim();

    if (!cleanedClaimId) {
      throw new Error(
        "Für den Workflow-Start-Claim fehlt die claimId.",
      );
    }

    const safeTtlSeconds =
      Math.max(
        30,
        Math.floor(
          ttlSeconds,
        ),
      );

    if (redis) {
      const result =
        await redis.set(
          workflowStartKeyFor(
            jobId,
          ),
          `starting:${cleanedClaimId}`,
          {
            nx:
              true,

            ex:
              safeTtlSeconds,
          },
        );

      return result ===
        "OK";
    }

    const existing =
      getMemoryWorkflowStartClaim(
        jobId,
      );

    if (existing) {
      return false;
    }

    memoryWorkflowStartClaims.set(
      jobId,
      {
        value:
          `starting:${cleanedClaimId}`,

        expiresAt:
          Date.now() +
          safeTtlSeconds *
            1000,
      },
    );

    return true;
  },

  /*
   * Nach erfolgreichem start() wird der kurze Claim
   * in einen längeren "started"-Marker umgewandelt.
   *
   * Damit kann ein später erneut zugestellter
   * Stripe-Webhook erkennen, dass der Workflow bereits
   * gestartet wurde, selbst wenn das VideoJob-JSON
   * zwischenzeitlich nicht aktualisiert werden konnte.
   */
  async confirmWorkflowStarted(
    jobId: string,
    workflowRunId: string,
  ): Promise<void> {
    const cleanedRunId =
      workflowRunId.trim();

    if (!cleanedRunId) {
      throw new Error(
        "workflowRunId fehlt.",
      );
    }

    if (redis) {
      await redis.set(
        workflowStartKeyFor(
          jobId,
        ),
        `started:${cleanedRunId}`,
        {
          ex:
            JOB_TTL_SECONDS,
        },
      );

      return;
    }

    memoryWorkflowStartClaims.set(
      jobId,
      {
        value:
          `started:${cleanedRunId}`,

        expiresAt:
          Date.now() +
          JOB_TTL_SECONDS *
            1000,
      },
    );
  },

  async getWorkflowStartState(
    jobId: string,
  ): Promise<
    | {
        status:
          "starting";

        claimId:
          string;
      }
    | {
        status:
          "started";

        workflowRunId:
          string;
      }
    | undefined
  > {
    let value:
      string | undefined;

    if (redis) {
      const stored =
        await redis.get<
          string
        >(
          workflowStartKeyFor(
            jobId,
          ),
        );

      value =
        stored ??
        undefined;
    } else {
      value =
        getMemoryWorkflowStartClaim(
          jobId,
        )?.value;
    }

    if (!value) {
      return undefined;
    }

    if (
      value.startsWith(
        "started:",
      )
    ) {
      const workflowRunId =
        value.slice(
          "started:".length,
        );

      return {
        status:
          "started",

        workflowRunId,
      };
    }

    if (
      value.startsWith(
        "starting:",
      )
    ) {
      const claimId =
        value.slice(
          "starting:".length,
        );

      return {
        status:
          "starting",

        claimId,
      };
    }

    return undefined;
  },

  async clearWorkflowStart(
    jobId: string,
  ): Promise<void> {
    if (redis) {
      await redis.del(
        workflowStartKeyFor(jobId),
      );
      return;
    }

    memoryWorkflowStartClaims.delete(jobId);
  },

  /*
   * Bequemer Helper für Worker-Fortschritt.
   *
   * Bestehender Code darf weiterhin get -> ändern -> set
   * verwenden. Neue Queue-/Worker-Logik kann update nutzen.
   *
   * Hinweis:
   * Das ist bewusst noch KEIN verteiltes Lock.
   * Für parallele Worker verwenden wir später
   * workerId + leaseExpiresAt mit einer atomaren
   * Claim-Operation.
   */
  async update(
    jobId: string,
    updater: (
      job: VideoJob,
    ) =>
      | VideoJob
      | Promise<VideoJob>,
  ): Promise<
    VideoJob | undefined
  > {
    const current =
      await this.get(
        jobId,
      );

    if (!current) {
      return undefined;
    }

    const updated =
      await updater(
        current,
      );

    await this.set(
      jobId,
      updated,
    );

    return {
      ...updated,

      updatedAt:
        Date.now(),
    };
  },
};
