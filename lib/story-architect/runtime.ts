export const STORY_ARCHITECT_DEADLINE_MS = 52_000;
export const STORY_ARCHITECT_MODEL_TIMEOUT_MS = 18_000;
export const STORY_ARCHITECT_MIN_ATTEMPT_MS = 4_000;

export class StoryArchitectDeadlineError extends Error {
  readonly status = 504;
  readonly code = "STORY_ARCHITECT_DEADLINE";

  constructor() {
    super(
      "Der Story Architect hat sein Zeitbudget ausgeschöpft.",
    );
    this.name = "StoryArchitectDeadlineError";
  }
}

export function getStoryArchitectAttemptTimeout(
  startedAt: number,
  now = Date.now(),
): number | null {
  const remaining =
    STORY_ARCHITECT_DEADLINE_MS -
    Math.max(0, now - startedAt);

  if (remaining < STORY_ARCHITECT_MIN_ATTEMPT_MS) {
    return null;
  }

  return Math.min(
    STORY_ARCHITECT_MODEL_TIMEOUT_MS,
    Math.max(
      STORY_ARCHITECT_MIN_ATTEMPT_MS,
      remaining - 750,
    ),
  );
}

export function clampStoryArchitectRetryDelay(
  requestedDelayMs: number,
  startedAt: number,
  now = Date.now(),
): number {
  const remaining =
    STORY_ARCHITECT_DEADLINE_MS -
    Math.max(0, now - startedAt);

  return Math.max(
    0,
    Math.min(
      requestedDelayMs,
      remaining - STORY_ARCHITECT_MIN_ATTEMPT_MS,
    ),
  );
}
