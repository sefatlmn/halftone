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

export function computeTargetFps(mediaFps, fallback = 15) {
  const fps = Number(mediaFps);
  if (!Number.isFinite(fps) || fps <= 0) return fallback;
  return fps > 15 ? 15 : fps;
}

export function parseMp4Fps(buffer) {
  if (!buffer || buffer.byteLength < 8) return null;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let currentTrack = null;
  const tracks = [];

  function walk(start, end) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos);
      let headerSize = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        const bigSize = view.getBigUint64(pos + 8);
        if (bigSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
        size = Number(bigSize);
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;
      const type = String.fromCharCode(
        bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]
      );
      const payloadStart = pos + headerSize;
      const payloadEnd = pos + size;

      if (type === "moov") {
        walk(payloadStart, payloadEnd);
      } else if (type === "trak") {
        currentTrack = { timescale: 0, sampleDelta: 0, isVideo: false };
        tracks.push(currentTrack);
        walk(payloadStart, payloadEnd);
        currentTrack = null;
      } else if (type === "mdia" || type === "minf" || type === "stbl") {
        walk(payloadStart, payloadEnd);
      } else if (type === "hdlr" && currentTrack) {
        if (payloadEnd - payloadStart >= 12) {
          const handlerType = String.fromCharCode(
            bytes[payloadStart + 8], bytes[payloadStart + 9],
            bytes[payloadStart + 10], bytes[payloadStart + 11]
          );
          if (handlerType === "vide") {
            currentTrack.isVideo = true;
          }
        }
      } else if (type === "mdhd" && currentTrack) {
        const version = view.getUint8(payloadStart);
        const tsOffset = version === 1 ? payloadStart + 4 + 16 : payloadStart + 4 + 8;
        if (tsOffset + 4 <= payloadEnd) {
          currentTrack.timescale = view.getUint32(tsOffset);
        }
      } else if (type === "stts" && currentTrack) {
        if (payloadStart + 8 <= payloadEnd) {
          const entryCount = view.getUint32(payloadStart + 4);
          let totalSamples = 0;
          let totalDelta = 0;
          let entryPos = payloadStart + 8;
          for (let e = 0; e < entryCount && entryPos + 8 <= payloadEnd; e++) {
            const count = view.getUint32(entryPos);
            const delta = view.getUint32(entryPos + 4);
            totalSamples += count;
            totalDelta += count * delta;
            entryPos += 8;
          }
          if (totalSamples > 0 && totalDelta > 0) {
            currentTrack.sampleDelta = totalDelta / totalSamples;
          }
        }
      }
      pos += size;
    }
  }

  try {
    walk(0, bytes.byteLength);
  } catch {
    return null;
  }

  // If moov was not found at root level, scan the buffer for 'moov' FourCC
  if (!tracks.some((t) => t.timescale > 0 && t.sampleDelta > 0)) {
    for (let i = 4; i <= bytes.byteLength - 8; i++) {
      if (bytes[i] === 0x6D && bytes[i + 1] === 0x6F && bytes[i + 2] === 0x6F && bytes[i + 3] === 0x76) {
        const boxStart = i - 4;
        let boxSize = view.getUint32(boxStart);
        if (boxSize >= 8 && boxStart + boxSize <= bytes.byteLength + 64) {
          try {
            walk(boxStart, Math.min(bytes.byteLength, boxStart + boxSize));
          } catch {}
          if (tracks.some((t) => t.timescale > 0 && t.sampleDelta > 0)) break;
        }
      }
    }
  }

  const videoTrack = tracks.find((t) => t.isVideo && t.timescale > 0 && t.sampleDelta > 0) ||
    tracks.find((t) => t.timescale > 0 && t.sampleDelta > 0);
  if (videoTrack && videoTrack.sampleDelta > 0) {
    const fps = videoTrack.timescale / videoTrack.sampleDelta;
    return Number.isFinite(fps) && fps > 0 ? fps : null;
  }
  return null;
}

function readEbmlId(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 4 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 4 || offset + length > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) {
    id = (id << 8) | bytes[offset + i];
  }
  return { length, id };
}

function readEbmlVint(bytes, offset) {
  const first = bytes[offset];
  if (first === undefined) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = (value * 256) + bytes[offset + i];
  }
  return { length, value };
}

export function parseWebmFps(buffer) {
  if (!buffer || buffer.byteLength < 8) return null;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    const limit = Math.min(bytes.length - 3, 65536);
    for (let i = 0; i < limit; i++) {
      // DefaultDuration (0x23E383)
      if (bytes[i] === 0x23 && bytes[i + 1] === 0xE3 && bytes[i + 2] === 0x83) {
        const vint = readEbmlVint(bytes, i + 3);
        if (vint && vint.value > 0 && vint.value <= 8 && i + 3 + vint.length + vint.value <= bytes.length) {
          let val = 0;
          for (let j = 0; j < vint.value; j++) {
            val = (val * 256) + bytes[i + 3 + vint.length + j];
          }
          if (val > 0) {
            const fps = 1e9 / val;
            if (Number.isFinite(fps) && fps > 0) return fps;
          }
        }
      }
      // FrameRate (0x2383E3)
      if (bytes[i] === 0x23 && bytes[i + 1] === 0x83 && bytes[i + 2] === 0xE3) {
        const vint = readEbmlVint(bytes, i + 3);
        if (vint && i + 3 + vint.length + vint.value <= bytes.length) {
          const valOffset = i + 3 + vint.length;
          let fps = null;
          if (vint.value === 4) {
            fps = view.getFloat32(valOffset);
          } else if (vint.value === 8) {
            fps = view.getFloat64(valOffset);
          }
          if (fps && Number.isFinite(fps) && fps > 0 && fps <= 240) {
            return fps;
          }
        }
      }
    }

    // Scan forward from start for Clusters and track timecodes per track
    const trackTimecodes = new Map();
    let scanPos = 0;
    while (scanPos + 4 <= bytes.length) {
      if (bytes[scanPos] === 0x1F && bytes[scanPos + 1] === 0x43 && bytes[scanPos + 2] === 0xB6 && bytes[scanPos + 3] === 0x75) {
        const cLen = readEbmlVint(bytes, scanPos + 4);
        if (!cLen) { scanPos += 4; continue; }
        let cPos = scanPos + 4 + cLen.length;
        const cEnd = (cLen.value > 0 && cLen.value < 0x00FFFFFFFFFFFFFF)
          ? Math.min(bytes.length, cPos + cLen.value)
          : bytes.length;
        let clusterTimecode = 0;
        while (cPos < cEnd) {
          const elId = readEbmlId(bytes, cPos);
          if (!elId) break;
          cPos += elId.length;
          const elLen = readEbmlVint(bytes, cPos);
          if (!elLen) break;
          cPos += elLen.length;
          const elemEnd = cPos + elLen.value;
          if (elemEnd > bytes.length) break;

          if (elId.id === 0xE7) {
            let tcVal = 0;
            for (let b = 0; b < elLen.value; b++) tcVal = (tcVal * 256) + bytes[cPos + b];
            clusterTimecode = tcVal;
          } else if (elId.id === 0xA3) {
            const trackVint = readEbmlVint(bytes, cPos);
            if (trackVint && cPos + trackVint.length + 2 <= elemEnd) {
              const tcOffset = cPos + trackVint.length;
              let relTc = (bytes[tcOffset] << 8) | bytes[tcOffset + 1];
              if (relTc & 0x8000) relTc -= 0x10000;
              const absTc = clusterTimecode + relTc;
              const list = trackTimecodes.get(trackVint.value) || [];
              list.push(absTc);
              trackTimecodes.set(trackVint.value, list);
            }
          } else if (elId.id === 0xA0) {
            let sub = cPos;
            while (sub < elemEnd) {
              const sId = readEbmlId(bytes, sub);
              if (!sId) break;
              sub += sId.length;
              const sLen = readEbmlVint(bytes, sub);
              if (!sLen) break;
              sub += sLen.length;
              const sEnd = sub + sLen.value;
              if (sEnd > elemEnd) break;
              if (sId.id === 0xA1) {
                const trackVint = readEbmlVint(bytes, sub);
                if (trackVint && sub + trackVint.length + 2 <= sEnd) {
                  const tcOffset = sub + trackVint.length;
                  let relTc = (bytes[tcOffset] << 8) | bytes[tcOffset + 1];
                  if (relTc & 0x8000) relTc -= 0x10000;
                  const absTc = clusterTimecode + relTc;
                  const list = trackTimecodes.get(trackVint.value) || [];
                  list.push(absTc);
                  trackTimecodes.set(trackVint.value, list);
                }
              }
              sub = sEnd;
            }
          }
          cPos = elemEnd;
          let maxCount = 0;
          for (const list of trackTimecodes.values()) if (list.length > maxCount) maxCount = list.length;
          if (maxCount >= 16) break;
        }
        let maxCount = 0;
        for (const list of trackTimecodes.values()) if (list.length > maxCount) maxCount = list.length;
        if (maxCount >= 16) break;
        scanPos = cEnd;
      } else {
        scanPos++;
      }
    }

    for (const timecodes of trackTimecodes.values()) {
      if (timecodes.length >= 2) {
        const deltas = [];
        for (let k = 1; k < timecodes.length; k++) {
          const d = timecodes[k] - timecodes[k - 1];
          if (d > 0) deltas.push(d);
        }
        if (deltas.length > 0) {
          const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
          if (avgDelta > 0) {
            const fps = 1000 / avgDelta;
            if (Number.isFinite(fps) && fps > 0) return fps;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function detectVideoFps(file) {
  if (!file || typeof file.arrayBuffer !== "function") return null;
  const size = file.size || 0;
  let headBuf;
  try {
    const headSlice = file.slice(0, Math.min(size, 2 * 1024 * 1024));
    headBuf = await headSlice.arrayBuffer();
  } catch {
    return null;
  }

  // 1. Try parsing MP4 from the head buffer
  let fps = parseMp4Fps(headBuf);
  if (fps) return fps;

  // 2. Walk top-level box sizes to locate moov if placed after mdat
  if (headBuf.byteLength >= 8) {
    const view = new DataView(headBuf);
    let pos = 0;
    while (pos + 8 <= headBuf.byteLength) {
      let bSize = view.getUint32(pos);
      let hSize = 8;
      if (bSize === 1) {
        if (pos + 16 > headBuf.byteLength) break;
        const big = view.getBigUint64(pos + 8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
        bSize = Number(big);
        hSize = 16;
      } else if (bSize === 0) {
        bSize = size - pos;
      }
      if (bSize < hSize) break;
      const nextPos = pos + bSize;
      if (nextPos <= headBuf.byteLength) {
        pos = nextPos;
      } else {
        if (nextPos < size) {
          try {
            const nextSlice = file.slice(nextPos, Math.min(size, nextPos + 2 * 1024 * 1024));
            const nextBuf = await nextSlice.arrayBuffer();
            fps = parseMp4Fps(nextBuf);
            if (fps) return fps;
          } catch {}
        }
        break;
      }
    }
  }

  // 3. Fallback: inspect the tail buffer for moov (supporting unaligned / scan)
  if (size > 2 * 1024 * 1024) {
    try {
      const tailSlice = file.slice(Math.max(0, size - 2 * 1024 * 1024));
      const tailBuf = await tailSlice.arrayBuffer();
      fps = parseMp4Fps(tailBuf);
      if (fps) return fps;
    } catch {
      // ignore
    }
  }

  // 4. Try WebM parsing from the head buffer
  fps = parseWebmFps(headBuf);
  if (fps) return fps;

  return null;
}

export async function loadVideoSource(file, { signal, fps } = {}) {
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
  let detectedFps = null;
  if (typeof fps === "number" && Number.isFinite(fps) && fps > 0) {
    detectedFps = fps;
  } else if (typeof file?.fps === "number" && Number.isFinite(file.fps) && file.fps > 0) {
    detectedFps = file.fps;
  } else {
    try {
      detectedFps = await detectVideoFps(file);
    } catch {
      // ignore
    }
  }
  const videoFps = detectedFps && Number.isFinite(detectedFps) && detectedFps > 0
    ? detectedFps
    : 15;

  let disposed = false;
  const guard = () => { if (disposed) throw new Error("This media source has been disposed."); };
  return {
    kind: "video", element, url, width: element.videoWidth, height: element.videoHeight, duration,
    fps: videoFps,
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

export async function loadGifSource(file, { signal, fps } = {}) {
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
  const detectedGifFps = duration > 0 ? frames.length / duration : (delays.length > 0 ? 1000 / delays[0] : 15);
  const gifFps = typeof fps === "number" && Number.isFinite(fps) && fps > 0
    ? fps
    : (typeof file?.fps === "number" && Number.isFinite(file.fps) && file.fps > 0 ? file.fps : detectedGifFps);

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
    fps: gifFps,
    frameCount: frames.length,
    frameDelays: delays.slice(),
    get currentTime() { return time; }, set currentTime(value) { this.seek(value); },
    get playing() { return playing; },
    get loop() { return looping; }, set loop(value) { looping = Boolean(value); },
    renderFrame, renderAtTime(value) { time = Math.max(0, Math.min(Number(value) || 0, duration)); return renderFrame(frameAt(time)); },
    play() { ensure(); if (!playing) { playing = true; last = performance.now(); raf = requestAnimationFrame(tick); } return Promise.resolve(); },
    pause() { ensure(); playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    seek(value) { ensure(); time = Math.max(0, Math.min(Number(value) || 0, duration)); return Promise.resolve(renderFrame(frameAt(time))); },
    dispose() {
      if (disposed) return;
      disposed = true;
      playing = false;
      if (raf) cancelAnimationFrame(raf);
      canvas.width = canvas.height = 1;
      patch.width = patch.height = 1;
    },
  };
}