import {
  NextRequest,
  NextResponse,
} from "next/server";

import { nanoid } from "nanoid";
import { head } from "@vercel/blob";
import { start } from "workflow/api";

import { stripe } from "../../../lib/stripe";

import {
  CURRENTLY_RELEASED_MAX_DURATION_SECONDS,
  getVideoModel,
  getVideoQuotaSeconds,
  getVideoPriceCents,
  isReleasedVideoDuration,
} from "../../../lib/pricing";

import {
  isVideoAudioStyle,
  isVideoSpokenLanguage,
  isVideoVoiceMode,
  isVoiceoverVoiceName,
} from "../../../lib/audio-options";

import {
  promptHasProvidedDialogue,
  resolveProvidedDialogueVoiceMode,
} from "../../../lib/dialogue-render-mode";
import {
  inspectDialogueQuality,
} from "../../../lib/dialogue-quality";

import {
  loadStoredPreview,
} from "../../../lib/video-backend/images";

import {
  checkRateLimit,
} from "../../../lib/rate-limit";

import {
  MUSIC_VIDEO_AUDIO_TYPES,
  MUSIC_VIDEO_MAX_AUDIO_BYTES,
  getMusicVideoDurationBucket,
} from "../../../lib/music-video";

import {
  jobStore,
  type VideoFormat,
} from "../../../lib/store";

import { accountLibrary } from "@/lib/account-library";
import { prepareInstagramDiscountCheckout } from "@/lib/instagram-discount-account";
import { getCurrentUser } from "@/lib/supabase/server";
import { getActiveVideoSubscription } from "@/lib/video-subscription";
import { releaseVideoSubscriptionUsage, reserveVideoSubscriptionUsage } from "@/lib/video-subscription-usage";
import { buildVideoDurationPlan } from "@/lib/veo";
import { renderVideoWorkflow } from "@/workflows/render-video";

import {
  isVideoModelId,
} from "@/types/story";

import type {
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoModelId,
  VideoSpokenLanguage,
  VideoVoiceMode,
  Story,
} from "@/types/story";

/*
 * Neue Checkout-Längen.
 *
 * 8 Sekunden werden hier bewusst NICHT
 * mehr akzeptiert.
 *
 * Alte 8-Sekunden-Aufträge werden weiterhin
 * von Webhook / Confirm / Recovery verstanden.
 */
const SUPPORTED_VIDEO_DURATIONS = [
  15,
  30,
  60,
  120,
  180,
  240,
  300,
] as const satisfies readonly VideoDurationSeconds[];

type CheckoutVideoDuration =
  (typeof SUPPORTED_VIDEO_DURATIONS)[number];

const SUPPORTED_ASPECT_RATIOS = [
  "9:16",
  "16:9",
] as const satisfies readonly VideoAspectRatio[];

const SUPPORTED_EDITING_STYLES = [
  "auto",
  "social",
  "cinematic",
  "music-video",
] as const satisfies readonly VideoEditingStyle[];

type CheckoutRequest = {
  prompt?: unknown;

  /*
   * Altes Feld bleibt kompatibel.
   *
   * short bedeutet bei NEUEN Requests
   * jetzt 15 Sekunden.
   */
  format?: unknown;

  targetDurationSeconds?: unknown;

  videoModel?: unknown;

  aspectRatio?: unknown;

  editingStyle?: unknown;

  audioStyle?: unknown;

  voiceMode?: unknown;

  spokenLanguage?: unknown;

  voiceoverText?: unknown;

  voiceoverVoiceName?: unknown;

  closingText?: unknown;

  referenceImageUri?: unknown;

  referenceImageMimeType?: unknown;

  musicVideoAudioUri?: unknown;
  musicVideoAudioMimeType?: unknown;
  musicVideoAudioName?: unknown;
  musicVideoAudioDurationSeconds?: unknown;
  musicVideoAudioAnalysis?: unknown;

  useSubscription?: unknown;
};

function missingProductionServices():
  string[] {
  if (
    process.env.NODE_ENV ===
    "development"
  ) {
    return [];
  }

  const missing:
    string[] = [];

  if (
    !process.env
      .UPSTASH_REDIS_REST_URL ||
    !process.env
      .UPSTASH_REDIS_REST_TOKEN
  ) {
    missing.push(
      "Redis",
    );
  }

  if (
    !process.env
      .BLOB_READ_WRITE_TOKEN &&
    !process.env
      .BLOB_STORE_ID
  ) {
    missing.push(
      "Vercel Blob",
    );
  }

  if (
    !process.env
      .STRIPE_WEBHOOK_SECRET
  ) {
    missing.push(
      "Stripe Webhook",
    );
  }

  if (
    !process.env
      .GEMINI_API_KEY
  ) {
    missing.push(
      "Google AI",
    );
  }

  if (
    process.env.SEEDANCE_PROVIDER === "byteplus"
      ? !(
          process.env.BYTEPLUS_ARK_API_KEY ||
          process.env.BYTEPLUS_LAS_API_KEY ||
          process.env.LAS_API_KEY
        )
      : !process.env.FAL_KEY
  ) {
    missing.push(
      process.env.SEEDANCE_PROVIDER === "byteplus"
        ? "BytePlus / Seedance"
        : "fal.ai / Seedance",
    );
  }

  if (
    process.env
      .SEEDANCE_WORKFLOW_RENDER_ENABLED !==
    "true"
  ) {
    missing.push(
      "Seedance Render",
    );
  }

  return missing;
}

/*
 * Wichtig:
 *
 * Diese Funktion prüft NICHT den gesamten
 * VideoDurationSeconds-Typ, weil dieser aus
 * Legacy-Gründen weiterhin 8 enthält.
 *
 * Sie prüft ausschließlich die für NEUE
 * Checkout-Sessions erlaubten Längen.
 */
function isVideoDurationSeconds(
  value: unknown,
): value is CheckoutVideoDuration {
  return (
    typeof value ===
      "number" &&
    SUPPORTED_VIDEO_DURATIONS.includes(
      value as CheckoutVideoDuration,
    )
  );
}

function isVideoAspectRatio(
  value: unknown,
): value is VideoAspectRatio {
  return (
    typeof value ===
      "string" &&
    SUPPORTED_ASPECT_RATIOS.includes(
      value as VideoAspectRatio,
    )
  );
}

function isVideoEditingStyle(
  value: unknown,
): value is VideoEditingStyle {
  return (
    typeof value ===
      "string" &&
    SUPPORTED_EDITING_STYLES.includes(
      value as VideoEditingStyle,
    )
  );
}

function normalizeDuration(
  value: unknown,
  legacyFormat: unknown,
): VideoDurationSeconds {
  if (
    isVideoDurationSeconds(
      value,
    )
  ) {
    return value;
  }

  /*
   * Rückwärtskompatibilität für Clients,
   * die noch kein targetDurationSeconds
   * mitsenden:
   *
   * long  -> 60 Sekunden
   * short -> 15 Sekunden
   *
   * Ein NEUER 8-Sekunden-Auftrag wird
   * hier nicht mehr erzeugt.
   */
  return legacyFormat ===
    "long"
    ? 60
    : 15;
}

function normalizeAspectRatio(
  value: unknown,
): VideoAspectRatio {
  return isVideoAspectRatio(
    value,
  )
    ? value
    : "9:16";
}

function normalizeEditingStyle(
  value: unknown,
): VideoEditingStyle {
  return isVideoEditingStyle(
    value,
  )
    ? value
    : "social";
}

function durationLabel(
  durationSeconds:
    VideoDurationSeconds,
): string {
  if (
    durationSeconds <
    60
  ) {
    return `${durationSeconds} Sekunden`;
  }

  const minutes =
    durationSeconds /
    60;

  return minutes ===
    1
    ? "1 Minute"
    : `${minutes} Minuten`;
}

function formatQuotaMinutes(seconds: number): string {
  const minutes = seconds / 60;
  return `${new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: 2,
  }).format(minutes)} Video-Minuten`;
}

function countPlannedExtensions(
  chapterTargets: VideoDurationSeconds[],
  videoModel: VideoModelId,
): number {
  return chapterTargets.reduce(
    (total, seconds) =>
      total +
      (
        videoModel === "google-veo" ||
        videoModel === "google-veo-fast"
          ? Math.max(0, Math.ceil((seconds - 8) / 7))
          : Math.max(0, Math.ceil((seconds - 15) / 15))
      ),
    0,
  );
}

function editingStyleLabel(
  editingStyle:
    VideoEditingStyle,
): string {
  switch (
    editingStyle
  ) {
    case "cinematic":
      return "Kino / Film";

    case "music-video":
      return "Musikvideo";

    case "auto":
      return "Auto";

    default:
      return "Social / Reels";
  }
}

function hasValidDialoguePlan(
  prompt: string,
  targetDurationSeconds:
    VideoDurationSeconds,
  requireViralStory =
    false,
): boolean {
  try {
    const story =
      JSON.parse(
        prompt,
      ) as {
        creationMode?:
          unknown;

        singleSpeakerMode?:
          unknown;

        providedDialogue?:
          Array<{
            speaker?: unknown;
          }>;

        characters?:
          Array<{
            name?: unknown;
          }>;

        productionBible?: {
          characterBible?:
            Array<{
              name?: unknown;
            }>;
        };

        moviePlan?: {
          opening?: {
            dialogue?:
              unknown;

            dialogueTurns?:
              unknown[];
          };

          continuations?:
            Array<{
              dialogue?:
                unknown;

              dialogueTurns?:
                unknown[];
            }>;
        };
      };

    if (
      requireViralStory &&
      story.creationMode !==
        "viral-story"
    ) {
      return false;
    }

    const openingDialogueValues = [
      story.moviePlan
        ?.opening
        ?.dialogue,

      ...(
        story.moviePlan
          ?.opening
          ?.dialogueTurns ??
        []
      ),
    ];

    const continuationDialogueValues =
      (
        story.moviePlan
          ?.continuations ??
        []
      ).flatMap(
        (
          item,
        ) => [
          item.dialogue,

          ...(
            item.dialogueTurns ??
            []
          ),
        ],
      );

    const dialogueValues = [
      ...openingDialogueValues,
      ...continuationDialogueValues,
    ];

    const speakers =
      new Set<string>();

    let validLineCount =
      0;

    let totalWordCount =
      0;

    /*
     * Ein neuer Seedance-Abschnitt besitzt
     * bis zu 15 Sekunden.
     *
     * Kurze direkte Dialogsätze bleiben
     * dadurch ausreichend gut sprechbar.
     */
    const maximumWordsPerLine =
  requireViralStory
    ? 9
    : 12;

    const forbiddenSpeaker =
      /narrat|voice[ -]?over|off[ -]?screen|erz(?:ae|ä)hl|sprecher(?:in)?$/i;

    for (
      const value of
      dialogueValues
    ) {
      if (
        !value ||
        typeof value !==
          "object"
      ) {
        continue;
      }

      const dialogue =
        value as Record<
          string,
          unknown
        >;

      if (
        dialogue.enabled !==
        true
      ) {
        continue;
      }

      const speaker =
        typeof dialogue.speaker ===
        "string"
          ? dialogue.speaker
              .trim()
          : "";

      const text =
        typeof dialogue.text ===
        "string"
          ? dialogue.text
              .trim()
          : "";

      const wordCount =
        text
          .split(/\s+/)
          .filter(Boolean)
          .length;

      if (
        !speaker ||
        forbiddenSpeaker.test(
          speaker,
        ) ||
        !text ||
        wordCount >
          maximumWordsPerLine ||
        text.length >
          140
      ) {
        continue;
      }

      speakers.add(
        speaker.toLocaleLowerCase(
          "de-DE",
        ),
      );

      validLineCount +=
        1;

      totalWordCount +=
        wordCount;
    }

    const bibleSpeakers =
      (
        story.productionBible
          ?.characterBible ??
        []
      )
        .map(
          (
            character,
          ) =>
            typeof character.name ===
            "string"
              ? character.name
                  .trim()
              : "",
        )
        .filter(
          Boolean,
        );

    const storySpeakers =
      (
        story.characters ??
        []
      )
        .map(
          (
            character,
          ) =>
            typeof character.name ===
            "string"
              ? character.name
                  .trim()
              : "",
        )
        .filter(
          Boolean,
        );

    const providedSpeakers =
      Array.from(
        new Map(
          (
            story.providedDialogue ??
            []
          )
            .map((line) =>
              typeof line.speaker ===
                "string"
                ? line.speaker.trim()
                : "",
            )
            .filter(Boolean)
            .map((speaker) => [
              speaker.toLocaleLowerCase(
                "de-DE",
              ),
              speaker,
            ]),
        ).values(),
      );

    const singleSpeakerMode =
      story.singleSpeakerMode ===
        true ||
      providedSpeakers.length === 1;

    const expectedSpeakers =
      singleSpeakerMode
        ? [
            providedSpeakers[0] ??
              storySpeakers[0] ??
              bibleSpeakers[0],
          ].filter(
            (
              speaker,
            ): speaker is string =>
              Boolean(speaker),
          )
        : (
            bibleSpeakers.length >=
            2
              ? bibleSpeakers
              : storySpeakers
          ).slice(
            0,
            3,
          );

    const requiresConversation =
      requireViralStory ||
      story.creationMode ===
        "viral-story";

    const requiredSpeakerCount =
      Math.min(
        3,

        Math.max(
          requiresConversation
            ? 2
            : 1,
          expectedSpeakers.length,
        ),
      );

    const openingDialogue =
      openingDialogueValues[
        0
      ];

    const hasOpeningDialogue =
      typeof openingDialogue ===
        "object" &&
      openingDialogue !==
        null &&
      (
        openingDialogue as Record<
          string,
          unknown
        >
      ).enabled ===
        true;

    const hasContinuationDialogue =
      continuationDialogueValues.some(
        (
          value,
        ) =>
          typeof value ===
            "object" &&
          value !==
            null &&
          (
            value as Record<
              string,
              unknown
            >
          ).enabled ===
            true,
      );

    if (
      !hasOpeningDialogue ||

      /*
       * Bei 15 Sekunden existiert noch
       * keine Fortsetzung.
       *
       * Ab 30 Sekunden muss der Dialog
       * auch in mindestens einem weiteren
       * 15-Sekunden-Abschnitt weitergehen.
       */
      (
        targetDurationSeconds >
          15 &&
        !hasContinuationDialogue
      ) ||

      validLineCount <
        requiredSpeakerCount ||

      speakers.size <
        requiredSpeakerCount ||

      /*
       * Beim einzelnen 15-Sekunden-Clip
       * begrenzen wir die gesamte
       * Dialogmenge zusätzlich.
       */
      (
        targetDurationSeconds ===
          15 &&
        totalWordCount >
          (
            requiredSpeakerCount ===
              1
              ? 30
              : 28
          )
      )
    ) {
      return false;
    }

    return expectedSpeakers.every(
      (
        expectedSpeaker,
      ) => {
        const fullName =
          expectedSpeaker
            .toLocaleLowerCase(
              "de-DE",
            );

        const shortName =
          fullName
            .split(",")[0]
            .trim();

        return (
          speakers.has(
            fullName,
          ) ||
          speakers.has(
            shortName,
          )
        );
      },
    );
  } catch {
    return false;
  }
}

function hasValidViralDialoguePlan(
  prompt: string,
  targetDurationSeconds:
    VideoDurationSeconds,
): boolean {
  return hasValidDialoguePlan(
    prompt,
    targetDurationSeconds,
    true,
  );
}

export async function POST(
  req: NextRequest,
) {
  const rateLimit =
    await checkRateLimit(
      req,
      "checkout",
      20,
      60 * 60,
    );

  if (
    !rateLimit.allowed
  ) {
    return NextResponse.json(
      {
        error:
          "Zu viele Bestellversuche in kurzer Zeit. Bitte versuche es später erneut.",
      },
      {
        status:
          429,

        headers: {
          "Retry-After":
            String(
              rateLimit
                .retryAfterSeconds,
            ),
        },
      },
    );
  }

  const missingServices =
    missingProductionServices();

  if (
    missingServices.length >
    0
  ) {
    console.error(
      "Checkout blockiert: Produktionsdienste fehlen:",
      missingServices,
    );

    return NextResponse.json(
      {
        error:
          "Die Video-Bestellung ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
      },
      {
        status:
          503,
      },
    );
  }

  const providerPause =
    await jobStore
      .getProviderPause();

  if (
    providerPause
  ) {
    const retryAfterSeconds =
      Math.max(
        60,

        Math.ceil(
          (
            providerPause.until -
            Date.now()
          ) /
            1000,
        ),
      );

    return NextResponse.json(
      {
        error:
          "Die Video-KI ist momentan ausgelastet. Es wird keine Zahlung gestartet. Bitte versuche es später erneut.",
      },
      {
        status:
          503,

        headers: {
          "Retry-After":
            String(
              retryAfterSeconds,
            ),
        },
      },
    );
  }

  let body:
    CheckoutRequest;

  try {
    body =
      (
        await req.json()
      ) as CheckoutRequest;
  } catch {
    return NextResponse.json(
      {
        error:
          "Der Request enthält kein gültiges JSON.",
      },
      {
        status:
          400,
      },
    );
  }

  const prompt =
    typeof body.prompt ===
    "string"
      ? body.prompt
          .trim()
      : "";

  if (
    prompt.length <
    3
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte gib eine Beschreibung für dein Video ein.",
      },
      {
        status:
          400,
      },
    );
  }

  /*
   * Wenn die Dauer explizit mitgesendet
   * wurde, werden ausschließlich die
   * neuen Checkout-Längen akzeptiert.
   *
   * 8 Sekunden ist hier bewusst ungültig.
   */
  if (
    body.targetDurationSeconds !==
      undefined &&
    !isVideoDurationSeconds(
      body.targetDurationSeconds,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Ungültige Videolänge. Erlaubt sind 15, 30, 60, 120, 180, 240 oder 300 Sekunden.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    body.aspectRatio !==
      undefined &&
    !isVideoAspectRatio(
      body.aspectRatio,
    )
  ) {
    return NextResponse.json(
      {
        error:
          'Ungültiges Bildformat. Erlaubt sind "9:16" oder "16:9".',
      },
      {
        status:
          400,
      },
    );
  }

  if (
    body.editingStyle !==
      undefined &&
    !isVideoEditingStyle(
      body.editingStyle,
    )
  ) {
    return NextResponse.json(
      {
        error:
          'Ungültiger Schnittstil. Erlaubt sind "auto", "social", "cinematic" oder "music-video".',
      },
      {
        status:
          400,
      },
    );
  }

  const targetDurationSeconds =
    normalizeDuration(
      body.targetDurationSeconds,
      body.format,
    );

  const videoModel: VideoModelId =
    isVideoModelId(body.videoModel)
      ? body.videoModel
      : "seedance-2-fast";

  if (
    body.videoModel !== undefined &&
    !isVideoModelId(body.videoModel)
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte wähle Seedance 2 Fast, Seedance 2 Original, Google Veo 3.1 Fast oder Google Veo 3.1 Standard.",
      },
      { status: 400 },
    );
  }

  const editingStyle =
    normalizeEditingStyle(
      body.editingStyle,
    );

  const musicVideoMode =
    editingStyle ===
    "music-video";

  if (
    !isReleasedVideoDuration(
      targetDurationSeconds,
    ) &&
    !(
      musicVideoMode &&
      targetDurationSeconds <= 300
    )
  ) {
    return NextResponse.json(
      {
        error:
          `Diese Videolänge befindet sich noch in der Qualitätsprüfung. Aktuell sind maximal ${CURRENTLY_RELEASED_MAX_DURATION_SECONDS} Sekunden freigeschaltet. Es wurde nichts berechnet.`,
      },
      {
        status:
          409,
      },
    );
  }

  if (
    !isVideoAudioStyle(
      body.audioStyle,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte wähle einen gültigen KI-Musikstil.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    !isVideoVoiceMode(
      body.voiceMode,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte wähle eine gültige Stimmen-Option.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    !isVideoSpokenLanguage(
      body.spokenLanguage,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte wähle eine gültige Sprache.",
      },
      {
        status:
          400,
      },
    );
  }

  const audioStyle =
    body.audioStyle as
      VideoAudioStyle;

  const requestedVoiceMode =
    body.voiceMode as
      VideoVoiceMode;

  const promptContainsProvidedDialogue =
    promptHasProvidedDialogue(
      prompt,
    );

  /*
   * Letzte serverseitige Sicherung vor Zahlung und Renderstart:
   * Ein vorhandener Originaldialog darf niemals als Voice-over bestellt
   * oder gespeichert werden, auch wenn der Browser noch einen alten
   * Stimmenmodus mitsendet.
   */
  const voiceMode:
    VideoVoiceMode =
    resolveProvidedDialogueVoiceMode(
      requestedVoiceMode,
      promptContainsProvidedDialogue,
    );

  const spokenLanguage =
    body.spokenLanguage as
      VideoSpokenLanguage;

  const musicVideoAudioUri =
    typeof body.musicVideoAudioUri ===
      "string"
      ? body.musicVideoAudioUri.trim()
      : "";

  const musicVideoAudioMimeType =
    typeof body.musicVideoAudioMimeType ===
      "string"
      ? body.musicVideoAudioMimeType
          .toLowerCase()
          .split(";")[0]
          .trim()
      : "";

  const musicVideoAudioName =
    typeof body.musicVideoAudioName ===
      "string"
      ? body.musicVideoAudioName
          .trim()
          .slice(0, 180)
      : "";

  const musicVideoAudioDurationSeconds =
    Number(
      body.musicVideoAudioDurationSeconds,
    );

  const musicVideoAudioAnalysis =
    typeof body.musicVideoAudioAnalysis ===
      "string"
      ? body.musicVideoAudioAnalysis
          .trim()
          .slice(0, 2_500)
      : "";

  if (musicVideoMode) {
    let expectedDuration:
      VideoDurationSeconds;

    try {
      expectedDuration =
        getMusicVideoDurationBucket(
          musicVideoAudioDurationSeconds,
        );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Die Songdauer ist ungültig.",
        },
        {
          status: 400,
        },
      );
    }

    const supportedMimeType =
      MUSIC_VIDEO_AUDIO_TYPES.includes(
        musicVideoAudioMimeType as
          (typeof MUSIC_VIDEO_AUDIO_TYPES)[number],
      );

    if (
      !musicVideoAudioUri.startsWith(
        "blob:music-video-audio/",
      ) ||
      !musicVideoAudioName ||
      !supportedMimeType ||
      musicVideoAudioAnalysis.length < 20 ||
      expectedDuration !==
        targetDurationSeconds ||
      audioStyle !==
        "no-music" ||
      voiceMode !==
        "no-voice"
    ) {
      return NextResponse.json(
        {
          error:
            "Die Angaben zum vollständigen Originalsong sind unvollständig oder passen nicht zur Videolänge. Es wurde nichts berechnet.",
        },
        {
          status: 400,
        },
      );
    }

    try {
      const storedAudio =
        await head(
          musicVideoAudioUri.slice(
            "blob:".length,
          ),
        );

      if (
        storedAudio.size < 1_000 ||
        storedAudio.size > MUSIC_VIDEO_MAX_AUDIO_BYTES ||
        !storedAudio.pathname.startsWith(
          "music-video-audio/",
        ) ||
        !storedAudio.contentType.startsWith(
          "audio/",
        )
      ) {
        throw new Error(
          "Die gespeicherte Songdatei ist ungültig.",
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Der hochgeladene Originalsong konnte nicht geprüft werden.",
        },
        {
          status: 400,
        },
      );
    }
  }

  const hasViralStudioDialogue =
    hasValidViralDialoguePlan(
      prompt,
      targetDurationSeconds,
    );

  const hasProvidedDialogue =
    voiceMode === "dialogue" &&
    promptContainsProvidedDialogue;

  if (
    voiceMode ===
      "dialogue" &&
    !hasViralStudioDialogue &&
    !hasValidDialoguePlan(
      prompt,
      targetDurationSeconds,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Der Dialogplan enthält noch keine vollständig ausführbare sichtbare Sprache. Bitte lass den Filmplan neu erstellen. Es wurde nichts berechnet.",
      },
      {
        status:
          400,
      },
    );
  }

  const voiceoverText =
    typeof body.voiceoverText ===
    "string"
      ? body.voiceoverText
          .trim()
      : "";

  let submittedStory:
    Story | null = null;

  try {
    submittedStory =
      JSON.parse(prompt) as Story;
  } catch {
    submittedStory = null;
  }

  if (submittedStory) {
    const dialogueQuality =
      inspectDialogueQuality(
        submittedStory,
        {
          voiceMode,
          voiceoverText,
          targetDurationSeconds,
          videoModel,
        },
      );

    if (
      dialogueQuality.required &&
      !dialogueQuality.ready
    ) {
      console.warn(
        "Checkout blocked by exact-dialogue quality gate",
        {
          issueCodes:
            dialogueQuality.issues.map(
              (issue) => issue.code,
            ),
          dialogueCount:
            dialogueQuality.dialogueCount,
        },
      );

      return NextResponse.json(
        {
          error:
            dialogueQuality.issues[0]?.message ??
            "Der Originaldialog hat die technische Freigabeprüfung nicht bestanden. Es wurde nichts berechnet.",
        },
        {
          status: 400,
        },
      );
    }
  }

  const voiceoverVoiceName =
    isVoiceoverVoiceName(
      body.voiceoverVoiceName,
    )
      ? body.voiceoverVoiceName
      : "Charon";

  const closingText =
    typeof body.closingText ===
    "string"
      ? body.closingText
          .trim()
      : "";

  /*
   * Genug Platz für natürliche Pausen und
   * einen vollständigen letzten Satz.
   */
  const maximumVoiceoverWords =
    Math.max(
      16,

      Math.floor(
        (
          targetDurationSeconds +
          2
        ) *
          1.75,
      ),
    );

  const voiceoverWords =
    voiceoverText
      ? voiceoverText
          .split(/\s+/)
          .filter(Boolean)
          .length
      : 0;

  if (
    voiceMode ===
      "voiceover" &&
    !voiceoverText
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte gib den exakten Sprechertext für das Voice-over ein.",
      },
      {
        status:
          400,
      },
    );
  }

  if (
    voiceoverText.length >
      4_000 ||
    voiceoverWords >
      maximumVoiceoverWords
  ) {
    return NextResponse.json(
      {
        error:
          `Der Sprechertext ist für ${targetDurationSeconds} Sekunden zu lang. Erlaubt sind ungefähr ${maximumVoiceoverWords} Wörter.`,
      },
      {
        status:
          400,
      },
    );
  }

  if (
    closingText.length >
    160
  ) {
    return NextResponse.json(
      {
        error:
          "Die Schluss-Einblendung darf höchstens 160 Zeichen lang sein.",
      },
      {
        status:
          400,
      },
    );
  }

  const referenceImageUri =
    typeof body.referenceImageUri ===
    "string"
      ? body.referenceImageUri
          .trim()
      : "";

  const referenceImageMimeType =
    typeof body.referenceImageMimeType ===
    "string"
      ? body.referenceImageMimeType
          .trim()
      : "";

  if (
    !referenceImageUri ||
    !referenceImageMimeType
  ) {
    return NextResponse.json(
      {
        error:
          "Die bestätigte Bildvorschau fehlt. Bitte erstelle sie erneut.",
      },
      {
        status:
          400,
      },
    );
  }

  try {
    await loadStoredPreview(
      referenceImageUri,
      referenceImageMimeType,
    );
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Die bestätigte Bildvorschau konnte nicht geprüft werden.",
      },
      {
        status:
          400,
      },
    );
  }

  const aspectRatio =
    normalizeAspectRatio(
      body.aspectRatio,
    );

  /*
   * 15 Sekunden ist jetzt das neue
   * Short-Format.
   */
  const videoFormat:
    VideoFormat =
    targetDurationSeconds ===
    15
      ? "short"
      : "long";

  const priceCents =
    getVideoPriceCents(
      targetDurationSeconds,
      videoModel,
    );

  const selectedVideoModel =
    getVideoModel(videoModel);

  const productName = [
    "KI-generiertes Video",

    durationLabel(
      targetDurationSeconds,
    ),

    aspectRatio,

    editingStyleLabel(
      editingStyle,
    ),

    selectedVideoModel.name,
  ].join(
    " · ",
  );

  const jobId =
    nanoid();

  const user =
    await getCurrentUser();

  const useSubscription =
    body.useSubscription === true;

  const subscription =
    useSubscription
      ? await getActiveVideoSubscription(req).catch(() => null)
      : null;

  if (useSubscription && (!user || !subscription)) {
    return NextResponse.json(
      {
        error:
          "Bitte melde dich mit dem Kundenkonto an, zu dem dein Video-Abo gehört.",
      },
      { status: 401 },
    );
  }

  const quotaSecondsRequired =
    getVideoQuotaSeconds(targetDurationSeconds, videoModel);

  if (subscription) {
    const reservation =
      await reserveVideoSubscriptionUsage({
        subscriptionId: subscription.subscriptionId,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        kind: "video-seconds",
        amount: quotaSecondsRequired,
        limit: subscription.plan.videoSecondsPerMonth,
      });

    if (!reservation.allowed) {
      return NextResponse.json(
        {
          error:
            `Für dieses Video reicht dein verbleibendes Monatskontingent nicht aus. Mit ${selectedVideoModel.shortName} sind noch ${formatQuotaMinutes(reservation.remaining / selectedVideoModel.quotaMultiplier)} verfügbar.`,
        },
        { status: 409 },
      );
    }
  }

  const durationPlan =
    buildVideoDurationPlan(targetDurationSeconds);

  const now = Date.now();

  /*
   * Hier schreiben wir nur Felder,
   * die der bestehende Job Store kennt.
   *
   * Die bezahlten Einstellungen werden
   * zusätzlich in Stripe-Metadata gespeichert
   * und danach serverseitig wieder geprüft.
   */
  await jobStore.set(
    jobId,
    {
      userId:
        user?.id,

      status:
        subscription ? "processing" : "pending",

      prompt,

      format:
        videoFormat,

      audioStyle,

      voiceMode,

      spokenLanguage,

      videoModel,

      provider:
        selectedVideoModel.provider,

      targetDurationSeconds,

      aspectRatio,

      editingStyle,

      generationStrategy:
        durationPlan.generationStrategy,

      paymentStatus:
        subscription ? "paid" : undefined,

      paidAt:
        subscription ? now : undefined,

      subscriptionId:
        subscription?.subscriptionId,

      subscriptionPlanId:
        subscription?.plan.id,

      renderStage:
        subscription ? "queued" : undefined,

      progressPercent:
        subscription ? 0 : undefined,

      currentChapter:
        subscription ? 0 : undefined,

      totalChapters:
        subscription
          ? durationPlan.chapterTargets.length
          : undefined,

      currentExtension:
        subscription ? 0 : undefined,

      totalExtensions:
        subscription
          ? countPlannedExtensions(durationPlan.chapterTargets, videoModel)
          : undefined,

      retryCount:
        subscription ? 0 : undefined,

      maxRetries:
        subscription ? 12 : undefined,

      nextAttemptAt:
        subscription ? now : undefined,

      musicVideoAudioUri:
        musicVideoMode
          ? musicVideoAudioUri
          : undefined,

      musicVideoAudioMimeType:
        musicVideoMode
          ? musicVideoAudioMimeType
          : undefined,

      musicVideoAudioName:
        musicVideoMode
          ? musicVideoAudioName
          : undefined,

      musicVideoAudioDurationSeconds:
        musicVideoMode
          ? musicVideoAudioDurationSeconds
          : undefined,

      musicVideoAudioAnalysis:
        musicVideoMode
          ? musicVideoAudioAnalysis
          : undefined,

      nativeCharacterDialogue:
        /*
         * Wortwörtlich vorgegebene Dialoge müssen von der sichtbaren
         * Figur direkt im Provider-Video gesprochen werden. Nur so
         * stammen Stimme und Mundbewegung aus demselben Render-Pass.
         * Automatisch erzeugte Dialoge behalten die Studio-Nachvertonung.
         */
        hasProvidedDialogue,

      voiceoverText:
        voiceoverText ||
        undefined,

      voiceoverVoiceName:
        voiceMode === "voiceover" ||
        voiceMode === "dialogue"
          ? voiceoverVoiceName
          : undefined,

      closingText:
        closingText ||
        undefined,

      referenceImageUrl:
        referenceImageUri,

      referenceImageMimeType,

      createdAt:
        now,
    },
  );

  if (user) {
    await accountLibrary.addMedia(
      user.id,
      {
        kind:
          "video",
        jobId,
        title:
          `KI-Video · ${durationLabel(targetDurationSeconds)}`,
        createdAt:
          now,
      },
    );
  }

  if (subscription) {
    let workflowStarted = false;

    try {
      const claimId =
        `video-subscription:${subscription.subscriptionId}:${jobId}`;

      const claimed =
        await jobStore.claimWorkflowStart(jobId, claimId);

      if (!claimed) {
        throw new Error("Der Video-Workflow konnte nicht reserviert werden.");
      }

      const run =
        await start(renderVideoWorkflow, [jobId]);

      workflowStarted = true;

      await jobStore.confirmWorkflowStarted(jobId, run.runId);

      await jobStore.update(jobId, (current) => ({
        ...current,
        workerId: run.runId,
        claimedAt: current.claimedAt ?? Date.now(),
      }));

      return NextResponse.json({
        url:
          `/success?jobId=${encodeURIComponent(jobId)}&included=1`,
        checkoutUrl:
          `/success?jobId=${encodeURIComponent(jobId)}&included=1`,
        jobId,
        included: true,
        quotaSecondsRequired,
        targetDurationSeconds,
        aspectRatio,
        editingStyle,
        videoModel,
        priceCents: 0,
      });
    } catch (error) {
      console.error("Video aus dem Abo konnte nicht gestartet werden:", error);

      if (!workflowStarted) {
        await releaseVideoSubscriptionUsage({
          subscriptionId: subscription.subscriptionId,
          periodStart: subscription.periodStart,
          kind: "video-seconds",
          amount: quotaSecondsRequired,
        }).catch(() => undefined);
      }

      await jobStore.update(jobId, (current) => ({
        ...current,
        status: "error",
        renderStage: "failed",
        errorMessage:
          workflowStarted
            ? "Das Video wurde gestartet, aber der Status konnte nicht vollständig gespeichert werden. Der Support kann den Auftrag weiter prüfen."
            : "Das Video konnte nicht gestartet werden. Die reservierten Videominuten wurden wieder freigegeben.",
      }));

      return NextResponse.json(
        {
          error:
            workflowStarted
              ? "Das Video wurde gestartet, aber die Bestätigung ist fehlgeschlagen. Bitte prüfe gleich dein Konto."
              : "Das Video konnte gerade nicht gestartet werden. Dein Videokontingent wurde nicht verbraucht.",
        },
        { status: 500 },
      );
    }
  }

  const appUrl =
    process.env.APP_URL ??
    "http://localhost:3000";

  const instagramDiscount =
    await prepareInstagramDiscountCheckout(
      stripe,
      user,
    );

  const session =
    await stripe.checkout.sessions.create({
      mode:
        "payment",

      client_reference_id:
        user?.id,

      customer:
        instagramDiscount?.customerId,

      allow_promotion_codes:
        true,

      line_items: [
        {
          price_data: {
            currency:
              "eur",

            product_data: {
              name:
                productName,
            },

            unit_amount:
              priceCents,
          },

          quantity:
            1,
        },
      ],

      metadata: {
        productType:
          "video",

        jobId,

        userId:
          user?.id || "",

        instagramCampaignId:
          instagramDiscount?.campaign.id || "",

        targetDurationSeconds:
          String(
            targetDurationSeconds,
          ),

        videoModel,

        aspectRatio,

        editingStyle,

        audioStyle,

        voiceMode,

        spokenLanguage,

        hasReferenceImage:
          "true",

        hasOriginalSong:
          musicVideoMode
            ? "true"
            : "false",

        originalSongDurationSeconds:
          musicVideoMode
            ? musicVideoAudioDurationSeconds.toFixed(2)
            : "",

        format:
          videoFormat,
      },

      success_url:
        `${appUrl}/success?jobId=${encodeURIComponent(
          jobId,
        )}&session_id={CHECKOUT_SESSION_ID}`,

      cancel_url:
        `${appUrl}?canceled=1`,
    });

  if (
    !session.url
  ) {
    return NextResponse.json(
      {
        error:
          "Stripe hat keine Checkout-Adresse zurückgegeben.",
      },
      {
        status:
          502,
      },
    );
  }

  return NextResponse.json({
    url:
      session.url,

    checkoutUrl:
      session.url,

    jobId,

    targetDurationSeconds,

    aspectRatio,

    editingStyle,

    videoModel,

    priceCents,
  });
}
