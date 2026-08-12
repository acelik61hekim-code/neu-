import {
  requestPromptEngineer,
  type PromptEngineerResult,
} from "@/services/promptEngineerClient";
import type { Story } from "@/types/story";

/**
 * Ergänzt alle Szenen einer bestehenden Story
 * um die Ergebnisse des Prompt Engineers.
 *
 * Jede Szene bekommt den vollständigen Kontext:
 * - gesamte Story
 * - aktuelle Szene
 * - vorherige Szene
 * - nächste Szene
 * - aktueller ProductionMemory
 */
export async function enhanceStoryWithPrompts(
  story: Story,
): Promise<Story> {
  const enhancedScenes: Story["scenes"] = [];

  for (
    let index = 0;
    index < story.scenes.length;
    index++
  ) {
    const scene = story.scenes[index];

    const previousScene =
      index > 0
        ? story.scenes[index - 1]
        : null;

    const nextScene =
      index < story.scenes.length - 1
        ? story.scenes[index + 1]
        : null;

    const prompts: PromptEngineerResult =
      await requestPromptEngineer({
        story,
        scene,
        previousScene,
        nextScene,
        productionMemory:
          story.productionMemory,
      });

    enhancedScenes.push({
      ...scene,

      veoPrompt:
        prompts.veoPrompt,

      audioPrompt:
        prompts.audioPrompt,

      negativePrompt:
        prompts.negativePrompt,

      dialogue:
        prompts.dialogue ??
        scene.dialogue,

      camera:
        prompts.camera ??
        scene.camera,

      lighting:
        prompts.lighting ??
        scene.lighting,

      style:
        prompts.style ??
        scene.style,

      transition:
        prompts.transition ??
        scene.transition,
    });
  }

  return {
    ...story,
    scenes: enhancedScenes,
  };
}

/**
 * Alias für ältere Stellen im Projekt, die möglicherweise
 * noch den Namen processStory verwenden.
 */
export async function processStory(
  story: Story,
): Promise<Story> {
  return enhanceStoryWithPrompts(story);
}

/**
 * Alias für Stellen, die den Namen runStoryPipeline verwenden.
 */
export async function runStoryPipeline(
  story: Story,
): Promise<Story> {
  return enhanceStoryWithPrompts(story);
}

export default enhanceStoryWithPrompts;