import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { start } from "workflow/api";

import { checkRateLimit } from "@/lib/rate-limit";
import {
  isSongLanguage,
  isSongLyricsMode,
  isSongVocalStyle,
  countLyricsWords,
  customLyricsPronunciationRisks,
  maximumCustomLyricsWords,
  minimumCustomLyricsWords,
  SONG_PRICE_CENTS,
  songLengthLabel,
} from "@/lib/song";
import { songStore } from "@/lib/song-store";
import { createSongAccessToken } from "@/lib/song-access";
import { getActiveSongSubscription } from "@/lib/song-subscription";
import { reserveSubscriptionUsage } from "@/lib/song-subscription-usage";
import { stripe } from "@/lib/stripe";
import { renderSongWorkflow } from "@/workflows/render-song";
import { accountLibrary } from "@/lib/account-library";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SongCheckoutRequest = {
  title?: unknown;
  description?: unknown;
  style?: unknown;
  mood?: unknown;
  length?: unknown;
  lyricsMode?: unknown;
  lyrics?: unknown;
  language?: unknown;
  vocalStyle?: unknown;
  rightsAccepted?: unknown;
  voiceIdeaAnalysis?: unknown;
  revisionMode?: unknown;
  revisionApproach?: unknown;
  referenceRightsAccepted?: unknown;
  useSubscription?: unknown;
};

function textValue(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function missingProductionServices(): boolean {
  if (process.env.NODE_ENV === "development") return false;
  return !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN ||
    (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) ||
    !process.env.STRIPE_WEBHOOK_SECRET;
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, "song-checkout", 15, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Zu viele Bestellversuche. Bitte versuche es später erneut." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  if (missingProductionServices()) {
    return NextResponse.json(
      { error: "Die Song-Bestellung ist vorübergehend nicht verfügbar." },
      { status: 503 },
    );
  }

  let body: SongCheckoutRequest;
  try {
    body = await request.json() as SongCheckoutRequest;
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const title = textValue(body.title, 100);
  const description = textValue(body.description, 6_000);
  const style = textValue(body.style, 120);
  const mood = textValue(body.mood, 120);
  const lyrics = textValue(body.lyrics, 8_000);
  const voiceIdeaAnalysis = textValue(body.voiceIdeaAnalysis, 2_500);
  const revisionMode = body.revisionMode === true;
  const revisionApproach = body.revisionApproach === "character" || body.revisionApproach === "new-melody" || body.revisionApproach === "free"
    ? body.revisionApproach
    : undefined;
  const songLength = "full3" as const;

  if (description.length < 10 && voiceIdeaAnalysis.length < 20) {
    return NextResponse.json({ error: "Bitte beschreibe deine Songidee oder füge eine analysierte Sprachidee hinzu." }, { status: 400 });
  }
  if (!isSongLyricsMode(body.lyricsMode) ||
      !isSongLanguage(body.language) || !isSongVocalStyle(body.vocalStyle)) {
    return NextResponse.json({ error: "Bitte prüfe die Song-Einstellungen." }, { status: 400 });
  }
  if (revisionMode && (!revisionApproach || voiceIdeaAnalysis.length < 40)) {
    return NextResponse.json({ error: "Bitte lade den Ausgangssong hoch und lasse ihn zuerst analysieren." }, { status: 400 });
  }
  if (revisionMode && body.referenceRightsAccepted !== true) {
    return NextResponse.json({ error: "Bitte bestätige, dass du den hochgeladenen Song verwenden und neu bearbeiten darfst." }, { status: 400 });
  }
  if (body.lyricsMode === "custom" && lyrics.length < 10) {
    return NextResponse.json({ error: "Bitte gib deine Lyrics ein." }, { status: 400 });
  }
  if (body.lyricsMode === "custom") {
    const minimumWords = minimumCustomLyricsWords(songLength);
    const maximumWords = maximumCustomLyricsWords(songLength, style);
    const wordCount = countLyricsWords(lyrics);
    if (wordCount < minimumWords) {
      return NextResponse.json(
        { error: `Für einen vollständigen Song ist der Text zu kurz (${wordCount} von mindestens ${minimumWords} Wörtern). Ein längerer Text verhindert, dass ganze Strophen unnötig wiederholt werden.` },
        { status: 400 },
      );
    }
    if (wordCount > maximumWords) {
      return NextResponse.json(
        { error: `Für einen natürlich gesungenen Song ist der Text zu lang (${wordCount} von höchstens ${maximumWords} Wörtern). Bitte kürze ihn, damit die Wörter nicht zu schnell gesungen werden.` },
        { status: 400 },
      );
    }
    const pronunciationRisks = customLyricsPronunciationRisks(lyrics);
    if (pronunciationRisks.length > 0) {
      return NextResponse.json(
        { error: `${pronunciationRisks[0]}. Bitte schreibe Wörter ohne künstlich wiederholte Buchstaben oder lange Fülllaute.` },
        { status: 400 },
      );
    }
  }
  if (body.lyricsMode === "custom" && body.rightsAccepted !== true) {
    return NextResponse.json(
      { error: "Bitte bestätige, dass du die eingegebenen Lyrics verwenden darfst." },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const useSubscription = body.useSubscription === true;
  const subscription = useSubscription ? await getActiveSongSubscription(request).catch(() => null) : null;
  if (useSubscription && !subscription) {
    return NextResponse.json({ error: "Dein Song-Abo konnte nicht bestätigt werden. Bitte öffne die Seite nach der Abo-Aktivierung erneut." }, { status: 401 });
  }
  if (subscription) {
    const reservation = await reserveSubscriptionUsage({
      subscriptionId: subscription.subscriptionId,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
      kind: "songs",
      limit: subscription.plan.songsPerMonth,
    });
    if (!reservation.allowed) {
      return NextResponse.json({ error: "Dein monatliches Songkontingent ist aufgebraucht. Du kannst diesen Song weiterhin einzeln kaufen." }, { status: 409 });
    }
  }

  const jobId = nanoid();
  const access = subscription ? createSongAccessToken() : null;
  const now = Date.now();
  await songStore.set(jobId, {
    userId: user?.id,
    status: subscription ? "processing" : "pending",
    paymentStatus: subscription ? "paid" : "unpaid",
    renderStage: "queued",
    progressPercent: subscription ? 5 : 0,
    title: title || undefined,
    description: description || "Song nach der analysierten Sprachidee des Kunden",
    style: style || "Modern und hochwertig produziert",
    mood: mood || "Emotional und eingängig",
    length: songLength,
    lyricsMode: body.lyricsMode,
    lyrics: body.lyricsMode === "custom" ? lyrics : undefined,
    language: body.language,
    vocalStyle: body.lyricsMode === "instrumental" ? "auto" : body.vocalStyle,
    voiceIdeaAnalysis: voiceIdeaAnalysis || undefined,
    revisionMode,
    revisionApproach,
    subscriptionId: subscription?.subscriptionId,
    subscriptionPlanId: subscription?.plan.id,
    accessTokenHash: access?.hash,
    paidAt: subscription ? now : undefined,
    createdAt: now,
    updatedAt: now,
  });
  if (user) await accountLibrary.addMedia(user.id, { kind: "song", jobId, title: title || "KI-Song", createdAt: now });

  const appUrl =
  process.env.APP_URL?.trim() ||
  request.nextUrl.origin;
  try {
    if (subscription && access) {
      const claimed = await songStore.claimWorkflowStart(jobId, `subscription:${subscription.subscriptionId}`);
      if (!claimed) throw new Error("Der Songstart konnte nicht reserviert werden.");
      const run = await start(renderSongWorkflow, [jobId]);
      await songStore.confirmWorkflowStarted(jobId, run.runId);
      await songStore.update(jobId, (current) => ({ ...current, workflowRunId: run.runId }));
      return NextResponse.json({
        url: `${appUrl}/song-success?jobId=${encodeURIComponent(jobId)}&access_token=${encodeURIComponent(access.token)}`,
        jobId,
        included: true,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allow_promotion_codes: true,
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `${revisionMode ? "Song-Neuinterpretation" : "KI-Song"} · ${songLengthLabel(songLength)} · MP3`,
            description: revisionMode
              ? "Neue Originalversion nach der analysierten Klangidee deines Songs"
              : body.lyricsMode === "instrumental"
              ? "Originaler Instrumental-Song ohne Video"
              : body.lyricsMode === "custom"
                ? "Originaler KI-Song mit deinen Lyrics"
                : "Originaler KI-Song mit neu geschriebenen Lyrics",
          },
          unit_amount: SONG_PRICE_CENTS[songLength],
        },
        quantity: 1,
      }],
      metadata: {
        productType: "song",
        jobId,
        userId: user?.id || "",
        songLength,
        lyricsMode: body.lyricsMode,
        language: body.language,
        vocalStyle: body.lyricsMode === "instrumental" ? "auto" : body.vocalStyle,
      },
      success_url: `${appUrl}/song-success?jobId=${encodeURIComponent(jobId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/songs?canceled=1`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe hat keine Checkout-Adresse zurückgegeben." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url, jobId });
  } catch (error) {
    console.error("Song-Checkout konnte nicht erstellt werden:", error);
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "development" && error instanceof Error
          ? error.message
          : "Der sichere Song-Checkout konnte nicht geöffnet werden. Bitte versuche es erneut.",
      },
      { status: 500 },
    );
  }
}
