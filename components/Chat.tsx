"use client";

import { useState } from "react";

import { AI_DIRECTOR_MESSAGE_MAX_CHARACTERS } from "@/lib/ai-director-limits";

import {
  requestAiDirector,
  type ConversationMessage,
} from "@/services/aiDirectorClient";

import { requestStoryArchitect } from "@/services/storyArchitectClient";
import { requestAutomaticVoiceover } from "@/services/voiceoverClient";
import ViralStoryStarter from "@/components/ViralStoryStarter";
import {
  createViralStoryPrompt,
  type ViralCharacter,
} from "@/lib/viral-characters";

import type {
  Story,
  VideoAspectRatio,
  VideoAudioStyle,
  VideoDurationSeconds,
  VideoEditingStyle,
  VideoSpokenLanguage,
  VideoVoiceMode,
} from "@/types/story";

import {
  ArrowIcon,
  BotIcon,
  LoadingIcon,
  WarningIcon,
} from "./Icons";

type ChatProps = {
  loading: boolean;
  error: string | null;
  onStoryChange: (story: string) => void;
  onVoiceoverTextChange?: (text: string) => void;

  /*
   * Optional, damit app/page.tsx während der Umstellung
   * weiterhin ohne Änderungen kompiliert.
   *
   * Sobald page.tsx die Auswahl besitzt, werden diese
   * drei Werte von dort an Chat übergeben.
   */
  targetDurationSeconds?: VideoDurationSeconds;
  aspectRatio?: VideoAspectRatio;
  editingStyle?: VideoEditingStyle;
  audioStyle?: VideoAudioStyle;
  voiceMode?: VideoVoiceMode;
  spokenLanguage?: VideoSpokenLanguage;
  voiceoverText?: string;
  closingText?: string;
  onViralStoryStart?: (characters: ViralCharacter[]) => Promise<void> | void;
};

type Message = ConversationMessage & {
  id: number;
};

const INITIAL_MESSAGE: Message = {
  id: 1,
  role: "assistant",
  content:
    "Hallo! Ich bin dein persönlicher AI Director. Welche Geschichte möchtest du als KI-Video erzählen?",
};

function formatDuration(
  durationSeconds: VideoDurationSeconds,
): string {
  if (durationSeconds < 60) {
    return `${durationSeconds} Sek.`;
  }

  const minutes = durationSeconds / 60;

  return minutes === 1
    ? "1 Min."
    : `${minutes} Min.`;
}

function formatEditingStyle(
  editingStyle: VideoEditingStyle,
): string {
  switch (editingStyle) {
    case "cinematic":
      return "Kino / Film";

    case "music-video":
      return "Musikvideo";

    case "auto":
      return "Auto";

    default:
      return "Social / Reels";
  }
}

function formatAspectRatio(
  aspectRatio: VideoAspectRatio,
): string {
  return aspectRatio === "16:9"
    ? "16:9 Widescreen"
    : "9:16 Vertikal";
}

export default function Chat({
  loading,
  error,
  onStoryChange,
  onVoiceoverTextChange,
  targetDurationSeconds = 60,
  aspectRatio = "9:16",
  editingStyle = "social",
  audioStyle = "cinematic",
  voiceMode = "auto",
  spokenLanguage = "de",
  voiceoverText = "",
  closingText = "",
  onViralStoryStart,
}: ChatProps) {
  const [messages, setMessages] =
    useState<Message[]>([
      INITIAL_MESSAGE,
    ]);

  const [input, setInput] =
    useState("");

  const [thinking, setThinking] =
    useState(false);

  const [
    creatingMoviePlan,
    setCreatingMoviePlan,
  ] = useState(false);

  const [finished, setFinished] =
    useState(false);

  const [activeViralCharacterIds, setActiveViralCharacterIds] =
    useState<string[]>([]);

  const [
    completeStory,
    setCompleteStory,
  ] = useState<Story | null>(
    null,
  );

  const [
    localError,
    setLocalError,
  ] =
    useState<string | null>(
      null,
    );

  function createStoryNotes(
    conversation: Message[],
  ) {
    const userMessages =
      conversation.filter(
        (message) =>
          message.role === "user",
      );

    if (
      userMessages.length === 0
    ) {
      return "";
    }

    return [
      "Bisherige Angaben des Nutzers:",
      ...userMessages.map(
        (message, index) =>
          `${index + 1}. ${message.content}`,
      ),
    ].join("\n\n");
  }

  async function handleSubmit(
    preparedInput?: string,
    preparedViralCharacterIds?: string[],
  ) {
    const cleanedInput =
      (preparedInput ?? input).trim();

    const viralCharacterIds =
      preparedViralCharacterIds ?? activeViralCharacterIds;

    const isViralStory = viralCharacterIds.length >= 2;

    if (!cleanedInput) {
      setLocalError(
        "Bitte schreibe zuerst eine Antwort.",
      );

      return;
    }

    if (
      cleanedInput.length < 3
    ) {
      setLocalError(
        "Deine Antwort ist noch etwas zu kurz.",
      );

      return;
    }

    if (
      thinking ||
      creatingMoviePlan ||
      finished ||
      loading
    ) {
      return;
    }

    setLocalError(null);

    const userMessage: Message = {
      id: Date.now(),
      role: "user",
      content: cleanedInput,
    };

    const updatedMessages = [
      ...messages,
      userMessage,
    ];

    setMessages(
      updatedMessages,
    );

    setInput("");
    setThinking(true);

    const storyNotes =
      createStoryNotes(
        updatedMessages,
      );

    onStoryChange(storyNotes);

    try {
      const conversation:
        ConversationMessage[] =
        updatedMessages.map(
          (message) => ({
            role:
              message.role,
            content:
              message.content,
          }),
        );

      const directorResult =
        await requestAiDirector(
          conversation,
          viralCharacterIds,
          !isViralStory && voiceMode === "dialogue",
        );

      const assistantMessage:
        Message = {
        id: Date.now() + 1,
        role: "assistant",
        content:
          directorResult.reply,
      };

      setMessages(
        (
          previousMessages,
        ) => [
          ...previousMessages,
          assistantMessage,
        ],
      );

      const directorFinished =
        directorResult.finished;

      if (!directorFinished) {
        return;
      }

      setThinking(false);

      setCreatingMoviePlan(
        true,
      );

      /*
       * WICHTIG:
       * Hier wird ausschließlich geplant.
       *
       * Es wird KEIN Veo-Video gestartet.
       * Die teure Videogenerierung gehört in den
       * Flow:
       *
       * Story -> Preview -> Bestätigung -> Zahlung
       * -> serverseitig verifizierter Auftrag -> Render.
       */
      const generatedStory =
        await requestStoryArchitect(
          directorResult.story,
          targetDurationSeconds,
          isViralStory ? "9:16" : aspectRatio,
          isViralStory ? "social" : editingStyle,
          audioStyle,
          isViralStory ? "dialogue" : voiceMode,
          spokenLanguage,
          voiceoverText,
          closingText,
          isViralStory ? "viral-story" : "standard",
        );

      if (
        !generatedStory.moviePlan
      ) {
        throw new Error(
          "Der Story Architect hat keinen gültigen MoviePlan zurückgegeben.",
        );
      }

      if (
        voiceMode === "voiceover" &&
        !voiceoverText.trim() &&
        onVoiceoverTextChange
      ) {
        try {
          const automaticVoiceover =
            await requestAutomaticVoiceover(
              generatedStory,
              targetDurationSeconds,
              spokenLanguage,
            );

          onVoiceoverTextChange(
            automaticVoiceover,
          );
        } catch (voiceoverError) {
          setLocalError(
            voiceoverError instanceof Error
              ? `${voiceoverError.message} Du kannst den Sprechertext auch selbst eintragen.`
              : "Der automatische Sprechertext konnte nicht erstellt werden. Du kannst ihn selbst eintragen.",
          );
        }
      }

      setCompleteStory(
        generatedStory,
      );

      setFinished(true);

      onStoryChange(
        JSON.stringify(
          generatedStory,
          null,
          2,
        ),
      );
    } catch (
      requestError
    ) {
      console.error(
        "Story-Erstellung fehlgeschlagen:",
        requestError,
      );

      setLocalError(
        requestError instanceof
          Error
          ? requestError.message
          : "Die Story konnte nicht erstellt werden.",
      );
    } finally {
      setThinking(false);

      setCreatingMoviePlan(
        false,
      );
    }
  }

  async function handleViralStoryCreate(
    characters: ViralCharacter[],
    topic: string,
  ) {
    if (thinking || creatingMoviePlan || finished || loading) return;

    const ids = characters.map((character) => character.id);
    setActiveViralCharacterIds(ids);
    setLocalError(null);

    try {
      await onViralStoryStart?.(characters);
      await handleSubmit(
        createViralStoryPrompt(ids, topic, targetDurationSeconds),
        ids,
      );
    } catch (viralError) {
      setLocalError(
        viralError instanceof Error
          ? viralError.message
          : "Der TikTok-Story-Modus konnte nicht gestartet werden.",
      );
    }
  }

  function handleKeyDown(
    event:
      React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      void handleSubmit();
    }
  }

  function restartConversation() {
    setMessages([
      {
        ...INITIAL_MESSAGE,
        id: Date.now(),
      },
    ]);

    setInput("");
    setThinking(false);

    setCreatingMoviePlan(
      false,
    );

    setFinished(false);

    setActiveViralCharacterIds([]);

    setCompleteStory(
      null,
    );

    setLocalError(
      null,
    );

    onStoryChange("");
  }

  const displayedError =
    localError || error;

  const isProcessing =
    thinking ||
    creatingMoviePlan;

  const statusText =
    creatingMoviePlan
      ? `Plant ${formatDuration(
          targetDurationSeconds,
        )} · ${formatEditingStyle(
          editingStyle,
        )} ...`
      : thinking
        ? "Denkt nach ..."
        : "Bereit";

  const activityLabel =
    finished
      ? "Filmplan fertig"
      : creatingMoviePlan
        ? "Story Architect aktiv"
        : "Gemini aktiv";

  const plan =
    completeStory?.moviePlan;

  return (
    <section className="flex min-h-[720px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
            <BotIcon />
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white">
              AI Director
            </h2>

            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isProcessing
                    ? "bg-amber-400"
                    : "bg-emerald-400"
                }`}
              />

              {statusText}
            </div>
          </div>
        </div>

        <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-zinc-500">
          {activityLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
          {!finished ? (
            <ViralStoryStarter
              disabled={isProcessing || loading}
              onCreate={handleViralStoryCreate}
            />
          ) : null}

          {messages.map(
            (message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role ===
                  "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl p-4 text-sm leading-6 ${
                    message.role ===
                    "user"
                      ? "rounded-tr-md bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-950/30"
                      : "rounded-tl-md border border-white/10 bg-white/5 text-zinc-300"
                  }`}
                >
                  {
                    message.content
                  }
                </div>
              </div>
            ),
          )}

          {thinking && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-400">
                <LoadingIcon className="animate-spin" />
                AI Director denkt
                nach
              </div>
            </div>
          )}

          {creatingMoviePlan && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-200">
                <LoadingIcon className="animate-spin" />
                Story Architect
                plant{" "}
                {formatDuration(
                  targetDurationSeconds,
                )}{" "}
                ·{" "}
                {formatEditingStyle(
                  editingStyle,
                )}{" "}
                ·{" "}
                {formatAspectRatio(
                  aspectRatio,
                )}
              </div>
            </div>
          )}

          {plan && completeStory && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-violet-400/20 bg-violet-400/10 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                  Filmplan
                </p>

                <h3 className="mt-2 text-lg font-semibold text-white">
                  {
                    completeStory.title
                  }
                </h3>

                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {
                    completeStory.summary
                  }
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-lg bg-black/20 px-2.5 py-1 text-xs text-violet-200">
                    {
                      completeStory.genre
                    }
                  </span>

                  <span className="rounded-lg bg-black/20 px-2.5 py-1 text-xs text-violet-200">
                    {
                      completeStory.mood
                    }
                  </span>

                  <span className="rounded-lg bg-black/20 px-2.5 py-1 text-xs text-violet-200">
                    {formatDuration(
                      plan.targetDurationSeconds,
                    )}
                  </span>

                  <span className="rounded-lg bg-black/20 px-2.5 py-1 text-xs text-violet-200">
                    {formatAspectRatio(
                      plan.aspectRatio,
                    )}
                  </span>

                  <span className="rounded-lg bg-black/20 px-2.5 py-1 text-xs text-violet-200">
                    {formatEditingStyle(
                      plan.editingStyle ??
                        "social",
                    )}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                <p className="text-sm font-medium text-emerald-200">
                  ✓ Planung abgeschlossen
                </p>

                <p className="mt-1 text-xs leading-5 text-emerald-200/70">
                  Hier wird bewusst noch
                  kein kostenpflichtiges
                  Video erzeugt. Der
                  fertige Filmplan geht
                  als Nächstes in die
                  Vorschau und danach in
                  den Zahlungs- und
                  Render-Flow.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                  Opening · 0–8 Sekunden
                </p>

                <h4 className="mt-2 font-semibold text-white">
                  {
                    plan.opening.title
                  }
                </h4>

                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {
                    plan.opening.action
                  }
                </p>

                <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                  <PromptSection
                    title="Hook"
                    content={
                      plan.opening.hook
                    }
                  />

                  <PromptSection
                    title="Kamera"
                    content={
                      plan.opening
                        .cameraPlan
                    }
                  />

                  <PromptSection
                    title="Veo-Prompt"
                    content={
                      plan.opening
                        .veoPrompt
                    }
                  />

                  <PromptSection
                    title="Audio"
                    content={
                      plan.opening
                        .audioPrompt
                    }
                  />
                </div>
              </div>

              {plan.continuations.length >
                0 && (
                <div className="space-y-3">
                  {plan.continuations.map(
                    (
                      continuation,
                    ) => (
                      <article
                        key={
                          continuation.id
                        }
                        className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                            Fortsetzung{" "}
                            {
                              continuation.extensionNumber
                            }
                          </p>

                          <span className="rounded-lg bg-white/5 px-2 py-1 text-xs text-zinc-500">
                            {
                              continuation.startSecond
                            }
                            –
                            {
                              continuation.endSecond
                            }{" "}
                            Sek.
                          </span>
                        </div>

                        <h4 className="mt-2 font-semibold text-white">
                          {
                            continuation.title
                          }
                        </h4>

                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                          {
                            continuation.actionContinuation
                          }
                        </p>

                        <div className="mt-3 space-y-3">
                          <PromptSection
                            title="Story Beat"
                            content={
                              continuation.storyBeat
                            }
                          />

                          <PromptSection
                            title="Kamera / Schnitt"
                            content={
                              continuation.cameraContinuation
                            }
                          />
                        </div>
                      </article>
                    ),
                  )}
                </div>
              )}

              {plan.chapters &&
                plan.chapters.length >
                  0 && (
                  <div className="space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Kapitelplan
                    </p>

                    {plan.chapters.map(
                      (chapter) => (
                        <article
                          key={
                            chapter.id
                          }
                          className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-xs font-medium uppercase tracking-wider text-violet-300">
                              Kapitel{" "}
                              {
                                chapter.id
                              }
                            </p>

                            <span className="rounded-lg bg-white/5 px-2 py-1 text-xs text-zinc-500">
                              {
                                chapter.startSecond
                              }
                              –
                              {
                                chapter.endSecond
                              }{" "}
                              Sek.
                            </span>
                          </div>

                          <h4 className="mt-2 font-semibold text-white">
                            {
                              chapter.title
                            }
                          </h4>

                          <div className="mt-3 space-y-3">
                            <PromptSection
                              title="Story-Ziel"
                              content={
                                chapter.storyGoal
                              }
                            />

                            <PromptSection
                              title="Visuelles Ziel"
                              content={
                                chapter.visualGoal
                              }
                            />

                            <PromptSection
                              title="Übergang"
                              content={
                                chapter.transitionOut
                              }
                            />
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-5 sm:p-6">
          {finished &&
          completeStory ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
              <p className="text-sm font-medium text-emerald-200">
                Dein Filmplan ist
                vollständig.
              </p>

              <p className="mt-1 text-xs leading-5 text-emerald-200/60">
                Prüfe rechts die
                Vorschau. Erst nach
                Freigabe und Zahlung
                wird die eigentliche
                Videogenerierung
                gestartet.
              </p>

              <button
                type="button"
                onClick={
                  restartConversation
                }
                className="mt-4 rounded-xl border border-emerald-300/20 bg-black/20 px-4 py-2 text-xs font-medium text-emerald-100 transition hover:bg-black/30"
              >
                Neue Story beginnen
              </button>
            </div>
          ) : (
            <>
              <div
                className={`rounded-2xl border bg-black/30 transition ${
                  displayedError
                    ? "border-red-400/40"
                    : "border-white/10 focus-within:border-violet-400/50"
                }`}
              >
                <textarea
                  value={input}
                  onChange={(
                    event,
                  ) => {
                    setInput(
                      event.target
                        .value,
                    );

                    if (
                      localError
                    ) {
                      setLocalError(
                        null,
                      );
                    }
                  }}
                  onKeyDown={
                    handleKeyDown
                  }
                  disabled={
                    isProcessing ||
                    loading
                  }
                  maxLength={
                    AI_DIRECTOR_MESSAGE_MAX_CHARACTERS
                  }
                  placeholder="Beschreibe deine Idee oder beantworte die Frage des AI Directors ..."
                  className="min-h-28 w-full resize-none border-0 bg-transparent px-4 py-4 text-sm leading-6 text-white outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
                />

                <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
                  <span className="text-xs text-zinc-600">
                    {
                      input.length
                    }
                    /{AI_DIRECTOR_MESSAGE_MAX_CHARACTERS} Zeichen
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      void handleSubmit()
                    }
                    disabled={
                      isProcessing ||
                      loading
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isProcessing ? (
                      <>
                        <LoadingIcon className="animate-spin" />
                        Einen Moment
                      </>
                    ) : (
                      <>
                        Senden
                        <ArrowIcon />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {displayedError && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-sm text-red-200">
                  <WarningIcon className="mt-0.5 shrink-0" />

                  <span>
                    {
                      displayedError
                    }
                  </span>
                </div>
              )}

              <p className="mt-3 text-xs leading-5 text-zinc-600">
                Enter zum Senden ·
                Shift + Enter für
                eine neue Zeile
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

type PromptSectionProps = {
  title: string;
  content?: string;
};

function PromptSection({
  title,
  content,
}: PromptSectionProps) {
  if (!content) {
    return null;
  }

  return (
    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </p>

      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-zinc-300">
        {content}
      </p>
    </div>
  );
}
