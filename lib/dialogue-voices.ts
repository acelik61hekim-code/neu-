import {
  VIRAL_CHARACTERS,
} from "@/lib/viral-characters";

export const DIALOGUE_VOICES = [
  "Kore",
  "Puck",
  "Aoede",
  "Charon",
  "Orus",
  "Leda",
  "Fenrir",
  "Zephyr",
] as const;

export type DialogueVoiceName =
  (typeof DIALOGUE_VOICES)[number];

export function assignDialogueVoice(
  speaker: string,
  assignments: Map<string, string>,
): string {
  const normalized =
    speaker
      .trim()
      .toLocaleLowerCase("de-DE");

  const existing =
    assignments.get(normalized);

  if (existing) {
    return existing;
  }

  const character =
    VIRAL_CHARACTERS.find(
      (candidate) =>
        candidate.name
          .toLocaleLowerCase("de-DE") ===
          normalized ||
        candidate.shortName
          .toLocaleLowerCase("de-DE") ===
          normalized,
    );

  if (character) {
    assignments.set(
      normalized,
      character.voiceName,
    );

    return character.voiceName;
  }

  const usedVoices =
    new Set(assignments.values());
  const unusedVoice =
    DIALOGUE_VOICES.find(
      (voice) =>
        !usedVoices.has(voice),
    );
  const hash = [...normalized].reduce(
    (sum, characterValue) =>
      sum + characterValue.charCodeAt(0),
    0,
  );
  const voiceName =
    unusedVoice ??
    DIALOGUE_VOICES[
      hash % DIALOGUE_VOICES.length
    ];

  assignments.set(
    normalized,
    voiceName,
  );

  return voiceName;
}

export function dialogueVoiceForSpeaker(
  speaker: string,
  orderedSpeakers: readonly string[],
): string {
  const assignments =
    new Map<string, string>();

  for (const currentSpeaker of orderedSpeakers) {
    const voice = assignDialogueVoice(
      currentSpeaker,
      assignments,
    );

    if (
      currentSpeaker.trim().toLocaleLowerCase("de-DE") ===
      speaker.trim().toLocaleLowerCase("de-DE")
    ) {
      return voice;
    }
  }

  return assignDialogueVoice(
    speaker,
    assignments,
  );
}
