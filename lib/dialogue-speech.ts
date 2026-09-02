import {
  GoogleGenAI,
} from "@google/genai";

type SpeechPreview = {
  audio: Buffer;
  contentType: string;
  durationSeconds: number;
};

function wrapPcmAsWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  const byteRate =
    sampleRate * blockAlign;

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(
    36 + pcm.length,
    4,
  );
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([
    header,
    pcm,
  ]);
}

export async function synthesizeDialogueSpeechPreview(
  options: {
    text: string;
    voiceName: string;
    language: "auto" | "de" | "en";
    speaker: string;
  },
): Promise<SpeechPreview> {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Die Stimmenvorschau ist momentan nicht konfiguriert.",
    );
  }

  const languageDirection =
    options.language === "en"
      ? "Speak natural English."
      : options.language === "auto"
        ? "Use the language of the supplied script."
        : "Sprich natürliches, klares Hochdeutsch. Sprich KI als K-I aus.";
  const client = new GoogleGenAI({
    apiKey,
  });
  let chunks: Buffer[] = [];
  let mimeType = "audio/l16";
  let sampleRate = 24_000;
  let channels = 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      chunks = [];

      const stream =
        await client.interactions.create({
          model:
            "gemini-3.1-flash-tts-preview",
          input: [
            "Create a short pronunciation preview for an on-camera character.",
            languageDirection,
            `The visible speaker is ${options.speaker}.`,
            "Read the supplied pronunciation script exactly once. Do not add, remove, translate or paraphrase anything.",
            "Use a natural, clearly articulated studio voice at a conversational pace.",
            "PRONUNCIATION SCRIPT:",
            options.text,
          ].join("\n"),
          response_format: {
            type: "audio",
          },
          generation_config: {
            speech_config: [
              {
                voice:
                  options.voiceName,
              },
            ],
          },
          stream: true,
        });

      for await (const event of stream) {
        if (
          event.event_type !== "step.delta" ||
          event.delta.type !== "audio"
        ) {
          continue;
        }

        if (event.delta.mime_type) {
          mimeType = event.delta.mime_type;
        }

        if (event.delta.sample_rate) {
          sampleRate = event.delta.sample_rate;
        }

        if (event.delta.channels) {
          channels = event.delta.channels;
        }

        if (event.delta.data) {
          chunks.push(
            Buffer.from(
              event.delta.data,
              "base64",
            ),
          );
        }
      }

      if (chunks.length === 0) {
        throw new Error(
          "Die Sprach-KI hat keine Hörprobe zurückgegeben.",
        );
      }

      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError || chunks.length === 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error(
          "Die Hörprobe konnte nicht erstellt werden.",
        );
  }

  const raw = Buffer.concat(chunks);
  const isRawPcm =
    mimeType.includes("l16") ||
    mimeType.includes("pcm");
  const audio = isRawPcm
    ? wrapPcmAsWav(
        raw,
        sampleRate,
        channels,
      )
    : raw;

  return {
    audio,
    contentType:
      isRawPcm
        ? "audio/wav"
        : mimeType.split(";")[0],
    durationSeconds:
      raw.length /
      Math.max(
        1,
        sampleRate * channels * 2,
      ),
  };
}
