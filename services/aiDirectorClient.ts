import type { StoryDraft } from "@/types/story";

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiDirectorResponse = {
  reply: string;
  finished: boolean;
  story: StoryDraft;
};

type ApiStoryCharacter = {
  name?: unknown;
  description?: unknown;
};

type ApiStoryDraft = {
  title?: unknown;
  genre?: unknown;
  mood?: unknown;
  setting?: unknown;
  summary?: unknown;
  characters?: unknown;
};

type ApiResponse = {
  success?: boolean;
  reply?: string;
  finished?: boolean;
  story?: ApiStoryDraft;
  error?: string;
};

function createStoryDraft(story: ApiStoryDraft): StoryDraft {
  const rawCharacters = Array.isArray(story.characters)
    ? (story.characters as ApiStoryCharacter[])
    : [];

  return {
    title:
      typeof story.title === "string"
        ? story.title
        : "",
    genre:
      typeof story.genre === "string"
        ? story.genre
        : "",
    mood:
      typeof story.mood === "string"
        ? story.mood
        : "",
    setting:
      typeof story.setting === "string"
        ? story.setting
        : "",
    summary:
      typeof story.summary === "string"
        ? story.summary
        : "",
    characters: rawCharacters
      .filter(
        (character) =>
          typeof character.name === "string" &&
          typeof character.description === "string",
      )
      .map((character, index) => ({
        id: `character-${index + 1}`,
        name: character.name as string,
        description: character.description as string,
      })),
  };
}

export async function requestAiDirector(
  messages: ConversationMessage[],
  viralCharacterIds: string[] = [],
): Promise<AiDirectorResponse> {
  const response = await fetch("/api/ai-director", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      viralCharacterIds,
    }),
  });

  const data = (await response.json()) as ApiResponse;

  if (!response.ok || !data.success) {
    throw new Error(
      data.error ||
        "Der AI Director konnte nicht antworten.",
    );
  }

  if (typeof data.reply !== "string" || !data.reply.trim()) {
    throw new Error(
      "Der AI Director hat keine Antwort zurückgegeben.",
    );
  }

  if (!data.story || typeof data.story !== "object") {
    throw new Error(
      "Der AI Director hat keine Story-Daten zurückgegeben.",
    );
  }

  return {
    reply: data.reply.trim(),
    finished: Boolean(data.finished),
    story: createStoryDraft(data.story),
  };
}
