const RESTARTABLE_SONG_PROVIDER_ERROR =
  /api internal error|provider internal error|upstream internal error|temporary internal error|upstream server|tim(?:ed|ing)? out|timeout|gateway timeout|service unavailable|temporarily unavailable|rate limit|too many requests|vorübergehender (?:interner )?fehler|vorübergehender musikdienst-fehler|\b(?:408|425|429|500|502|503|504)\b/i;

export function isRestartableSongProviderError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return RESTARTABLE_SONG_PROVIDER_ERROR.test(
    message,
  );
}

export function shouldStartFreshSongProviderTask(error: unknown): boolean {
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
    return "Der Musikdienst antwortet momentan zu langsam oder ist vorübergehend ausgelastet. Dein bezahlter Auftrag bleibt sicher gespeichert und kann ohne neue Zahlung erneut gestartet werden.";
  }

  return message;
}
