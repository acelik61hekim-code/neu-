import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import ffmpegPath from "ffmpeg-static";

import {
  buildCompatibleConcatPlan,
  buildSeamlessMergePlan,
  parseFfmpegMediaInspection,
} from "../lib/video-backend/seamless-merge.ts";

test("two 15-second clips meet seamlessly around second 15 without shortening the film", () => {
  const plan =
    buildSeamlessMergePlan(
      [
        {
          durationSeconds: 15,
          width: 720,
          height: 1280,
          hasAudio: true,
        },
        {
          durationSeconds: 15,
          width: 704,
          height: 1280,
          hasAudio: true,
        },
      ],
      30,
      "9:16",
    );

  const filterGraph =
    plan.filters.join(";");

  assert.equal(plan.width, 720);
  assert.equal(plan.height, 1280);
  assert.ok(
    Math.abs(
      plan.outputDurationSeconds - 30,
    ) < 0.001,
  );
  assert.match(
    filterGraph,
    /scale=720:1280:force_original_aspect_ratio=increase/u,
  );
  assert.match(
    filterGraph,
    /crop=720:1280/u,
  );
  assert.match(
    filterGraph,
    /setsar=1/u,
  );
  assert.match(
    filterGraph,
    /setpts=PTS-STARTPTS,fps=fps=30:round=near\[v0\]/u,
  );
  assert.doesNotMatch(
    filterGraph,
    /settb=AVTB/u,
  );
  assert.match(
    filterGraph,
    /xfade=transition=fade:duration=0\.240000:offset=14\.880000/u,
  );
  assert.match(
    filterGraph,
    /acrossfade=d=0\.240000/u,
  );
});

test("the compatibility fallback normalizes both streams before concat", () => {
  const plan =
    buildCompatibleConcatPlan(
      [
        {
          durationSeconds: 15.1,
          width: 1280,
          height: 720,
          hasAudio: true,
        },
        {
          durationSeconds: 15.1,
          width: 1280,
          height: 720,
          hasAudio: true,
        },
      ],
      30,
      "16:9",
    );

  const filterGraph =
    plan.filters.join(";");

  assert.equal(
    plan.transitionSeconds,
    0,
  );
  assert.ok(
    Math.abs(
      plan.outputDurationSeconds -
        30,
    ) < 0.001,
  );
  assert.match(
    filterGraph,
    /fps=fps=30:round=near\[cv0\]/u,
  );
  assert.match(
    filterGraph,
    /concat=n=2:v=1:a=1\[vconcat\]\[aconcat\]/u,
  );
  assert.doesNotMatch(
    filterGraph,
    /xfade/u,
  );
});

test("a silent provider segment receives continuous silence instead of breaking the audio graph", () => {
  const plan =
    buildSeamlessMergePlan(
      [
        {
          durationSeconds: 15,
          width: 1280,
          height: 720,
          hasAudio: true,
        },
        {
          durationSeconds: 15,
          width: 1280,
          height: 720,
          hasAudio: false,
        },
      ],
      30,
      "16:9",
    );

  assert.equal(plan.width, 1280);
  assert.equal(plan.height, 720);
  assert.match(
    plan.filters.join(";"),
    /anullsrc=r=48000:cl=stereo/u,
  );
});

test("ffmpeg inspection reads duration, frame size and audio presence", () => {
  const inspection =
    parseFfmpegMediaInspection(`
Duration: 00:00:15.04, start: 0.000000, bitrate: 5000 kb/s
Stream #0:0: Video: h264, yuv420p, 720x1280 [SAR 1:1 DAR 9:16], 30 fps
Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp
`);

  assert.deepEqual(
    inspection,
    {
      durationSeconds: 15.04,
      width: 720,
      height: 1280,
      hasAudio: true,
    },
  );
});

function runFfmpeg(
  args,
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      execFile(
        ffmpegPath,
        args,
        {
          windowsHide: true,
          maxBuffer:
            8 * 1024 * 1024,
        },
        (
          error,
          stdout,
          stderr,
        ) => {
          if (error) {
            reject(
              new Error(
                stderr ||
                  error.message,
              ),
            );
            return;
          }

          resolve({
            stdout,
            stderr,
          });
        },
      );
    },
  );
}

test("the production filter graph really renders continuous video and audio", async (context) => {
  if (
    !ffmpegPath ||
    !existsSync(ffmpegPath)
  ) {
    context.skip(
      "ffmpeg-static is unavailable",
    );
    return;
  }

  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "seamless-merge-test-",
      ),
    );

  const first =
    join(directory, "first.mp4");
  const second =
    join(directory, "second.mp4");
  const output =
    join(directory, "output.mp4");
  const fallbackOutput =
    join(
      directory,
      "fallback-output.mp4",
    );

  try {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=180x320:r=24:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=32000:duration=1",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      first,
    ]);

    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=176x320:r=24:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=32000:duration=1",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      second,
    ]);

    const plan =
      buildSeamlessMergePlan(
        [
          {
            durationSeconds: 1,
            width: 180,
            height: 320,
            hasAudio: true,
          },
          {
            durationSeconds: 1,
            width: 176,
            height: 320,
            hasAudio: true,
          },
        ],
        2,
        "9:16",
      );

    await runFfmpeg([
      "-y",
      "-i",
      first,
      "-i",
      second,
      "-filter_complex",
      plan.filters.join(";"),
      "-map",
      `[${plan.videoOutputLabel}]`,
      "-map",
      `[${plan.audioOutputLabel}]`,
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      output,
    ]);

    let probeOutput = "";

    try {
      await runFfmpeg([
        "-hide_banner",
        "-i",
        output,
      ]);
    } catch (error) {
      probeOutput =
        error.message;
    }

    const inspection =
      parseFfmpegMediaInspection(
        probeOutput,
      );

    assert.ok(inspection);
    assert.ok(
      Math.abs(
        inspection.durationSeconds - 2,
      ) < 0.1,
    );
    assert.equal(
      inspection.width,
      720,
    );
    assert.equal(
      inspection.height,
      1280,
    );
    assert.equal(
      inspection.hasAudio,
      true,
    );

    const fallbackPlan =
      buildCompatibleConcatPlan(
        [
          {
            durationSeconds: 1,
            width: 180,
            height: 320,
            hasAudio: true,
          },
          {
            durationSeconds: 1,
            width: 176,
            height: 320,
            hasAudio: true,
          },
        ],
        2,
        "9:16",
      );

    await runFfmpeg([
      "-y",
      "-i",
      first,
      "-i",
      second,
      "-filter_complex",
      fallbackPlan.filters.join(
        ";",
      ),
      "-map",
      `[${fallbackPlan.videoOutputLabel}]`,
      "-map",
      `[${fallbackPlan.audioOutputLabel}]`,
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      fallbackOutput,
    ]);

    let fallbackProbeOutput =
      "";

    try {
      await runFfmpeg([
        "-hide_banner",
        "-i",
        fallbackOutput,
      ]);
    } catch (error) {
      fallbackProbeOutput =
        error.message;
    }

    const fallbackInspection =
      parseFfmpegMediaInspection(
        fallbackProbeOutput,
      );

    assert.ok(
      fallbackInspection,
    );
    assert.ok(
      Math.abs(
        fallbackInspection.durationSeconds -
          2,
      ) < 0.1,
    );
    assert.equal(
      fallbackInspection.width,
      720,
    );
    assert.equal(
      fallbackInspection.height,
      1280,
    );
    assert.equal(
      fallbackInspection.hasAudio,
      true,
    );
  } finally {
    await rm(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});
