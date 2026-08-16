"use client";

import { useState } from "react";

import {
  VIRAL_CHARACTERS,
  VIRAL_STORY_TEMPLATES,
  VIRAL_STORY_TOPICS,
  type ViralCharacter,
  type ViralStoryTemplate,
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
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function toggleCharacter(id: string) {
    setLocalError(null);
    setActiveTemplateId(null);
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

  function applyTemplate(template: ViralStoryTemplate) {
    setSelectedIds([...template.characterIds]);
    setCustomTopic(template.topic);
    setActiveTemplateId(template.id);
    setLocalError(null);
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
            <span className="text-[11px] text-emerald-300">Feste Figuren + Szenendialog</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            Virale Story mit festen Charakteren erstellen
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            Skandal-Hook, Beweis, Konfrontation und Cliffhanger entstehen automatisch.
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
          <div className="mb-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-white">Trend-Vorlagen</p>
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                  Vorschau ansehen, Vorlage wählen und anschließend deine Story erstellen.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-fuchsia-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-fuchsia-200">
                6 Ideen
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {VIRAL_STORY_TEMPLATES.map((template) => {
                const selected = activeTemplateId === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    disabled={disabled}
                    aria-pressed={selected}
                    className={`group relative overflow-hidden rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "border-fuchsia-300 ring-2 ring-fuchsia-400/40"
                        : "border-white/10 hover:border-fuchsia-300/50"
                    }`}
                  >
                    <video
                      src={template.previewVideoPath}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="aspect-[9/16] w-full bg-black object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-white backdrop-blur">
                      {template.badge}
                    </span>
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent px-2.5 pb-2.5 pt-10">
                      <span className="block text-[11px] font-bold text-white">
                        {template.title}
                      </span>
                      <span className="mt-0.5 block text-[9px] leading-3.5 text-zinc-300">
                        {template.description}
                      </span>
                      {selected ? (
                        <span className="mt-1.5 inline-flex rounded-full bg-fuchsia-500 px-2 py-0.5 text-[8px] font-bold text-white">
                          Ausgewählt
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-fuchsia-300/15 bg-black/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">
              TikTok-Microdrama-Ablauf
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["0–2 s", "Skandal-Hook"],
                ["Beweis", "Geheimnis fliegt auf"],
                ["Streit", "Gegenenthüllung"],
                ["Ende", "Offener Cliffhanger"],
              ].map(([label, description]) => (
                <div key={label} className="rounded-lg bg-white/5 px-2.5 py-2">
                  <p className="text-[10px] font-bold text-white">{label}</p>
                  <p className="mt-0.5 text-[10px] leading-4 text-zinc-400">
                    {description}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-4 text-zinc-500">
              Schnelle Reaktions-Close-ups, klare Rollen und ein Ende, das nach der nächsten Folge verlangt.
            </p>
          </div>

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
                onChange={(event) => {
                  setTopic(event.target.value);
                  setActiveTemplateId(null);
                }}
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
                onChange={(event) => {
                  setCustomTopic(event.target.value);
                  setActiveTemplateId(null);
                }}
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
            {activeTemplateId ? "Vorlage als Story erstellen" : "Story automatisch erstellen"}
          </button>

          <p className="mt-3 text-[10px] leading-4 text-zinc-500">
            Die sichtbaren Figuren sprechen direkt und lippensynchron in der Szene. Keine Erzählerstimme und kein nachträgliches Voice-over.
          </p>
        </div>
      ) : null}
    </div>
  );
}
