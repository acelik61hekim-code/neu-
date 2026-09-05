import {
  checkVideoStatus as checkSeedanceStatus,
  readSeedanceWebhookResult,
  startVideoExtension as startSeedanceExtension,
  startVideoGeneration as startSeedanceOpening,
} from "@/lib/seedance";
import {
  checkVideoStatus as checkVeoStatus,
  startVideoExtension as startVeoExtension,
  startVideoGeneration as startVeoOpening,
} from "@/lib/veo";

import type {
  EngineProviderId,
  VideoProviderAdapter,
} from "./contracts";
import { providerCapabilities } from "./model-router";

function seedanceAdapter(): VideoProviderAdapter {
  return {
    id: "seedance",
    capabilities: providerCapabilities("seedance"),
    configured: Boolean(process.env.FAL_KEY),
    async startOpening(input) {
      return startSeedanceOpening(
        input.prompt,
        {
          modelTier:
            input.modelId === "seedance-2-original"
              ? "original"
              : "fast",
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSeconds,
          referenceImage: input.referenceImage,
          referenceImages: input.referenceImages,
          referenceAudios: input.referenceAudios,
          webhookUrl: input.webhookUrl,
          maxAttempts: input.maxAttempts,
        },
      );
    },
    async startExtension(input) {
      return startSeedanceExtension(
        input.previousVideoUri,
        input.prompt,
        {
          modelTier:
            input.modelId === "seedance-2-original"
              ? "original"
              : "fast",
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSeconds,
          extensionNumber: input.extensionNumber,
          referenceAudios: input.referenceAudios,
          webhookUrl: input.webhookUrl,
          maxAttempts: input.maxAttempts,
        },
      );
    },
    async check(operationName) {
      return checkSeedanceStatus(operationName);
    },
    readWebhook(operationName, payload) {
      return readSeedanceWebhookResult(
        operationName,
        payload,
      );
    },
  };
}

function veoAdapter(): VideoProviderAdapter {
  return {
    id: "veo",
    capabilities: providerCapabilities("veo"),
    configured: Boolean(process.env.GEMINI_API_KEY),
    async startOpening(input) {
      return startVeoOpening(
        input.prompt,
        {
          modelTier:
            input.modelId === "google-veo"
              ? "standard"
              : "fast",
          aspectRatio: input.aspectRatio,
          referenceImage: input.referenceImage,
          referenceImages: input.referenceImages,
          maxAttempts: input.maxAttempts,
        },
      );
    },
    async startExtension(input) {
      return startVeoExtension(
        input.previousVideoUri,
        input.prompt,
        {
          modelTier:
            input.modelId === "google-veo"
              ? "standard"
              : "fast",
          aspectRatio: input.aspectRatio,
          extensionNumber: input.extensionNumber,
          maxAttempts: input.maxAttempts,
        },
      );
    },
    async check(operationName) {
      return checkVeoStatus(operationName);
    },
  };
}

export function getVideoProviderAdapter(
  provider: EngineProviderId,
): VideoProviderAdapter {
  if (provider === "seedance") {
    return seedanceAdapter();
  }

  if (provider === "veo") {
    return veoAdapter();
  }

  throw new Error(
    "Runway ist vorbereitet, aber noch nicht konfiguriert.",
  );
}
