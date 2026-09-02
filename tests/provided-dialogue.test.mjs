import assert from "node:assert/strict";
import test from "node:test";

import {
  inferPromptSpeechIntent,
} from "../lib/audio-options.ts";
import {
  countExplicitDialogueBlocks,
  countExplicitDialogueEvents,
  countExplicitMultilineDialogueBlocks,
  extractProvidedDialogue,
  shouldBlockAutomaticDialogueReplacement,
  splitProvidedDialogueText,
} from "../lib/provided-dialogue.ts";
import {
  getExactDialogueWordCapacity,
  MAX_DIALOGUE_TURNS_PER_SECTION,
} from "../lib/dialogue-limits.ts";
import {
  promptHasProvidedDialogue,
  resolveProvidedDialogueVoiceMode,
  shouldUseNativeCharacterDialogue,
  shouldUsePostProducedDialogue,
} from "../lib/dialogue-render-mode.ts";
import {
  buildNativeDialogueAudioInstruction,
  partitionDialogueCuesForAudioReference,
} from "../lib/native-dialogue-audio.ts";
import {
  applyProvidedDialoguePronunciations,
} from "../lib/dialogue-pronunciation.ts";
import {
  approveDialogueReview,
  hasApprovedDialogueReview,
  inspectDialogueQuality,
} from "../lib/dialogue-quality.ts";

const repeatedConsumption =
  Array.from(
    { length: 5 },
    () => "Frau: Konsumiere.",
  ).join("\n");

const realFifteenSecondConsumptionPrompt = `Erstelle ein 15 Sekunden langes, fotorealistisches, cineastisches vertikales Video im Format 9:16 für TikTok.

Eine attraktive Frau, etwa 25–30 Jahre alt, sitzt frontal vor der Kamera. Sie befindet sich in einem modernen, sehr reduzierten Raum. Der Hintergrund ist dunkel, weich unscharf und fast vollkommen reizlos. Keine auffälligen Gegenstände, keine anderen Personen.

Die Kamera befindet sich exakt auf Augenhöhe und zeigt eine enge Nahaufnahme ihres Gesichts und ihrer Schultern.

Die Frau schaut während des gesamten Videos direkt in die Kameralinse, als würde sie den Zuschauer persönlich ansehen.

Ihr Gesichtsausdruck ist ruhig, neutral und selbstbewusst. Sie lächelt nicht. Sie wirkt nicht aggressiv und nicht wie in einem Horrorfilm. Die Situation soll vielmehr leicht unangenehm und hypnotisch wirken, weil sie den Blickkontakt niemals unterbricht.

Keine Hintergrundmusik.

Nur sehr dezenter Raumklang.

Ihre Stimme ist ruhig, weich, langsam und vollkommen kontrolliert.

0–2 Sekunden:

Die Frau schaut schweigend direkt in die Kamera.

Keine Bewegung.

Dann sagt sie ruhig:

„Konsumiere.“

2–5 Sekunden:

Kurze Stille.

Sie hält weiterhin perfekten Blickkontakt.

Die Kamera beginnt mit einem extrem langsamen, fast unbemerkbaren Zoom auf ihr Gesicht.

Sie sagt erneut:

„Konsumiere.“

5–8 Sekunden:

Wieder eine unangenehm lange Pause.

Die Frau blinzelt einmal langsam.

Dann sagt sie etwas leiser:

„Konsumiere.“

8–11 Sekunden:

Der Zoom ist inzwischen etwas näher.

Die Beleuchtung verändert sich ganz subtil. Der Hintergrund wird minimal dunkler.

Die Frau sagt erneut:

„Konsumiere.“

11–13,5 Sekunden:

Komplette Stille.

Die Frau schaut einfach nur direkt in die Kamera.

Keine Bewegung.

Kein Lächeln.

Dann flüstert sie sehr leise:

„Konsumiere.“

13,5–15 Sekunden:

Harter Schnitt auf komplett schwarzen Hintergrund.

Weiße, minimalistische Schrift erscheint mittig:

„Du hast gerade 15 Sekunden KI konsumiert.“

Darunter deutlich kleiner:

„kivideostudio.de“

Das Video endet ohne Musik und ohne zusätzlichen Soundeffekt.

WICHTIG:

– fotorealistisches menschliches Gesicht
– perfekte Lippen-Synchronisation beim deutschen Wort „Konsumiere“
– natürliche Augenbewegungen und natürliches Blinzeln
– keine übertriebene Mimik
– keine Horror-Effekte
– keine deformierten Gesichtszüge
– keine zusätzlichen Personen
– keine Untertitel während die Frau spricht
– keine sichtbaren Logos oder Marken im Raum
– keine hektischen Kamerabewegungen
– keine schnellen Schnitte
– extrem langsamer subtiler Kamera-Zoom
– hochwertiger cineastischer Look
– geringe Tiefenschärfe
– authentische Hautstruktur
– ruhige, leicht hypnotische Atmosphäre
– der Zuschauer soll sich beobachtet fühlen und neugierig bleiben, aber nicht direkt verstehen, worauf das Video hinausläuft`;

const screenshotFruitDialoguePrompt = `SZENE 1 — 0–6 SEKUNDEN

Erdbeerina läuft wütend auf den Bananen-Jungen zu.

ERDBEERINA sagt exakt:
„Sag mal, hältst du mich eigentlich für komplett bescheuert?“

Der Bananen-Junge schaut überrascht.

BANANEN-JUNGE sagt exakt:
„Was ist denn jetzt schon wieder dein Problem?“

SZENE 2 — 6–15 SEKUNDEN

Nahaufnahme von Erdbeerina. Sie zeigt wütend auf ihn.

ERDBEERINA sagt exakt:
„Du hast gestern gesagt, ich bin die Einzige hier. Und fünf Minuten später liegst du mit einer anderen am Pool.“`;

const screenshotEmotionLabelDialoguePrompt = `**5–10 Sekunden**

Das Avocado-Kopf-Mädchen geht entschlossen auf die beiden zu.

AVOCADO-KOPF-MÄDCHEN, verletzt und wütend:
„Was läuft hier zwischen euch?“

Der Bananen-Kopf-Junge dreht sich erschrocken um.

BANANEN-KOPF-JUNGE, nervös:
„Es ist nicht so, wie es aussieht.“

Das Erdbeer-Kopf-Mädchen hebt beschwichtigend die Hände.

ERDBEER-KOPF-MÄDCHEN, defensiv:
„Ava, lass mich erklären.“`;

const markdownTypoDialoguePrompt = `**6–12 Sekunden:**
Erbeerina bleibt vor ihm stehen und schaut ihn verletzt an.

**ERBEERINA:** „Warum hast du dich heute die ganze Zeit so komisch verhalten?“

Bano schaut kurz weg.

**BANO:** „Ich wusste nicht, wie ich es dir sagen soll.“

**12–20 Sekunden:**
Nahaufnahme auf Erbeerina. Ihre Augen werden traurig.

**ERBEERINA:** „Dann sag es jetzt.“

Bano atmet tief ein.

**BANO:** „Ich hab Angst, dich zu verlieren.“

**20–26 Sekunden:**
Kurze Stille.

**ERBEERINA:** „Dann sei ehrlich zu mir. Das ist alles, was ich will.“`;

test("repeated lines from one named speaker stay in single-speaker mode", () => {
  assert.equal(
    inferPromptSpeechIntent(
      repeatedConsumption,
    ),
    "single-speaker",
  );
});

test("different speaker labels still select conversation mode", () => {
  assert.equal(
    inferPromptSpeechIntent(
      "Frau: Bleib hier.\nMann: Ich gehe.",
    ),
    "conversation",
  );
});

test("five identical submitted lines remain five exact speech events", () => {
  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            repeatedConsumption,
        },
      ],
      [
        {
          name: "Frau",
        },
        {
          name: "Zuschauer",
        },
      ],
      true,
    );

  assert.deepEqual(
    dialogue,
    Array.from(
      { length: 5 },
      () => ({
        speaker: "Frau",
        text: "Konsumiere.",
      }),
    ),
  );
});

test("five repeated sentences inside one quote remain separate and unchanged", () => {
  assert.deepEqual(
    splitProvidedDialogueText(
      "Konsumiere. Konsumiere. Konsumiere. Konsumiere. Konsumiere.",
    ),
    Array.from(
      { length: 5 },
      () => "Konsumiere.",
    ),
  );
});

test("an explicit fünfmal instruction expands to five exact events", () => {
  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            "Die Frau sagt fünfmal „Konsumiere.“",
        },
      ],
      [
        {
          name: "Hauptfigur",
        },
      ],
      true,
    );

  assert.deepEqual(
    dialogue,
    Array.from(
      { length: 5 },
      () => ({
        speaker: "Hauptfigur",
        text: "Konsumiere.",
      }),
    ),
  );
});

test("overlapping dialogue parsers do not create artificial duplicate events", () => {
  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            "Frau sagt wörtlich:\n„Warum bist DU noch hier?!“",
        },
      ],
      [
        {
          name: "Frau",
        },
      ],
      true,
    );

  assert.deepEqual(
    dialogue,
    [
      {
        speaker: "Frau",
        text:
          "Warum bist DU noch hier?!",
      },
    ],
  );
});

test("screenshot-style exact fruit dialogue maps role aliases to the selected characters", () => {
  assert.equal(
    inferPromptSpeechIntent(
      screenshotFruitDialoguePrompt,
    ),
    "conversation",
  );

  assert.deepEqual(
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            screenshotFruitDialoguePrompt,
        },
      ],
      [
        {
          name:
            "Ruby, die Erdbeere",
        },
        {
          name:
            "Bano, die Banane",
        },
      ],
      false,
    ),
    [
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Sag mal, hältst du mich eigentlich für komplett bescheuert?",
      },
      {
        speaker:
          "Bano, die Banane",
        text:
          "Was ist denn jetzt schon wieder dein Problem?",
      },
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Du hast gestern gesagt, ich bin die Einzige hier.",
      },
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Und fünf Minuten später liegst du mit einer anderen am Pool.",
      },
    ],
  );
});

test("multiline fruit speaker labels with emotion preserve the submitted dialogue", () => {
  assert.equal(
    countExplicitMultilineDialogueBlocks(
      screenshotEmotionLabelDialoguePrompt,
    ),
    3,
  );

  assert.equal(
    shouldBlockAutomaticDialogueReplacement(
      3,
      0,
    ),
    true,
  );

  assert.equal(
    inferPromptSpeechIntent(
      screenshotEmotionLabelDialoguePrompt,
    ),
    "conversation",
  );

  assert.deepEqual(
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            screenshotEmotionLabelDialoguePrompt,
        },
      ],
      [
        {
          name:
            "Ava, die Avocado",
        },
        {
          name:
            "Bano, die Banane",
        },
        {
          name:
            "Ruby, die Erdbeere",
        },
      ],
      false,
    ),
    [
      {
        speaker:
          "Ava, die Avocado",
        text:
          "Was läuft hier zwischen euch?",
      },
      {
        speaker:
          "Bano, die Banane",
        text:
          "Es ist nicht so, wie es aussieht.",
      },
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Ava, lass mich erklären.",
      },
    ],
  );

  assert.equal(
    shouldBlockAutomaticDialogueReplacement(
      3,
      3,
    ),
    false,
  );
});

test("bold markdown dialogue with a one-letter fruit typo stays exact", () => {
  assert.equal(
    countExplicitDialogueBlocks(
      markdownTypoDialoguePrompt,
    ),
    5,
  );

  assert.equal(
    countExplicitDialogueEvents(
      markdownTypoDialoguePrompt,
    ),
    6,
  );

  assert.equal(
    inferPromptSpeechIntent(
      markdownTypoDialoguePrompt,
    ),
    "conversation",
  );

  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            markdownTypoDialoguePrompt,
        },
      ],
      [
        {
          name:
            "Ruby, die Erdbeere",
        },
        {
          name:
            "Bano, die Banane",
        },
      ],
      false,
    );

  assert.deepEqual(
    dialogue,
    [
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Warum hast du dich heute die ganze Zeit so komisch verhalten?",
      },
      {
        speaker:
          "Bano, die Banane",
        text:
          "Ich wusste nicht, wie ich es dir sagen soll.",
      },
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Dann sag es jetzt.",
      },
      {
        speaker:
          "Bano, die Banane",
        text:
          "Ich hab Angst, dich zu verlieren.",
      },
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Dann sei ehrlich zu mir.",
      },
      {
        speaker:
          "Ruby, die Erdbeere",
        text:
          "Das ist alles, was ich will.",
      },
    ],
  );
});

test("exact dialogue requires a matching technical approval before render", () => {
  const story = {
    characters: [
      {
        id: "ruby",
        name: "Ruby",
        description: "sichtbare Sprecherin",
      },
    ],
    dialogueSourceMode: "provided",
    providedDialogue: [
      {
        speaker: "Ruby",
        text: "Konsumiere.",
      },
      {
        speaker: "Ruby",
        text: "Konsumiere.",
      },
    ],
    moviePlan: {
      opening: {
        dialogue: {
          enabled: true,
          speaker: "Ruby",
          text: "Konsumiere.",
        },
        dialogueTurns: [
          {
            enabled: true,
            speaker: "Ruby",
            text: "Konsumiere.",
          },
        ],
      },
      continuations: [],
    },
  };

  const beforeApproval = inspectDialogueQuality(
    story,
    {
      voiceMode: "dialogue",
      targetDurationSeconds: 15,
    },
  );

  assert.equal(beforeApproval.ready, false);
  assert.ok(
    beforeApproval.issues.some(
      (issue) => issue.code === "review-required",
    ),
  );

  const approvedStory = approveDialogueReview(story);

  assert.equal(
    hasApprovedDialogueReview(approvedStory),
    true,
  );
  assert.equal(
    inspectDialogueQuality(
      approvedStory,
      {
        voiceMode: "dialogue",
        targetDurationSeconds: 15,
      },
    ).ready,
    true,
  );

  const changedPronunciation = {
    ...approvedStory,
    providedDialogue:
      approvedStory.providedDialogue.map(
        (line, index) =>
          index === 0
            ? {
                ...line,
                pronunciation: "Kon-su-mie-re.",
              }
            : line,
      ),
  };

  assert.equal(
    hasApprovedDialogueReview(
      changedPronunciation,
    ),
    false,
  );
});

test("exact dialogue gate rejects voiceover and changed screenplay lines", () => {
  const story = {
    characters: [
      {
        id: "ruby",
        name: "Ruby",
        description: "sichtbare Sprecherin",
      },
    ],
    dialogueSourceMode: "provided",
    providedDialogue: [
      {
        speaker: "Ruby",
        text: "Bleib hier.",
      },
    ],
    moviePlan: {
      opening: {
        dialogue: {
          enabled: true,
          speaker: "Ruby",
          text: "Geh weg.",
        },
        dialogueTurns: [],
      },
      continuations: [],
    },
  };

  const report = inspectDialogueQuality(
    story,
    {
      voiceMode: "voiceover",
      voiceoverText: "Eine Erzählerin spricht.",
      targetDurationSeconds: 15,
      requireApproval: false,
    },
  );

  assert.equal(report.ready, false);
  assert.deepEqual(
    new Set(
      report.issues.map((issue) => issue.code),
    ),
    new Set([
      "wrong-voice-mode",
      "voiceover-conflict",
      "dialogue-plan-mismatch",
    ]),
  );
});

test("pronunciation overrides keep duplicate speech events in exact order", () => {
  const cues = Array.from(
    { length: 5 },
    (_, index) => ({
      speaker: "Frau",
      text: "Konsumiere.",
      marker: index + 1,
    }),
  );
  const providedDialogue = cues.map(
    (cue, index) => ({
      speaker: cue.speaker,
      text: cue.text,
      ...(index === 4
        ? {
            pronunciation:
              "Kon-su-mie-re.",
          }
        : {}),
    }),
  );

  assert.deepEqual(
    applyProvidedDialoguePronunciations(
      cues,
      providedDialogue,
    ).map((cue) => cue.text),
    [
      "Konsumiere.",
      "Konsumiere.",
      "Konsumiere.",
      "Konsumiere.",
      "Kon-su-mie-re.",
    ],
  );
});

test("a rejected voiceover cannot override explicitly requested character dialogue", () => {
  assert.equal(
    inferPromptSpeechIntent(
      `Kein Voiceover und kein Erzähler. Die Frau sagt direkt in die Kamera: „Konsumiere.“ Die Dialoge wortwörtlich übernehmen.`,
    ),
    "single-speaker",
  );

  assert.equal(
    resolveProvidedDialogueVoiceMode(
      "voiceover",
      true,
    ),
    "dialogue",
  );
});

test("negated off-screen speech keeps a two-person dialogue in conversation mode", () => {
  assert.equal(
    inferPromptSpeechIntent(
      `Ohne Off-Stimme. Frau: „Bleib hier.“\nMann: „Ich gehe.“`,
    ),
    "conversation",
  );
});

test("client and server share a dialogue-turn limit that accepts five or more exact events", () => {
  assert.equal(
    MAX_DIALOGUE_TURNS_PER_SECTION,
    16,
  );
});

test("a 76-word exact dialogue fits naturally into a 30-second video", () => {
  const capacity =
    getExactDialogueWordCapacity(
      30,
    );

  assert.equal(
    capacity,
    78,
  );

  assert.equal(
    76 <= capacity,
    true,
  );

  assert.equal(
    79 > capacity,
    true,
  );
});

test("the real 15-second Konsumiere prompt stays one exact five-event monologue", () => {
  assert.equal(
    countExplicitMultilineDialogueBlocks(
      realFifteenSecondConsumptionPrompt,
    ),
    5,
  );

  assert.equal(
    inferPromptSpeechIntent(
      realFifteenSecondConsumptionPrompt,
    ),
    "single-speaker",
  );

  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            realFifteenSecondConsumptionPrompt,
        },
      ],
      [
        {
          name:
            "Attraktive Frau",
        },
      ],
      true,
    );

  assert.deepEqual(
    dialogue,
    Array.from(
      { length: 5 },
      () => ({
        speaker:
          "Attraktive Frau",
        text:
          "Konsumiere.",
      }),
    ),
  );

  assert.equal(
    new Set(
      dialogue.map(
        ({ speaker }) =>
          speaker,
      ),
    ).size,
    1,
  );
});

test("exact provided dialogue uses direct character audio instead of documentary post-dubbing", () => {
  const prompt =
    JSON.stringify({
      creationMode:
        "standard",
      singleSpeakerMode:
        true,
      providedDialogue:
        Array.from(
          { length: 5 },
          () => ({
            speaker:
              "Attraktive Frau",
            text:
              "Konsumiere.",
          }),
        ),
    });

  assert.equal(
    promptHasProvidedDialogue(
      prompt,
    ),
    true,
  );

  const nativeCharacterDialogue =
    shouldUseNativeCharacterDialogue(
      "dialogue",
      true,
    );

  assert.equal(
    nativeCharacterDialogue,
    true,
  );

  assert.equal(
    shouldUsePostProducedDialogue(
      "standard",
      "dialogue",
      nativeCharacterDialogue,
    ),
    false,
  );
});

test("automatic standard dialogue keeps the existing post-produced mode", () => {
  assert.equal(
    promptHasProvidedDialogue(
      JSON.stringify({
        creationMode:
          "standard",
      }),
    ),
    false,
  );

  assert.equal(
    shouldUseNativeCharacterDialogue(
      "dialogue",
      false,
    ),
    false,
  );

  assert.equal(
    shouldUsePostProducedDialogue(
      "standard",
      "dialogue",
      false,
    ),
    true,
  );
});

test("exact dialogue audio references preserve every ordered speech event", () => {
  const repeated =
    Array.from(
      { length: 5 },
      (_, index) => ({
        startSeconds:
          0.45 + index * 2.7,
        maximumDurationSeconds:
          2.5,
        speaker:
          "Attraktive Frau",
        text:
          "Konsumiere.",
        voiceName:
          "Kore",
        voiceDirection:
          "ruhig und kontrolliert",
      }),
    );

  const clips =
    partitionDialogueCuesForAudioReference(
      repeated,
      15,
    );

  assert.equal(
    clips.length,
    1,
  );
  assert.equal(
    clips[0].length,
    5,
  );
  assert.deepEqual(
    clips[0].map(({ text }) => text),
    Array.from(
      { length: 5 },
      () => "Konsumiere.",
    ),
  );

  const instruction =
    buildNativeDialogueAudioInstruction();

  assert.match(
    instruction,
    /exact German words, voices, pauses, timing and pronunciation/,
  );
  assert.match(
    instruction,
    /synchronize .* lips precisely/i,
  );
});

test("generic pronouns and visible-role labels resolve in both German word orders", () => {
  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content: `Dann sagt die Frau ruhig: „Eins.“
Sie sagt erneut: „Zwei.“
Dann flüstert sie sehr leise: „Drei.“`,
        },
      ],
      [
        {
          name:
            "Einzige sichtbare Sprecherin",
        },
      ],
      true,
    );

  assert.deepEqual(
    dialogue,
    [
      {
        speaker:
          "Einzige sichtbare Sprecherin",
        text: "Eins.",
      },
      {
        speaker:
          "Einzige sichtbare Sprecherin",
        text: "Zwei.",
      },
      {
        speaker:
          "Einzige sichtbare Sprecherin",
        text: "Drei.",
      },
    ],
  );
});

test("generic male pronouns and roles map to the only visible man", () => {
  const dialogue =
    extractProvidedDialogue(
      [
        {
          role: "user",
          content:
            "Er sagt ruhig: „Eins.“\nDann sagt der Mann erneut: „Zwei.“",
        },
      ],
      [
        {
          name:
            "Einziger sichtbarer Sprecher",
        },
      ],
      true,
    );

  assert.deepEqual(
    dialogue.map(
      ({ text }) => text,
    ),
    [
      "Eins.",
      "Zwei.",
    ],
  );
});
