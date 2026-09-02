type ProvidedPronunciationLine = {
  speaker: string;
  text: string;
  pronunciation?: string;
};

function asRecord(
  value: unknown,
): Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readProvidedPronunciationLines(
  value: unknown,
): ProvidedPronunciationLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .map((line) => ({
      speaker:
        typeof line.speaker === "string"
          ? line.speaker.trim()
          : "",
      text:
        typeof line.text === "string"
          ? line.text.trim()
          : "",
      pronunciation:
        typeof line.pronunciation === "string"
          ? line.pronunciation.trim()
          : undefined,
    }))
    .filter(
      (line) =>
        Boolean(line.speaker) &&
        Boolean(line.text),
    );
}

export function applyProvidedDialoguePronunciations<
  Cue extends {
    speaker: string;
    text: string;
  },
>(
  cues: readonly Cue[],
  providedDialogue: unknown,
): Cue[] {
  const lines =
    readProvidedPronunciationLines(
      providedDialogue,
    );

  if (lines.length === 0) {
    return [...cues];
  }

  let lineIndex = 0;

  return cues.map((cue) => {
    const normalizedSpeaker =
      cue.speaker
        .trim()
        .toLocaleLowerCase("de-DE");

    const matchingIndex =
      lines.findIndex(
        (line, index) =>
          index >= lineIndex &&
          line.text === cue.text.trim() &&
          line.speaker
            .toLocaleLowerCase("de-DE") ===
            normalizedSpeaker,
      );

    if (matchingIndex < 0) {
      return cue;
    }

    const line = lines[matchingIndex];
    lineIndex = matchingIndex + 1;

    return {
      ...cue,
      text:
        line.pronunciation ||
        cue.text,
    };
  });
}

export function buildProvidedPronunciationDirection(
  providedDialogue: unknown,
): string {
  const overrides =
    readProvidedPronunciationLines(
      providedDialogue,
    ).filter(
      (line) =>
        Boolean(line.pronunciation) &&
        line.pronunciation !== line.text,
    );

  if (overrides.length === 0) {
    return "";
  }

  return [
    "MANDATORY GERMAN PRONUNCIATION GUIDE: Keep the written dialogue semantically unchanged. Speak each original line using the supplied pronunciation aid; the aid is phonetic guidance, not extra dialogue.",
    ...overrides.map(
      (line, index) =>
        `${index + 1}. ${line.speaker}: written \"${line.text}\"; pronounce as \"${line.pronunciation ?? line.text}\".`,
    ),
  ].join("\n");
}
