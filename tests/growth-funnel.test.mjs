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

test("real-user performance monitoring is enabled", async () => {
  const layout = await readSource("../app/layout.tsx");

  assert.match(layout, /@vercel\/speed-insights\/next/);
  assert.match(layout, /<SpeedInsights \/>/);
});
