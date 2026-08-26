import {
  GIFEncoder,
  applyPalette,
  quantize,
} from "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm";

let encoder = null;
let width = 0;
let height = 0;
let cancelled = false;

self.addEventListener("message", (event) => {
  const message = event.data || {};
  try {
    if (message.type === "init") {
      width = message.width;
      height = message.height;
      cancelled = false;
      encoder = GIFEncoder();
      self.postMessage({ type: "ready" });
      return;
    }

    if (message.type === "cancel") {
      cancelled = true;
      encoder = null;
      self.postMessage({ type: "cancelled" });
      return;
    }

    if (message.type === "frame") {
      if (!encoder || cancelled) throw new Error("GIF encoder is not active.");
      const rgba = new Uint8Array(message.rgba);
      const palette = quantize(rgba, 256);
      const indexed = applyPalette(rgba, palette);
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: Math.max(20, Math.round(message.delay)),
        repeat: message.index === 0 ? 0 : undefined,
      });
      self.postMessage({ type: "frame", index: message.index });
      return;
    }

    if (message.type === "finish") {
      if (!encoder || cancelled) throw new Error("GIF encoder is not active.");
      encoder.finish();
      const bytes = encoder.bytes();
      const output = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      encoder = null;
      self.postMessage({ type: "finished", bytes: output }, [output]);
    }
  } catch (error) {
    encoder = null;
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});