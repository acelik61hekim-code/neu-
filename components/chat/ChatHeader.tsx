import { BotIcon } from "../Icons";

type ChatHeaderProps = {
  isProcessing: boolean;
  statusText: string;
  activityLabel: string;
};

export default function ChatHeader({
  isProcessing,
  statusText,
  activityLabel,
}: ChatHeaderProps) {
  return (
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
  );
}