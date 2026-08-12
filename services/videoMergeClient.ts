export type MergeVideosResult = Blob;

export async function mergeVideos(
  videoUris: string[],
  filename = "komplettes-video.mp4",
): Promise<void> {
  if (videoUris.length < 2) {
    throw new Error(
      "Mindestens zwei Videos werden benötigt.",
    );
  }

  const response = await fetch(
    "/api/merge-videos",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        videoUris,
        filename,
      }),
    },
  );

  if (!response.ok) {
    let message =
      `Merge fehlgeschlagen (${response.status})`;

    try {
      const data = await response.json();

      if (data?.error) {
        message = data.error;
      }
    } catch {}

    throw new Error(message);
  }

  const blob = await response.blob();

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}