const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const VIDEO_MODEL = "veo-3.1-fast-generate-preview";
const TEXT_MODEL = "gemini-3.5-flash-lite";

if (!GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY fehlt in den Umgebungsvariablen (.env.local)");
}

export async function startVideoGeneration(prompt: string): Promise<string> {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(
      `${BASE_URL}/models/${VIDEO_MODEL}:predictLongRunning`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY!,
        },
        body: JSON.stringify({ instances: [{ prompt }] }),
      }
    );
    if (response.ok) {
      const data = await response.json();
      return data.name;
    }
    if (response.status === 429 && attempt < maxRetries - 1) {
      const waitMs = 10000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    const errorText = await response.text();
    throw new Error(`Veo-Anfrage fehlgeschlagen: ${response.status} ${errorText}`);
  }
  throw new Error("Veo-Anfrage fehlgeschlagen: Kontingent wiederholt überschritten.");
}

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
  const videoUrlWithKey = `${videoUri}${videoUri.includes("?") ? "&" : "?"}key=${GEMINI_API_KEY}`;
  return { done: true, videoUrl: videoUrlWithKey };
}

// Teilt einen Gesamt-Prompt in mehrere aufeinanderfolgende Szenen-Prompts auf.
export async function splitIntoScenes(
  prompt: string,
  sceneCount: number
): Promise<string[]> {
  const response = await fetch(
    `${BASE_URL}/models/${TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Teile diese Videoidee in genau ${sceneCount} aufeinanderfolgende, kurze Videoclip-Beschreibungen auf (je ca. 8 Sekunden). Idee: "${prompt}". Gib NUR ein JSON-Array mit genau ${sceneCount} Strings zurück, jeder String ist eine bildhafte, eigenständige Beschreibung (Stil, Bewegung, Kameraführung) für einen KI-Videogenerator, die zusammen eine zusammenhängende Geschichte erzählen. Kein Text außerhalb des JSON-Arrays.`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Szenen-Aufteilung fehlgeschlagen: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Keine Szenen von der KI erhalten.");
  }
  const scenes = JSON.parse(text);
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Unerwartetes Format der Szenen-Antwort.");
  }
  return scenes.slice(0, sceneCount);
}
