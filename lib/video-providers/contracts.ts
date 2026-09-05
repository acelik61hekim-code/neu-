import type {
  VideoAspectRatio,
  VideoModelId,
} from "@/types/story";

export type EngineProviderId =
  | "seedance"
  | "veo"
  | "runway";

export type ProviderOperation =
  | "opening"
  | "extension";

export type ReferencePolicy =
  | "none"
  | "optional"
  | "required";

export type ProviderImageReference = {
  data: string;
  mimeType:
    | "image/jpeg"
    | "image/png"
    | "image/webp";
};

export type ProviderAudioReference = {
  data: string;
  mimeType:
    | "audio/mpeg"
    | "audio/wav";
};

export type ProviderCapabilities = {
  imageReference: boolean;
  maximumImageReferences: number;
  videoExtension: boolean;
  webhookCompletion: boolean;
};

export type ProviderRoute = {
  provider: EngineProviderId;
  modelId: string;
  role: "primary" | "fallback";
  reason: string;
  capabilities: ProviderCapabilities;
};

export type VideoRoutingContext = {
  requestedModel: VideoModelId;
  operation: ProviderOperation;
  referencePolicy: ReferencePolicy;
  referenceCount: number;
  allowFallback?: boolean;
  availableProviders?: Partial<
    Record<EngineProviderId, boolean>
  >;
};

export type ProviderOpeningInput = {
  modelId: string;
  prompt: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  referenceImage?: ProviderImageReference;
  referenceImages?: ProviderImageReference[];
  referenceAudios?: ProviderAudioReference[];
  webhookUrl?: string;
  maxAttempts?: number;
};

export type ProviderExtensionInput = {
  modelId: string;
  previousVideoUri: string;
  prompt: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  extensionNumber: number;
  referenceAudios?: ProviderAudioReference[];
  webhookUrl?: string;
  maxAttempts?: number;
};

export type ProviderVideoStatus = {
  done: boolean;
  videoUri?: string;
  mimeType?: string;
};

export interface VideoProviderAdapter {
  readonly id: EngineProviderId;
  readonly capabilities: ProviderCapabilities;
  readonly configured: boolean;

  startOpening(
    input: ProviderOpeningInput,
  ): Promise<string>;

  startExtension(
    input: ProviderExtensionInput,
  ): Promise<string>;

  check(operationName: string): Promise<ProviderVideoStatus>;

  readWebhook?(
    operationName: string,
    payload: unknown,
  ): ProviderVideoStatus;
}

export type ProviderAttemptOutcome =
  | "started"
  | "completed"
  | "failed"
  | "rejected";

export type ProviderAttemptRecord = {
  provider: EngineProviderId;
  modelId: string;
  operation: ProviderOperation;
  chapterNumber: number;
  extensionNumber?: number;
  outcome: ProviderAttemptOutcome;
  at: number;
  reason?: string;
};
