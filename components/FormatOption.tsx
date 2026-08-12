type FormatOptionProps = {
  title: string;
  description: string;
  badge: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export default function FormatOption({
  title,
  description,
  badge,
  selected,
  disabled = false,
  onSelect,
}: FormatOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`relative w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-violet-400/50 bg-violet-500/10 shadow-lg shadow-violet-950/20"
          : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className={`text-sm font-semibold ${
              selected ? "text-violet-100" : "text-white"
            }`}
          >
            {title}
          </p>

          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {description}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 text-xs ${
            selected
              ? "bg-violet-400/15 text-violet-200"
              : "bg-white/5 text-zinc-500"
          }`}
        >
          {badge}
        </span>
      </div>

      <div
        className={`absolute bottom-3 right-3 flex h-5 w-5 items-center justify-center rounded-full border ${
          selected
            ? "border-violet-300 bg-violet-400 text-black"
            : "border-white/20 bg-transparent"
        }`}
      >
        {selected && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m5 12 4 4L19 6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </button>
  );
}