import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStoryArchitectJson,
  parseStoryArchitectRequest,
  STORY_ARCHITECT_RESPONSE_JSON_SCHEMA,
} from "../lib/story-architect/schema.ts";
import {
  clampStoryArchitectRetryDelay,
  getStoryArchitectAttemptTimeout,
  STORY_ARCHITECT_DEADLINE_MS,
  STORY_ARCHITECT_MODEL_TIMEOUT_MS,
} from "../lib/story-architect/runtime.ts";

const validRequest = {
  story: {
    title: "Testfilm",
    genre: "Drama",
    mood: "Spannend",
    setting: "Wohnzimmer",
    summary: "Eine klare, ausführbare Handlung.",
    characters: [
      {
        id: "person-1",
        name: "Mira",
        description: "Eine Frau mit roter Jacke.",
      },
    ],
  },
  targetDurationSeconds: 30,
  aspectRatio: "9:16",
  editingStyle: "social",
  voiceMode: "dialogue",
  speechContentMode: "generate",
};

test("accepts a bounded, supported story request", () => {
  const result = parseStoryArchitectRequest(validRequest);

  assert.equal(result.success, true);
  assert.equal(
    result.success && result.data.story.title,
    "Testfilm",
  );
});

test("accepts a boolean speechDisabled flag and rejects non-boolean values", () => {
  const accepted = parseStoryArchitectRequest({
    ...validRequest,
    story: {
      ...validRequest.story,
      speechDisabled: true,
    },
  });

  assert.equal(accepted.success, true);

  const rejected = parseStoryArchitectRequest({
    ...validRequest,
    story: {
      ...validRequest.story,
      speechDisabled: "true",
    },
  });

  assert.equal(rejected.success, false);
  assert.ok(
    !rejected.success &&
      rejected.issues.some(
        (issue) => issue.path === "story.speechDisabled",
      ),
  );
});

test("rejects unsupported enums and oversized story input with paths", () => {
  const result = parseStoryArchitectRequest({
    ...validRequest,
    aspectRatio: "1:1",
    story: {
      ...validRequest.story,
      summary: "x".repeat(12_001),
    },
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success
      ? []
      : result.issues.map((issue) => issue.path),
    ["story.summary", "aspectRatio"],
  );
});

test("extracts the first balanced JSON object and preserves braces in strings", () => {
  const result = parseStoryArchitectJson(
    'Vorwort ```json\n{"productionBible":{},"moviePlan":{"note":"look } here",},}\n``` Nachwort {"ignored":true}',
  );

  assert.deepEqual(result?.parsed, {
    productionBible: {},
    moviePlan: {
      note: "look } here",
    },
  });
});

test("rejects truncated JSON instead of guessing a plan", () => {
  assert.equal(
    parseStoryArchitectJson(
      '{"productionBible": {}, "moviePlan": {',
    ),
    null,
  );
});

test("publishes a top-level response contract for both required sections", () => {
  assert.deepEqual(
    STORY_ARCHITECT_RESPONSE_JSON_SCHEMA.required,
    ["productionBible", "moviePlan"],
  );
});

test("model attempts stay inside the route deadline", () => {
  const startedAt = 1_000;

  assert.equal(
    getStoryArchitectAttemptTimeout(startedAt, startedAt),
    STORY_ARCHITECT_MODEL_TIMEOUT_MS,
  );
  assert.equal(
    getStoryArchitectAttemptTimeout(
      startedAt,
      startedAt + STORY_ARCHITECT_DEADLINE_MS,
    ),
    null,
  );
  assert.equal(
    clampStoryArchitectRetryDelay(
      10_000,
      startedAt,
      startedAt + STORY_ARCHITECT_DEADLINE_MS - 5_000,
    ),
    1_000,
  );
});
