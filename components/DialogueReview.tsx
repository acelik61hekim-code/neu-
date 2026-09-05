"use client";

import {
  approveDialogueReview,
  hasApprovedDialogueReview,
  inspectDialogueQuality,
} from "@/lib/dialogue-quality";

import type {
  Story,
  VideoModelId,
  VideoVoiceMode,
} from "@/types/story";

type DialogueReviewProps = {
  story: Story;
  voiceMode: VideoVoiceMode;
  voiceoverText: string;
  targetDurationSeconds: number;
  videoModel: VideoModelId;
  disabled?: boolean;
  onStoryChange: (story: Story) => void;
};

export default function DialogueReview({
  story,
  voiceMode,
  voiceoverText,
  targetDurationSeconds,
  videoModel,
  disabled = false,
  onStoryChange,
}: DialogueReviewProps) {
  const dialogue =
    story.providedDialogue ?? [];
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

  if (!report.required) {
    return null;
  }

  function updatePronunciation(
    index: number,
    value: string,
  ) {
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
          Sprecher, Wortlaut und Aussprache prüfen
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

          </article>
        ))}

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
              <li>✓ Die festgelegte Aussprache wird erst für die finale Synchronspur erzeugt</li>
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
            : "Originaldialog bestätigen"}
        </button>

        <p className="text-center text-[11px] leading-5 text-zinc-500">
          Erst nach dieser Bestätigung werden Bildvorschau und Zahlung freigeschaltet.
        </p>
      </div>
    </section>
  );
}
