export type VideoMediaMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  hasAudio: boolean;
};

/** Read the actual container, not the requested duration or file extension. */
export function parseVideoMediaMetadata(output: string): VideoMediaMetadata {
  const duration = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const videoLine = output.split(/\r?\n/).find(line => /Stream .*Video:/.test(line)) ?? "";
  const codec = videoLine.match(/Video:\s*([\w]+)/)?.[1] ?? "";
  const dimensions = videoLine.match(/(?:,\s*|\s)(\d{2,5})x(\d{2,5})(?:[\s,\[]|$)/);
  return {
    durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0,
    width: Number(dimensions?.[1] ?? 0),
    height: Number(dimensions?.[2] ?? 0),
    videoCodec: codec,
    hasAudio: /Stream .*Audio:/.test(output),
  };
}

export function expectedVideoDuration(job: {
  targetDurationSeconds?: number;
  musicVideoAudioUri?: string;
  musicVideoAudioSource?: "uploaded" | "generated";
  musicVideoAudioDurationSeconds?: number;
}): number {
  const seconds = job.musicVideoAudioUri && job.musicVideoAudioSource !== "generated"
    ? job.musicVideoAudioDurationSeconds
    : job.targetDurationSeconds;
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0 || seconds > 300.25) {
    throw new Error("Die bestellte Ausgabelänge ist nicht vollständig gespeichert.");
  }
  return seconds;
}

/** Never quietly drop a customer's requested closing words. */
export function wrapClosingText(value: string): string {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, "").split("\n")) {
    let current = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (word.length > 30) throw new Error("Ein Wort im Schlusstext ist zu lang. Bitte verwende höchstens 30 Zeichen pro Wort.");
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > 30) { lines.push(current); current = word; }
      else current = candidate;
    }
    if (current) lines.push(current);
  }
  if (lines.length > 4) throw new Error("Der Schlusstext passt nicht vollständig ins Bild. Bitte kürze ihn auf höchstens vier Zeilen mit je 30 Zeichen.");
  return lines.join("\n");
}
