import type {
  ProvidedDialogueLine,
  Story,
  VideoModelId,
  VideoVoiceMode,
} from "@/types/story";

export type DialogueQualityIssueCode =
  | "missing-original-dialogue"
  | "wrong-voice-mode"
  | "voiceover-conflict"
  | "unknown-speaker"
  | "dialogue-plan-mismatch"
  | "dialogue-too-long"
  | "unsupported-dialogue-sync-model"
  | "review-required";

export type DialogueQualityIssue = {
  code: DialogueQualityIssueCode;
  message: string;
};

export type DialogueQualityReport = {
  required: boolean;
  ready: boolean;
  dialogueCount: number;
  wordCount: number;
  issues: DialogueQualityIssue[];
};

function normalizeSpeaker(
  value: string,
): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[^a-z0-9äöüß]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeProvidedLines(
  value: unknown,
): ProvidedDialogueLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((line) => {
    if (
      typeof line !== "object" ||
      line === null
    ) {
      return [];
    }

    const candidate = line as {
      speaker?: unknown;
      text?: unknown;
      pronunciation?: unknown;
    };

    if (
      typeof candidate.speaker !== "string" ||
      typeof candidate.text !== "string" ||
      !candidate.speaker.trim() ||
      !candidate.text.trim()
    ) {
      return [];
    }

    return [
      {
        speaker: candidate.speaker.trim(),
        text: candidate.text.trim(),
        ...(typeof candidate.pronunciation === "string" &&
        candidate.pronunciation.trim()
          ? {
              pronunciation:
                candidate.pronunciation.trim(),
            }
          : {}),
      },
    ];
  });
}

function collectPlanDialogue(
  story: Pick<Story, "moviePlan">,
): ProvidedDialogueLine[] {
  const sections = [
    story.moviePlan?.opening,
    ...(story.moviePlan?.continuations ?? []),
  ].filter(Boolean);

  return sections.flatMap((section) => {
    if (!section) {
      return [];
    }

    return [
      section.dialogue,
      ...(section.dialogueTurns ?? []),
    ].flatMap((dialogue) =>
      dialogue?.enabled &&
      typeof dialogue.speaker === "string" &&
      dialogue.speaker.trim() &&
      typeof dialogue.text === "string" &&
      dialogue.text.trim()
        ? [
            {
              speaker: dialogue.speaker.trim(),
              text: dialogue.text.trim(),
            },
          ]
        : [],
    );
  });
}

export function dialogueFingerprint(
  lines: readonly ProvidedDialogueLine[],
): string {
  const serialized = JSON.stringify(
    normalizeProvidedLines(lines).map((line) => [
      line.speaker,
      line.text,
      line.pronunciation ?? line.text,
    ]),
  );

  let hash = 2_166_136_261;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return `dialogue-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function hasApprovedDialogueReview(
  story: Pick<Story, "providedDialogue" | "dialogueReview">,
): boolean {
  const lines = normalizeProvidedLines(
    story.providedDialogue,
  );

  return (
    lines.length > 0 &&
    story.dialogueReview?.status === "approved" &&
    story.dialogueReview.fingerprint ===
      dialogueFingerprint(lines)
  );
}

export function approveDialogueReview<
  T extends Pick<
    Story,
    "providedDialogue" | "dialogueReview"
  >,
>(story: T): T {
  const lines = normalizeProvidedLines(
    story.providedDialogue,
  );

  if (lines.length === 0) {
    return story;
  }

  return {
    ...story,
    dialogueReview: {
      status: "approved",
      fingerprint:
        dialogueFingerprint(lines),
      approvedAt:
        new Date().toISOString(),
    },
  };
}

export function inspectDialogueQuality(
  story: Pick<
    Story,
    | "characters"
    | "providedDialogue"
    | "dialogueSourceMode"
    | "dialogueReview"
    | "moviePlan"
  >,
  options: {
    voiceMode: VideoVoiceMode;
    voiceoverText?: string;
    targetDurationSeconds: number;
    videoModel?: VideoModelId;
    requireApproval?: boolean;
  },
): DialogueQualityReport {
  const dialogue = normalizeProvidedLines(
    story.providedDialogue,
  );
  const required =
    story.dialogueSourceMode === "provided" ||
    dialogue.length > 0;
  const issues: DialogueQualityIssue[] = [];
  const wordCount = dialogue.reduce(
    (total, line) =>
      total +
      (line.pronunciation ?? line.text)
        .split(/\s+/gu)
        .filter(Boolean).length,
    0,
  );

  if (!required) {
    return {
      required: false,
      ready: true,
      dialogueCount: 0,
      wordCount: 0,
      issues: [],
    };
  }

  if (dialogue.length === 0) {
    issues.push({
      code: "missing-original-dialogue",
      message:
        "Der Modus „Originaldialog exakt“ enthält noch keinen sicher erkannten Sprechertext.",
    });
  }

  if (options.voiceMode !== "dialogue") {
    issues.push({
      code: "wrong-voice-mode",
      message:
        "Originaldialog darf nur im sichtbaren Dialogmodus gerendert werden.",
    });
  }

  if (options.voiceoverText?.trim()) {
    issues.push({
      code: "voiceover-conflict",
      message:
        "Ein Voice-over ist zusammen mit verbindlichem Originaldialog gesperrt.",
    });
  }

  if (
    options.videoModel === "google-veo" ||
    options.videoModel === "google-veo-fast"
  ) {
    issues.push({
      code: "unsupported-dialogue-sync-model",
      message:
        "Für verbindlichen Originaldialog ist ein Seedance-Modell nötig, damit die bestätigte Sprachspur direkt zur Lippensynchronisation verwendet wird.",
    });
  }

  const knownSpeakers = new Set(
    story.characters.map((character) =>
      normalizeSpeaker(character.name),
    ),
  );
  const unknownSpeaker = dialogue.find(
    (line) =>
      !knownSpeakers.has(
        normalizeSpeaker(line.speaker),
      ),
  );

  if (unknownSpeaker) {
    issues.push({
      code: "unknown-speaker",
      message: `„${unknownSpeaker.speaker}“ ist keiner sichtbaren Figur des Filmplans zugeordnet.`,
    });
  }

  const plannedDialogue = collectPlanDialogue(
    story,
  );
  const exactPlan =
    dialogue.length > 0 &&
    plannedDialogue.length === dialogue.length &&
    dialogue.every(
      (line, index) =>
        plannedDialogue[index]?.speaker ===
          line.speaker &&
        plannedDialogue[index]?.text ===
          line.text,
    );

  if (!exactPlan) {
    issues.push({
      code: "dialogue-plan-mismatch",
      message:
        "Sprecher, Reihenfolge oder Wortlaut des Filmplans stimmen nicht vollständig mit dem Originaldialog überein.",
    });
  }

  const capacity = Math.max(
    1,
    Math.floor(
      options.targetDurationSeconds * 2.6,
    ),
  );

  if (wordCount > capacity) {
    issues.push({
      code: "dialogue-too-long",
      message: `Der gesprochene Text enthält ${wordCount} Wörter; für ${options.targetDurationSeconds} Sekunden passen ungefähr ${capacity}.`,
    });
  }

  if (
    options.requireApproval !== false &&
    !hasApprovedDialogueReview(story)
  ) {
    issues.push({
      code: "review-required",
      message:
        "Dialog, Sprecher und Aussprache müssen vor Vorschau und Zahlung bestätigt werden.",
    });
  }

  return {
    required,
    ready: issues.length === 0,
    dialogueCount: dialogue.length,
    wordCount,
    issues,
  };
}
