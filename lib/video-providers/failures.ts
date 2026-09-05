import type {
  EngineProviderId,
  ProviderOperation,
} from "./contracts";

export type ProviderFailureCategory =
  | "reference-rejected"
  | "rate-limited"
  | "temporarily-unavailable"
  | "invalid-output"
  | "content-policy"
  | "configuration"
  | "unknown";

export type ClassifiedProviderFailure = {
  provider: EngineProviderId;
  operation: ProviderOperation;
  category: ProviderFailureCategory;
  message: string;
  retryable: boolean;
  fallbackAllowed: boolean;
  httpStatus?: number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return typeof error === "string"
    ? error
    : "Unbekannter Providerfehler.";
}

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return undefined;
  }

  const candidate = error as {
    httpStatus?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  for (const status of [
    candidate.httpStatus,
    candidate.status,
    candidate.statusCode,
  ]) {
    if (typeof status === "number") {
      return status;
    }
  }

  return undefined;
}

export function classifyProviderFailure(
  provider: EngineProviderId,
  operation: ProviderOperation,
  error: unknown,
): ClassifiedProviderFailure {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  const httpStatus = errorStatus(error);

  const mentionsReference =
    /reference|start(?:ing)? image|startbild|referenzbild|input image|image input|first frame/.test(
      normalized,
    );
  const mentionsRejection =
    /reject|declin|deni|refus|invalid|unsupported|not accept|abgelehnt|zurückgewiesen|moderation|safety|policy/.test(
      normalized,
    );

  if (mentionsReference && mentionsRejection) {
    return {
      provider,
      operation,
      category: "reference-rejected",
      message,
      retryable: false,
      fallbackAllowed: true,
      httpStatus,
    };
  }

  if (
    httpStatus === 429 ||
    /rate limit|quota|too many requests|kontingent/.test(
      normalized,
    )
  ) {
    return {
      provider,
      operation,
      category: "rate-limited",
      message,
      retryable: true,
      fallbackAllowed: true,
      httpStatus,
    };
  }

  if (
    [408, 500, 502, 503, 504].includes(
      httpStatus ?? 0,
    ) ||
    /timeout|timed out|temporar|unavailable|overload|infrastructure|internal server/.test(
      normalized,
    )
  ) {
    return {
      provider,
      operation,
      category: "temporarily-unavailable",
      message,
      retryable: true,
      fallbackAllowed: true,
      httpStatus,
    };
  }

  if (
    /content policy|safety policy|moderation/.test(
      normalized,
    )
  ) {
    return {
      provider,
      operation,
      category: "content-policy",
      message,
      retryable: false,
      fallbackAllowed: false,
      httpStatus,
    };
  }

  if (
    /api key|credential|environment variable|umgebungsvariable|deaktiviert/.test(
      normalized,
    )
  ) {
    return {
      provider,
      operation,
      category: "configuration",
      message,
      retryable: false,
      fallbackAllowed: false,
      httpStatus,
    };
  }

  if (
    /no video|keine video-url|invalid video|ungültig.*video/.test(
      normalized,
    )
  ) {
    return {
      provider,
      operation,
      category: "invalid-output",
      message,
      retryable: false,
      fallbackAllowed: false,
      httpStatus,
    };
  }

  return {
    provider,
    operation,
    category: "unknown",
    message,
    retryable: false,
    fallbackAllowed: false,
    httpStatus,
  };
}
