export type FinalOutputDurationSource =
  | "render-target"
  | "music-track";

export type FinalOutputDurationPlan = {
  renderTargetDurationSeconds: number;
  outputTargetDurationSeconds: number;
  source: FinalOutputDurationSource;
};

const FINAL_VIDEO_FRAME_SECONDS =
  1 / 30;
const MAX_FINAL_VIDEO_PADDING_SECONDS =
  2;

function finitePositive(
  value: number,
): boolean {
  return (
    Number.isFinite(value) &&
    value > 0
  );
}

/**
 * Music-video render buckets reserve enough provider footage for the complete
 * song, but the finished file must follow the exact server-inspected song
 * duration. Every other video finishes at the booked render duration.
 */
export function planFinalOutputDuration(
  renderTargetDurationSeconds: number,
  inspectedMusicDurationSeconds?: number,
): FinalOutputDurationPlan {
  if (
    !finitePositive(
      renderTargetDurationSeconds,
    )
  ) {
    throw new Error(
      "Die Ziel-Laufzeit der finalen Videodatei ist ungültig.",
    );
  }

  if (
    inspectedMusicDurationSeconds !==
      undefined &&
    !finitePositive(
      inspectedMusicDurationSeconds,
    )
  ) {
    throw new Error(
      "Die geprüfte Song-Laufzeit der finalen Videodatei ist ungültig.",
    );
  }

  return {
    renderTargetDurationSeconds,
    outputTargetDurationSeconds:
      inspectedMusicDurationSeconds ??
      renderTargetDurationSeconds,
    source:
      inspectedMusicDurationSeconds ===
      undefined
        ? "render-target"
        : "music-track",
  };
}

/**
 * A small unconditional clone-pad makes `-t` a reliable upper bound even
 * when a provider stream ends between frame timestamps. The following trim
 * then turns that bound into an exact video-stream duration.
 */
export function buildFinalVideoDurationFilters(
  sourceDurationSeconds: number,
  outputTargetDurationSeconds: number,
  beforeTrimFilters:
    readonly string[] = [],
): string[] {
  if (
    !finitePositive(
      sourceDurationSeconds,
    ) ||
    !finitePositive(
      outputTargetDurationSeconds,
    )
  ) {
    throw new Error(
      "Die Video-Laufzeiten für den finalen Schnitt sind ungültig.",
    );
  }

  const missingVideoSeconds =
    outputTargetDurationSeconds -
    sourceDurationSeconds;

  if (
    missingVideoSeconds >
    MAX_FINAL_VIDEO_PADDING_SECONDS
  ) {
    throw new Error(
      `Das Rohvideo ist für die finale Zieldauer zu kurz: Soll ${outputTargetDurationSeconds.toFixed(3)}s, verfügbar ${sourceDurationSeconds.toFixed(3)}s.`,
    );
  }

  const paddingSeconds =
    Math.max(
      FINAL_VIDEO_FRAME_SECONDS,
      missingVideoSeconds +
        FINAL_VIDEO_FRAME_SECONDS,
    );

  return [
    `tpad=stop_mode=clone:stop_duration=${paddingSeconds.toFixed(6)}`,
    ...beforeTrimFilters,
    `trim=duration=${outputTargetDurationSeconds}`,
    "setpts=PTS-STARTPTS",
    "format=yuv420p",
  ];
}
