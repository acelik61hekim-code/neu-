import type {
  ProviderExtensionInput,
  ProviderOpeningInput,
  ProviderVideoStatus,
  VideoProviderAdapter,
} from "./contracts";
import { providerCapabilities } from "./model-router";

/**
 * Deliberately provider-SDK agnostic. A concrete Runway HTTP/SDK client can be
 * injected without changing the workflow or model router.
 */
export interface RunwayGateway {
  startOpening(
    input: ProviderOpeningInput,
  ): Promise<string>;
  startExtension(
    input: ProviderExtensionInput,
  ): Promise<string>;
  check(
    operationName: string,
  ): Promise<ProviderVideoStatus>;
}

export function createRunwayProviderAdapter(
  gateway?: RunwayGateway,
): VideoProviderAdapter {
  const unavailable = (): never => {
    throw new Error(
      "Runway-Provider ist noch nicht mit einem Gateway konfiguriert.",
    );
  };

  return {
    id: "runway",
    capabilities: providerCapabilities("runway"),
    configured: Boolean(gateway),
    startOpening: gateway
      ? gateway.startOpening.bind(gateway)
      : async () => unavailable(),
    startExtension: gateway
      ? gateway.startExtension.bind(gateway)
      : async () => unavailable(),
    check: gateway
      ? gateway.check.bind(gateway)
      : async () => unavailable(),
  };
}
