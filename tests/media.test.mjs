import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The app deliberately has no package.json (it is served as browser modules).
// Loading the source as a data URL lets node:test exercise its browser-free API.
const source = await readFile(new URL("../src/media.js", import.meta.url), "utf8");
const media = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("detectMediaKind recognizes MIME types and useful extensions", () => {
  assert.equal(media.detectMediaKind({ type: "image/gif", name: "x.bin" }), "gif");
  assert.equal(media.detectMediaKind({ type: "", name: "clip.WEBM" }), "video");
  assert.equal(media.detectMediaKind({ type: "image/png", name: "x" }), "image");
  assert.equal(media.detectMediaKind({ type: "text/plain", name: "notes.txt" }), null);
});

test("media limits reject over-sized files", () => {
  assert.throws(() => media.validateMediaFile({ size: media.MEDIA_LIMITS.gif.bytes + 1, name: "a.gif" }), RangeError);
  assert.equal(media.validateMediaFile({ size: 1, type: "image/png" }).kind, "image");
});

test("animated limits stay within the conservative browser budget", () => {
  assert.ok(media.MEDIA_LIMITS.gif.frames <= 240);
  assert.ok(media.MEDIA_LIMITS.gif.duration <= 30);
  assert.ok(media.MEDIA_LIMITS.gif.maxEdge <= 1920);
  assert.ok(media.MEDIA_LIMITS.gif.decodedBytes <= 48 * 1024 * 1024);
  assert.ok(media.MEDIA_LIMITS.video.duration <= 60);
  assert.ok(media.MEDIA_LIMITS.video.maxPixels <= 2_100_000);
});

test("GIF decoded patch estimates reject compressed memory bombs before decode", () => {
  const descriptor = (width, height) => ({ image: { descriptor: { width, height } } });
  const estimate = media.estimateGifDecodedBytes({
    frames: [descriptor(100, 50), {}, descriptor(20, 10)],
  });
  assert.deepEqual(estimate, {
    frames: 2,
    pixels: 5200,
    patchBytes: 20_800,
  });
  const fullFrames = Math.floor(
    media.MEDIA_LIMITS.gif.decodedBytes / (1600 * 1200 * 4),
  ) + 1;
  const bomb = media.estimateGifDecodedBytes({
    frames: Array.from({ length: fullFrames }, () => descriptor(1600, 1200)),
  });
  assert.ok(bomb.patchBytes > media.MEDIA_LIMITS.gif.decodedBytes);
});

test("fitWithin preserves aspect and never enlarges", () => {
  assert.deepEqual(media.fitWithin(4000, 2000, 1000), { width: 1000, height: 500, scale: 0.25 });
  assert.deepEqual(media.fitWithin(100, 50, 1000), { width: 100, height: 50, scale: 1 });
});

test("formatMediaTime produces stable minute-second labels", () => {
  assert.equal(media.formatMediaTime(0), "0:00");
  assert.equal(media.formatMediaTime(65.9), "1:05");
  assert.equal(media.formatMediaTime(Infinity), "0:00");
});