import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (pathname) =>
  readFile(new URL(`../${pathname}`, import.meta.url), "utf8");

test("music-video audio uses OIDC-compatible presigned uploads", async () => {
  const [client, route] = await Promise.all([
    readProjectFile("components/StudioHome.tsx"),
    readProjectFile("app/api/upload-video-audio/route.ts"),
  ]);

  assert.match(client, /import\s*\{\s*uploadPresigned,?\s*\}\s*from\s*"@vercel\/blob\/client"/s);
  assert.match(client, /await\s+uploadPresigned\([\s\S]*handleUploadUrl:\s*"\/api\/upload-video-audio"/s);
  assert.match(route, /handleUploadPresigned\(\{/);
  assert.match(route, /body\.type\s*===\s*"blob\.generate-presigned-url"/s);
  assert.match(route, /issueSignedToken\(\{[\s\S]*pathname,[\s\S]*operations:\s*\["put"\]/s);
  assert.match(route, /maximumSizeInBytes:\s*MUSIC_VIDEO_MAX_AUDIO_BYTES/s);
  assert.match(route, /allowedContentTypes:\s*\[\.\.\.MUSIC_VIDEO_AUDIO_TYPES\]/s);
  assert.doesNotMatch(route, /\bhandleUpload\(\{/);
  assert.doesNotMatch(route, /BLOB_READ_WRITE_TOKEN/);
});

test("song-studio audio uses the same short-lived upload authorization", async () => {
  const [client, route] = await Promise.all([
    readProjectFile("components/SoundStudio.tsx"),
    readProjectFile("app/api/song-studio/upload-audio/route.ts"),
  ]);

  assert.match(client, /import\s*\{\s*uploadPresigned\s*\}\s*from\s*"@vercel\/blob\/client"/s);
  assert.match(client, /await\s+uploadPresigned\([\s\S]*handleUploadUrl:\s*"\/api\/song-studio\/upload-audio"/s);
  assert.match(route, /handleUploadPresigned\(\{/);
  assert.match(route, /issueSignedToken\(\{[\s\S]*operations:\s*\["put"\]/s);
  assert.match(route, /maximumSizeInBytes:\s*SONG_STUDIO_MAX_AUDIO_BYTES/s);
  assert.match(route, /allowedContentTypes:\s*\[\.\.\.SONG_STUDIO_AUDIO_TYPES\]/s);
  assert.doesNotMatch(route, /\bhandleUpload\(\{/);
  assert.doesNotMatch(route, /BLOB_READ_WRITE_TOKEN/);
});
