// Anbindung an Googles Veo 3.1 Fast Modell über die Gemini API.
//
// WICHTIG: Dies ist eine Preview-API von Google, Modellnamen und Endpunkte
// können sich ändern. Bevor du live gehst, prüfe die aktuelle Doku unter
// https://ai.google.dev/gemini-api/docs/video und passe MODEL_ID bei Bedarf an.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_ID = "veo-3.1-fast-generate-preview";

if (!GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY fehlt in den Umgebungsvariablen (.env.local)");
}

// Startet die Videogenerierung und gibt den Namen der "Operation" zurück,
// mit der wir später den Fortschritt abfragen.
export async function startVideoGeneration(prompt: string): Promise<string> {
  const response = await fetch(
    `${BASE_URL}/models/${MODEL_ID}:predictLongRunning`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Veo-Anfrage fehlgeschlagen: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  // data.name ist der Operationsname, z.B. "operations/abc123"
  return data.name;
}

// Fragt den Status einer laufenden Videogenerierung ab.
export async function checkVideoStatus(
  operationName: string
): Promise<{ done: boolean; videoUrl?: string }> {
  const response = await fetch(`${BASE_URL}/${operationName}`, {
    headers: { "x-goog-api-key": GEMINI_API_KEY! },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Statusabfrage fehlgeschlagen: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  if (!data.done) {
    return { done: false };
  }

  const videoUri =
    data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

  if (!videoUri) {
    throw new Error("Video fertig gemeldet, aber keine Video-URL erhalten.");
  }

  // Die URI braucht weiterhin den API-Key zum Abrufen, deshalb hängen wir
  // ihn als Query-Parameter an, damit das <video>-Element sie laden kann.
  const videoUrlWithKey = `${videoUri}${videoUri.includes("?") ? "&" : "?"}key=${GEMINI_API_KEY}`;

  return { done: true, videoUrl: videoUrlWithKey };
}
