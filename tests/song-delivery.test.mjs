import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveSongAudioFormat } from "../lib/song-audio-format.ts";

test("AceData M4A outputs keep their real container and MIME type", () => {
  assert.deepEqual(
    resolveSongAudioFormat({ mimeType: "audio/mp4" }),
    { extension: "m4a", label: "M4A", mimeType: "audio/mp4" },
  );
  assert.equal(
    resolveSongAudioFormat({ sourceUrl: "https://cdn.example/song.m4a?token=secret" }).extension,
    "m4a",
  );
});

test("M4A is detected from ftyp bytes even with a generic provider header", () => {
  const bytes = Uint8Array.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x4d, 0x34, 0x41, 0x20,
  ]);

  assert.equal(
    resolveSongAudioFormat({ mimeType: "application/octet-stream", bytes }).extension,
    "m4a",
  );
});

test("legacy MP3 outputs remain playable and downloadable", () => {
  assert.deepEqual(
    resolveSongAudioFormat({ mimeType: "audio/mpeg" }),
    { extension: "mp3", label: "MP3", mimeType: "audio/mpeg" },
  );
});

test("the first checked Suno version is published before the full task finishes", async () => {
  const polling = await readFile(new URL("../lib/acedata-suno.ts", import.meta.url), "utf8");
  const generation = await readFile(new URL("../lib/song-generation.ts", import.meta.url), "utf8");
  const statusRoute = await readFile(new URL("../app/api/song-status/route.ts", import.meta.url), "utf8");
  const successPage = await readFile(new URL("../app/song-success/page.tsx", import.meta.url), "utf8");

  assert.match(polling, /intervalMs\s*\?\?\s*3_000/s);
  assert.ok(polling.indexOf("options?.onProgress") < polling.indexOf("if (result.finished)"));
  assert.match(generation, /onProgress:\s*async[\s\S]*songVersions:[\s\S]*earlyVersion/s);
  assert.match(statusRoute, /const playable\s*=\s*songVersions\.length > 0/s);
  assert.match(statusRoute, /finalized:\s*job\.status === "done"/s);
  assert.match(successPage, /setInterval\(\(\) => void refresh\(\), 2000\)/s);
  assert.match(successPage, /hasPlayableSong \? <div>/s);
  assert.match(successPage, /Download nach Abschlussprüfung/s);
  assert.doesNotMatch(successPage, /\{done && songVersions\.length > 0/);
});

test("inline preview works while only final downloads are gated", async () => {
  const downloadRoute = await readFile(new URL("../app/api/song-download/[jobId]/route.ts", import.meta.url), "utf8");
  const coverRoute = await readFile(new URL("../app/api/song-cover/[jobId]/route.ts", import.meta.url), "utf8");

  assert.match(downloadRoute, /download\s*&&\s*job\.status !== "done"/s);
  assert.doesNotMatch(downloadRoute, /job\.status !== "done"\s*\|\|\s*!selected/s);
  assert.match(downloadRoute, /status:\s*206/s);
  assert.match(downloadRoute, /filename="ki-song-\$\{jobId\}-version-\$\{index \+ 1\}\.\$\{format\.extension\}"/s);
  assert.doesNotMatch(coverRoute, /job\.status !== "done"/);
});
