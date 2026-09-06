import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProviderFailure,
} from "../lib/video-providers/failures.ts";
import {
  findProviderFallback,
  routeVideoProviders,
} from "../lib/video-providers/model-router.ts";
import {
  assertQualityGatePassed,
  evaluateFinalOutput,
  evaluateProviderOutput,
  evaluateShotPreflight,
} from "../lib/video-providers/quality-gates.ts";
import {
  buildFinalVideoDurationFilters,
  planFinalOutputDuration,
} from "../lib/video-backend/final-duration.ts";

const requiredReferenceRoute = {
  requestedModel: "seedance-2-fast",
  operation: "opening",
  referencePolicy: "required",
  referenceCount: 1,
  allowFallback: true,
  availableProviders: {
    seedance: true,
    veo: true,
    runway: false,
  },
};

test("routes Seedance first and Veo second while retaining one required reference", () => {
  const routes = routeVideoProviders(
    requiredReferenceRoute,
  );

  assert.deepEqual(
    routes.map((route) => [
      route.provider,
      route.role,
      route.modelId,
    ]),
    [
      ["seedance", "primary", "seedance-2-fast"],
      ["veo", "fallback", "google-veo-fast"],
    ],
  );
});

test("does not route a required-reference shot when no reference was loaded", () => {
  const routes = routeVideoProviders({
    ...requiredReferenceRoute,
    referenceCount: 0,
  });

  assert.deepEqual(routes, []);
});

test("does not silently use Runway before its gateway is enabled", () => {
  const fallback = findProviderFallback(
    {
      ...requiredReferenceRoute,
      availableProviders: {
        seedance: true,
        veo: false,
        runway: false,
      },
    },
    "seedance",
  );

  assert.equal(fallback, null);
});

test("classifies a Seedance start-image rejection as fallback-safe", () => {
  const failure = classifyProviderFailure(
    "seedance",
    "opening",
    new Error(
      "Seedance hat das notwendige Startbild abgelehnt.",
    ),
  );

  assert.equal(failure.category, "reference-rejected");
  assert.equal(failure.retryable, false);
  assert.equal(failure.fallbackAllowed, true);
});

test("does not classify a general content-policy block as fallback-safe", () => {
  const failure = classifyProviderFailure(
    "seedance",
    "opening",
    new Error("Blocked by content policy."),
  );

  assert.equal(failure.category, "content-policy");
  assert.equal(failure.fallbackAllowed, false);
});

test("fails preflight when a mandatory reference disappeared", () => {
  const gate = evaluateShotPreflight({
    shotId: "chapter-1-opening",
    provider: "seedance",
    operation: "opening",
    prompt: "A sufficiently detailed production prompt for the shot.",
    durationSeconds: 15,
    referencePolicy: "required",
    referenceCount: 0,
    maximumReferences: 9,
  });

  assert.equal(gate.status, "failed");
  assert.equal(
    gate.checks.find(
      (check) => check.name === "required-reference",
    )?.passed,
    false,
  );
});

test("accepts a valid provider URL and rejects a fabricated value", () => {
  assert.equal(
    evaluateProviderOutput({
      shotId: "chapter-1-opening",
      provider: "veo",
      operation: "opening",
      videoUri: "https://example.test/video.mp4",
    }).status,
    "passed",
  );
  assert.equal(
    evaluateProviderOutput({
      shotId: "chapter-1-opening",
      provider: "veo",
      operation: "opening",
      videoUri: "not-a-video-uri",
    }).status,
    "failed",
  );
});

test("final output gate enforces MP4 storage and target duration", () => {
  assert.equal(
    evaluateFinalOutput({
      shotId: "final-output",
      pathname: "finished-videos/job.mp4",
      expectedDurationSeconds: 30,
      actualDurationSeconds: 30.08,
    }).status,
    "passed",
  );
  assert.equal(
    evaluateFinalOutput({
      shotId: "final-output",
      pathname: "finished-videos/job.mp4",
      expectedDurationSeconds: 30,
      actualDurationSeconds: 27,
    }).status,
    "failed",
  );
});

test("a 60-second music render finishes at the exact inspected song duration", () => {
  const durationPlan =
    planFinalOutputDuration(
      60,
      58.42,
    );

  assert.deepEqual(
    durationPlan,
    {
      renderTargetDurationSeconds: 60,
      outputTargetDurationSeconds: 58.42,
      source: "music-track",
    },
  );

  assert.equal(
    evaluateFinalOutput({
      shotId: "final-output",
      pathname: "finished-videos/music-video.mp4",
      expectedDurationSeconds:
        durationPlan.outputTargetDurationSeconds,
      actualDurationSeconds: 58.44,
    }).status,
    "passed",
  );

  assert.equal(
    evaluateFinalOutput({
      shotId: "final-output",
      pathname: "finished-videos/music-video.mp4",
      expectedDurationSeconds:
        durationPlan.outputTargetDurationSeconds,
      actualDurationSeconds: 60,
    }).status,
    "failed",
  );
});

test("non-music renders keep their booked duration as the final target", () => {
  assert.deepEqual(
    planFinalOutputDuration(60),
    {
      renderTargetDurationSeconds: 60,
      outputTargetDurationSeconds: 60,
      source: "render-target",
    },
  );
});

test("final video timing pads short footage and trims long footage", () => {
  assert.deepEqual(
    buildFinalVideoDurationFilters(
      58.4,
      60,
    ),
    [
      "tpad=stop_mode=clone:stop_duration=1.633333",
      "trim=duration=60",
      "setpts=PTS-STARTPTS",
      "format=yuv420p",
    ],
  );

  assert.deepEqual(
    buildFinalVideoDurationFilters(
      61.2,
      60,
    ),
    [
      "tpad=stop_mode=clone:stop_duration=0.033333",
      "trim=duration=60",
      "setpts=PTS-STARTPTS",
      "format=yuv420p",
    ],
  );

  assert.throws(
    () =>
      buildFinalVideoDurationFilters(
        57.9,
        60,
      ),
    /Rohvideo.*zu kurz/u,
  );
});

test("final duration planning rejects invalid media durations", () => {
  assert.throws(
    () =>
      planFinalOutputDuration(
        60,
        Number.NaN,
      ),
    /Song-Laufzeit/u,
  );

  assert.throws(
    () =>
      planFinalOutputDuration(0),
    /Ziel-Laufzeit/u,
  );
});

test("a failed final gate reports expected, actual and allowed duration drift", () => {
  const gate =
    evaluateFinalOutput({
      shotId: "final-output",
      pathname: "finished-videos/job.mp4",
      expectedDurationSeconds: 60,
      actualDurationSeconds: 57,
    });

  assert.throws(
    () =>
      assertQualityGatePassed(
        gate,
      ),
    /duration \(Soll 60\.000s, ist 57\.000s; Abweichung 3\.000s \(erlaubt ±0\.750s\)\.\)/u,
  );
});
