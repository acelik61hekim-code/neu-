const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const DIALOGUE_WRITER_MODEL = "gpt-5.6-terra";

export type DialogueWriterOptions = {
  speakerNames: string[];
  minimumTurns: number;
  maximumTurns: number;
style?:
  | "conversation"
  | "spokesperson"
  | "viral-story";
};

type OpenAIResponseContent = {
  type?: unknown;
  text?: unknown;
};

type OpenAIResponseOutput = {
  type?: unknown;
  content?: unknown;
};

type OpenAIResponseBody = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
  incomplete_details?: {
    reason?: unknown;
  };
  output?: unknown;
  output_text?: unknown;
  status?: unknown;
};

export class OpenAIResponsesError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
    } = {},
  ) {
    super(message);
    this.name = "OpenAIResponsesError";
    this.status = options.status;
    this.code = options.code;
  }
}

function readOutputText(
  response: OpenAIResponseBody,
): string {
  if (
    typeof response.output_text === "string" &&
    response.output_text.trim()
  ) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return "";
  }

  return (response.output as OpenAIResponseOutput[])
    .flatMap((item) =>
      Array.isArray(item.content)
        ? (item.content as OpenAIResponseContent[])
        : [],
    )
    .filter(
      (content) =>
        content.type === "output_text" &&
        typeof content.text === "string",
    )
    .map((content) => content.text as string)
    .join("")
    .trim();
}

function readApiErrorMessage(
  response: OpenAIResponseBody,
  status: number,
): string {
  if (
    response.error &&
    typeof response.error.message === "string" &&
    response.error.message.trim()
  ) {
    return response.error.message.trim();
  }

  if (
    response.incomplete_details &&
    typeof response.incomplete_details.reason === "string"
  ) {
    return `OpenAI-Antwort unvollständig: ${response.incomplete_details.reason}`;
  }

  return `OpenAI Responses API fehlgeschlagen (HTTP ${status}).`;
}

export async function generateStructuredDialoguePlan(
  apiKey: string,
  prompt: string,
  options: DialogueWriterOptions,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    20_000,
  );

  const isSpokesperson =
  options.style ===
  "spokesperson";

const isViralStory =
  options.style ===
  "viral-story";

  try {
    const response = await fetch(
      OPENAI_RESPONSES_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DIALOGUE_WRITER_MODEL,
          instructions: [
            "Du bist der zentrale professionelle Dialog- und Story-Autor für eine deutsche KI-Videoplattform.",
            isSpokesperson
              ? "Schreibe einen kurzen, natürlichen Presenter- oder Influencer-Monolog für die einzige sichtbare Sprecherfigur. Der Wortlaut wird unverändert an Google Veo 3.1 Standard, Google Veo 3.1 Fast, Seedance 2 Fast und Seedance 2 Original weitergereicht."
              : "Schreibe ausschließlich den kausalen, natürlich sprechbaren Dialog für den bereits geplanten Film. Der Wortlaut wird unverändert an Google Veo 3.1 Standard, Google Veo 3.1 Fast, Seedance 2 Fast und Seedance 2 Original weitergereicht.",
            isSpokesperson
              ? "Der contract hält Produkt, Zielgruppe, Nutzen, sichtbare Umgebung, Beleg und Handlungsaufforderung unveränderlich fest. Erfinde keine zweite Figur, keinen Streit und kein Interview."
              : "Lege zuerst im contract genau eine unveränderliche Faktenkette fest. Jeder Dialogsatz darf nur diese Fakten verwenden; neue Gegenstände, Beweise, Beziehungen oder Orte während des Gesprächs sind verboten.",
            isSpokesperson
              ? "Der Monolog klingt spontan und glaubwürdig, nicht wie vorgelesener Werbetext."
              : "Schreibe schnelle Alltagssprache wie in einer viralen TikTok-Mini-Serie: überwiegend drei bis acht Wörter, direkter Sprecherwechsel, unmittelbare Antwort und Gegenreaktion. Verboten sind Meta-Sätze über das Gespräch, den wichtigsten Punkt, die gemeinsame Entscheidung oder die Folgen aus einer Perspektive.",
            isSpokesperson
              ? "respondsToTurn entspricht für jede Monologzeile ihrer vorherigen Position: erste Zeile null, zweite Zeile eins, dritte Zeile zwei."
              : "respondsToTurn verweist ab der zweiten Zeile immer auf die unmittelbar vorherige einbasierte Zeilennummer. Die erste Zeile verwendet null.",
            "Antworte ausschließlich im vorgegebenen JSON-Schema. Keine Erklärung und keine zusätzlichen Felder.",
          ].join("\n"),
          input: prompt,
         reasoning: {
  effort:
    isViralStory
      ? "medium"
      : "low",
},
          text: {
            format: {
              type: "json_schema",
              name: "video_dialogue_plan",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  contract: {
                    type: "object",
                    properties: {
                      relationship: {
                        type: "string",
                      },
                      witnessedEvent: {
                        type: "string",
                      },
                      location: {
                        type: "string",
                      },
                      accusedResponse: {
                        type: "string",
                      },
                      contradiction: {
                        type: "string",
                      },
                      consequence: {
                        type: "string",
                      },
                      supportingEvidence: {
                        type: "string",
                      },
                    },
                    required: [
                      "relationship",
                      "witnessedEvent",
                      "location",
                      "accusedResponse",
                      "contradiction",
                      "consequence",
                      "supportingEvidence",
                    ],
                    additionalProperties: false,
                  },
                  turns: {
                    type: "array",
                    minItems: options.minimumTurns,
                    maxItems: options.maximumTurns,
                    items: {
                      type: "object",
                      properties: {
                        speaker: {
                          type: "string",
                          enum: options.speakerNames,
                        },
                        text: {
                          type: "string",
                        },
                        voiceDirection: {
                          type: "string",
                        },
                        purpose: {
                          type: "string",
                          enum: [
                            "discovery",
                            "accusation",
                            "answer",
                            "contradiction",
                            "admission",
                            "decision",
                            "consequence",
                            "cliffhanger",
                          ],
                        },
                        respondsToTurn: {
                          type: "integer",
                          minimum: 0,
                        },
                        factKeys: {
                          type: "array",
                          minItems: 1,
                          maxItems: 2,
                          items: {
                            type: "string",
                            enum: [
                              "relationship",
                              "witnessedEvent",
                              "location",
                              "accusedResponse",
                              "contradiction",
                              "consequence",
                              "supportingEvidence",
                            ],
                          },
                        },
                      },
                      required: [
                        "speaker",
                        "text",
                        "voiceDirection",
                        "purpose",
                        "respondsToTurn",
                        "factKeys",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: [
                  "contract",
                  "turns",
                ],
                additionalProperties: false,
              },
            },
            verbosity: "medium",
          },
          max_output_tokens: 4_000,
          store: false,
        }),
        signal: controller.signal,
      },
    );

    let data: OpenAIResponseBody;

    try {
      data = (await response.json()) as OpenAIResponseBody;
    } catch {
      throw new OpenAIResponsesError(
        `OpenAI hat keine gültige JSON-Antwort geliefert (HTTP ${response.status}).`,
        { status: response.status },
      );
    }

    if (!response.ok) {
      throw new OpenAIResponsesError(
        readApiErrorMessage(data, response.status),
        {
          status: response.status,
          code:
            typeof data.error?.code === "string"
              ? data.error.code
              : undefined,
        },
      );
    }

    if (data.status === "incomplete") {
      throw new OpenAIResponsesError(
        readApiErrorMessage(data, response.status),
        { status: response.status },
      );
    }

    const outputText = readOutputText(data);

    if (!outputText) {
      throw new OpenAIResponsesError(
        "GPT-5.6 Terra hat keinen Filmplan zurückgegeben.",
        { status: response.status },
      );
    }

    return outputText;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new OpenAIResponsesError(
        "GPT-5.6 Terra hat nicht rechtzeitig geantwortet.",
        { status: 504 },
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
