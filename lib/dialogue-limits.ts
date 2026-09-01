export const MAX_DIALOGUE_TURNS_PER_SECTION =
  16;

export const EXACT_DIALOGUE_WORDS_PER_SECOND =
  2.6;

export function getExactDialogueWordCapacity(
  durationSeconds: number,
): number {
  return Math.max(
    12,
    Math.floor(
      durationSeconds *
        EXACT_DIALOGUE_WORDS_PER_SECOND,
    ),
  );
}
