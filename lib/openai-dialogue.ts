const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const DIALOGUE_WRITER_MODEL = "gpt-5.6-terra";

export type DialogueWriterOptions = {
  speakerNames: string[];
  minimumTurns: number;
  maximumTurns: number;
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
    110_000,
  );

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
            "Schreibe ausschließlich den kausalen, natürlich sprechbaren Dialog für den bereits geplanten Film. Der Wortlaut wird unverändert an Google Veo 3.1 Standard, Google Veo 3.1 Fast, Seedance 2 Fast und Seedance 2 Original weitergereicht.",
            "Antworte ausschließlich im vorgegebenen JSON-Schema. Keine Erklärung und keine zusätzlichen Felder.",
          ].join("\n"),
          input: prompt,
          reasoning: {
            effort: "medium",
          },
          text: {
            format: {
              type: "json_schema",
              name: "video_dialogue_plan",
              strict: true,
              schema: {
                type: "object",
                properties: {
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
                      },
                      required: [
                        "speaker",
                        "text",
                        "voiceDirection",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["turns"],
                additionalProperties: false,
              },
            },
            verbosity: "medium",
          },
          max_output_tokens: 8_000,
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
