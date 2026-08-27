export function isRestartableSongProviderError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return /api internal error|provider internal error|upstream internal error|temporary internal error/i.test(
    message,
  );
}

export function publicSongFailureMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;

  if (isRestartableSongProviderError(message)) {
    return "Der Musikdienst hatte einen vorübergehenden internen Fehler. Dein Text und deine Einstellungen sind gültig. Du kannst denselben Auftrag ohne neue Berechnung erneut starten.";
  }

  return message;
}
