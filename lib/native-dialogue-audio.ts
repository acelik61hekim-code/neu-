export type NativeDialogueAudioCue = {
  startSeconds: number;
  maximumDurationSeconds: number;
  speaker: string;
  text: string;
  voiceName: string;
  voiceDirection: string;
};

function roundTiming(
  value: number,
): number {
  return Math.round(value * 1_000) / 1_000;
}

function estimateSpokenSeconds(
  text: string,
): number {
  const normalized = text
    .trim()
    .replace(/\s+/gu, " ");

  const wordCount = normalized
    .split(/\s+/gu)
    .filter(Boolean).length;

  const spokenCharacterCount = normalized
    .replace(/[^\p{L}\p{N}]/gu, "")
    .length;

  const pauseCount = (
    normalized.match(/[,.!?;:…]/gu) ?? []
  ).length;

  return Math.max(
    1.05,
    wordCount / 2.45,
    spokenCharacterCount / 14.5,
  ) + Math.min(0.45, pauseCount * 0.08);
}

/**
 * Reserves dialogue windows according to the amount of speech in each line.
 * The old equal split gave a two-word reaction and a long sentence the same
 * time budget, which forced the long line to be unnaturally accelerated.
 */
export function scheduleDialogueCuesWithinWindow<
  Cue extends NativeDialogueAudioCue,
>(
  cues: readonly Cue[],
  windowStartSeconds: number,
  windowEndSeconds: number,
): Cue[] {
  if (cues.length === 0) {
    return [];
  }

  const safeStart = Math.max(0, windowStartSeconds);
  const safeEnd = Math.max(safeStart + 1, windowEndSeconds);
  const availableSeconds = safeEnd - safeStart;
  const gapSeconds =
    cues.length > 1
      ? Math.min(
          0.22,
          Math.max(
            0.08,
            availableSeconds * 0.018,
          ),
        )
      : 0;
  const speechSeconds = Math.max(
    0.5,
    availableSeconds - gapSeconds * (cues.length - 1),
  );
  const minimumWindowSeconds = Math.min(
    1.1,
    speechSeconds / cues.length,
  );
  const weights = cues.map((cue) =>
    estimateSpokenSeconds(cue.text),
  );
  const weightTotal = weights.reduce(
    (total, weight) => total + weight,
    0,
  );
  const flexibleSeconds = Math.max(
    0,
    speechSeconds - minimumWindowSeconds * cues.length,
  );

  let nextStartSeconds = safeStart;

  return cues.map((cue, index) => {
    const unboundedDuration =
      minimumWindowSeconds +
      flexibleSeconds * (weights[index] / weightTotal);
    const remainingSeconds = Math.max(
      0.25,
      safeEnd - nextStartSeconds,
    );
    const maximumDurationSeconds = Math.min(
      11.5,
      remainingSeconds,
      unboundedDuration,
    );
    const scheduled = {
      ...cue,
      startSeconds: roundTiming(nextStartSeconds),
      maximumDurationSeconds: roundTiming(
        maximumDurationSeconds,
      ),
    };

    nextStartSeconds +=
      maximumDurationSeconds + gapSeconds;

    return scheduled;
  });
}

export function buildNativeDialogueAudioInstruction(
  audioNumber = 1,
): string {
  return [
    `@Audio${audioNumber} is the exact finished dialogue track for this clip.`,
    "Use its exact German words, voices, pauses, timing and pronunciation, and synchronize the visible assigned speakers' lips precisely to it.",
    `Start @Audio${audioNumber} at clip time 00.000 without offset, trimming, looping, time-stretching or rerecording.`,
    "Move a speaker's lips only while that speaker is audibly speaking in the reference track; every other visible mouth stays closed.",
    "Do not replace, rerecord, paraphrase, translate or add spoken words.",
  ].join(" ");
}

export function buildNativeDialogueTimelineInstruction(
  cues: readonly NativeDialogueAudioCue[],
  clipDurationSeconds: number,
): string {
  if (cues.length === 0) {
    return [
      "AUDIO-LOCKED PERFORMANCE TIMELINE:",
      "This clip contains no speech event. Keep every visible mouth closed for the entire clip.",
    ].join("\n");
  }

  return [
    "AUDIO-LOCKED PERFORMANCE TIMELINE (times are local to this clip and @Audio1):",
    ...cues.map((cue, index) => {
      const startSeconds = Math.max(0, cue.startSeconds);
      const endSeconds = Math.min(
        clipDurationSeconds,
        startSeconds + cue.maximumDurationSeconds,
      );

      return `${index + 1}. ${startSeconds.toFixed(2)}s-${endSeconds.toFixed(2)}s: ${cue.speaker} is the only active speaker; follow the actual audible onset and ending inside this window.`;
    }),
    "During every audible word, hold an uninterrupted frontal or three-quarter medium close-up of the active speaker with the full mouth clearly visible.",
    "Do not cut away, change speaker, turn the face away, cover the mouth or add large camera motion during speech. Use reaction shots and faster cuts only in audible pauses.",
    "Outside the listed audible speech, every mouth remains naturally closed. Never create filler mouth movement.",
  ].join("\n");
}

export function partitionDialogueCuesForAudioReference<
  Cue extends NativeDialogueAudioCue,
>(
  cues: readonly Cue[],
  targetDurationSeconds: number,
  clipDurationSeconds = 15,
): Cue[][] {
  const clipCount =
    Math.ceil(
      targetDurationSeconds /
        clipDurationSeconds,
    );

  return Array.from(
    {
      length:
        clipCount,
    },
    (_, clipIndex) => {
      const clipStartSeconds =
        clipIndex *
        clipDurationSeconds;

      const actualClipDurationSeconds =
        Math.min(
          clipDurationSeconds,
          targetDurationSeconds -
            clipStartSeconds,
        );

      return cues
        .filter(
          (cue) =>
            cue.startSeconds >=
              clipStartSeconds &&
            cue.startSeconds <
              clipStartSeconds +
                actualClipDurationSeconds,
        )
        .map(
          (cue) => ({
            ...cue,
            startSeconds:
              cue.startSeconds -
              clipStartSeconds,
          }),
        );
    },
  );
}
