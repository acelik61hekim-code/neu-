import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from "@google/genai";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type RequestBody = {
  messages?: ConversationMessage[];
};

type StoryCharacter = {
  name: string;
  description: string;
};

type StoryDraft = {
  title: string;
  genre: string;
  mood: string;
  setting: string;
  characters: StoryCharacter[];
  summary: string;
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

const MODEL_NAME = "gemini-3.5-flash-lite";

const MAX_ATTEMPTS = 4;

const SYSTEM_INSTRUCTION = `
Du bist der AI Director einer professionellen KI-Video-Plattform.

Deine Aufgabe ist NICHT nur zu chatten.

Deine Aufgabe ist es, in möglichst wenigen Nachrichten alle Informationen zu sammeln,
die benötigt werden, um daraus eine hochwertige Geschichte mit sechs
zusammenhängenden 8-Sekunden-Videos zu erzeugen.

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

14. Die Geschichte soll später automatisch in sechs Szenen
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
    message.content.trim().length > 0
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

async function generateWithRetry(
  ai: GoogleGenAI,
  conversation: Array<{
    role: "user" | "model";
    parts: Array<{
      text: string;
    }>;
  }>,
) {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      console.log(
        `AI Director: Gemini-Versuch ${attempt}/${MAX_ATTEMPTS}`,
      );

      return await ai.models.generateContent({
        model: MODEL_NAME,
        contents: conversation,
        config: {
          systemInstruction:
            SYSTEM_INSTRUCTION,

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
        `Gemini-Versuch ${attempt} fehlgeschlagen:`,
        {
          status,
          message:
            getErrorMessage(error),
        },
      );

      const canRetry =
        attempt < MAX_ATTEMPTS &&
        isRetryableGeminiError(error);

      if (!canRetry) {
        throw error;
      }

      const baseDelay =
        1000 * 2 ** (attempt - 1);

      const randomExtraDelay =
        Math.floor(Math.random() * 500);

      const waitTime =
        baseDelay + randomExtraDelay;

      console.log(
        `Gemini ist ausgelastet. Neuer Versuch in ${waitTime} ms.`,
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

    const messages = body.messages
      .filter(isConversationMessage)
      .slice(-20);

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

    const ai = new GoogleGenAI({
      apiKey,
    });

    const response =
      await generateWithRetry(
        ai,
        conversation,
      );

    const responseText =
      response.text?.trim();

    if (!responseText) {
      throw new Error(
        "Gemini hat keine Antwort zurückgegeben.",
      );
    }

    let result: unknown;

    try {
      result =
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

    if (!isAiDirectorResult(result)) {
      console.error(
        "Unerwartete Antwortstruktur:",
        result,
      );

      throw new Error(
        "Die Antwort von Gemini besitzt nicht die erwartete Struktur.",
      );
    }

    return NextResponse.json({
      success: true,
      reply: result.reply.trim(),
      finished: result.ready,
      story: result.story,
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
