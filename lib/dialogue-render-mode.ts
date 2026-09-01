export function promptHasProvidedDialogue(
  prompt: string,
): boolean {
  try {
    const story =
      JSON.parse(
        prompt,
      ) as {
        providedDialogue?:
          Array<{
            speaker?: unknown;
            text?: unknown;
          }>;
      };

    return (
      Array.isArray(
        story.providedDialogue,
      ) &&
      story.providedDialogue.some(
        (line) =>
          typeof line?.speaker ===
            "string" &&
          line.speaker.trim().length >
            0 &&
          typeof line.text ===
            "string" &&
          line.text.trim().length >
            0,
      )
    );
  } catch {
    return false;
  }
}

export function shouldUseNativeCharacterDialogue(
  voiceMode: unknown,
  nativeCharacterDialogue: unknown,
): boolean {
  return (
    voiceMode === "dialogue" &&
    nativeCharacterDialogue === true
  );
}

export function shouldUsePostProducedDialogue(
  creationMode: unknown,
  voiceMode: unknown,
  nativeCharacterDialogue: unknown,
): boolean {
  return (
    creationMode !== "viral-story" &&
    voiceMode === "dialogue" &&
    nativeCharacterDialogue !== true
  );
}
