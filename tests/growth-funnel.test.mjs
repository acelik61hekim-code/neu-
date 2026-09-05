import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("the public homepage is a focused landing page instead of the full studio", async () => {
  const homepage = await readSource("../app/page.tsx");
  const landingPage = await readSource("../components/VideoLandingPage.tsx");

  assert.match(homepage, /VideoLandingPage/);
  assert.doesNotMatch(homepage, /StudioHome/);
  assert.match(landingPage, /Deine Idee wird ein Video/);
  assert.match(landingPage, /\/ki-video-erstellen#ai-director/);
  assert.match(landingPage, /Vorschau kostenlos/);
  assert.match(landingPage, /Wörtlich übernommener Sprechertext/);
  assert.match(landingPage, /Unbearbeitete visuelle Modellclips/);
  assert.match(landingPage, /keine Dialog- oder Lipsync-Qualität/);
  assert.equal(
    landingPage.match(/\/viral-templates\/[^"']+\.mp4/g)?.length,
    7,
  );
});

test("the studio starts with the AI Director while advanced settings stay optional", async () => {
  const studio = await readSource("../components/StudioHome.tsx");

  assert.match(studio, /<details id="project-settings"/);
  assert.doesNotMatch(studio, /<details id="project-settings"[^>]*\sopen(?:=|\s|>)/);
  assert.match(studio, /<section id="ai-director"/);
  assert.match(studio, /Standardmäßig für ein vertikales Social-Video vorbereitet/);
});

test("the measurable video funnel covers the decisive conversion stages", async () => {
  const studio = await readSource("../components/StudioHome.tsx");
  const checkout = await readSource("../app/api/confirm-checkout/route.ts");
  const workflow = await readSource("../workflows/render-video.ts");

  for (const event of [
    "video_story_ready",
    "video_preview_started",
    "video_preview_ready",
    "video_preview_failed",
    "video_checkout_started",
    "video_checkout_ready",
  ]) {
    assert.match(studio, new RegExp(event));
  }

  assert.match(checkout, /video_payment_confirmed/);
  assert.match(workflow, /video_render_completed/);
  assert.match(workflow, /video_render_failed/);

  const completionStep = workflow.indexOf("async function finishRenderJobStep");
  const completionEvent = workflow.indexOf('msg: "video_render_completed"');
  const disabledStep = workflow.indexOf("async function markRenderDisabledStep");

  assert.equal(workflow.match(/msg: "video_render_completed"/g)?.length, 1);
  assert.ok(completionEvent > completionStep);
  assert.ok(completionEvent > disabledStep);
});

test("exact dialogue keeps its audio-locked sync path during render and recovery", async () => {
  const workflow = await readSource("../workflows/render-video.ts");
  const recovery = await readSource("../app/api/recover-video/route.ts");
  const media = await readSource("../lib/video-backend/media.ts");

  assert.match(workflow, /Prepared audio-locked dialogue timeline/);
  assert.match(workflow, /buildNativeDialogueTimelineInstruction/);
  assert.match(workflow, /audio-reference-v2/);
  assert.match(recovery, /!exactProvidedDialogue/);
  assert.match(media, /dialogue_reference_finishing_verified/);
  assert.match(media, /Eine unsynchronisierte Ausgabe wurde verhindert/);
});

test("real-user performance monitoring is enabled", async () => {
  const layout = await readSource("../app/layout.tsx");

  assert.match(layout, /@vercel\/speed-insights\/next/);
  assert.match(layout, /<SpeedInsights \/>/);
});

test("exact dialogue is reviewed without pre-generated audio and server-gated before payment and render", async () => {
  const studio = await readSource("../components/StudioHome.tsx");
  const review = await readSource("../components/DialogueReview.tsx");
  const checkout = await readSource("../app/api/create-checkout-session/route.ts");
  const workflow = await readSource("../workflows/render-video.ts");

  assert.match(studio, /<DialogueReview/);
  assert.doesNotMatch(review, /dialogue-speech-preview/);
  assert.doesNotMatch(review, /Aussprache anhören/);
  assert.doesNotMatch(review, /<audio/);
  assert.match(review, /Originaldialog bestätigen/);
  assert.match(checkout, /inspectDialogueQuality/);
  assert.match(workflow, /Render blocked by exact-dialogue quality gate/);
  assert.match(workflow, /applyProvidedDialoguePronunciations/);
});
