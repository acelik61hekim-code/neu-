export type VideoStudioScene = {
  number: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

const SCENE_SECONDS = 8;
const MINIMUM_LAST_SCENE_SECONDS = 4;

export function buildVideoStudioScenes(
  durationSeconds: number,
): VideoStudioScene[] {
  const duration = Math.max(1, durationSeconds);
  const scenes: VideoStudioScene[] = [];

  for (let start = 0; start < duration; start += SCENE_SECONDS) {
    const end = Math.min(duration, start + SCENE_SECONDS);
    scenes.push({
      number: scenes.length + 1,
      startSeconds: start,
      endSeconds: end,
      durationSeconds: end - start,
    });
  }

  const last = scenes.at(-1);
  if (
    last &&
    last.durationSeconds < MINIMUM_LAST_SCENE_SECONDS &&
    scenes.length > 1
  ) {
    const previous = scenes[scenes.length - 2];
    previous.endSeconds = duration;
    previous.durationSeconds = duration - previous.startSeconds;
    scenes.pop();
  }

  return scenes.map((scene, index) => ({
    ...scene,
    number: index + 1,
  }));
}
