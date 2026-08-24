import { get, put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { VIRAL_CHARACTERS } from "@/lib/viral-characters";

const localImageRoot = resolve(
  process.cwd(),
  ".video-backend-backups",
  "local-images",
);

const MAX_STORED_IMAGE_BYTES = 5 * 1024 * 1024;

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type StoredImage = {
  data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  label?: string;
};

function normalizeMimeType(value: string): StoredImage["mimeType"] {
  const cleaned = value.toLowerCase().trim();
  if (cleaned === "image/jpeg" || cleaned === "image/png" || cleaned === "image/webp") {
    return cleaned;
  }
  throw new Error("Das Bildformat wird nicht unterstützt. Erlaubt sind JPG, PNG und WebP.");
}

function resolveLocalImagePath(pathname: string): string {
  const normalized = pathname.replace(/\\/g, "/").replace(/^\/+/, "");
  const destination = resolve(localImageRoot, normalized);
  if (!destination.startsWith(`${localImageRoot}${sep}`)) {
    throw new Error("Ungültiger lokaler Bildpfad.");
  }
  return destination;
}

function validatePreviewUri(uri: string): { kind: "blob" | "local"; pathname: string } {
  const kind = uri.startsWith("blob:")
    ? "blob"
    : uri.startsWith("local-image:")
      ? "local"
      : null;

  if (!kind) throw new Error("Die gespeicherte Vorschau-Referenz ist ungültig.");

  const prefix = kind === "blob" ? "blob:" : "local-image:";
  const pathname = uri.slice(prefix.length);
  if (!/^preview-references\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(pathname)) {
    throw new Error("Die gespeicherte Vorschau-Referenz ist ungültig.");
  }

  return { kind, pathname };
}

export async function storeGeneratedPreview(
  base64Data: string,
  mimeTypeValue: string,
): Promise<{ uri: string; mimeType: StoredImage["mimeType"] }> {
  const mimeType = normalizeMimeType(mimeTypeValue);
  const bytes = Buffer.from(base64Data, "base64");
  if (bytes.length < 256 || bytes.length > MAX_STORED_IMAGE_BYTES) {
    throw new Error("Die erzeugte Vorschau hat eine ungültige Dateigröße.");
  }

  const pathname = `preview-references/${nanoid(24)}.${extensionByMimeType[mimeType]}`;
  const hasBlobCredentials = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID,
  );

  if (process.env.NODE_ENV === "development" && !hasBlobCredentials) {
    const destination = resolveLocalImagePath(pathname);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return { uri: `local-image:${pathname}`, mimeType };
  }

  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: mimeType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });

  return { uri: `blob:${blob.pathname}`, mimeType };
}

export async function loadStoredPreview(
  uri: string,
  expectedMimeType?: string,
): Promise<StoredImage> {
  const reference = validatePreviewUri(uri.trim());
  const inferredMimeType = normalizeMimeType(
    reference.pathname.endsWith(".png")
      ? "image/png"
      : reference.pathname.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg"
  );
  const mimeType = expectedMimeType
    ? normalizeMimeType(expectedMimeType)
    : inferredMimeType;

  if (mimeType !== inferredMimeType) {
    throw new Error("Das Dateiformat der gespeicherten Vorschau stimmt nicht überein.");
  }

  let bytes: Buffer;
  if (reference.kind === "local") {
    bytes = await readFile(resolveLocalImagePath(reference.pathname));
  } else {
    const result = await get(reference.pathname, { access: "private" });
    if (!result?.stream) throw new Error("Das freigegebene Vorschaubild wurde nicht gefunden.");
    bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  if (bytes.length < 256 || bytes.length > MAX_STORED_IMAGE_BYTES) {
    throw new Error("Das freigegebene Vorschaubild hat eine ungültige Dateigröße.");
  }

  return { data: bytes.toString("base64"), mimeType };
}

export async function loadViralCharacterReferences(
  characterNames: readonly string[],
): Promise<StoredImage[]> {
  const selected = VIRAL_CHARACTERS.filter((character) =>
    characterNames.includes(character.name),
  ).slice(0, 3);

  if (selected.length < 2) {
    throw new Error(
      "Die festen TikTok-Figuren konnten für die Videogenerierung nicht geladen werden.",
    );
  }

  const publicRoot = resolve(process.cwd(), "public", "viral-characters");

  return await Promise.all(
    selected.map(async (character) => {
      const filename = character.imagePath.split("/").pop();
      if (!filename || !/^[a-z0-9-]+\.webp$/.test(filename)) {
        throw new Error("Eine TikTok-Figurenreferenz besitzt einen ungültigen Dateinamen.");
      }

      const pathname = resolve(publicRoot, filename);
      if (!pathname.startsWith(`${publicRoot}${sep}`)) {
        throw new Error("Eine TikTok-Figurenreferenz besitzt einen ungültigen Pfad.");
      }

      const bytes = await readFile(pathname);
      if (bytes.length < 256 || bytes.length > MAX_STORED_IMAGE_BYTES) {
        throw new Error("Eine TikTok-Figurenreferenz besitzt eine ungültige Dateigröße.");
      }

      return {
        data: bytes.toString("base64"),
        mimeType: "image/webp" as const,
        label: character.name,
      };
    }),
  );
}
