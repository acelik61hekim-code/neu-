import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { storeGeneratedPreview } from "@/lib/video-backend/images";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  STUDIO_NAME,
  STUDIO_URL,
  buildStudioAdvertisementDirection,
  isStudioWebsiteAdvertisement,
} from "@/lib/studio-brand";

import type {
  VideoAspectRatio,
  VideoEditingStyle,
} from "@/types/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PREVIEW_MODEL =
  "gemini-3.1-flash-image";

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

type GeneratePreviewRequest = {
  prompt?: unknown;
  aspectRatio?: unknown;
  editingStyle?: unknown;
  referenceImage?: unknown;
  referenceImages?: unknown;
};

type InputReferenceImage = {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

const MAX_REFERENCE_IMAGE_BYTES = 900 * 1024;

function readReferenceImage(value: unknown): InputReferenceImage | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("Das Referenzbild ist ungültig.");
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  if (!match) {
    throw new Error("Das Referenzbild muss eine JPG-, PNG- oder WebP-Datei sein.");
  }

  const data = match[2].replace(/[\r\n]/g, "");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 256 || bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("Das Referenzbild darf nach der Optimierung höchstens 900 KB groß sein.");
  }

  return {
    data,
    mimeType: match[1] as InputReferenceImage["mimeType"],
  };
}

function readReferenceImages(value: unknown, legacyValue: unknown): InputReferenceImage[] {
  const source = Array.isArray(value)
    ? value
    : legacyValue
      ? [legacyValue]
      : [];

  if (source.length > 3) {
    throw new Error("Es können höchstens drei Referenzbilder verwendet werden.");
  }

  return source.map((item) => {
    const image = readReferenceImage(item);
    if (!image) throw new Error("Ein Referenzbild ist leer oder ungültig.");
    return image;
  });
}

function readPrompt(
  value: unknown,
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function readAspectRatio(
  value: unknown,
): VideoAspectRatio {
  if (
    typeof value === "string" &&
    SUPPORTED_ASPECT_RATIOS.includes(
      value as VideoAspectRatio,
    )
  ) {
    return value as VideoAspectRatio;
  }

  /*
   * Rückwärtskompatibilität:
   * Alte Requests ohne dieses Feld
   * bleiben weiterhin vertikal.
   */
  return "9:16";
}

function readEditingStyle(
  value: unknown,
): VideoEditingStyle {
  if (
    typeof value === "string" &&
    SUPPORTED_EDITING_STYLES.includes(
      value as VideoEditingStyle,
    )
  ) {
    return value as VideoEditingStyle;
  }

  /*
   * Rückwärtskompatibilität für alte Clients.
   */
  return "social";
}

function buildFormatDirection(
  aspectRatio: VideoAspectRatio,
): string[] {
  if (aspectRatio === "16:9") {
    return [
      "FORMAT / COMPOSITION:",
      "- native 16:9 cinematic widescreen composition",
      "- use foreground, midground and background depth",
      "- use negative space and spatial relationships intentionally",
      "- compose like a real film frame, not a vertical social frame stretched sideways",
      "- preserve clear screen direction and believable spatial geography",
    ];
  }

  return [
    "FORMAT / COMPOSITION:",
    "- native vertical 9:16 composition",
    "- keep the main subject and important action readable on mobile screens",
    "- use depth and layered composition even in the vertical frame",
    "- avoid making every shot an extreme close-up",
    "- do not crop a horizontal composition into vertical framing",
  ];
}

function buildEditingDirection(
  editingStyle: VideoEditingStyle,
): string[] {
  switch (editingStyle) {
    case "cinematic":
      return [
        "FILM LANGUAGE / EDITING STYLE:",
        "- cinematic feature-film visual language",
        "- frame the scene as part of a real movie, not a TikTok or Reel",
        "- use motivated coverage: establishing, master, medium, close-up, insert or reaction framing when appropriate",
        "- preserve eyelines, screen direction and believable spatial continuity",
        "- favor deliberate camera placement and emotionally motivated composition",
        "- allow visual breathing room when drama or performance benefits from it",
        "- avoid arbitrary jump-cut energy or forced social-media pacing",
        "- premium theatrical lighting, production design and restrained cinematic color grading",
      ];

    case "music-video":
      return [
        "FILM LANGUAGE / EDITING STYLE:",
        "- premium cinematic music-video visual language",
        "- strong memorable visual motifs",
        "- expressive composition and camera movement",
        "- imagery should feel suitable for rhythm-aware cutting and musical sections",
        "- combine performance, narrative and atmospheric visual language where appropriate",
        "- do not make the frame look like a generic social-media thumbnail",
      ];

    case "auto":
      return [
        "FILM LANGUAGE / EDITING STYLE:",
        "- infer the most appropriate professional visual language from the user's story, genre, selected aspect ratio and mood",
        "- keep the chosen visual language coherent throughout the planned film",
        "- prioritize cinematic quality, story clarity and believable continuity",
      ];

    default:
      return [
        "FILM LANGUAGE / EDITING STYLE:",
        "- premium social-video / Reels visual language",
        "- immediate visual clarity and a strong opening image",
        "- energetic but controlled framing",
        "- mobile-friendly visual hierarchy",
        "- strong subject separation and readable action",
        "- avoid cheap clickbait aesthetics, random jump-cut styling or exaggerated thumbnail composition",
      ];
  }
}

function buildPreviewPrompt(
  userPrompt: string,
  aspectRatio: VideoAspectRatio,
  editingStyle: VideoEditingStyle,
  studioAdvertisement: boolean,
): string {
  const visibleContentRules = studioAdvertisement
    ? [
        `- this is a commercial advertisement for the real, existing ${STUDIO_NAME} website at ${STUDIO_URL}`,
        "- the real KI Video Studio website interface and its logo from the official attached reference image are required on the device display",
        "- preserve the reference website's recognizable dark layout, violet accents, brand header and Video / Songs / Bilder navigation",
        "- do not redraw, redesign or replace the referenced website with an abstract neon screen, fake app, fictional interface or unrelated logo",
        "- do not invent any additional interface copy; visible product text may come only from the supplied official website reference",
        "- no subtitles, no captions and no watermarks",
      ]
    : [
        "- no subtitles",
        "- no captions",
        "- no logos",
        "- no watermarks",
        "- no UI elements",
        "- no unnecessary visible text",
      ];

  return [
    "Create one premium cinematic preview frame for the planned AI video.",
    "",
    studioAdvertisement
      ? `This is an advertisement for the existing ${STUDIO_NAME} website, not a generic or fictional AI product.`
      : "This is a visual preview of the planned video, not a poster, thumbnail or advertisement.",
    "The result should look like a real frame captured from the final film.",
    studioAdvertisement
      ? buildStudioAdvertisementDirection()
      : "",
    "",
    ...buildFormatDirection(
      aspectRatio,
    ),
    "",
    ...buildEditingDirection(
      editingStyle,
    ),
    "",
    "GENERAL QUALITY REQUIREMENTS:",
    "- photorealistic live-action unless the user's idea explicitly requests another visual style",
    "- realistic anatomy and facial proportions",
    "- believable hands and body proportions",
    "- physically plausible lighting, shadows and reflections",
    "- natural skin texture",
    "- realistic materials and surface imperfections",
    "- real-world lens behavior",
    "- cinematic composition",
    "- premium commercial / film production quality",
    "- strong visual hierarchy",
    ...visibleContentRules,
    "",
    "CONTINUITY REQUIREMENTS:",
    "The preview must represent the opening look of the planned video:",
    "- same main character identity",
    "- same face and hair",
    "- same clothing and accessories",
    "- same environment",
    "- same lighting mood",
    "- same color grade",
    "- same camera language",
    "- same realism level",
    "",
    `SELECTED ASPECT RATIO: ${aspectRatio}`,
    `SELECTED EDITING STYLE: ${editingStyle}`,
    "",
    "USER VIDEO / OPENING PROMPT:",
    userPrompt,
  ].join("\n");
}

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const record =
      error as Record<string, unknown>;

    if (
      typeof record.message === "string"
    ) {
      return record.message;
    }

    const nestedError =
      record.error;

    if (
      typeof nestedError === "object" &&
      nestedError !== null
    ) {
      const nestedRecord =
        nestedError as Record<
          string,
          unknown
        >;

      if (
        typeof nestedRecord.message ===
        "string"
      ) {
        return nestedRecord.message;
      }
    }
  }

  return "Die Bild-Vorschau konnte nicht erstellt werden.";
}

function isSafetyBlocked(
  error: unknown,
): boolean {
  const message =
    getErrorMessage(error)
      .toLowerCase();

  if (
    message.includes(
      "safety violations",
    ) ||
    message.includes(
      "prohibited use",
    ) ||
    message.includes(
      "filtered out",
    ) ||
    message.includes(
      "image generation blocked",
    )
  ) {
    return true;
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    try {
      const serialized =
        JSON.stringify(error)
          .toLowerCase();

      return (
        serialized.includes(
          "safety violations",
        ) ||
        serialized.includes(
          "prohibited use",
        ) ||
        serialized.includes(
          "filtered out",
        ) ||
        serialized.includes(
          "image generation blocked",
        )
      );
    } catch {
      return false;
    }
  }

  return false;
}

export async function POST(
  request: Request,
) {
  const rateLimit = await checkRateLimit(request, "preview-v2", 8, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Zu viele Vorschauen in kurzer Zeit. Bitte versuche es später erneut.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
      },
      {
        status: 500,
      },
    );
  }

  let body:
    GeneratePreviewRequest;

  try {
    body =
      (await request.json()) as GeneratePreviewRequest;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Request enthält kein gültiges JSON.",
      },
      {
        status: 400,
      },
    );
  }

  const prompt =
    readPrompt(
      body.prompt,
    );

  const aspectRatio =
    readAspectRatio(
      body.aspectRatio,
    );

  const editingStyle =
    readEditingStyle(
      body.editingStyle,
    );

  let referenceImages: InputReferenceImage[] = [];
  try {
    referenceImages = readReferenceImages(body.referenceImages, body.referenceImage);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Das Referenzbild ist ungültig.",
      },
      { status: 400 },
    );
  }

  if (!prompt) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Für die Vorschau fehlt der Prompt.",
      },
      {
        status: 400,
      },
    );
  }

  if (prompt.length < 10) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Der Prompt ist zu kurz für eine sinnvolle Vorschau.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Sicherheitsgrenze für sehr große
   * Story-/MoviePlan-Prompts.
   */
  const limitedPrompt =
    prompt.length > 12000
      ? prompt.slice(
          0,
          12000,
        )
      : prompt;

  const studioAdvertisement =
    isStudioWebsiteAdvertisement(
      limitedPrompt,
    );

  if (studioAdvertisement) {
    try {
      const officialWebsiteReference =
        await readFile(
          resolve(
            process.cwd(),
            "public",
            "ki-video-studio-reference.png",
          ),
        );

      const officialReferenceImage: InputReferenceImage = {
        data: officialWebsiteReference.toString("base64"),
        mimeType: "image/png",
      };

      referenceImages = [
        officialReferenceImage,
        ...referenceImages,
      ].slice(0, 3);
    } catch (error) {
      console.error(
        "Die offizielle KI-Video-Studio-Referenz konnte nicht geladen werden:",
        error,
      );
    }
  }

  try {
    const ai =
      new GoogleGenAI({
        apiKey,
      });

    const previewPrompt = [
      buildPreviewPrompt(
        limitedPrompt,
        aspectRatio,
        editingStyle,
        studioAdvertisement,
      ),
      referenceImages.length > 0
        ? [
            "",
            studioAdvertisement
              ? "OFFICIAL KI VIDEO STUDIO WEBSITE REFERENCE:"
              : "CUSTOMER REFERENCE IMAGE:",
            "Use the attached image or images as authoritative visual references.",
            "Preserve the recognizable identity, face, hair, body proportions, clothing, product design or other defining subject details that are visible in it.",
            studioAdvertisement
              ? "The first attached image is the official, authentic KI Video Studio website. Place this recognizable interface on the phone or computer display and preserve its brand design instead of inventing a replacement. This product-reference requirement overrides any conflicting generic instruction against UI, logos or visible product text."
              : "Recompose it as a premium cinematic opening frame in the selected aspect ratio; do not merely copy the background or add text.",
          ].join("\n")
        : "",
    ].filter(Boolean).join("\n");

    const interactionInput = referenceImages.length > 0
      ? [
          { type: "text" as const, text: previewPrompt },
          ...referenceImages.map((referenceImage) => ({
            type: "image" as const,
            data: referenceImage.data,
            mime_type: referenceImage.mimeType,
          })),
        ]
      : previewPrompt;

    const interaction =
      await ai.interactions.create({
        model:
          PREVIEW_MODEL,

        input: interactionInput,

        response_format: {
          type: "image",

          /*
           * JPEG hat mit diesem
           * Preview-Flow bereits funktioniert.
           */
          mime_type:
            "image/jpeg",

          /*
           * Jetzt nicht mehr fest 9:16.
           * Der Kunde bekommt wirklich das
           * zuvor ausgewählte Format.
           */
          aspect_ratio:
            aspectRatio,

          image_size:
            "1K",
        },
      });

    const outputImage =
      interaction.output_image;

    if (
      !outputImage ||
      typeof outputImage.data !==
        "string" ||
      outputImage.data.length === 0
    ) {
      console.error(
        "Gemini Preview: Keine Bilddaten zurückgegeben.",
        {
          interactionId:
            interaction.id,

          status:
            interaction.status,

          outputText:
            interaction.output_text,

          aspectRatio,

          editingStyle,
        },
      );

      return NextResponse.json(
        {
          success: false,

          error:
            "Gemini hat keine Bild-Vorschau zurückgegeben. Bitte versuche es erneut.",
        },
        {
          status: 502,
        },
      );
    }

    const outputMimeType =
      outputImage.mime_type ||
      "image/jpeg";

    const storedPreview =
      await storeGeneratedPreview(
        outputImage.data,
        outputMimeType,
      );

    return NextResponse.json(
      {
        success: true,

        model:
          PREVIEW_MODEL,

        aspectRatio,

        editingStyle,

        imageSize:
          "1K",

        mimeType:
          storedPreview.mimeType,

        imageData:
          outputImage.data,

        referenceImageUri:
          storedPreview.uri,
      },
      {
        status: 200,
      },
    );
  } catch (
    caughtError: unknown
  ) {
    console.error(
      "Preview-Generierung fehlgeschlagen:",
      {
        error:
          caughtError,

        aspectRatio,

        editingStyle,
      },
    );

    /*
     * Wenn Google die Bildausgabe aufgrund
     * seiner Safety-Regeln blockiert,
     * bekommt der Kunde eine verständliche
     * Meldung statt eines technischen Fehlers.
     */
    if (
      isSafetyBlocked(
        caughtError,
      )
    ) {
      return NextResponse.json(
        {
          success: false,

          code:
            "SAFETY_BLOCK",

          error:
            "Diese Vorschau konnte wegen der Sicherheitsregeln des Bildmodells nicht erstellt werden. Bitte ändere einzelne Details deiner Beschreibung und versuche es erneut.",
        },
        {
          status: 422,
        },
      );
    }

    const errorMessage =
      getErrorMessage(
        caughtError,
      );

    return NextResponse.json(
      {
        success: false,

        error:
          errorMessage,
      },
      {
        status: 500,
      },
    );
  }
}
