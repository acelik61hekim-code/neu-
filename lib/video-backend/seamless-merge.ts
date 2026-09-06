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
  videoTransitionSeconds: number;
  audioTransitionSeconds: number;
  outputDurationSeconds: number;
  width: number;
  height: number;
};

const DEFAULT_AUDIO_TRANSITION_SECONDS =
  0.8;

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

  const audioTransitionSeconds =
    Math.min(
      DEFAULT_AUDIO_TRANSITION_SECONDS,
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

  const totalAudioOverlap =
    audioTransitionSeconds *
    (
      inputs.length - 1
    );

  /*
   * Seedance erzeugt den Anschlussclip bereits aus dem vorherigen Video. Seine
   * erste Aufnahme ist deshalb normalerweise fast identisch zum letzten Bild
   * des vorherigen Clips. Ein Bild-Crossfade legt zwei leicht versetzte
   * Personen und Kamerapositionen übereinander und erzeugt genau den sichtbaren
   * Größen-/Morph-Sprung, den es eigentlich verstecken soll. Die normalisierten
   * Videostreams werden daher bildgenau aneinandergefügt.
   *
   * Die getrennt erzeugten Tonspuren können dagegen mit unterschiedlicher
   * Musiklautstärke oder einer neuen Phrase beginnen. Sie erhalten einen
   * längeren Constant-Power-Crossfade. Bild und Ton werden unabhängig minimal
   * zeitlich angepasst, damit beide weiterhin exakt die bestellte Länge haben.
   */
  const videoStretchFactor =
    targetDurationSeconds /
    totalInputDuration;

  const audioStretchFactor =
    (
      targetDurationSeconds +
      totalAudioOverlap
    ) /
    totalInputDuration;

  if (
    videoStretchFactor < 0.75 ||
    videoStretchFactor > 1.25 ||
    audioStretchFactor < 0.75 ||
    audioStretchFactor > 1.25
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

  const adjustedVideoDurations =
    inputs.map(
      (input) =>
        input.durationSeconds *
        videoStretchFactor,
    );

  const adjustedAudioDurations =
    inputs.map(
      (input) =>
        input.durationSeconds *
        audioStretchFactor,
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

      const adjustedVideoDuration =
        adjustedVideoDurations[index]
          .toFixed(6);

      const adjustedAudioDuration =
        adjustedAudioDurations[index]
          .toFixed(6);

      const videoFilters =
        [
          `trim=duration=${sourceDuration}`,
          "setpts=PTS-STARTPTS",
          `setpts=${videoStretchFactor.toFixed(8)}*PTS`,
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}`,
          "setsar=1",
          "format=yuv420p",
          "tpad=stop_mode=clone:stop_duration=0.1",
          `trim=duration=${adjustedVideoDuration}`,
          "setpts=PTS-STARTPTS",
          /*
           * Keep fps as the final video filter. FFmpeg 7 can lose the
           * constant-frame-rate metadata when settb/tpad/trim run after fps.
           * A final fps filter gives every concat input the same 30/1 rate
           * and the same 1/30 time base.
           */
          "fps=fps=30:round=near",
        ].join(",");

      filters.push(
        `[${index}:v:0]${videoFilters}[v${index}]`,
      );

      if (input.hasAudio) {
        const tempoFilters =
          buildAtempoChain(
            1 / audioStretchFactor,
          );

        const audioFilters =
          [
            `atrim=duration=${sourceDuration}`,
            "asetpts=PTS-STARTPTS",
            "aresample=48000",
            "asettb=1/48000",
            "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
            ...tempoFilters,
            `apad=pad_dur=${adjustedAudioDuration}`,
            `atrim=duration=${adjustedAudioDuration}`,
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
            `atrim=duration=${adjustedAudioDuration}`,
            "asetpts=PTS-STARTPTS",
          ].join(",")}[a${index}]`,
        );
      }
    },
  );

  const videoConcatInputs =
    inputs
      .map(
        (
          _input,
          index,
        ) =>
          `[v${index}]`,
      )
      .join("");

  filters.push(
    `${videoConcatInputs}concat=n=${inputs.length}:v=1:a=0[vconcat]`,
  );

  let audioOutputLabel =
    "a0";

  let accumulatedAudioDuration =
    adjustedAudioDurations[0];

  for (
    let index = 1;
    index < inputs.length;
    index += 1
  ) {
    const nextAudioLabel =
      `ax${index}`;

    filters.push(
      `[${audioOutputLabel}][a${index}]acrossfade=d=${audioTransitionSeconds.toFixed(6)}:c1=qsin:c2=qsin[${nextAudioLabel}]`,
    );

    audioOutputLabel =
      nextAudioLabel;

    accumulatedAudioDuration +=
      adjustedAudioDurations[index] -
      audioTransitionSeconds;
  }

  return {
    filters,
    videoOutputLabel:
      "vconcat",
    audioOutputLabel,
    videoTransitionSeconds:
      0,
    audioTransitionSeconds,
    outputDurationSeconds:
      accumulatedAudioDuration,
    width,
    height,
  };
}

/*
 * Emergency compatibility path for provider files that a future FFmpeg
 * version still refuses to crossfade. It keeps resolution, pixel aspect
 * ratio, frame rate, sample rate and total duration deterministic, but uses
 * a normalized concat so a paid render is delivered instead of being lost.
 */
export function buildCompatibleConcatPlan(
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
      "Für den kompatiblen Übergang fehlen gültige Videosegmente.",
    );
  }

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

  const stretchFactor =
    targetDurationSeconds /
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

      filters.push(
        `[${index}:v:0]${[
          `trim=duration=${sourceDuration}`,
          "setpts=PTS-STARTPTS",
          `setpts=${stretchFactor.toFixed(8)}*PTS`,
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}`,
          "setsar=1",
          "format=yuv420p",
          "tpad=stop_mode=clone:stop_duration=0.1",
          `trim=duration=${adjustedDuration}`,
          "setpts=PTS-STARTPTS",
          "fps=fps=30:round=near",
        ].join(",")}[cv${index}]`,
      );

      if (input.hasAudio) {
        filters.push(
          `[${index}:a:0]${[
            `atrim=duration=${sourceDuration}`,
            "asetpts=PTS-STARTPTS",
            "aresample=48000",
            "asettb=1/48000",
            "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
            ...buildAtempoChain(
              1 /
                stretchFactor,
            ),
            `apad=pad_dur=${adjustedDuration}`,
            `atrim=duration=${adjustedDuration}`,
            "asetpts=PTS-STARTPTS",
          ].join(",")}[ca${index}]`,
        );
      } else {
        filters.push(
          `${[
            "anullsrc=r=48000:cl=stereo",
            "asettb=1/48000",
            `atrim=duration=${adjustedDuration}`,
            "asetpts=PTS-STARTPTS",
          ].join(",")}[ca${index}]`,
        );
      }
    },
  );

  const concatInputs =
    inputs
      .map(
        (
          _input,
          index,
        ) =>
          `[cv${index}][ca${index}]`,
      )
      .join("");

  filters.push(
    `${concatInputs}concat=n=${inputs.length}:v=1:a=1[vconcat][aconcat]`,
  );

  return {
    filters,
    videoOutputLabel:
      "vconcat",
    audioOutputLabel:
      "aconcat",
    videoTransitionSeconds:
      0,
    audioTransitionSeconds:
      0,
    outputDurationSeconds:
      adjustedDurations.reduce(
        (
          total,
          duration,
        ) =>
          total +
          duration,
        0,
      ),
    width,
    height,
  };
}
