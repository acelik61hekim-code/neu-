export type InlineDialogueLine = {
  speaker: string;
  text: string;
  sourceStart?: number;
  sourceEnd?: number;
};

export type ProvidedDialogueMessage = {
  role: "user" | "assistant";
  content: string;
  dialogueContent?: string;
};

export type ProvidedDialogueCharacter = {
  name: string;
};

export type ProvidedDialogueLine = {
  speaker: string;
  text: string;
};

const INLINE_SPEECH_VERB_PATTERN =
  /(?:sagt(?:e)?|spricht|antwortet|erwidert|ruft|schreit|stammelt|fleht|weint|flüstert|erklärt|gesteht|verkündet|enthüllt|says?|said|asks?|asked|answers?|answered|replies?|replied|shouts?|shouted|screams?|screamed|yells?|yelled|cries|cried|begs?|begged|stammers?|stammered|whispers?|whispered|declares?|declared|reveals?|revealed)(?:\s+(?:wörtlich|wortwörtlich|exakt|genau\s+so|verbatim))?\s*,?\s*$/iu;

export function extractInlineAttributedDialogue(
  source: string,
  speakerNames: readonly string[],
): InlineDialogueLine[] {
  const knownSpeakers =
    speakerNames
      .map((fullName) => ({
        fullName:
          fullName.trim(),
        aliases: [
          fullName.trim(),
          fullName
            .split(",")[0]
            .trim(),
          fullName
            .trim()
            .replace(
              /\s+(?:woman|man|girl|boy|frau|mann|mädchen|junge)$/iu,
              "",
            )
            .trim(),
        ]
          .filter(Boolean)
          .map((alias) =>
            alias.toLocaleLowerCase(
              "de-DE",
            ),
          ),
      }))
      .filter(
        (speaker) =>
          speaker.fullName.length > 0,
      );

  if (
    knownSpeakers.length === 0
  ) {
    return [];
  }

  const dialogue:
    InlineDialogueLine[] = [];

  const inlineQuotePattern =
    /["„“]([^"„“”]{1,2000})["“”]/gu;

  let previousQuoteEnd =
    0;

  for (
    const match
    of source.matchAll(
      inlineQuotePattern,
    )
  ) {
    const quoteIndex =
      match.index ??
      0;

    const contextStart =
      Math.max(
        previousQuoteEnd,
        quoteIndex - 600,
      );

    const attributionContext =
      source.slice(
        contextStart,
        quoteIndex,
      );

    const normalizedContext =
      attributionContext
        .toLocaleLowerCase(
          "de-DE",
        );

    const speakerCandidates:
      Array<{
        fullName: string;
        aliasStart: number;
        aliasEnd: number;
      }> = [];

    for (
      const speaker
      of knownSpeakers
    ) {
      for (
        const alias
        of speaker.aliases
      ) {
        const aliasIndex =
          normalizedContext
            .lastIndexOf(
              alias,
            );

        if (
          aliasIndex < 0
        ) {
          continue;
        }

        const aliasEnd =
          aliasIndex +
          alias.length;

        const followingText =
          normalizedContext
            .slice(
              aliasEnd,
            );

        /*
         * "Lemon's phone rings and an employee says ..." describes the
         * owner of an object, not Lemon speaking. Do not attach that unknown
         * off-screen voice to the nearest library character.
         */
        if (
          /^(?:'s|’s)\b/u.test(
            followingText,
          )
        ) {
          continue;
        }

        speakerCandidates.push({
          fullName:
            speaker.fullName,
          aliasStart:
            aliasIndex,
          aliasEnd,
        });
      }
    }

    const sentenceBoundary =
      Math.max(
        normalizedContext
          .lastIndexOf("."),
        normalizedContext
          .lastIndexOf("!"),
        normalizedContext
          .lastIndexOf("?"),
        normalizedContext
          .lastIndexOf(";"),
        normalizedContext
          .lastIndexOf("\n"),
      );

    const clauseMarkers = [
      " while ",
      " während ",
      " when ",
      " wenn ",
      " als ",
    ];

    const clauseBoundary =
      clauseMarkers.reduce(
        (latest, marker) =>
          Math.max(
            latest,
            normalizedContext
              .lastIndexOf(marker),
          ),
        sentenceBoundary,
      );

    const currentClauseSpeakers =
      speakerCandidates
        .filter(
          (candidate) =>
            candidate.aliasStart >
            clauseBoundary,
        )
        .sort(
          (left, right) =>
            left.aliasStart -
              right.aliasStart ||
            right.aliasEnd -
              left.aliasEnd,
        );

    const selectedSpeaker =
      currentClauseSpeakers[0] ??
      speakerCandidates
        .sort(
          (left, right) =>
            right.aliasEnd -
            left.aliasEnd,
        )[0];

    if (selectedSpeaker) {
      const attributionTail =
        attributionContext
          .slice(
            selectedSpeaker
              .aliasEnd,
          )
          .trim();

      if (
        INLINE_SPEECH_VERB_PATTERN.test(
          attributionTail,
        ) ||
        /:\s*$/u.test(
          attributionTail,
        )
      ) {
        dialogue.push({
          speaker:
            selectedSpeaker
              .fullName,
          text:
            match[1].trim(),
          sourceStart:
            quoteIndex,
          sourceEnd:
            quoteIndex +
            match[0].length,
        });
      }
    }

    previousQuoteEnd =
      quoteIndex +
      match[0].length;
  }

  return dialogue;
}

const PROVIDED_DIALOGUE_WORDS_PER_EVENT =
  12;
const PROVIDED_DIALOGUE_MAX_CHARACTERS =
  4_000;
const PROVIDED_DIALOGUE_MAX_EVENTS =
  48;

const REPETITION_WORDS:
  Record<string, number> = {
    einmal: 1,
    zweimal: 2,
    dreimal: 3,
    viermal: 4,
    fuenfmal: 5,
    fünfmal: 5,
    sechsmal: 6,
    siebenmal: 7,
    achtmal: 8,
    neunmal: 9,
    zehnmal: 10,
  };

function normalizeSpeakerKey(
  value: string,
): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+sagt(?:e)?\s*$/iu, "")
    .replace(/[^a-z0-9äöüß]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_SPEAKER_IDENTITY_WORDS =
  new Set([
    "der",
    "die",
    "das",
    "den",
    "dem",
    "ein",
    "eine",
    "frau",
    "mann",
    "mädchen",
    "junge",
    "figur",
    "charakter",
    "speaker",
    "woman",
    "man",
    "girl",
    "boy",
  ]);

function speakerIdentityStems(
  value: string,
): Set<string> {
  const words =
    normalizeSpeakerKey(
      value,
    )
      .split(" ")
      .filter(
        (word) =>
          word.length >= 5 &&
          !GENERIC_SPEAKER_IDENTITY_WORDS.has(
            word,
          ),
      );

  return new Set(
    words
      .map((word) =>
        word.endsWith(
          "ina",
        )
          ? word.slice(
              0,
              -3,
            )
          : word.replace(
              /(?:ern|er|en|es|e|n|s)$/u,
              "",
            ),
      )
      .filter(
        (word) =>
          word.length >= 5,
      ),
  );
}

function stripDialogueQuotes(
  value: string,
): string {
  const trimmed =
    value.trim();

  const quotePairs: Array<[
    string,
    string,
  ]> = [
    ["„", "“"],
    ["“", "”"],
    ['"', '"'],
    ["'", "'"],
  ];

  for (const [opening, closing] of quotePairs) {
    if (
      trimmed.startsWith(opening) &&
      trimmed.endsWith(closing) &&
      trimmed.length > 2
    ) {
      return trimmed
        .slice(1, -1)
        .trim();
    }
  }

  return trimmed;
}

function splitLongSpeechEvent(
  value: string,
): string[] {
  const words =
    value
      .trim()
      .match(/\S+/gu) ??
    [];

  if (
    words.length <=
    PROVIDED_DIALOGUE_WORDS_PER_EVENT
  ) {
    return value.trim()
      ? [value.trim()]
      : [];
  }

  const chunks:
    string[] = [];

  for (
    let index = 0;
    index < words.length;
    index +=
      PROVIDED_DIALOGUE_WORDS_PER_EVENT
  ) {
    chunks.push(
      words
        .slice(
          index,
          index +
            PROVIDED_DIALOGUE_WORDS_PER_EVENT,
        )
        .join(" "),
    );
  }

  return chunks;
}

/*
 * Each submitted sentence becomes one speech event. This intentionally keeps
 * repeated sentences as repeated events; there is no content-based dedupe.
 */
export function splitProvidedDialogueText(
  value: string,
): string[] {
  const text =
    stripDialogueQuotes(
      value,
    );

  if (
    !text ||
    text.length >
      PROVIDED_DIALOGUE_MAX_CHARACTERS
  ) {
    return [];
  }

  const paragraphs =
    text
      .replace(/\r\n?/gu, "\n")
      .split(/\n+/gu)
      .map((paragraph) =>
        paragraph.trim(),
      )
      .filter(Boolean);

  const segmenter =
    new Intl.Segmenter(
      "de",
      {
        granularity:
          "sentence",
      },
    );

  return paragraphs
    .flatMap((paragraph) =>
      Array.from(
        segmenter.segment(
          paragraph,
        ),
        ({ segment }) =>
          segment.trim(),
      )
        .filter(Boolean)
        .flatMap(
          splitLongSpeechEvent,
        ),
    )
    .slice(
      0,
      PROVIDED_DIALOGUE_MAX_EVENTS,
    );
}

function readRepetitionCount(
  numericValue: string | undefined,
  wordValue: string | undefined,
): number {
  const numericCount =
    numericValue
      ? Number.parseInt(
          numericValue,
          10,
        )
      : Number.NaN;

  if (
    Number.isInteger(
      numericCount,
    ) &&
    numericCount >= 1 &&
    numericCount <= 10
  ) {
    return numericCount;
  }

  return wordValue
    ? REPETITION_WORDS[
        wordValue
          .toLocaleLowerCase(
            "de-DE",
          )
      ] ?? 1
    : 1;
}

function rangesOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return (
    firstStart < secondEnd &&
    secondStart < firstEnd
  );
}

function isGenericVisibleSpeakerLabel(
  value: string,
): boolean {
  return /\b(?:frau|mann|mädchen|junge|person|sprecher(?:in)?|figur|charakter|moderator(?:in)?|presenter|protagonist(?:in)?|hauptfigur|sie|er|woman|man|girl|boy|speaker|character)\b/iu.test(
    value,
  );
}

/*
 * Extract only text explicitly attributed by the user to a visible speaker.
 * Source ranges suppress parser overlap while preserving intentional duplicate
 * occurrences at different positions.
 */
export function extractProvidedDialogue(
  messages: readonly ProvidedDialogueMessage[],
  characters: readonly ProvidedDialogueCharacter[],
  allowSingleSpeaker = false,
): ProvidedDialogueLine[] {
  const knownSpeakers =
    characters
      .map((character) => ({
        fullName:
          character.name.trim(),
        fullKey:
          normalizeSpeakerKey(
            character.name,
          ),
        shortKey:
          normalizeSpeakerKey(
            character.name
              .split(",")[0],
          ),
        identityStems:
          speakerIdentityStems(
            character.name,
          ),
      }))
      .filter(
        (speaker) =>
          speaker.fullName &&
          speaker.fullKey,
      );

  if (
    knownSpeakers.length <
      (
        allowSingleSpeaker
          ? 1
          : 2
      )
  ) {
    return [];
  }

  const dialogue:
    ProvidedDialogueLine[] = [];

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const source =
      message.dialogueContent ??
      message.content;
    const claimedRanges:
      Array<{
        start: number;
        end: number;
      }> = [];
    const candidates:
      Array<{
        speakerLabel: string;
        rawText: string;
        sourceStart: number;
        sourceEnd: number;
        repeatCount: number;
        allowGenericAlias: boolean;
        priority: number;
      }> = [];

    const collectDialogue = (
      speakerLabel: string,
      rawText: string,
      sourceStart: number,
      sourceEnd: number,
      repeatCount = 1,
      allowGenericAlias = false,
      priority = 2,
    ) => {
      candidates.push({
        speakerLabel,
        rawText,
        sourceStart,
        sourceEnd,
        repeatCount,
        allowGenericAlias,
        priority,
      });
    };

    const addDialogue = (
      speakerLabel: string,
      rawText: string,
      sourceStart: number,
      sourceEnd: number,
      repeatCount = 1,
      allowGenericAlias = false,
    ) => {
      if (
        claimedRanges.some(
          (range) =>
            rangesOverlap(
              sourceStart,
              sourceEnd,
              range.start,
              range.end,
            ),
        )
      ) {
        return;
      }

      const candidateKey =
        normalizeSpeakerKey(
          speakerLabel,
        );
      const exactSpeaker =
        knownSpeakers.find(
          ({
            fullKey,
            shortKey,
          }) =>
            candidateKey ===
              fullKey ||
            candidateKey ===
              shortKey,
        );
      const candidateIdentityStems =
        speakerIdentityStems(
          speakerLabel,
        );
      const identityMatches =
        knownSpeakers.filter(
          (speaker) =>
            Array.from(
              candidateIdentityStems,
            ).some(
              (stem) =>
                speaker.identityStems.has(
                  stem,
                ),
            ),
        );
      const roleAliasSpeaker =
        identityMatches.length === 1
          ? identityMatches[0]
          : undefined;
      const fallbackSpeaker =
        allowSingleSpeaker &&
        knownSpeakers.length === 1 &&
        (
          allowGenericAlias ||
          isGenericVisibleSpeakerLabel(
            speakerLabel,
          )
        )
          ? knownSpeakers[0]
          : undefined;
      const knownSpeaker =
        exactSpeaker ??
        roleAliasSpeaker ??
        fallbackSpeaker;

      if (!knownSpeaker) {
        return;
      }

      const events =
        splitProvidedDialogueText(
          rawText,
        );

      if (
        events.length === 0
      ) {
        return;
      }

      claimedRanges.push({
        start:
          sourceStart,
        end:
          sourceEnd,
      });

      for (
        let repetition = 0;
        repetition < repeatCount;
        repetition += 1
      ) {
        for (const text of events) {
          if (
            dialogue.length >=
            PROVIDED_DIALOGUE_MAX_EVENTS
          ) {
            return;
          }

          dialogue.push({
            speaker:
              knownSpeaker.fullName,
            text,
          });
        }
      }
    };

    const repeatedSpeechPattern =
      /(?:^|\n)\s*(?:[-*•]\s*)?(.{1,100}?)\s+(?:sagt|spricht)(?:\s+(?:wörtlich|wortwörtlich|exakt|genau\s+so|verbatim))?(?:\s+den\s+satz)?\s+(?:(\d{1,2})\s*(?:mal|x)|((?:ein|zwei|drei|vier|fuenf|fünf|sechs|sieben|acht|neun|zehn)mal))\s*:?\s*[„“"']([\s\S]{1,4000}?)[“”"']/gimu;

    for (
      const match
      of source.matchAll(
        repeatedSpeechPattern,
      )
    ) {
      const start =
        match.index ?? 0;

      collectDialogue(
        match[1],
        match[4],
        start,
        start +
          match[0].length,
        readRepetitionCount(
          match[2],
          match[3],
        ),
        true,
        0,
      );
    }

    const quotedSpeechPattern =
      /(?:^|\n)\s*(?:[-*•]\s*)?(.{1,100}?)\s+(?:sagt|spricht)(?:\s+(?:wörtlich|wortwörtlich|exakt|genau\s+so|verbatim))?\s*:\s*[\r\n\t ]*[„“"']([\s\S]{1,4000}?)[“”"']/gimu;

    for (
      const match
      of source.matchAll(
        quotedSpeechPattern,
      )
    ) {
      const start =
        match.index ?? 0;

      collectDialogue(
        match[1],
        match[2],
        start,
        start +
          match[0].length,
        1,
        true,
        1,
      );
    }

    /*
     * In an explicit single-speaker request, the user often describes the
     * only visible person with a pronoun or a generic role. Support both
     * German word orders immediately before a quote:
     *
     *   "Sie sagt erneut: ..." / "Die Frau flüstert: ..."
     *   "Dann sagt sie ruhig: ..." / "Dann sagt die Frau: ..."
     */
    const genericSingleSpeakerPattern =
      /(?:^|[\r\n]|[.!?]\s+)\s*(?:[-*•]\s*)?(?:(sie|er|die\s+frau|der\s+mann|das\s+mädchen|der\s+junge|die\s+sprecherin|der\s+sprecher|die\s+hauptfigur)\s+(?:sagt(?:e)?|spricht|antwortet|erwidert|ruft|schreit|stammelt|fleht|weint|flüstert|erklärt|gesteht|verkündet|enthüllt)|(?:dann\s+)?(?:sagt(?:e)?|spricht|antwortet|erwidert|ruft|schreit|stammelt|fleht|weint|flüstert|erklärt|gesteht|verkündet|enthüllt)\s+(sie|er|die\s+frau|der\s+mann|das\s+mädchen|der\s+junge|die\s+sprecherin|der\s+sprecher|die\s+hauptfigur))(?:\s+[^:\r\n„“"']{0,80})?\s*:?\s*[\r\n\t ]*[„“"']([\s\S]{1,4000}?)[“”"']/gimu;

    for (
      const match
      of source.matchAll(
        genericSingleSpeakerPattern,
      )
    ) {
      const start =
        match.index ?? 0;

      collectDialogue(
        match[1] ?? match[2],
        match[3],
        start,
        start +
          match[0].length,
        1,
        true,
        1,
      );
    }

    for (
      const line
      of extractInlineAttributedDialogue(
        source,
        knownSpeakers.map(
          (speaker) =>
            speaker.fullName,
        ),
      )
    ) {
      collectDialogue(
        line.speaker,
        line.text,
        line.sourceStart ?? 0,
        line.sourceEnd ?? source.length,
        1,
        false,
        2,
      );
    }

    const sourceLinePattern =
      /[^\r\n]+/gu;

    for (
      const lineMatch
      of source.matchAll(
        sourceLinePattern,
      )
    ) {
      const rawLine =
        lineMatch[0];
      const line =
        rawLine.trim();

      if (!line) {
        continue;
      }

      const colonMatch =
        line.match(
          /^(?:[-*•]\s*)?(?:\d{1,2}[.)]\s*)?(.{1,64}?)\s*:\s*(.+)$/u,
        );
      const spokenMatch =
        line.match(
          /^(?:[-*•]\s*)?(.{1,100}?)\s+(?:sagt|sagte|spricht)\s+[„“"'](.+)[“”"']$/iu,
        );
      const matched =
        colonMatch ??
        spokenMatch;

      if (!matched) {
        continue;
      }

      const start =
        lineMatch.index ?? 0;

      collectDialogue(
        matched[1],
        matched[2],
        start,
        start +
          rawLine.length,
        1,
        Boolean(
          spokenMatch,
        ),
        3,
      );
    }

    candidates
      .sort(
        (left, right) =>
          left.sourceStart -
            right.sourceStart ||
          left.priority -
            right.priority ||
          right.sourceEnd -
            left.sourceEnd,
      )
      .forEach(
        (candidate) =>
          addDialogue(
            candidate.speakerLabel,
            candidate.rawText,
            candidate.sourceStart,
            candidate.sourceEnd,
            candidate.repeatCount,
            candidate.allowGenericAlias,
          ),
      );
  }

  const distinctSpeakers =
    new Set(
      dialogue.map(
        (line) =>
          normalizeSpeakerKey(
            line.speaker,
          ),
      ),
    );

  if (
    dialogue.length === 0 ||
    (
      !allowSingleSpeaker &&
      distinctSpeakers.size < 2
    )
  ) {
    return [];
  }

  return dialogue.slice(
    0,
    PROVIDED_DIALOGUE_MAX_EVENTS,
  );
}
