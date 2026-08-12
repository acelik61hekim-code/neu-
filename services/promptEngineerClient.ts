import type {
  PromptEngineerRequest,
  PromptEngineerResult,
} from "@/types/story";

type PromptEngineerApiError = {
  success?: false;
  error?: string;
};

export type {
  PromptEngineerRequest,
  PromptEngineerResult,
};

export async function requestPromptEngineer(
  input: PromptEngineerRequest,
): Promise<PromptEngineerResult> {
  const response = await fetch(
    "/api/prompt-engineer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  const data = (await response.json()) as
    | PromptEngineerResult
    | PromptEngineerApiError;

  if (!response.ok) {
    throw new Error(
      "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "Der Prompt Engineer konnte keine Produktionsanweisungen erstellen.",
    );
  }

  if (
    !("veoPrompt" in data) ||
    typeof data.veoPrompt !== "string"
  ) {
    throw new Error(
      "Der Prompt Engineer hat eine ungültige Antwort zurückgegeben.",
    );
  }

  return data;
}