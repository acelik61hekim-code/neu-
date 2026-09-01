export type NativeDialogueAudioCue = {
  startSeconds: number;
  maximumDurationSeconds: number;
  speaker: string;
  text: string;
  voiceName: string;
  voiceDirection: string;
};

export function buildNativeDialogueAudioInstruction(
  audioNumber = 1,
): string {
  return [
    `@Audio${audioNumber} is the exact finished dialogue track for this clip.`,
    "Use its exact German words, voices, pauses, timing and pronunciation, and synchronize the visible assigned speakers' lips precisely to it.",
    "Do not replace, rerecord, paraphrase, translate or add spoken words.",
  ].join(" ");
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
