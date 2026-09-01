import assert from "node:assert/strict";
import test from "node:test";

import {
  inferPromptSpeechIntent,
} from "../lib/audio-options.ts";
import {
  extractProvidedDialogue,
  splitProvidedDialogueText,
} from "../lib/provided-dialogue.ts";

const repeatedConsumption =
  Array.from(
    { length: 5 },
    () => "Frau: Konsumiere.",
  ).join("\n");

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
