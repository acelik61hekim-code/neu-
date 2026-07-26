import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = "gemini-2.5-flash";

export async function POST(req: NextRequest) {
  try {
    const { prompt, genre, length } = await req.json();

    const response = await fetch(
      `${BASE_URL}/models/${MODEL}:generateContent`,
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
                  text: `
Du bist ein professioneller Hollywood-Drehbuchautor.

Erstelle eine virale ${genre}-Story.

Thema:
${prompt}

Länge:
${length}

Erstelle ausschließlich gültiges JSON.

Format:

{
"title":"",
"description":"",
"scenes":[
{
"title":"",
"prompt":"",
"audio":"",
"negativePrompt":""
}
]
}

Jede Szene muss perfekt für Veo sein.
Die Hauptfigur muss in jeder Szene identisch bleiben.
Beschreibe Kamera, Licht, Emotionen und Umgebung.
`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();

      return NextResponse.json(
        { error },
        { status: response.status }
      );
    }

    const data = await response.json();

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    return NextResponse.json(JSON.parse(text));
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      { error: "Story konnte nicht erstellt werden." },
      { status: 500 }
    );
  }
}
