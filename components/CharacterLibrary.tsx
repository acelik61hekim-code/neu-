"use client";

import { useState } from "react";

import {
  VIRAL_CHARACTERS,
  type ViralCharacter,
} from "@/lib/viral-characters";

type CharacterLibraryProps = {
  disabled?: boolean;
  onApply: (characters: ViralCharacter[]) => Promise<void> | void;
};

export default function CharacterLibrary({
  disabled = false,
  onApply,
}: CharacterLibraryProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");

  function toggleCharacter(id: string) {
    setMessage("");
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((selectedId) => selectedId !== id);
      }

      if (current.length >= 3) {
        setMessage("Du kannst höchstens drei feste Charaktere auswählen.");
        return current;
      }

      return [...current, id];
    });
  }

  async function applySelection() {
    if (selectedIds.length === 0) {
      setMessage("Wähle mindestens einen Charakter aus.");
      return;
    }

    const characters = VIRAL_CHARACTERS.filter((character) =>
      selectedIds.includes(character.id),
    );

    setApplying(true);
    setMessage("");

    try {
      await onApply(characters);
      setMessage(
        `${characters.map((character) => character.shortName).join(", ")} ${
          characters.length === 1 ? "ist" : "sind"
        } jetzt als feste Charakterreferenz ausgewählt.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Die Charaktere konnten nicht übernommen werden.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-500/10 via-violet-500/10 to-fuchsia-500/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-200">
              Charakter-Bibliothek
            </span>
            <span className="text-[11px] text-emerald-300">
              Für jedes Videoformat
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            Ruby und Freunde als feste Charaktere verwenden
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Wähle ihre Gesichter und ihr festes Aussehen für Werbung, Musikvideo,
            Kurzfilm oder deine eigene Idee – ganz ohne Trash-TV-Vorlage.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          disabled={disabled || applying}
          className="shrink-0 rounded-xl border border-blue-300/25 bg-blue-500/15 px-4 py-2.5 text-xs font-bold text-blue-100 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {expanded ? "Auswahl schließen" : "Gesicht auswählen"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">
                1–3 Charaktere auswählen
              </p>
              <p className="mt-1 text-[10px] text-zinc-500">
                Genre, Schauplatz und Handlung bestimmst du anschließend selbst.
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-zinc-500">
              {selectedIds.length}/3 gewählt
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VIRAL_CHARACTERS.map((character) => {
              const selected = selectedIds.includes(character.id);

              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => toggleCharacter(character.id)}
                  disabled={disabled || applying}
                  aria-pressed={selected}
                  className={`overflow-hidden rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "border-blue-300 bg-blue-400/15 ring-1 ring-blue-300/50"
                      : "border-white/10 bg-black/25 hover:border-white/25"
                  }`}
                >
                  <img
                    src={character.imagePath}
                    alt={`${character.shortName} als Charakter auswählen`}
                    className="aspect-square w-full object-cover object-top"
                  />
                  <span className="block px-2 py-2">
                    <span className="block text-xs font-semibold text-white">
                      {character.shortName}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-zinc-500">
                      {character.personality}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void applySelection()}
              disabled={disabled || applying || selectedIds.length === 0}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-xs font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying
                ? "Charaktere werden vorbereitet …"
                : "Als feste Charaktere übernehmen"}
            </button>

            {message ? (
              <p className="text-[11px] leading-5 text-zinc-300">{message}</p>
            ) : (
              <p className="text-[11px] leading-5 text-zinc-500">
                Die Auswahl ersetzt die bisherigen Bildreferenzen für dieses Video.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
