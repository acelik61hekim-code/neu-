import type {
  VideoEditingStyle,
} from "@/types/story";

type InternalShotPlanOptions = {
  prompt: string;
  durationSeconds: number;
  editingStyle?: VideoEditingStyle | string;
  intentText: string;
  narrativeCues: readonly string[];
  sectionLabel: string;
};

const RAPID_CUT_INTENT =
  /\b(?:schnell(?:e|en|er|es)?\s+(?:szenenwechsel|schnitte?|bildwechsel)|rasch(?:e|en|er|es)?\s+(?:szenenwechsel|schnitte?|bildwechsel)|harte?\s+schnitte?|jump\s*cuts?|fast(?:-paced)?\s+(?:scene\s+changes?|cuts?|editing)|quick\s+cuts?|rapid\s+(?:scene\s+changes?|cuts?|editing)|dynamic\s+montage|speed\s+montage)\b/i;

const compact = (
  value: string,
): string =>
  value
    .replace(/\s+/g, " ")
    .trim();

const compactCue = (
  value: string | undefined,
): string =>
  compact(value ?? "")
    .slice(0, 420);

export function hasRapidSceneChangeIntent(
  value: string,
): boolean {
  return RAPID_CUT_INTENT.test(
    compact(value),
  );
}

function countExistingTimedShots(
  prompt: string,
): number {
  const shotLabels =
    prompt.match(
      /\bshot\s*\d+\b/gi,
    ) ?? [];

  const timedWindows =
    prompt.match(
      /\b\d+(?:[.,]\d+)?\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?\s*(?:s|sec(?:ond)?s?)\b/gi,
    ) ?? [];

  return Math.max(
    new Set(
      shotLabels.map(
        (value) =>
          value.toLowerCase(),
      ),
    ).size,
    timedWindows.length,
  );
}

function requiredShotCount(
  durationSeconds: number,
  editingStyle: string | undefined,
  rapidSceneChanges: boolean,
): number {
  if (
    durationSeconds < 4
  ) {
    return 1;
  }

  if (
    rapidSceneChanges
  ) {
    return durationSeconds >= 15
      ? 5
      : 4;
  }

  if (
    editingStyle === "social" ||
    editingStyle === "music-video"
  ) {
    return durationSeconds >= 15
      ? 4
      : 3;
  }

  return 1;
}

function formatSecond(
  value: number,
): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1);
}

function buildShotWindows(
  durationSeconds: number,
  shotCount: number,
): Array<{
  start: number;
  end: number;
}> {
  return Array.from(
    {
      length: shotCount,
    },
    (_, index) => ({
      start:
        index *
        durationSeconds /
        shotCount,
      end:
        (index + 1) *
        durationSeconds /
        shotCount,
    }),
  );
}

function cueAt(
  cues: readonly string[],
  index: number,
): string {
  const normalized =
    cues
      .map(compactCue)
      .filter(Boolean);

  if (
    normalized.length === 0
  ) {
    return "Advance the established action with new visible story information.";
  }

  return normalized[
    Math.min(
      index,
      normalized.length - 1,
    )
  ];
}

/**
 * Seedance receives 15-second provider clips even when the customer orders a
 * longer film. A request for fast scene changes must therefore be translated
 * into an explicit, clip-local edit map. Otherwise the model often interprets
 * "fast" as camera movement inside one long pose or location.
 */
export function ensureTimedInternalShotPlan(
  options: InternalShotPlanOptions,
): string {
  const prompt =
    options.prompt.trim();

  const rapidSceneChanges =
    hasRapidSceneChangeIntent(
      [
        options.intentText,
        prompt,
      ].join(" "),
    );

  const shotCount =
    requiredShotCount(
      options.durationSeconds,
      options.editingStyle,
      rapidSceneChanges,
    );

  if (
    shotCount <= 1 ||
    countExistingTimedShots(
      prompt,
    ) >= shotCount
  ) {
    return prompt;
  }

  const shotPurposes = [
    "Immediate visual hook; begin in the middle of the action",
    "A visibly different coverage angle and the next physical action",
    "A new consequence, obstacle, discovery or reaction",
    "A decisive escalation with changed blocking and visual information",
    "A clear payoff, reveal or strong handoff into the next clip",
  ] as const;

  const shotLines =
    buildShotWindows(
      options.durationSeconds,
      shotCount,
    ).map(
      (window, index) =>
        `SHOT ${index + 1} (${formatSecond(window.start)}-${formatSecond(window.end)} seconds): ${shotPurposes[index] ?? shotPurposes[shotPurposes.length - 1]}. Narrative requirement: ${cueAt(options.narrativeCues, index)}`,
    );

  return [
    prompt,
    "",
    `MANDATORY INTERNAL EDIT MAP FOR ${options.sectionLabel.toUpperCase()} — ${shotCount} DISTINCT EDITORIAL SHOTS INSIDE THIS ${formatSecond(options.durationSeconds)}-SECOND CLIP:`,
    ...shotLines,
    "These are separate editorial shots, not one continuous take and not merely small reframings of static poses.",
    "Cut at every listed time boundary with a motivated hard cut, match cut, whip cut or action cut.",
    "Every new shot must introduce visibly new action or story information and change at least two of these: framing, camera position, subject blocking, object interaction, location zone or dramatic objective.",
    "Do not leave the characters standing or posing in the same composition. Do not repeat an earlier shot.",
    "Preserve the same character identities, wardrobe, props, world geography, lighting logic and cause-and-effect across all cuts.",
  ]
    .filter(Boolean)
    .join("\n");
}
