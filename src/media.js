// Small, dependency-free-at-startup media primitives.  Decoding APIs are kept
// behind browser checks so the sizing and file checks are also usable in Node.

export const MEDIA_LIMITS = Object.freeze({
  image: Object.freeze({
    bytes: 20 * 1024 * 1024, maxBytes: 20 * 1024 * 1024,
    maxEdge: 8192, maxWidth: 8192, maxHeight: 8192, pixels: 32_000_000, maxPixels: 32_000_000,
    frames: 1, maxFrames: 1, duration: 0, maxDuration: 0, fps: 0, maxFps: 0,
  }),
  gif: Object.freeze({
    bytes: 12 * 1024 * 1024, maxBytes: 12 * 1024 * 1024,
    maxEdge: 1600, maxWidth: 1600, maxHeight: 1600, pixels: 2_100_000, maxPixels: 2_100_000,
    frames: 240, maxFrames: 240, duration: 30, maxDuration: 30, fps: 50, maxFps: 50,
    decodedBytes: 48 * 1024 * 1024, maxDecodedBytes: 48 * 1024 * 1024,
  }),
  video: Object.freeze({
    bytes: 60 * 1024 * 1024, maxBytes: 60 * 1024 * 1024,
    maxEdge: 1920, maxWidth: 1920, maxHeight: 1920, pixels: 2_100_000, maxPixels: 2_100_000,
    frames: 3_600, maxFrames: 3_600, duration: 60, maxDuration: 60, fps: 60, maxFps: 60,
  }),
});

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "bmp", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);

function extensionOf(file) {
  const name = typeof file?.name === "string" ? file.name : "";
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

export function detectMediaKind(file) {
  const type = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  const ext = extensionOf(file);
  if (type === "image/gif" || ext === "gif") return "gif";
  if (type.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

// This intentionally validates only facts available without decoding. Loaders
// additionally validate decoded metadata before returning a source.
export function validateMediaFile(file, kind = detectMediaKind(file)) {
  if (!file || typeof file.size !== "number" || !Number.isFinite(file.size)) {
    throw new TypeError("A browser File or Blob with a finite size is required.");
  }
  if (!["image", "gif", "video"].includes(kind)) {
    throw new TypeError("Unsupported media type.");
  }
  if (file.size <= 0) throw new RangeError("The media file is empty.");
  if (file.size > MEDIA_LIMITS[kind].bytes) {
    throw new RangeError(`${kind} files must be ${Math.floor(MEDIA_LIMITS[kind].bytes / 1048576)} MB or smaller.`);
  }
  return { kind, bytes: file.size, limits: MEDIA_LIMITS[kind] };
}

export function fitWithin(width, height, maxEdge) {
  width = Number(width);
  height = Number(height);
  maxEdge = Number(maxEdge);
  if (!(width > 0 && height > 0 && maxEdge > 0) ||
      !Number.isFinite(width + height + maxEdge)) {
    throw new RangeError("width, height, and maxEdge must be positive finite numbers.");
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export function formatMediaTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function estimateGifDecodedBytes(parsedGif) {
  const images = Array.isArray(parsedGif?.frames)
    ? parsedGif.frames.filter((frame) => frame?.image?.descriptor)
    : [];
  const pixels = images.reduce((sum, frame) => {
    const { width, height } = frame.image.descriptor;
    return sum + Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0);
  }, 0);
  return {
    frames: images.length,
    pixels,
    patchBytes: pixels * 4,
  };
}

export function waitForMediaEvent(element, event, signal) {
  if (!element?.addEventListener) return Promise.reject(new TypeError("A DOM EventTarget is required."));
  return new Promise((resolve, reject) => {
    const clean = () => {
      element.removeEventListener(event, done);
      element.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const done = () => { clean(); resolve(element); };
    const failed = () => { clean(); reject(element.error || new Error(`Media ${event} failed.`)); };
    const aborted = () => { clean(); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
    if (signal?.aborted) return aborted();
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function resolveVideoDuration(element, signal) {
  if (Number.isFinite(element.duration)) return Promise.resolve(element.duration);
  return new Promise((resolve, reject) => {
    let timer;
    const clean = () => {
      clearTimeout(timer);
      element.removeEventListener("durationchange", inspect);
      element.removeEventListener("timeupdate", inspect);
      element.removeEventListener("seeked", inspect);
      signal?.removeEventListener("abort", aborted);
    };
    const inspect = () => {
      if (!Number.isFinite(element.duration)) return;
      const duration = element.duration;
      clean();
      element.currentTime = 0;
      resolve(duration);
    };
    const aborted = () => {
      clean();
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
    };
    element.addEventListener("durationchange", inspect);
    element.addEventListener("timeupdate", inspect);
    element.addEventListener("seeked", inspect);
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => {
      clean();
      reject(new RangeError("Could not determine the video duration."));
    }, 5000);
    try {
      element.currentTime = Number.MAX_SAFE_INTEGER;
    } catch (error) {
      clean();
      reject(error);
    }
  });
}

function assertBrowser(feature) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error(`${feature} is available only in a browser.`);
  }
}

function checkDimensions(width, height, limits, label) {
  if (!(width > 0 && height > 0) || width > limits.maxEdge || height > limits.maxEdge ||
      width * height > limits.pixels) {
    throw new RangeError(`${label} dimensions exceed supported limits.`);
  }
}

export async function loadVideoSource(file, { signal } = {}) {
  assertBrowser("Video loading");
  validateMediaFile(file, "video");
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.preload = "auto";
  element.muted = true;
  element.playsInline = true;
  element.src = url;
  let duration;
  try {
    await waitForMediaEvent(element, "loadedmetadata", signal);
    checkDimensions(element.videoWidth, element.videoHeight, MEDIA_LIMITS.video, "Video");
    duration = await resolveVideoDuration(element, signal);
    if (duration > MEDIA_LIMITS.video.duration) {
      throw new RangeError(`Video duration must be ${MEDIA_LIMITS.video.duration} seconds or less.`);
    }
    if (element.readyState < 2) await waitForMediaEvent(element, "loadeddata", signal);
  } catch (error) {
    element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url);
    throw error;
  }
  let disposed = false;
  const guard = () => { if (disposed) throw new Error("This media source has been disposed."); };
  return {
    kind: "video", element, url, width: element.videoWidth, height: element.videoHeight, duration,
    get currentTime() { return element.currentTime; },
    get playing() { return !element.paused && !element.ended; },
    set currentTime(time) { this.seek(time); },
    get loop() { return element.loop; }, set loop(value) { element.loop = Boolean(value); },
    play() { guard(); return element.play(); },
    pause() { guard(); element.pause(); },
    seek(time) {
      guard();
      const target = Math.max(0, Math.min(Number(time) || 0, element.duration || 0));
      if (Math.abs(element.currentTime - target) < 0.001) return Promise.resolve(element);
      element.currentTime = target;
      return waitForMediaEvent(element, "seeked");
    },
    dispose() {
      if (disposed) return;
      disposed = true; element.pause(); element.removeAttribute("src"); element.load(); URL.revokeObjectURL(url);
    },
  };
}

export async function loadGifSource(file, { signal } = {}) {
  assertBrowser("GIF loading");
  validateMediaFile(file, "gif");
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const [{ parseGIF, decompressFrame }, bytes] = await Promise.all([
    import("https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm"),
    file.arrayBuffer(),
  ]);
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const gif = parseGIF(bytes);
  const width = gif.lsd?.width, height = gif.lsd?.height;
  checkDimensions(width, height, MEDIA_LIMITS.gif, "GIF");
  const decoded = estimateGifDecodedBytes(gif);
  if (!decoded.frames || decoded.frames > MEDIA_LIMITS.gif.frames) {
    throw new RangeError("GIF has too many frames.");
  }
  if (decoded.patchBytes > MEDIA_LIMITS.gif.decodedBytes) {
    throw new RangeError("GIF decoded frame data exceeds the browser memory limit.");
  }
  const frames = gif.frames
    .filter((frame) => frame.image)
    .map((frame) => {
      const decodedFrame = decompressFrame(frame, gif.gct, true);
      // Playback only needs the RGBA patch. Dropping the LZW index array and
      // palette here keeps retained memory near the budget above.
      delete decodedFrame.pixels;
      delete decodedFrame.colorTable;
      return decodedFrame;
    });
  const delays = frames.map((frame) => Math.max(20, Number(frame.delay) || 100));
  if (delays.some((delay) => 1000 / delay > MEDIA_LIMITS.gif.fps)) throw new RangeError("GIF frame rate is too high.");
  const duration = delays.reduce((sum, delay) => sum + delay, 0) / 1000;
  if (duration > MEDIA_LIMITS.gif.duration) throw new RangeError("GIF duration is too long.");

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  const patch = document.createElement("canvas");
  const patchCtx = patch.getContext("2d", { alpha: true });
  let shown = -1, previous = null, restore = null, time = 0, playing = false, raf = 0, last = 0, looping = true, disposed = false;
  const ensure = () => { if (disposed) throw new Error("This media source has been disposed."); };
  const draw = (index) => {
    const frame = frames[index];
    if (patch.width !== frame.dims.width || patch.height !== frame.dims.height) {
      patch.width = frame.dims.width; patch.height = frame.dims.height;
    }
    patchCtx.putImageData(new ImageData(frame.patch, frame.dims.width, frame.dims.height), 0, 0);
    ctx.drawImage(patch, frame.dims.left, frame.dims.top);
  };
  const advance = (index) => {
    if (previous?.disposalType === 2) {
      ctx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
    } else if (previous?.disposalType === 3 && restore) {
      ctx.putImageData(restore.data, restore.x, restore.y);
    }
    const frame = frames[index];
    restore = frame.disposalType === 3
      ? {
          x: frame.dims.left,
          y: frame.dims.top,
          data: ctx.getImageData(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height),
        }
      : null;
    draw(index);
    previous = frame;
    shown = index;
  };
  const renderFrame = (index) => {
    ensure(); index = Math.max(0, Math.min(frames.length - 1, Math.floor(index)));
    if (index === shown) return canvas;
    if (index === shown + 1) {
      advance(index);
      return canvas;
    }
    ctx.clearRect(0, 0, width, height);
    previous = restore = null;
    shown = -1;
    for (let i = 0; i <= index; i++) advance(i);
    return canvas;
  };
  const frameAt = (seconds) => {
    const value = Number(seconds) || 0;
    if (value >= duration) return delays.length - 1;
    let ms = (value * 1000) % (duration * 1000);
    if (ms < 0) ms += duration * 1000;
    let i = 0; while (i < delays.length - 1 && (ms -= delays[i]) >= 0) i++;
    return i;
  };
  const tick = (now) => {
    if (!playing || disposed) return;
    time += (now - last) / 1000; last = now;
    if (time >= duration) { if (looping) time %= duration; else { time = duration; playing = false; renderFrame(frames.length - 1); return; } }
    const next = frameAt(time);
    if (next !== shown) renderFrame(next);
    raf = requestAnimationFrame(tick);
  };
  renderFrame(0);
  return {
    kind: "gif", element: canvas, canvas, width, height, duration,
    frameCount: frames.length,
    frameDelays: delays.slice(),
    get currentTime() { return time; }, set currentTime(value) { this.seek(value); },
    get playing() { return playing; },
    get loop() { return looping; }, set loop(value) { looping = Boolean(value); },
    renderFrame, renderAtTime(value) { time = Math.max(0, Math.min(Number(value) || 0, duration)); return renderFrame(frameAt(time)); },
    play() { ensure(); if (!playing) { playing = true; last = performance.now(); raf = requestAnimationFrame(tick); } return Promise.resolve(); },
    pause() { ensure(); playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    seek(value) { ensure(); time = Math.max(0, Math.min(Number(value) || 0, duration)); return Promise.resolve(renderFrame(frameAt(time))); },
    dispose() { if (!disposed) { disposed = true; playing = false; if (raf) cancelAnimationFrame(raf); canvas.width = canvas.height = 1; } },
  };
}