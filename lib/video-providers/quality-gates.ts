import type {
  EngineProviderId,
  ProviderOperation,
  ReferencePolicy,
} from "./contracts";

export type QualityGateStatus =
  | "passed"
  | "failed";

export type QualityCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type ShotQualityGateRecord = {
  shotId: string;
  phase: "preflight" | "provider-output" | "final-output";
  provider: EngineProviderId | "pipeline";
  operation: ProviderOperation | "finalization";
  status: QualityGateStatus;
  checkedAt: number;
  checks: QualityCheck[];
};

function result(
  input: Omit<
    ShotQualityGateRecord,
    "status" | "checkedAt"
  >,
): ShotQualityGateRecord {
  return {
    ...input,
    status: input.checks.every(
      (check) => check.passed,
    )
      ? "passed"
      : "failed",
    checkedAt: Date.now(),
  };
}

export function evaluateShotPreflight(
  input: {
    shotId: string;
    provider: EngineProviderId;
    operation: ProviderOperation;
    prompt: string;
    durationSeconds: number;
    referencePolicy: ReferencePolicy;
    referenceCount: number;
    maximumReferences: number;
  },
): ShotQualityGateRecord {
  const durationValid =
    input.provider === "seedance"
      ? input.durationSeconds >= 4 &&
        input.durationSeconds <= 15
      : input.durationSeconds > 0 &&
        input.durationSeconds <= 15;

  return result({
    shotId: input.shotId,
    phase: "preflight",
    provider: input.provider,
    operation: input.operation,
    checks: [
      {
        name: "prompt",
        passed: input.prompt.trim().length >= 24,
        detail: "Provider-Prompt muss konkret und nicht leer sein.",
      },
      {
        name: "duration",
        passed: durationValid,
        detail: `Cliplänge ${input.durationSeconds}s muss vom Provider ausführbar sein.`,
      },
      {
        name: "required-reference",
        passed:
          input.referencePolicy !== "required" ||
          input.referenceCount > 0,
        detail:
          input.referencePolicy === "required"
            ? "Verpflichtende Bildreferenz muss tatsächlich geladen sein."
            : "Keine verpflichtende Bildreferenz.",
      },
      {
        name: "reference-capacity",
        passed:
          input.referenceCount <=
          input.maximumReferences,
        detail: `${input.referenceCount}/${input.maximumReferences} Referenzen.`,
      },
    ],
  });
}

function validProviderUri(value: string): boolean {
  if (
    value.startsWith("blob:") ||
    value.startsWith("local:")
  ) {
    return true;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch {
    return false;
  }
}

export function evaluateProviderOutput(
  input: {
    shotId: string;
    provider: EngineProviderId;
    operation: ProviderOperation;
    videoUri: string;
  },
): ShotQualityGateRecord {
  return result({
    shotId: input.shotId,
    phase: "provider-output",
    provider: input.provider,
    operation: input.operation,
    checks: [
      {
        name: "video-uri",
        passed: validProviderUri(input.videoUri),
        detail: "Provider muss eine unterstützte, nicht leere Video-URI liefern.",
      },
    ],
  });
}

export function evaluateFinalOutput(
  input: {
    shotId: string;
    pathname: string;
    expectedDurationSeconds: number;
    actualDurationSeconds: number;
  },
): ShotQualityGateRecord {
  const durationDifference = Math.abs(
    input.expectedDurationSeconds -
      input.actualDurationSeconds,
  );

  return result({
    shotId: input.shotId,
    phase: "final-output",
    provider: "pipeline",
    operation: "finalization",
    checks: [
      {
        name: "stored-output",
        passed:
          input.pathname.trim().length > 0 &&
          input.pathname.toLowerCase().endsWith(".mp4"),
        detail: "Finale MP4-Datei muss gespeichert sein.",
      },
      {
        name: "duration",
        passed:
          Number.isFinite(input.actualDurationSeconds) &&
          durationDifference <= 0.75,
        detail: `Soll ${input.expectedDurationSeconds}s, ist ${input.actualDurationSeconds.toFixed(3)}s.`,
      },
    ],
  });
}

export function assertQualityGatePassed(
  gate: ShotQualityGateRecord,
): void {
  if (gate.status === "passed") {
    return;
  }

  const failedChecks = gate.checks
    .filter((check) => !check.passed)
    .map((check) => check.name)
    .join(", ");

  throw new Error(
    `Quality Gate ${gate.phase} für ${gate.shotId} fehlgeschlagen: ${failedChecks}.`,
  );
}
