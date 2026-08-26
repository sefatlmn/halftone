export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function preferredWebMMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export async function recordCanvasWebM({
  canvas,
  duration,
  fps,
  play,
  stop,
  onProgress,
  signal,
}) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  if (!canvas?.captureStream) {
    throw new Error("Canvas video export is not supported in this browser.");
  }
  const mimeType = preferredWebMMime();
  if (!mimeType) {
    throw new Error("WebM recording is not supported in this browser.");
  }

  const stream = canvas.captureStream(fps);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5_000_000,
  });
  let timer = 0;

  const result = new Promise((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      reject(recorder.error || new Error("WebM recording failed."));
    }, { once: true });
    recorder.addEventListener("stop", () => {
      resolve(new Blob(chunks, { type: mimeType }));
    }, { once: true });
  });

  const abort = () => {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // The stop path below still releases tracks.
    }
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    recorder.start(500);
    const started = performance.now();
    timer = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      onProgress?.(Math.min(0.98, elapsed / Math.max(0.1, duration)));
    }, 150);
    await play();
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    if (recorder.state !== "inactive") recorder.stop();
    const blob = await result;
    onProgress?.(1);
    return blob;
  } finally {
    clearInterval(timer);
    signal?.removeEventListener("abort", abort);
    stop?.();
    stream.getTracks().forEach((track) => track.stop());
  }
}

function abortError(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

export async function encodeGif({
  width,
  height,
  frames,
  onProgress,
  signal,
}) {
  if (signal?.aborted) throw abortError(signal);
  if (typeof Worker === "undefined") {
    throw new Error("Animated GIF export is not supported in this browser.");
  }
  const worker = new Worker(new URL("./gif-worker.js", import.meta.url), {
    type: "module",
  });
  let waiter = null;

  const waitFor = (type) => new Promise((resolve, reject) => {
    waiter = { type, resolve, reject };
  });
  const onMessage = (event) => {
    const message = event.data || {};
    if (message.type === "error") {
      waiter?.reject(new Error(message.message || "GIF encoding failed."));
      waiter = null;
      return;
    }
    if (waiter?.type === message.type) {
      waiter.resolve(message);
      waiter = null;
    }
  };
  const onError = (event) => {
    waiter?.reject(event.error || new Error(event.message || "GIF worker failed."));
    waiter = null;
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  const abort = () => {
    worker.postMessage({ type: "cancel" });
    waiter?.reject(abortError(signal));
    waiter = null;
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    worker.postMessage({ type: "init", width, height });
    await waitFor("ready");
    let index = 0;
    for await (const frame of frames) {
      if (signal?.aborted) throw abortError(signal);
      const rgba = frame.rgba instanceof Uint8Array
        ? frame.rgba
        : new Uint8Array(frame.rgba);
      worker.postMessage({
        type: "frame",
        index,
        delay: frame.delay,
        rgba: rgba.buffer,
      }, [rgba.buffer]);
      await waitFor("frame");
      index += 1;
      onProgress?.(frame.progress ?? 0);
    }
    worker.postMessage({ type: "finish" });
    const message = await waitFor("finished");
    onProgress?.(1);
    return new Blob([message.bytes], { type: "image/gif" });
  } finally {
    signal?.removeEventListener("abort", abort);
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.terminate();
  }
}