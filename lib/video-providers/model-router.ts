import type {
  EngineProviderId,
  ProviderCapabilities,
  ProviderRoute,
  VideoRoutingContext,
} from "./contracts";

const CAPABILITIES: Record<
  EngineProviderId,
  ProviderCapabilities
> = {
  seedance: {
    imageReference: true,
    maximumImageReferences: 9,
    videoExtension: true,
    webhookCompletion: true,
  },
  veo: {
    imageReference: true,
    maximumImageReferences: 1,
    videoExtension: true,
    webhookCompletion: false,
  },
  runway: {
    imageReference: true,
    maximumImageReferences: 1,
    videoExtension: false,
    webhookCompletion: false,
  },
};

function requestedProvider(
  modelId: VideoRoutingContext["requestedModel"],
): EngineProviderId {
  return modelId.startsWith("google-veo")
    ? "veo"
    : "seedance";
}

function fallbackModel(
  provider: EngineProviderId,
): string {
  if (provider === "veo") {
    return "google-veo-fast";
  }

  if (provider === "runway") {
    return "runway-gen4-turbo";
  }

  return "seedance-2-fast";
}

function supports(
  provider: EngineProviderId,
  context: VideoRoutingContext,
): boolean {
  const capabilities = CAPABILITIES[provider];

  if (
    context.availableProviders?.[provider] === false
  ) {
    return false;
  }

  if (
    context.operation === "extension" &&
    !capabilities.videoExtension
  ) {
    return false;
  }

  if (
    context.referencePolicy === "required" &&
    (
      context.referenceCount === 0 ||
      !capabilities.imageReference
    )
  ) {
    return false;
  }

  return (
    context.referenceCount <=
    capabilities.maximumImageReferences
  );
}

export function routeVideoProviders(
  context: VideoRoutingContext,
): ProviderRoute[] {
  const primary = requestedProvider(
    context.requestedModel,
  );
  const routes: ProviderRoute[] = [];

  if (supports(primary, context)) {
    routes.push({
      provider: primary,
      modelId: context.requestedModel,
      role: "primary",
      reason: "Vom Kunden ausgewähltes Modell.",
      capabilities: CAPABILITIES[primary],
    });
  }

  if (context.allowFallback === false) {
    return routes;
  }

  const fallbackOrder: EngineProviderId[] =
    primary === "seedance"
      ? ["veo", "runway"]
      : ["seedance", "runway"];

  for (const provider of fallbackOrder) {
    if (
      provider === primary ||
      !supports(provider, context)
    ) {
      continue;
    }

    routes.push({
      provider,
      modelId: fallbackModel(provider),
      role: "fallback",
      reason:
        context.referencePolicy === "required"
          ? "Fallback behält die verpflichtende Bildreferenz bei."
          : "Kompatibler Ausweichprovider.",
      capabilities: CAPABILITIES[provider],
    });
  }

  return routes;
}

export function findProviderFallback(
  context: VideoRoutingContext,
  failedProvider: EngineProviderId,
): ProviderRoute | null {
  return (
    routeVideoProviders(context).find(
      (route) =>
        route.role === "fallback" &&
        route.provider !== failedProvider,
    ) ?? null
  );
}

export function providerCapabilities(
  provider: EngineProviderId,
): ProviderCapabilities {
  return CAPABILITIES[provider];
}
