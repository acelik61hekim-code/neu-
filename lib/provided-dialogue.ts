export type InlineDialogueLine = {
  speaker: string;
  text: string;
};

const INLINE_SPEECH_VERB_PATTERN =
  /(?:sagt(?:e)?|spricht|antwortet|erwidert|ruft|schreit|stammelt|fleht|weint|flüstert|erklärt|gesteht|verkündet|enthüllt|says?|said|asks?|asked|answers?|answered|replies?|replied|shouts?|shouted|screams?|screamed|yells?|yelled|cries|cried|begs?|begged|stammers?|stammered|whispers?|whispered|declares?|declared|reveals?|revealed)\s*,?\s*$/iu;

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
        });
      }
    }

    previousQuoteEnd =
      quoteIndex +
      match[0].length;
  }

  return dialogue;
}
