export type SongAudioExtension =
  | "m4a"
  | "mp3";

export type SongAudioFormat = {
  extension: SongAudioExtension;
  label: "M4A" | "MP3";
  mimeType: "audio/mp4" | "audio/mpeg";
};

const M4A_FORMAT: SongAudioFormat = {
  extension: "m4a",
  label: "M4A",
  mimeType: "audio/mp4",
};

const MP3_FORMAT: SongAudioFormat = {
  extension: "mp3",
  label: "MP3",
  mimeType: "audio/mpeg",
};

function hasIsoBaseMediaHeader(
  bytes?: Uint8Array,
): boolean {
  if (!bytes || bytes.length < 12) {
    return false;
  }

  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

export function resolveSongAudioFormat(
  input: {
    mimeType?: string | null;
    sourceUrl?: string | null;
    bytes?: Uint8Array;
  },
): SongAudioFormat {
  const mimeType =
    input.mimeType
      ?.split(";")[0]
      .trim()
      .toLocaleLowerCase() ??
    "";
  const sourceUrl =
    input.sourceUrl
      ?.trim()
      .toLocaleLowerCase() ??
    "";

  if (
    mimeType === "audio/mp4" ||
    mimeType === "audio/x-m4a" ||
    mimeType === "video/mp4" ||
    /\.m4a(?:$|[?#])/u.test(
      sourceUrl,
    ) ||
    hasIsoBaseMediaHeader(
      input.bytes,
    )
  ) {
    return M4A_FORMAT;
  }

  return MP3_FORMAT;
}

export function songAudioFormatFromMimeType(
  mimeType?: string | null,
): SongAudioFormat {
  return resolveSongAudioFormat({
    mimeType,
  });
}
