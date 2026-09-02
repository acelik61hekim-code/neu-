import type {
  DialogueSourceMode,
  MusicVideoTrackContext,
  StoryDraft,
} from "@/types/story";

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  dialogueContent?: string;
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
  providedDialogue?: unknown;
  singleSpeakerMode?: unknown;
  dialogueSourceMode?: unknown;
};

type ApiProvidedDialogueLine = {
  speaker?: unknown;
  text?: unknown;
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

  const providedDialogue =
    Array.isArray(
      story.providedDialogue,
    )
      ? (
          story.providedDialogue as ApiProvidedDialogueLine[]
        )
          .filter(
            (line) =>
              typeof line.speaker === "string" &&
              typeof line.text === "string" &&
              line.speaker.trim().length > 0 &&
              line.text.trim().length > 0,
          )
          .map((line) => ({
            speaker:
              (line.speaker as string).trim(),
            text:
              (line.text as string).trim(),
          }))
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
    providedDialogue:
      providedDialogue.length > 0
        ? providedDialogue
        : undefined,
    singleSpeakerMode:
      story.singleSpeakerMode ===
        true
        ? true
        : undefined,
    dialogueSourceMode:
      story.dialogueSourceMode ===
        "provided"
        ? "provided"
        : "automatic",
  };
}

export async function requestAiDirector(
  messages: ConversationMessage[],
  viralCharacterIds: string[] = [],
  dialogueMode = false,
  musicTrack?: MusicVideoTrackContext,
  characterMode?: "general" | "viral",
  singleSpeakerMode = false,
  dialogueSourceMode:
    DialogueSourceMode =
      "automatic",
): Promise<AiDirectorResponse> {
  const response = await fetch("/api/ai-director", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      viralCharacterIds,
      dialogueMode,
      musicTrack,
      characterMode,
      singleSpeakerMode,
      dialogueSourceMode,
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
