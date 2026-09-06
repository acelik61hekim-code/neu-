export type MergeAspectRatio =
  | "9:16"
  | "16:9";

export type MediaInspection = {
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
};

export type SeamlessMergePlan = {
  filters: string[];
  videoOutputLabel: string;
  audioOutputLabel: string;
  transitionSeconds: number;
  outputDurationSeconds: number;
  width: number;
  height: number;
};

const DEFAULT_TRANSITION_SECONDS =
  0.24;

function finitePositive(
  value: number,
): boolean {
  return (
    Number.isFinite(value) &&
    value > 0
  );
}

export function parseFfmpegMediaInspection(
  value: string,
): MediaInspection | null {
  const durationMatch =
    value.match(
      /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i,
    );

  if (!durationMatch) {
    return null;
  }

  const durationSeconds =
    Number(durationMatch[1]) * 3600 +
    Number(durationMatch[2]) * 60 +
    Number(durationMatch[3]);

  if (!finitePositive(durationSeconds)) {
    return null;
  }

  const videoLine =
    value
      .split(/\r?\n/u)
      .find((line) =>
        /Stream\s+#.*Video:/iu.test(
          line,
        ),
      ) ?? "";

  const dimensions =
    videoLine.match(
      /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,\[]|$)/u,
    );

  return {
    durationSeconds,
    width:
      dimensions
        ? Number(dimensions[1])
        : undefined,
    height:
      dimensions
        ? Number(dimensions[2])
        : undefined,
    hasAudio:
      /Stream\s+#.*Audio:/iu.test(
        value,
      ),
  };
}

function outputDimensions(
  aspectRatio:
    | MergeAspectRatio
    | undefined,
  firstInput:
    MediaInspection,
): {
  width: number;
  height: number;
} {
  const landscape =
    aspectRatio === "16:9" ||
    (
      aspectRatio === undefined &&
      (
        firstInput.width ?? 0
      ) >=
        (
          firstInput.height ?? 1
        )
    );

  return landscape
    ? {
        width: 1280,
        height: 720,
      }
    : {
        width: 720,
        height: 1280,
      };
}

function buildAtempoChain(
  rate: number,
): string[] {
  if (!finitePositive(rate)) {
    throw new Error(
      "Die Audio-Geschwindigkeit für den Übergang ist ungültig.",
    );
  }

  const filters:
    string[] = [];

  let remaining =
    rate;

  while (remaining < 0.5) {
    filters.push(
      "atempo=0.5",
    );

    remaining /= 0.5;
  }

  while (remaining > 2) {
    filters.push(
      "atempo=2",
    );

    remaining /= 2;
  }

  if (
    Math.abs(
      remaining - 1,
    ) > 0.0005
  ) {
    filters.push(
      `atempo=${remaining.toFixed(6)}`,
    );
  }

  return filters;
}

export function buildSeamlessMergePlan(
  inputs:
    readonly MediaInspection[],
  targetDurationSeconds: number,
  aspectRatio?:
    MergeAspectRatio,
): SeamlessMergePlan {
  if (
    inputs.length < 2 ||
    !finitePositive(
      targetDurationSeconds,
    ) ||
    inputs.some(
      (input) =>
        !finitePositive(
          input.durationSeconds,
        ),
    )
  ) {
    throw new Error(
      "Für den nahtlosen Übergang fehlen gültige Videosegmente.",
    );
  }

  const shortestInput =
    Math.min(
      ...inputs.map(
        (input) =>
          input.durationSeconds,
      ),
    );

  const transitionSeconds =
    Math.min(
      DEFAULT_TRANSITION_SECONDS,
      shortestInput / 4,
    );

  const totalInputDuration =
    inputs.reduce(
      (
        total,
        input,
      ) =>
        total +
        input.durationSeconds,
      0,
    );

  const totalOverlap =
    transitionSeconds *
    (
      inputs.length - 1
    );

  /*
   * Das kurze Crossfade darf die bestellte Videolänge nicht verkürzen.
   * Deshalb werden alle Segmente zusammen nur minimal zeitlich angepasst.
   * Bei zwei 15-Sekunden-Clips sind das 0,8 Prozent – visuell und akustisch
   * unmerklich, der fertige Film bleibt aber exakt 30 Sekunden lang.
   */
  const stretchFactor =
    (
      targetDurationSeconds +
      totalOverlap
    ) /
    totalInputDuration;

  if (
    stretchFactor < 0.75 ||
    stretchFactor > 1.25
  ) {
    throw new Error(
      "Die gelieferten Segmentlängen weichen zu stark von der bestellten Videolänge ab.",
    );
  }

  const {
    width,
    height,
  } =
    outputDimensions(
      aspectRatio,
      inputs[0],
    );

  const filters:
    string[] = [];

  const adjustedDurations =
    inputs.map(
      (input) =>
        input.durationSeconds *
        stretchFactor,
    );

  inputs.forEach(
    (
      input,
      index,
    ) => {
      const sourceDuration =
        input.durationSeconds.toFixed(
          6,
        );

      const adjustedDuration =
        adjustedDurations[index]
          .toFixed(6);

      const videoFilters =
        [
          `trim=duration=${sourceDuration}`,
          "setpts=PTS-STARTPTS",
          `setpts=${stretchFactor.toFixed(8)}*PTS`,
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}`,
          "setsar=1",
          "fps=30",
          "settb=AVTB",
          "format=yuv420p",
          "tpad=stop_mode=clone:stop_duration=0.1",
          `trim=duration=${adjustedDuration}`,
          "setpts=PTS-STARTPTS",
        ].join(",");

      filters.push(
        `[${index}:v:0]${videoFilters}[v${index}]`,
      );

      if (input.hasAudio) {
        const tempoFilters =
          buildAtempoChain(
            1 / stretchFactor,
          );

        const audioFilters =
          [
            `atrim=duration=${sourceDuration}`,
            "asetpts=PTS-STARTPTS",
            "aresample=48000",
            "asettb=1/48000",
            "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
            ...tempoFilters,
            `apad=pad_dur=${adjustedDuration}`,
            `atrim=duration=${adjustedDuration}`,
            "asetpts=PTS-STARTPTS",
          ].join(",");

        filters.push(
          `[${index}:a:0]${audioFilters}[a${index}]`,
        );
      } else {
        filters.push(
          `${[
            "anullsrc=r=48000:cl=stereo",
            "asettb=1/48000",
            `atrim=duration=${adjustedDuration}`,
            "asetpts=PTS-STARTPTS",
          ].join(",")}[a${index}]`,
        );
      }
    },
  );

  let videoOutputLabel =
    "v0";

  let audioOutputLabel =
    "a0";

  let accumulatedDuration =
    adjustedDurations[0];

  for (
    let index = 1;
    index < inputs.length;
    index += 1
  ) {
    const nextVideoLabel =
      `vx${index}`;

    const nextAudioLabel =
      `ax${index}`;

    const transitionOffset =
      accumulatedDuration -
      transitionSeconds;

    filters.push(
      `[${videoOutputLabel}][v${index}]xfade=transition=fade:duration=${transitionSeconds.toFixed(6)}:offset=${transitionOffset.toFixed(6)}[${nextVideoLabel}]`,
      `[${audioOutputLabel}][a${index}]acrossfade=d=${transitionSeconds.toFixed(6)}:c1=tri:c2=tri[${nextAudioLabel}]`,
    );

    videoOutputLabel =
      nextVideoLabel;

    audioOutputLabel =
      nextAudioLabel;

    accumulatedDuration +=
      adjustedDurations[index] -
      transitionSeconds;
  }

  return {
    filters,
    videoOutputLabel,
    audioOutputLabel,
    transitionSeconds,
    outputDurationSeconds:
      accumulatedDuration,
    width,
    height,
  };
}
