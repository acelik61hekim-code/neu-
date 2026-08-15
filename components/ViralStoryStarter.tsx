"use client";

import { useState } from "react";

import {
  VIRAL_CHARACTERS,
  VIRAL_STORY_TOPICS,
  type ViralCharacter,
} from "@/lib/viral-characters";

type ViralStoryStarterProps = {
  disabled?: boolean;
  onCreate: (characters: ViralCharacter[], topic: string) => Promise<void> | void;
};

export default function ViralStoryStarter({
  disabled = false,
  onCreate,
}: ViralStoryStarterProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([
    VIRAL_CHARACTERS[0].id,
    VIRAL_CHARACTERS[1].id,
  ]);
  const [topic, setTopic] = useState<string>(VIRAL_STORY_TOPICS[0]);
  const [customTopic, setCustomTopic] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function toggleCharacter(id: string) {
    setLocalError(null);
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((selectedId) => selectedId !== id);
      }

      if (current.length >= 3) {
        setLocalError(
          "Für eine stabile Darstellung können pro Video höchstens drei Hauptfiguren ausgewählt werden.",
        );
        return current;
      }

      return [...current, id];
    });
  }

  async function handleCreate() {
    if (selectedIds.length < 2) {
      setLocalError("Wähle mindestens zwei Figuren für die automatische Story aus.");
      return;
    }

    const selectedCharacters = VIRAL_CHARACTERS.filter((character) =>
      selectedIds.includes(character.id),
    );
    const selectedTopic = customTopic.trim() || topic;

    setLocalError(null);
    await onCreate(selectedCharacters, selectedTopic);
  }

  return (
    <div className="rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 via-violet-500/10 to-blue-500/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-fuchsia-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">
              TikTok Story
            </span>
            <span className="text-[11px] text-emerald-300">Feste Figuren + eigene Stimmen</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            Virale Story mit festen Charakteren erstellen
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Figuren auswählen – Story, Dialoge, Stimmen und Wendung entstehen automatisch.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          disabled={disabled}
          className="shrink-0 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {expanded ? "Auswahl schließen" : "Figuren auswählen"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-white">2–3 Hauptfiguren auswählen</p>
            <span className="text-[11px] text-zinc-500">{selectedIds.length}/3 gewählt</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VIRAL_CHARACTERS.map((character) => {
              const selected = selectedIds.includes(character.id);
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => toggleCharacter(character.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`overflow-hidden rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "border-fuchsia-300 bg-fuchsia-400/15 ring-1 ring-fuchsia-300/50"
                      : "border-white/10 bg-black/25 hover:border-white/25"
                  }`}
                >
                  <img
                    src={character.imagePath}
                    alt={character.name}
                    className="aspect-square w-full object-cover object-top"
                  />
                  <span className="block px-2 py-2 text-xs font-semibold text-white">
                    {character.shortName}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Story-Idee
              </span>
              <select
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                disabled={disabled}
                className="w-full rounded-xl border border-white/10 bg-[#101016] px-3 py-3 text-xs text-white outline-none transition focus:border-fuchsia-300/50 disabled:opacity-50"
              >
                {VIRAL_STORY_TOPICS.map((storyTopic) => (
                  <option key={storyTopic} value={storyTopic}>
                    {storyTopic}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Oder eigenes Thema (optional)
              </span>
              <input
                value={customTopic}
                onChange={(event) => setCustomTopic(event.target.value)}
                maxLength={160}
                disabled={disabled}
                placeholder="z. B. heimliche Hochzeit"
                className="w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-white outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-300/50 disabled:opacity-50"
              />
            </label>
          </div>

          {localError ? (
            <p className="mt-3 text-xs leading-5 text-amber-200">{localError}</p>
          ) : null}

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={disabled || selectedIds.length < 2}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-950/30 transition hover:from-fuchsia-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Story automatisch erstellen
          </button>

          <p className="mt-3 text-[10px] leading-4 text-zinc-500">
            Die Originalfiguren werden als Bildreferenzen übernommen. Jede ausgewählte Figur erhält zusätzlich eine feste eigene Studiostimme.
          </p>
        </div>
      ) : null}
    </div>
  );
}
