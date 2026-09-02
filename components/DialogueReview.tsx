"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  approveDialogueReview,
  hasApprovedDialogueReview,
  inspectDialogueQuality,
} from "@/lib/dialogue-quality";

import type {
  Story,
  VideoSpokenLanguage,
  VideoModelId,
  VideoVoiceMode,
} from "@/types/story";

import {
  LoadingIcon,
  WarningIcon,
} from "./Icons";

type DialogueReviewProps = {
  story: Story;
  voiceMode: VideoVoiceMode;
  voiceoverText: string;
  targetDurationSeconds: number;
  videoModel: VideoModelId;
  spokenLanguage: VideoSpokenLanguage;
  disabled?: boolean;
  onStoryChange: (story: Story) => void;
};

export default function DialogueReview({
  story,
  voiceMode,
  voiceoverText,
  targetDurationSeconds,
  videoModel,
  spokenLanguage,
  disabled = false,
  onStoryChange,
}: DialogueReviewProps) {
  const [loadingIndex, setLoadingIndex] =
    useState<number | null>(null);
  const [previewUrls, setPreviewUrls] =
    useState<Record<number, string>>({});
  const previewUrlsRef = useRef<
    Record<number, string>
  >({});
  const [previewError, setPreviewError] =
    useState<string | null>(null);
  const dialogue =
    story.providedDialogue ?? [];
  const orderedSpeakers = useMemo(
    () =>
      Array.from(
        new Set(
          dialogue.map((line) =>
            line.speaker.trim(),
          ),
        ),
      ),
    [dialogue],
  );
  const report = inspectDialogueQuality(
    story,
    {
      voiceMode,
      voiceoverText,
      targetDurationSeconds,
      videoModel,
      requireApproval: false,
    },
  );
  const approved =
    hasApprovedDialogueReview(story);

  useEffect(
    () => () => {
      Object.values(previewUrlsRef.current).forEach(
        (url) => URL.revokeObjectURL(url),
      );
    },
    [],
  );

  if (!report.required) {
    return null;
  }

  function updatePronunciation(
    index: number,
    value: string,
  ) {
    setPreviewError(null);
    setPreviewUrls((current) => {
      const previous = current[index];

      if (!previous) {
        return current;
      }

      URL.revokeObjectURL(previous);

      const next = {
        ...current,
      };

      delete next[index];
      previewUrlsRef.current = next;

      return next;
    });

    const nextDialogue = dialogue.map(
      (line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              ...(value.trim() &&
              value.trim() !== line.text.trim()
                ? {
                    pronunciation: value,
                  }
                : {
                    pronunciation: undefined,
                  }),
            }
          : line,
    );

    onStoryChange({
      ...story,
      providedDialogue: nextDialogue,
      dialogueReview: undefined,
    });
  }

  async function createSpeechPreview(
    index: number,
  ) {
    const line = dialogue[index];

    if (!line || loadingIndex !== null) {
      return;
    }

    setPreviewError(null);
    setLoadingIndex(index);

    try {
      const response = await fetch(
        "/api/dialogue-speech-preview",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            speaker: line.speaker,
            speakers: orderedSpeakers,
            text:
              line.pronunciation?.trim() ||
              line.text,
            language: spokenLanguage,
          }),
        },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({})) as {
            error?: string;
          };

        throw new Error(
          error.error ||
            "Die Hörprobe konnte nicht erstellt werden.",
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      setPreviewUrls((current) => {
        const previous = current[index];

        if (previous) {
          URL.revokeObjectURL(previous);
        }

        const next = {
          ...current,
          [index]: url,
        };

        previewUrlsRef.current = next;

        return next;
      });
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : "Die Hörprobe konnte nicht erstellt werden.",
      );
    } finally {
      setLoadingIndex(null);
    }
  }

  function approve() {
    if (!report.ready) {
      return;
    }

    onStoryChange(
      approveDialogueReview(story),
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.055] shadow-2xl shadow-black/25">
      <div className="border-b border-emerald-400/15 px-5 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">
          Verbindlicher Originaldialog
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">
          Sprecher, Wortlaut und Aussprache bestätigen
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Der sichtbare Text bleibt unverändert. Im Aussprachefeld kannst du nur festlegen, wie Namen oder Fremdwörter gesprochen werden.
        </p>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        {dialogue.map((line, index) => (
          <article
            key={`${index}-${line.speaker}-${line.text}`}
            className="rounded-2xl border border-white/10 bg-black/25 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-emerald-100">
                {index + 1}. {line.speaker}
              </p>
              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                Wortlaut gesperrt
              </span>
            </div>

            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-sm leading-6 text-white">
              „{line.text}“
            </p>

            <label className="mt-3 block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Aussprache-Schreibweise
              </span>
              <input
                value={
                  line.pronunciation ??
                  line.text
                }
                onChange={(event) =>
                  updatePronunciation(
                    index,
                    event.target.value,
                  )
                }
                disabled={disabled}
                maxLength={500}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-zinc-200 outline-none transition focus:border-emerald-400/40 disabled:opacity-50"
              />
            </label>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() =>
                  void createSpeechPreview(index)
                }
                disabled={
                  disabled ||
                  loadingIndex !== null
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                {loadingIndex === index ? (
                  <>
                    <LoadingIcon className="animate-spin" />
                    Hörprobe wird erstellt
                  </>
                ) : (
                  "▶ Aussprache anhören"
                )}
              </button>

              {previewUrls[index] && (
                <audio
                  controls
                  src={previewUrls[index]}
                  className="h-9 min-w-0 flex-1"
                />
              )}
            </div>
          </article>
        ))}

        {previewError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-sm text-red-100">
            <WarningIcon className="mt-0.5 shrink-0" />
            {previewError}
          </div>
        )}

        <div className={`rounded-2xl border p-4 ${
          report.ready
            ? "border-emerald-400/20 bg-emerald-400/[0.07]"
            : "border-red-400/25 bg-red-400/[0.07]"
        }`}>
          <p className="text-sm font-semibold text-white">
            Technische Dialogprüfung
          </p>

          {report.ready ? (
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-emerald-200/80">
              <li>✓ {report.dialogueCount} Sprachereignisse vollständig und geordnet</li>
              <li>✓ Alle Sprecher sind sichtbaren Figuren zugeordnet</li>
              <li>✓ Kein Voice-over und kein automatischer Ersatzdialog</li>
              <li>✓ Bestätigte Aussprache wird als Synchronspur verwendet</li>
              <li>✓ Sprechmenge passt zur gewählten Videolänge</li>
            </ul>
          ) : (
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-red-100/80">
              {report.issues.map((issue) => (
                <li key={issue.code}>• {issue.message}</li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={approve}
          disabled={
            disabled ||
            !report.ready ||
            approved
          }
          className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {approved
            ? "✓ Originaldialog verbindlich bestätigt"
            : "Dialog, Sprecher und Aussprache bestätigen"}
        </button>

        <p className="text-center text-[11px] leading-5 text-zinc-500">
          Erst nach dieser Bestätigung werden Bildvorschau und Zahlung freigeschaltet.
        </p>
      </div>
    </section>
  );
}
