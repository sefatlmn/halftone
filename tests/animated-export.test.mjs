import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/animated-export.js", import.meta.url),
  "utf8",
);
const animatedExport = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("WebM feature detection fails closed outside a browser", () => {
  assert.equal(animatedExport.preferredWebMMime(), "");
});

test("WebM feature detection chooses the first supported codec", () => {
  const original = globalThis.MediaRecorder;
  globalThis.MediaRecorder = class {
    static isTypeSupported(type) {
      return type === "video/webm;codecs=vp8";
    }
  };
  try {
    assert.equal(animatedExport.preferredWebMMime(), "video/webm;codecs=vp8");
  } finally {
    if (original === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = original;
  }
});

test("animated export operations reject an already-cancelled signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    animatedExport.recordCanvasWebM({
      canvas: {},
      duration: 1,
      fps: 12,
      play: async () => {},
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  await assert.rejects(
    animatedExport.encodeGif({
      width: 1,
      height: 1,
      frames: [],
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});