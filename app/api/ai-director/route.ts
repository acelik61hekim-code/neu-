import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from "@google/genai";
import { NextResponse } from "next/server";
import { AI_DIRECTOR_MESSAGE_MAX_CHARACTERS } from "@/lib/ai-director-limits";
import {
  inferPromptSpeechIntent,
  shouldUseProvidedDialogue,
} from "@/lib/audio-options";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  STUDIO_BRAND_CONTEXT,
  STUDIO_NAME,
  STUDIO_URL,
  forbidsStudioDeviceInterface,
  isStudioWebsiteAdvertisement,
} from "@/lib/studio-brand";
import { getViralCharacters } from "@/lib/viral-characters";
import { isMusicVideoTrackContext } from "@/lib/music-video";
import {
  countExplicitDialogueEvents,
  extractProvidedDialogue,
  shouldBlockAutomaticDialogueReplacement,
} from "@/lib/provided-dialogue";

import type {
  MusicVideoTrackContext,
} from "@/types/story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  dialogueContent?: string;
};

type RequestBody = {
  messages?: ConversationMessage[];
  viralCharacterIds?: unknown;
  characterMode?: unknown;
  dialogueMode?: unknown;
  dialogueSourceMode?: unknown;
  singleSpeakerMode?: unknown;
  musicTrack?: unknown;
};

type StoryCharacter = {
  name: string;
  description: string;
};

type ProvidedDialogueLine = {
  speaker: string;
  text: string;
};

type StoryDraft = {
  title: string;
  genre: string;
  mood: string;
  setting: string;
  characters: StoryCharacter[];
  summary: string;
  providedDialogue?: ProvidedDialogueLine[];
  dialogueSourceMode?: "automatic" | "provided";
  singleSpeakerMode?: boolean;
};

type AiDirectorResult = {
  reply: string;
  ready: boolean;
  story: StoryDraft;
};

type ApiErrorLike = {
  status?: number;
  code?: number;
  message?: string;
};

function normalizeStorySpeakerName(
  value: string,
): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(
      /[^a-z0-9äöüß]+/giu,
      " ",
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function ensureDialogueSpeakersAreCharacters(
  characters: StoryCharacter[],
  dialogue: ProvidedDialogueLine[],
): StoryCharacter[] {
  const result = [
    ...characters,
  ];

  const knownNames =
    new Set(
      result.map(
        (character) =>
          normalizeStorySpeakerName(
            character.name,
          ),
      ),
    );

  for (const line of dialogue) {
    const key =
      normalizeStorySpeakerName(
        line.speaker,
      );

    if (
      !key ||
      knownNames.has(key)
    ) {
      continue;
    }

    result.push({
      name: line.speaker,
      description:
        "Sichtbare sprechende Figur aus dem verbindlich vorgegebenen Originaldialog. Aussehen und Rolle werden aus der Nutzereingabe übernommen. Die Figur muss sichtbar sein, während sie spricht.",
    });

    knownNames.add(key);
  }

  return result;
}

const STANDARD_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
] as const;

const VIRAL_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
] as const;

const SYSTEM_INSTRUCTION = `
Du bist der AI Director einer professionellen KI-Video-Plattform.

${STUDIO_BRAND_CONTEXT}

Deine Aufgabe ist NICHT nur zu chatten.

Deine Aufgabe ist es, in möglichst wenigen Nachrichten alle Informationen zu sammeln,
die benötigt werden, um daraus eine hochwertige Geschichte mit aufeinander
aufbauenden 15-Sekunden-Videoabschnitten zu erzeugen.

Die Geschichte benötigt:

- Titel
- Genre
- Stimmung
- Setting
- Hauptcharakter(e)
- Konflikt
- Ende

WICHTIGE REGELN

1. Antworte immer auf Deutsch.

2. Wenn der Nutzer bereits genügend Informationen geliefert hat,
stelle KEINE weitere Frage.

3. Fehlen nur kleine Details,
ergänze sie selbst sinnvoll.

4. Stelle nur dann eine Rückfrage,
wenn ohne diese Information keine gute Geschichte erzeugt werden kann.

5. Sobald mindestens 80 % aller Informationen vorhanden sind,
setze

ready = true

6. Wenn ready=true,
stelle keine weitere Frage.

7. Erstelle immer einen passenden Filmtitel.

8. Erstelle immer eine kurze Story-Zusammenfassung.

9. Aktualisiere das Story-Objekt nach jeder Nachricht.

10. Die Antwort für den Benutzer muss kurz sein
(maximal 3 Sätze).

11. Antworte niemals mit Markdown.

12. Gib ausschließlich das definierte JSON zurück.

13. Der Nutzer sieht ausschließlich "reply".

14. Die Geschichte soll später automatisch in klare 15-Sekunden-Abschnitte
aufgeteilt werden können.

15. Achte deshalb darauf,
dass die Handlung klar aufgebaut ist:

- Einführung
- Auslöser
- Konflikt
- Höhepunkt
- Wendung
- Ende

Wenn diese Struktur bereits vorhanden ist,
setze sofort ready=true.
`;

const DIALOGUE_SYSTEM_INSTRUCTION = `
ZUSÄTZLICHER VERBINDLICHER DIALOGMODUS

- Die Story benötigt mindestens zwei deutlich unterscheidbare, benannte und sichtbare Gesprächsfiguren.
- Ergänze selbst eine passende zweite Gesprächsfigur, falls der Nutzer nur eine Figur genannt hat; frage dafür nicht unnötig nach.
- Beschreibe für jede Figur Aussehen, Persönlichkeit, Rolle und Beziehung zur anderen Figur so konkret, dass ihre Identität über alle Szenen stabil bleiben kann.
- Die Zusammenfassung muss ein echtes abwechselndes Gespräch ermöglichen. Kein Monolog, kein Erzähler, kein Voice-over und keine Offscreen-Stimme.
- Lege den Konflikt vor dem Dialog konkret fest: Beziehung, Auslöser, sichtbares Beweisstück, verborgenes Wissen und Konsequenz.
- Jede Antwort reagiert direkt auf den vorherigen Satz und ergänzt eine neue überprüfbare Information. Vermeide austauschbare Platzhaltersätze wie „Das ist alles anders“, „Du verstehst das nicht“, „Warte ab“ oder „Das ist erst der Anfang“.
- Automatisch geschriebene Dialogzeilen bestehen überwiegend aus 3–8 Wörtern und höchstens aus einem sehr kurzen Satz. Alle 2–4 Sekunden folgt eine gesprochene Zeile, eine sichtbare Reaktion oder eine neue Handlung.
- Nutze schnelle Alltagssprache: Frage, direkte Antwort, Reaktion, Gegenreaktion. Keine Drehbuchsprache, Therapiesprache, Zusammenfassung oder Meta-Sätze über „das Gespräch“, „den wichtigsten Punkt“ oder „die gemeinsame Entscheidung“.
- Lege intern vor dem Schreiben eine unveränderliche Faktenkette fest: Beziehung, sichtbare Handlung, direkter Zeuge, genaue Lüge, widerlegendes Detail, Konsequenz und Cliffhanger.
- Jede Dialogzeile erfüllt genau eine Funktion: Vorwurf, Antwort, Widerspruch, Teilgeständnis, Entscheidung oder Enthüllung. Eine Antwort darf nie das Thema wechseln oder ein unverbundenes neues Geheimnis erfinden.
- Die Figuren brauchen unterscheidbare Sprechhaltungen passend zu ihrer Persönlichkeit. Wenn zwei Figuren ihre Sätze problemlos tauschen könnten, ist der Dialog noch nicht gut genug.
- Beispiel für eine klare Kette: „Ich sah euren Kuss am Pool.“ – „Ora küsste mich, ich wich zurück.“ – „Nein, du trägst meinen Ring seit Montag.“
- Bei Fremdgehen oder Verrat muss die Zusammenfassung eindeutig sagen, wer wen mit wem betrogen hat, wodurch es auffliegt und welche konkrete Gegenenthüllung folgt.
- Der zentrale Regelbruch wird sichtbar als Handlung gezeigt. Bei Fremdgehen sieht die betrogene Figur den Kuss, die vertraute Umarmung, das Händchenhalten oder das gemeinsame Verlassen eines Zimmers selbst. Handy, Chat, Foto, Brief oder Rechnung sind höchstens zusätzliche Bestätigung, nie der einzige Hauptbeweis.
- Plane Ursache, Entdeckung und Reaktion kausal: konkrete Handlung im Bild, entdeckende Figur, unmittelbarer Vorwurf, überprüfbare Antwort, Widerspruch und Konsequenz.
- Wenn die übrigen Story-Angaben ausreichen, darf ready erst dann true sein, wenn mindestens zwei Gesprächsfiguren im Story-Objekt stehen.
- Wörtlich zitierte Sätze im Nutzerprompt sind verbindlicher Originaldialog. Ordne sie der genannten Figur und der beschriebenen Handlung zu; ersetze sie nicht durch neu erfundene Standardsätze.
`;

const SINGLE_SPEAKER_SYSTEM_INSTRUCTION = `
ZUSÄTZLICHER VERBINDLICHER EIN-PERSONEN-SPRECHMODUS

- Die vom Nutzer gewünschte sichtbare Hauptfigur spricht selbst vor der Kamera.
- Plane einen natürlichen Presenter-, Influencer- oder Figurenmonolog. Erfinde keine zweite Gesprächsfigur, keinen Interviewer, keinen Erzähler und keine Offscreen-Stimme.
- Die Zusammenfassung legt konkret fest, was die Figur sagt und warum. Bei Werbung: relevanter Hook, belegbarer Produktnutzen und glaubwürdiger Abschluss statt leerer Werbefloskeln.
- Wenn der Nutzer bereits einen oder mehrere Sätze für die Figur vorgibt, bleiben Sprecher und Wortlaut unverändert erhalten.
- Beschreibe die sichtbare Sprechperformance mit natürlicher Mimik, Mundbewegung, Gestik und Blickkontakt zur Kamera.
- Wenn die übrigen Angaben ausreichen, darf ready mit genau einer sichtbaren Sprecherfigur true sein.
`;

function enforceStudioAdvertisement(
  result: AiDirectorResult,
  userRequest: string,
): AiDirectorResult {
  const story = result.story;
  const existingSummary = story.summary.trim();
  const existingSetting = story.setting.trim();
  const withoutDeviceInterface =
    forbidsStudioDeviceInterface(
      userRequest,
    );

  return {
    ...result,
    reply:
      `Verstanden: Ich plane ausdrücklich eine Werbung für deine bestehende Webseite ${STUDIO_NAME} (${STUDIO_URL}) – keine erfundene KI-Plattform. ${result.ready ? "Der Filmplan kann jetzt erstellt werden." : result.reply.trim()}`,
    story: {
      ...story,
      title: story.title.toLowerCase().includes("ki video studio")
        ? story.title
        : `${STUDIO_NAME} – ${story.title || "Deine Idee wird sichtbar"}`,
      genre: `Marken- und Produktwerbung für ${STUDIO_NAME}`,
      mood:
        `${story.mood || "Modern und hochwertig"}; vertrauenswürdig, klar und professionell`,
      setting: [
        existingSetting,
        withoutDeviceInterface
          ? `Die spektakulären KI-Video-Ergebnisse erscheinen bildfüllend; Smartphones, Computer, Bildschirme und Benutzeroberflächen bleiben vollständig unsichtbar.`
          : `Eine reale Person benutzt die bestehende Webseite ${STUDIO_NAME} unter ${STUDIO_URL} auf ihrem Smartphone oder Computer.`,
      ].filter(Boolean).join(" "),
      characters:
        story.characters.length > 0
          ? story.characters
          : [
              {
                name: "Nutzerin oder Nutzer",
                description:
                  withoutDeviceInterface
                    ? `Eine sympathische erwachsene Person, die natürlich auf die bildfüllenden KI-Video-Ergebnisse reagiert; keine Geräte oder Benutzeroberflächen sind sichtbar.`
                    : `Eine sympathische erwachsene Person, die ${STUDIO_NAME} auf einem echten Smartphone verwendet und natürlich auf das Ergebnis reagiert.`,
              },
            ],
      summary: [
        `Dies ist ausdrücklich eine Werbung für die bereits bestehende Marke und Webseite ${STUDIO_NAME} (${STUDIO_URL}), nicht für eine erfundene Plattform.`,
        existingSummary,
        withoutDeviceInterface
          ? `Die erzeugten Videos sind der alleinige visuelle Produktbeweis. ${STUDIO_NAME} und ${STUDIO_URL} erscheinen erst nach dem visuellen Hook als saubere Marken- beziehungsweise Schluss-Einblendung; keine Geräte und keine Benutzeroberflächen.`
          : "Die echte Webseite mit den Bereichen Video, Songs und Bilder ist das beworbene Produkt und muss auf dem Gerätedisplay erkennbar sein.",
      ].filter(Boolean).join(" "),
    },
  };
}

function enforceViralStory(
  result: AiDirectorResult,
  selectedCharacterIds: string[],
): AiDirectorResult {
  const selectedCharacters = getViralCharacters(selectedCharacterIds).slice(0, 3);

  if (selectedCharacters.length < 2) return result;

  return {
    ...result,
    ready: true,
    reply:
      "Die Figuren sind festgelegt. Ich habe daraus automatisch eine vertikale TikTok-Story mit starkem Hook, Wendung und eigenen festen Figurenstimmen geplant.",
    story: {
      ...result.story,
      title: result.story.title.trim() || "Die Frucht, die zu viel wusste",
      genre: "Virale vertikale TikTok-Story mit anthropomorphen Früchten",
      mood: [
        result.story.mood,
        "emotional, überraschend, hochwertiger filmischer 3D-Look, schnell verständlich",
      ]
        .filter(Boolean)
        .join("; "),
      setting:
        "Eine luxuriöse tropische Dating-Show-Villa mit Poolterrasse, Feuerkorb, Palmen und warmem Abendlicht. Im Bild erscheinen ausschließlich die ausgewählten anthropomorphen Früchte; keine Menschen, Statisten oder zusätzlichen Figuren.",
      characters: selectedCharacters.map((character) => ({
        name: character.name,
        description: `${character.fixedAppearance} Persönlichkeit: ${character.personality}. Diese Identität und dieses Outfit dürfen in keiner Szene verändert werden.`,
      })),
      summary:
        result.story.summary.trim() ||
        `${selectedCharacters.map((character) => character.name).join(", ")} geraten in einer tropischen Villa in einen sichtbaren Beziehungskonflikt, der durch eine direkte Konfrontation und eine persönliche Entscheidung eskaliert.`,
    },
  };
}

function createGeneralCharacterInstruction(
  selectedCharacterIds: string[],
): string {
  const selectedCharacters = getViralCharacters(selectedCharacterIds).slice(0, 3);

  if (selectedCharacters.length === 0) return "";

  const characterList = selectedCharacters
    .map(
      (character, index) =>
        `${index + 1}. ${character.name}: ${character.fixedAppearance} Persönlichkeit: ${character.personality}.`,
    )
    .join("\n");

  return `
VERBINDLICHE ALLGEMEINE CHARAKTERAUSWAHL

Der Nutzer hat die folgenden festen Charaktere aus der Charakter-Bibliothek ausgewählt:
${characterList}

- Verwende diese Figuren als Hauptcharaktere der vom Nutzer gewünschten Videoidee.
- Namen, Fruchtart, Gesicht, Kopfform, Augen, Körperproportionen, Farben und Kleidung bleiben in jeder Szene unverändert.
- Die Auswahl legt ausdrücklich KEIN Genre und KEIN Format fest. Erzeuge nur dann Trash-TV, eine Dating-Villa oder ein TikTok-Microdrama, wenn der Nutzer das selbst verlangt.
- Die Figuren dürfen genauso in Werbung, Musikvideo, Komödie, Fantasy, Alltag, Kurzfilm, Erklärvideo oder jedem anderen passenden Schauplatz auftreten.
- Passe Handlung, Stimmung, Kamera und Umgebung an die freie Idee des Nutzers an, nicht an frühere Früchte-TV-Vorlagen.
- Erfinde keine menschlichen Ersatzgesichter für die ausgewählten Fruchtfiguren.
${
  selectedCharacters.length === 1
    ? "- Wenn diese eine ausgewählte Figur laut Nutzer vor der Kamera sprechen soll, bleibt sie die einzige Sprecherfigur; erfinde keinen Gesprächspartner."
    : ""
}
`;
}

function enforceGeneralCharacters(
  result: AiDirectorResult,
  selectedCharacterIds: string[],
): AiDirectorResult {
  const selectedCharacters = getViralCharacters(selectedCharacterIds).slice(0, 3);

  if (selectedCharacters.length === 0) return result;

  const fixedCharacterSummary = selectedCharacters
    .map(
      (character) =>
        `${character.name}: ${character.fixedAppearance} Persönlichkeit: ${character.personality}.`,
    )
    .join(" ");

  return {
    ...result,
    story: {
      ...result.story,
      characters: selectedCharacters.map((character) => ({
        name: character.name,
        description: `${character.fixedAppearance} Persönlichkeit: ${character.personality}. Diese feste Identität gilt in jeder Szene; Genre und Schauplatz richten sich ausschließlich nach der freien Videoidee.`,
      })),
      summary: [
        result.story.summary,
        `Verbindliche allgemeine Charakterreferenzen: ${fixedCharacterSummary}`,
        "Die ausgewählten Figuren sind normale Hauptcharaktere dieses Videos. Es gelten keine Trash-TV-, Dating-Villa- oder TikTok-Vorgaben, sofern der Nutzer sie nicht ausdrücklich verlangt.",
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        "Die kurze sichtbare Antwort des AI Directors auf Deutsch.",
    },
    ready: {
      type: Type.BOOLEAN,
      description:
        "True, wenn alle wichtigen Story-Informationen vorhanden sind.",
    },
    story: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description:
            "Passender Filmtitel oder leer, wenn noch nicht bestimmbar.",
        },
        genre: {
          type: Type.STRING,
          description:
            "Genre der Geschichte oder leer, wenn noch unbekannt.",
        },
        mood: {
          type: Type.STRING,
          description:
            "Stimmung und visueller Stil oder leer, wenn noch unbekannt.",
        },
        setting: {
          type: Type.STRING,
          description:
            "Ort und Zeit der Geschichte oder leer, wenn noch unbekannt.",
        },
        characters: {
          type: Type.ARRAY,
          description:
            "Die bisher bekannten Hauptcharaktere.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description:
                  "Name oder kurze Bezeichnung des Charakters.",
              },
              description: {
                type: Type.STRING,
                description:
                  "Aussehen, Persönlichkeit und Rolle des Charakters.",
              },
            },
            required: ["name", "description"],
          },
        },
        summary: {
          type: Type.STRING,
          description:
            "Kurze Zusammenfassung aller bisher bekannten Story-Angaben.",
        },
      },
      required: [
        "title",
        "genre",
        "mood",
        "setting",
        "characters",
        "summary",
      ],
    },
  },
  required: ["reply", "ready", "story"],
};

function isConversationMessage(
  value: unknown,
): value is ConversationMessage {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const message =
    value as Partial<ConversationMessage>;

  return (
    (message.role === "user" ||
      message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= AI_DIRECTOR_MESSAGE_MAX_CHARACTERS &&
    (
      message.dialogueContent === undefined ||
      (
        typeof message.dialogueContent === "string" &&
        message.dialogueContent.length <=
          AI_DIRECTOR_MESSAGE_MAX_CHARACTERS
      )
    )
  );
}

function isStoryCharacter(
  value: unknown,
): value is StoryCharacter {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const character =
    value as Partial<StoryCharacter>;

  return (
    typeof character.name === "string" &&
    typeof character.description === "string"
  );
}

function isStoryDraft(
  value: unknown,
): value is StoryDraft {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const story = value as Partial<StoryDraft>;

  return (
    typeof story.title === "string" &&
    typeof story.genre === "string" &&
    typeof story.mood === "string" &&
    typeof story.setting === "string" &&
    Array.isArray(story.characters) &&
    story.characters.every(isStoryCharacter) &&
    typeof story.summary === "string"
  );
}

function isAiDirectorResult(
  value: unknown,
): value is AiDirectorResult {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const result =
    value as Partial<AiDirectorResult>;

  return (
    typeof result.reply === "string" &&
    typeof result.ready === "boolean" &&
    isStoryDraft(result.story)
  );
}

function parseGeminiJson(
  responseText: string,
): unknown {
  let cleanedText = responseText.trim();

  cleanedText = cleanedText
    .replace(/^\uFEFF/, "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace =
    cleanedText.indexOf("{");

  const lastBrace =
    cleanedText.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1
  ) {
    throw new Error(
      `In der Gemini-Antwort wurde kein JSON gefunden. Antwort: ${cleanedText.slice(
        0,
        300,
      )}`,
    );
  }

  const jsonText = cleanedText.slice(
    firstBrace,
    lastBrace + 1,
  );

  return JSON.parse(jsonText);
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getErrorStatus(
  error: unknown,
): number | undefined {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return undefined;
  }

  const apiError = error as ApiErrorLike;

  if (typeof apiError.status === "number") {
    return apiError.status;
  }

  if (typeof apiError.code === "number") {
    return apiError.code;
  }

  return undefined;
}

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null
  ) {
    const apiError = error as ApiErrorLike;

    if (
      typeof apiError.message === "string"
    ) {
      return apiError.message;
    }
  }

  return "Unbekannter Fehler";
}

function isRetryableGeminiError(
  error: unknown,
): boolean {
  const status = getErrorStatus(error);
  const message =
    getErrorMessage(error).toLowerCase();

  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("resource_exhausted")
  );
}

function isUnavailableGeminiModel(
  error: unknown,
): boolean {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error).toLowerCase();

  return (
    status === 404 ||
    message.includes("model not found") ||
    message.includes("not found for api version") ||
    message.includes("is not supported")
  );
}

function createResilientDirectorDraft(
  messages: ConversationMessage[],
  selectedCharacterIds: string[],
  characterMode: "general" | "viral" | undefined,
  dialogueMode: boolean,
  singleSpeakerMode: boolean,
  musicTrack?: MusicVideoTrackContext,
): AiDirectorResult {
  const selectedCharacters =
    getViralCharacters(selectedCharacterIds).slice(0, 3);

  const userIdea = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, AI_DIRECTOR_MESSAGE_MAX_CHARACTERS);

  const isViralStory =
    characterMode === "viral" && selectedCharacters.length >= 2;

  const characters: StoryCharacter[] = selectedCharacters.length > 0
    ? selectedCharacters.map((character) => ({
        name: character.name,
        description: `${character.fixedAppearance} Persönlichkeit: ${character.personality}.`,
      }))
    : dialogueMode &&
        !singleSpeakerMode
      ? [
          {
            name: "Hauptfigur",
            description:
              "Eine klar erkennbare Hauptfigur mit eigener Haltung und einem konkreten Ziel.",
          },
          {
            name: "Gegenfigur",
            description:
              "Eine deutlich unterscheidbare zweite Figur, die direkt in den zentralen Konflikt verwickelt ist.",
          },
        ]
      : [
          {
            name: "Hauptfigur",
            description:
              "Die zentrale sichtbare Figur der vom Nutzer beschriebenen Videoidee.",
          },
        ];

  return {
    reply:
      "Deine Angaben reichen aus. Ich erstelle daraus jetzt automatisch den vollständigen Filmplan.",
    ready: true,
    story: {
      title: isViralStory
        ? "Auf frischer Tat"
        : musicTrack
          ? `Musikvideo zu ${musicTrack.name}`
          : "Deine Videoidee",
      genre: isViralStory
        ? "Virales Trash-TV-Microdrama"
        : musicTrack
          ? "Musikvideo"
          : "Individuelles KI-Video",
      mood: isViralStory
        ? "emotional, spannungsgeladen, direkt und filmisch"
        : "hochwertig, klar, filmisch und passend zur beschriebenen Idee",
      setting: isViralStory
        ? "Luxuriöse tropische Dating-Show-Villa mit Poolterrasse und warmem Abendlicht."
        : "Ein visuell passender, zusammenhängender Schauplatz, der aus der Videoidee entwickelt wird.",
      characters,
      summary: [
        `Verbindliche Videoidee des Nutzers: ${userIdea || "Eine individuelle, professionell inszenierte Videoidee."}`,
        dialogueMode
          ? singleSpeakerMode
            ? "Die sichtbare Hauptfigur spricht natürlich und direkt vor der Kamera. Es wird keine zweite Gesprächsfigur erfunden."
            : "Die sichtbaren Figuren führen einen kausalen, natürlich klingenden Dialog mit konkretem Konflikt, Reaktionen und Konsequenz."
          : "Die Handlung wird ohne unnötige Rückfragen visuell klar, zusammenhängend und professionell ausgearbeitet.",
        musicTrack
          ? `Der vollständige Originalsong „${musicTrack.name}“ mit ${musicTrack.durationSeconds.toFixed(2)} Sekunden bestimmt Rhythmus und Bildbogen.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

async function generateWithRetry(
  ai: GoogleGenAI,
  conversation: Array<{
    role: "user" | "model";
    parts: Array<{
      text: string;
    }>;
  }>,
  dialogueMode = false,
  singleSpeakerMode = false,
  musicTrack?: MusicVideoTrackContext,
  viralStory = false,
  generalCharacterInstruction = "",
) {
  let lastError: unknown;

  const models =
    viralStory
      ? VIRAL_MODELS
      : STANDARD_MODELS;

  for (const [modelIndex, model] of models.entries()) {
    const attempt = modelIndex + 1;

    try {
      console.log(
        `AI Director: ${model}, Versuch ${attempt}/${models.length}`,
      );

      return await ai.models.generateContent({
        model,
        contents: conversation,
        config: {
          systemInstruction:
            [
              SYSTEM_INSTRUCTION,
              dialogueMode
                ? singleSpeakerMode
                  ? SINGLE_SPEAKER_SYSTEM_INSTRUCTION
                  : DIALOGUE_SYSTEM_INSTRUCTION
                : "",
              generalCharacterInstruction,
              musicTrack
                ? [
                    "VERBINDLICHER MUSIKVIDEO-MODUS",
                    `Der vollständige Originalsong „${musicTrack.name}“ dauert ${musicTrack.durationSeconds.toFixed(2)} Sekunden.`,
                    `Musikalische Analyse: ${musicTrack.analysis}`,
                    "Die Story muss als Musikvideoidee funktionieren und der Bildbogen muss den musikalischen Abschnitten, Energieänderungen, Refrains, Drops, Bridge und Outro folgen.",
                    "Plane keine zusätzliche Musik, Dialoge, Erzählerstimme oder gesprochene Handlung. Die hochgeladene Originaldatei ist später die einzige Tonspur.",
                    "Wenn die visuelle Idee des Nutzers ausreichend ist, ergänze fehlende Schauplätze, Motive und Übergänge selbst und setze ready sofort auf true.",
                  ].join("\n")
                : "",
            ].filter(Boolean).join("\n\n"),

          responseMimeType:
            "application/json",

          responseSchema:
            RESPONSE_SCHEMA,

          thinkingConfig: {
            thinkingLevel:
              ThinkingLevel.LOW,
          },

          maxOutputTokens: 4096,
        },
      });
    } catch (error) {
      lastError = error;

      const status =
        getErrorStatus(error);

      console.error(
        `AI Director: ${model} fehlgeschlagen:`,
        {
          status,
          message:
            getErrorMessage(error),
        },
      );

      const canRetry =
        attempt < models.length &&
        (
          isRetryableGeminiError(error) ||
          isUnavailableGeminiModel(error)
        );

      if (!canRetry) {
        throw error;
      }

      const baseDelay =
        500 * 2 ** (attempt - 1);

      const randomExtraDelay =
        Math.floor(Math.random() * 500);

      const waitTime =
        baseDelay + randomExtraDelay;

      console.log(
        `AI Director wechselt wegen Auslastung von ${model} zum naechsten Modell. Neuer Versuch in ${waitTime} ms.`,
      );

      await sleep(waitTime);
    }
  }

  throw lastError;
}

export async function POST(
  request: Request,
) {
  try {
    const rateLimit = await checkRateLimit(request, "ai-director", 40, 60 * 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "Zu viele KI-Anfragen in kurzer Zeit. Bitte versuche es später erneut.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const apiKey =
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GEMINI_API_KEY fehlt in den Umgebungsvariablen.",
        },
        {
          status: 500,
        },
      );
    }

    let body: RequestBody;

    try {
      body =
        (await request.json()) as RequestBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Die Anfrage enthält kein gültiges JSON.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Es wurden keine Chat-Nachrichten übermittelt.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      body.messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "content" in message &&
          typeof message.content === "string" &&
          message.content.length > AI_DIRECTOR_MESSAGE_MAX_CHARACTERS,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            `Eine Nachricht darf höchstens ${AI_DIRECTOR_MESSAGE_MAX_CHARACTERS} Zeichen enthalten.`,
        },
        { status: 400 },
      );
    }

    const messages = body.messages
      .filter(isConversationMessage)
      .slice(-20);
    
    const latestUserMessage =
  [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user",
    );

const dialogueMessages =
  latestUserMessage
    ? [latestUserMessage]
    : [];

const dialogueSourceText =
  latestUserMessage?.dialogueContent ??
  latestUserMessage?.content ??
  "";

    if (messages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Die übermittelten Nachrichten sind ungültig.",
        },
        {
          status: 400,
        },
      );
    }

    const conversation = messages.map(
      (message) => ({
        role:
          message.role === "assistant"
            ? ("model" as const)
            : ("user" as const),

        parts: [
          {
            text:
              message.content.trim(),
          },
        ],
      }),
    );

    const userConversation = messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");

    const speechIntent =
  inferPromptSpeechIntent(
    dialogueSourceText,
  );

    const ai = new GoogleGenAI({
      apiKey,
    });

    const viralCharacterIds = Array.isArray(body.viralCharacterIds)
      ? body.viralCharacterIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    const characterMode =
      body.characterMode === "general"
        ? "general"
        : body.characterMode === "viral" || viralCharacterIds.length >= 2
          ? "viral"
          : undefined;

    const explicitDialogueEventCount =
  countExplicitDialogueEvents(
    dialogueSourceText,
  );

    const providedDialogueRequested =
      shouldUseProvidedDialogue(
        body.dialogueSourceMode ===
          "provided"
          ? "provided"
          : "automatic",
        explicitDialogueEventCount,
        speechIntent,
      );

    const dialogueMode =
      speechIntent === "voiceover"
        ? false
        : body.dialogueMode === true ||
          providedDialogueRequested;

    const singleSpeakerMode =
      dialogueMode &&
      body.singleSpeakerMode ===
        true;

    const musicTrack =
      isMusicVideoTrackContext(body.musicTrack)
        ? body.musicTrack
        : undefined;

    const isViralStory =
      characterMode === "viral" && viralCharacterIds.length >= 2;

    let result: AiDirectorResult;

    try {
      const response =
        await generateWithRetry(
          ai,
          conversation,
          dialogueMode,
          singleSpeakerMode,
          musicTrack,
          isViralStory,
          characterMode === "general"
            ? createGeneralCharacterInstruction(viralCharacterIds)
            : "",
        );

      const responseText =
        response.text?.trim();

      if (!responseText) {
        throw new Error(
          "Gemini hat keine Antwort zurückgegeben.",
        );
      }

      let parsedResult: unknown;

      try {
        parsedResult =
          parseGeminiJson(responseText);
      } catch (parseError) {
        console.error(
          "Gemini-JSON konnte nicht verarbeitet werden:",
          {
            responseText,
            parseError,
          },
        );

        throw new Error(
          "Gemini hat kein gültiges JSON zurückgegeben.",
        );
      }

      if (!isAiDirectorResult(parsedResult)) {
        console.error(
          "Unerwartete Antwortstruktur:",
          parsedResult,
        );

        throw new Error(
          "Die Antwort von Gemini besitzt nicht die erwartete Struktur.",
        );
      }

      result = parsedResult;
    } catch (generationError) {
      if (
        !isRetryableGeminiError(generationError) &&
        !isUnavailableGeminiModel(generationError)
      ) {
        throw generationError;
      }

      console.warn(
        "Alle AI-Director-Modelle waren vorübergehend nicht erreichbar. Der Filmplan wird mit der sicheren lokalen Vorlage fortgesetzt.",
        {
          status: getErrorStatus(generationError),
          message: getErrorMessage(generationError),
        },
      );

      result = createResilientDirectorDraft(
        messages,
        viralCharacterIds,
        characterMode,
        dialogueMode,
        singleSpeakerMode,
        musicTrack,
      );
    }

    const brandedResult = isStudioWebsiteAdvertisement(userConversation)
      ? enforceStudioAdvertisement(
          result,
          userConversation,
        )
      : result;

    const characterResult =
  characterMode === "general"
    ? enforceGeneralCharacters(
        brandedResult,
        viralCharacterIds,
      )
    : enforceViralStory(
        brandedResult,
        viralCharacterIds,
      );

const preliminaryProvidedDialogue =
  singleSpeakerMode
    ? extractProvidedDialogue(
        dialogueMessages,
        characterResult.story.characters,
        true,
      )
    : [];

const providedSpeakerName =
  preliminaryProvidedDialogue[0]
    ?.speaker;

    const providedSpeakerCharacter =
  providedSpeakerName
    ? characterResult.story.characters.find(
        (character) =>
          character.name ===
          providedSpeakerName,
      )
    : undefined;

    const finalResult =
      singleSpeakerMode &&
      characterResult.story.characters.length > 1
        ? {
            ...characterResult,
            story: {
              ...characterResult.story,
              characters:
                [
                  providedSpeakerCharacter ??
                    characterResult.story.characters[0],
                ],
            },
          }
        : characterResult;

    const providedDialogue =
      preliminaryProvidedDialogue.length > 0
        ? preliminaryProvidedDialogue
        : extractProvidedDialogue(
            dialogueMessages,
            finalResult.story.characters,
            singleSpeakerMode,
          );

    if (
      providedDialogueRequested &&
      (
        providedDialogue.length === 0 ||
        shouldBlockAutomaticDialogueReplacement(
          explicitDialogueEventCount,
          providedDialogue.length,
        )
      )
    ) {
      console.warn(
        "AI Director blockiert automatischen Dialogersatz, weil beschriftete Originaldialoge keiner sichtbaren Figur zugeordnet werden konnten.",
        {
          explicitDialogueEventCount,
          providedDialogueCount:
            providedDialogue.length,
          characterCount:
            finalResult.story.characters.length,
        },
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Der Modus „Originaldialog exakt“ ist aktiv, aber nicht alle Sprechertexte konnten sicher zugeordnet werden. Prüfe die Sprecherbezeichnungen; es wird kein automatischer Ersatzdialog erzeugt.",
        },
        {
          status: 400,
        },
      );
    }

    const finalStory = {
      ...finalResult.story,
      characters:
  providedDialogue.length > 0
    ? ensureDialogueSpeakersAreCharacters(
        finalResult.story.characters,
        providedDialogue,
      )
    : finalResult.story.characters,
      singleSpeakerMode:
        singleSpeakerMode ||
        undefined,
      providedDialogue:
        providedDialogue.length > 0
          ? providedDialogue
          : undefined,
      dialogueSourceMode:
        providedDialogueRequested
          ? "provided"
          : "automatic",
    };

    return NextResponse.json({
      success: true,
      reply:
        providedDialogue.length > 0 &&
        finalResult.ready
          ? `${finalResult.reply.trim()} Deine eingegebenen Dialoge werden wortgetreu übernommen.`
          : finalResult.reply.trim(),
      finished: finalResult.ready,
      story: finalStory,
    });
  } catch (error) {
    console.error(
      "AI-Director-Fehler:",
      error,
    );

    const status =
      getErrorStatus(error);

    const isTemporarilyUnavailable =
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      isRetryableGeminiError(error);

    if (isTemporarilyUnavailable) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Das KI-Modell ist momentan stark ausgelastet. Die Anfrage wurde mehrmals automatisch wiederholt. Bitte versuche es in wenigen Augenblicken erneut.",
        },
        {
          status: 503,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unbekannter Fehler beim AI Director.",
      },
      {
        status: 500,
      },
    );
  }
}
