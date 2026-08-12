import {
  NextRequest,
  NextResponse,
} from "next/server";

import { nanoid } from "nanoid";

import {
  stripe,
  PRICE_LONG_CENTS,
  PRICE_SHORT_CENTS,
} from "../../../lib/stripe";

import {
  jobStore,
  type VideoFormat,
} from "../../../lib/store";

import type {
  VideoAspectRatio,
  VideoDurationSeconds,
  VideoEditingStyle,
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
};

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
   * RÃ¼ckwÃ¤rtskompatibilitÃ¤t:
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

export async function POST(
  req: NextRequest,
) {
  let body:
    CheckoutRequest;

  try {
    body =
      (await req.json()) as CheckoutRequest;
  } catch {
    return NextResponse.json(
      {
        error:
          "Der Request enthÃ¤lt kein gÃ¼ltiges JSON.",
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
          "Bitte gib eine Beschreibung fÃ¼r dein Video ein.",
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
          "UngÃ¼ltige VideolÃ¤nge. Erlaubt sind 8, 30, 60, 120, 180, 240 oder 300 Sekunden.",
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
          'UngÃ¼ltiges Bildformat. Erlaubt sind "9:16" oder "16:9".',
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
          'UngÃ¼ltiger Schnittstil. Erlaubt sind "auto", "social", "cinematic" oder "music-video".',
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

  /*
   * Die vorhandene Preisstruktur kennt aktuell nur
   * SHORT und LONG. Deshalb bleibt die bisherige
   * Preislogik in diesem Schritt erhalten:
   *
   * 8 s  -> PRICE_SHORT_CENTS
   * >8 s -> PRICE_LONG_CENTS
   *
   * Vor einem Ã¶ffentlichen Verkauf von 30 s und
   * 2â€“5 Min. brauchen wir eine echte Dauer-Preisstaffel
   * in lib/stripe.ts.
   */
  const priceCents =
    videoFormat === "short"
      ? PRICE_SHORT_CENTS
      : PRICE_LONG_CENTS;

  const productName = [
    "KI-generiertes Video",
    durationLabel(
      targetDurationSeconds,
    ),
    aspectRatio,
    editingStyleLabel(
      editingStyle,
    ),
  ].join(" Â· ");

  const jobId =
    nanoid();

  /*
   * Hier schreiben wir bewusst nur Felder, die
   * der bestehende lib/store.ts sicher kennt.
   *
   * Die neuen Werte liegen zusÃ¤tzlich in Stripe-Metadata
   * und werden im nÃ¤chsten Schritt vom Webhook Ã¼bernommen.
   */
  await jobStore.set(
    jobId,
    {
      status:
        "pending",

      prompt,

      format:
        videoFormat,

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

      payment_method_types: [
        "card",
      ],

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
          "Stripe hat keine Checkout-Adresse zurÃ¼ckgegeben.",
      },
      {
        status: 502,
      },
    );
  }

  /*
   * Deine neue page.tsx erwartet data.url.
   * Die bisherige Route lieferte checkoutUrl.
   * FÃ¼r die Ãœbergangsphase liefern wir beides.
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