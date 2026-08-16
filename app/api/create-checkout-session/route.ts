import {
  NextRequest,
  NextResponse,
} from "next/server";

import { nanoid } from "nanoid";

import { stripe } from "../../../lib/stripe";
import {
  CURRENTLY_RELEASED_MAX_DURATION_SECONDS,
  getVideoPriceCents,
  isReleasedVideoDuration,
} from "../../../lib/pricing";
import {
  isVideoAudioStyle,
  isVideoSpokenLanguage,
  isVideoVoiceMode,
} from "../../../lib/audio-options";
import { loadStoredPreview } from "../../../lib/video-backend/images";
import { checkRateLimit } from "../../../lib/rate-limit";

import {
  jobStore,
  type VideoFormat,
} from "../../../lib/store";

import type {
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

const SUPPORTED_VIDEO_DURATIONS = [
  8,
  30,
  60,
  120,
  180,
  240,
  300,
] as const satisfies readonly VideoDurationSeconds[];

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
   * Altes Feld bleibt vorerst erhalten,
   * damit bestehende Clients kompatibel bleiben.
   */
  format?: unknown;

  targetDurationSeconds?: unknown;
  aspectRatio?: unknown;
  editingStyle?: unknown;
  audioStyle?: unknown;
  voiceMode?: unknown;
  spokenLanguage?: unknown;
  voiceoverText?: unknown;
  closingText?: unknown;
  referenceImageUri?: unknown;
  referenceImageMimeType?: unknown;
};

function missingProductionServices(): string[] {
  if (process.env.NODE_ENV === "development") return [];

  const missing: string[] = [];
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    missing.push("Redis");
  }
  if (
    !process.env.BLOB_READ_WRITE_TOKEN &&
    !process.env.BLOB_STORE_ID
  ) {
    missing.push("Vercel Blob");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    missing.push("Stripe Webhook");
  }
  if (!process.env.GEMINI_API_KEY) {
    missing.push("Google AI");
  }
  if (process.env.VEO_WORKFLOW_RENDER_ENABLED !== "true") {
    missing.push("Veo Render");
  }
  return missing;
}

function isVideoDurationSeconds(
  value: unknown,
): value is VideoDurationSeconds {
  return (
    typeof value === "number" &&
    SUPPORTED_VIDEO_DURATIONS.includes(
      value as VideoDurationSeconds,
    )
  );
}

function isVideoAspectRatio(
  value: unknown,
): value is VideoAspectRatio {
  return (
    typeof value === "string" &&
    SUPPORTED_ASPECT_RATIOS.includes(
      value as VideoAspectRatio,
    )
  );
}

function isVideoEditingStyle(
  value: unknown,
): value is VideoEditingStyle {
  return (
    typeof value === "string" &&
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
   * Rückwärtskompatibilität:
   *
   * Alte long-Requests waren 60 Sekunden,
   * alte short-Requests 8 Sekunden.
   */
  return legacyFormat === "long"
    ? 60
    : 8;
}

function normalizeAspectRatio(
  value: unknown,
): VideoAspectRatio {
  return isVideoAspectRatio(value)
    ? value
    : "9:16";
}

function normalizeEditingStyle(
  value: unknown,
): VideoEditingStyle {
  return isVideoEditingStyle(value)
    ? value
    : "social";
}

function durationLabel(
  durationSeconds: VideoDurationSeconds,
): string {
  if (
    durationSeconds < 60
  ) {
    return `${durationSeconds} Sekunden`;
  }

  const minutes =
    durationSeconds / 60;

  return minutes === 1
    ? "1 Minute"
    : `${minutes} Minuten`;
}

function editingStyleLabel(
  editingStyle: VideoEditingStyle,
): string {
  switch (editingStyle) {
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

function hasValidViralDialoguePlan(
  prompt: string,
  targetDurationSeconds: VideoDurationSeconds,
): boolean {
  try {
    const story = JSON.parse(prompt) as {
      creationMode?: unknown;
      characters?: Array<{ name?: unknown }>;
      moviePlan?: {
        opening?: { dialogue?: unknown; dialogueTurns?: unknown[] };
        continuations?: Array<{ dialogue?: unknown; dialogueTurns?: unknown[] }>;
      };
    };
    if (story.creationMode !== "viral-story") return false;

    const dialogueValues = [
      story.moviePlan?.opening?.dialogue,
      ...(story.moviePlan?.opening?.dialogueTurns ?? []),
      ...(story.moviePlan?.continuations ?? []).flatMap((item) => [
        item.dialogue,
        ...(item.dialogueTurns ?? []),
      ]),
    ];
    const speakers = new Set<string>();
    let validLineCount = 0;
    let totalWordCount = 0;
    const maximumWordsPerLine = targetDurationSeconds <= 8 ? 6 : 12;
    for (const value of dialogueValues) {
      if (!value || typeof value !== "object") continue;
      const dialogue = value as Record<string, unknown>;
      if (dialogue.enabled !== true) continue;
      const speaker = typeof dialogue.speaker === "string" ? dialogue.speaker.trim() : "";
      const text = typeof dialogue.text === "string" ? dialogue.text.trim() : "";
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (!speaker || !text || wordCount > maximumWordsPerLine || text.length > 140) continue;
      speakers.add(speaker.toLocaleLowerCase("de-DE"));
      validLineCount += 1;
      totalWordCount += wordCount;
    }

    const expectedSpeakers = (story.characters ?? [])
      .map((character) => typeof character.name === "string" ? character.name.trim() : "")
      .filter(Boolean)
      .slice(0, 3);
    const requiredSpeakerCount = Math.min(3, Math.max(2, expectedSpeakers.length));
    if (
      validLineCount < requiredSpeakerCount ||
      speakers.size < requiredSpeakerCount ||
      (targetDurationSeconds <= 8 && totalWordCount > 12)
    ) {
      return false;
    }

    return expectedSpeakers.every((expectedSpeaker) => {
      const fullName = expectedSpeaker.toLocaleLowerCase("de-DE");
      const shortName = fullName.split(",")[0].trim();
      return speakers.has(fullName) || speakers.has(shortName);
    });
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
) {
  const rateLimit = await checkRateLimit(req, "checkout", 20, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Zu viele Bestellversuche in kurzer Zeit. Bitte versuche es später erneut." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const missingServices = missingProductionServices();
  if (missingServices.length > 0) {
    console.error("Checkout blockiert: Produktionsdienste fehlen:", missingServices);
    return NextResponse.json(
      {
        error:
          "Die Video-Bestellung ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
      },
      { status: 503 },
    );
  }

  const providerPause = await jobStore.getProviderPause();
  if (providerPause) {
    const retryAfterSeconds = Math.max(
      60,
      Math.ceil((providerPause.until - Date.now()) / 1000),
    );

    return NextResponse.json(
      {
        error:
          "Die Video-KI hat momentan ihr Google-Limit erreicht. Es wird keine Zahlung gestartet. Bitte versuche es später erneut.",
      },
      {
        status: 503,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  let body:
    CheckoutRequest;

  try {
    body =
      (await req.json()) as CheckoutRequest;
  } catch {
    return NextResponse.json(
      {
        error:
          "Der Request enthält kein gültiges JSON.",
      },
      {
        status: 400,
      },
    );
  }

  const prompt =
    typeof body.prompt === "string"
      ? body.prompt.trim()
      : "";

  if (
    prompt.length < 3
  ) {
    return NextResponse.json(
      {
        error:
          "Bitte gib eine Beschreibung für dein Video ein.",
      },
      {
        status: 400,
      },
    );
  }

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
          "Ungültige Videolänge. Erlaubt sind 8, 30, 60, 120, 180, 240 oder 300 Sekunden.",
      },
      {
        status: 400,
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
        status: 400,
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
        status: 400,
      },
    );
  }

  const targetDurationSeconds =
    normalizeDuration(
      body.targetDurationSeconds,
      body.format,
    );

  if (!isReleasedVideoDuration(targetDurationSeconds)) {
    return NextResponse.json(
      {
        error:
          `Diese Videolänge befindet sich noch in der Qualitätsprüfung. Aktuell sind maximal ${CURRENTLY_RELEASED_MAX_DURATION_SECONDS} Sekunden freigeschaltet. Es wurde nichts berechnet.`,
      },
      { status: 409 },
    );
  }

  if (!isVideoAudioStyle(body.audioStyle)) {
    return NextResponse.json(
      { error: "Bitte wähle einen gültigen KI-Musikstil." },
      { status: 400 },
    );
  }

  if (!isVideoVoiceMode(body.voiceMode)) {
    return NextResponse.json(
      { error: "Bitte wähle eine gültige Stimmen-Option." },
      { status: 400 },
    );
  }

  if (!isVideoSpokenLanguage(body.spokenLanguage)) {
    return NextResponse.json(
      { error: "Bitte wähle eine gültige Sprache." },
      { status: 400 },
    );
  }

  const audioStyle = body.audioStyle as VideoAudioStyle;
  const voiceMode = body.voiceMode as VideoVoiceMode;
  const spokenLanguage = body.spokenLanguage as VideoSpokenLanguage;

  if (
    voiceMode === "dialogue" &&
    !hasValidViralDialoguePlan(prompt, targetDurationSeconds)
  ) {
    return NextResponse.json(
      {
        error:
          "Der allgemeine Dialogmodus wird noch geprüft. Automatische Dialoge sind derzeit über den TikTok-Story-Modus verfügbar. Es wurde nichts berechnet.",
      },
      { status: 503 },
    );
  }

  const voiceoverText =
    typeof body.voiceoverText === "string"
      ? body.voiceoverText.trim()
      : "";

  const closingText =
    typeof body.closingText === "string"
      ? body.closingText.trim()
      : "";

  // Leave enough room for natural pauses and a complete final sentence. A
  // higher limit forces the finishing step to accelerate otherwise good TTS.
  const maximumVoiceoverWords = Math.max(16, Math.floor((targetDurationSeconds + 2) * 1.75));
  const voiceoverWords = voiceoverText ? voiceoverText.split(/\s+/).filter(Boolean).length : 0;

  if (voiceMode === "voiceover" && !voiceoverText) {
    return NextResponse.json(
      { error: "Bitte gib den exakten Sprechertext für das Voice-over ein." },
      { status: 400 },
    );
  }

  if (voiceoverText.length > 4_000 || voiceoverWords > maximumVoiceoverWords) {
    return NextResponse.json(
      { error: `Der Sprechertext ist für ${targetDurationSeconds} Sekunden zu lang. Erlaubt sind ungefähr ${maximumVoiceoverWords} Wörter.` },
      { status: 400 },
    );
  }

  if (closingText.length > 160) {
    return NextResponse.json(
      { error: "Die Schluss-Einblendung darf höchstens 160 Zeichen lang sein." },
      { status: 400 },
    );
  }

  const referenceImageUri =
    typeof body.referenceImageUri === "string"
      ? body.referenceImageUri.trim()
      : "";

  const referenceImageMimeType =
    typeof body.referenceImageMimeType === "string"
      ? body.referenceImageMimeType.trim()
      : "";

  if (!referenceImageUri || !referenceImageMimeType) {
    return NextResponse.json(
      { error: "Die bestätigte Bildvorschau fehlt. Bitte erstelle sie erneut." },
      { status: 400 },
    );
  }

  try {
    await loadStoredPreview(referenceImageUri, referenceImageMimeType);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Die bestätigte Bildvorschau konnte nicht geprüft werden.",
      },
      { status: 400 },
    );
  }

  const aspectRatio =
    normalizeAspectRatio(
      body.aspectRatio,
    );

  const editingStyle =
    normalizeEditingStyle(
      body.editingStyle,
    );

  const videoFormat:
    VideoFormat =
    targetDurationSeconds === 8
      ? "short"
      : "long";

  const priceCents = getVideoPriceCents(targetDurationSeconds);

  const productName = [
    "KI-generiertes Video",
    durationLabel(
      targetDurationSeconds,
    ),
    aspectRatio,
    editingStyleLabel(
      editingStyle,
    ),
  ].join(" · ");

  const jobId =
    nanoid();

  /*
   * Hier schreiben wir bewusst nur Felder, die
   * der bestehende lib/store.ts sicher kennt.
   *
   * Die neuen Werte liegen zusätzlich in Stripe-Metadata
   * und werden im nächsten Schritt vom Webhook übernommen.
   */
  await jobStore.set(
    jobId,
    {
      status:
        "pending",

      prompt,

      format:
        videoFormat,

      audioStyle,

      voiceMode,

      spokenLanguage,

      nativeCharacterDialogue:
        hasValidViralDialoguePlan(prompt, targetDurationSeconds),

      voiceoverText:
        voiceoverText || undefined,

      closingText:
        closingText || undefined,

      referenceImageUrl:
        referenceImageUri,

      referenceImageMimeType,

      createdAt:
        Date.now(),
    },
  );

  const appUrl =
    process.env.APP_URL ??
    "http://localhost:3000";

  const session =
    await stripe.checkout.sessions.create({
      mode:
        "payment",

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
        jobId,

        targetDurationSeconds:
          String(
            targetDurationSeconds,
          ),

        aspectRatio,

        editingStyle,

        audioStyle,

        voiceMode,

        spokenLanguage,

        hasReferenceImage:
          "true",

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

  if (!session.url) {
    return NextResponse.json(
      {
        error:
          "Stripe hat keine Checkout-Adresse zurückgegeben.",
      },
      {
        status: 502,
      },
    );
  }

  /*
   * Deine neue page.tsx erwartet data.url.
   * Die bisherige Route lieferte checkoutUrl.
   * Für die Übergangsphase liefern wir beides.
   */
  return NextResponse.json({
    url:
      session.url,

    checkoutUrl:
      session.url,

    jobId,

    targetDurationSeconds,

    aspectRatio,

    editingStyle,
  });
}
