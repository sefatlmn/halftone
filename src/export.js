// export.js — PNG (full-res, 1× / 2×), SVG (for vector-native effects), and
// color-separation ZIP (one plate per ink/channel, bundled via src/zip.js).

import { makeZipBlob } from "./zip.js";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveCanvas(buf, filename) {
  buf.canvas.toBlob((blob) => {
    if (blob) download(blob, filename);
    buf.remove();
  }, 'image/png');
}

// Re-render the effect at scale× into an offscreen buffer and save as PNG.
// We scale the drawing context (not the logical size) so the composition is
// identical to the preview, just at higher device resolution.
//
// `second` (optional) stacks a second effect on the first's output, mirroring
// the live chain: the first effect is drawn into an intermediate buffer at full
// export resolution, then the second effect renders from it into the final buf.
export function exportPNG(p, effect, src, state, w, h, scale, filename, second) {
  const W = Math.round(w * scale), H = Math.round(h * scale);

  if (!second) {
    const buf = p.createGraphics(W, H);
    buf.pixelDensity(1);
    buf.push();
    buf.scale(scale);
    effect.render(buf, src, state, { p, w, h });
    buf.pop();
    saveCanvas(buf, filename);
    return;
  }

  const mid = p.createGraphics(W, H);
  mid.pixelDensity(1);
  mid.push();
  mid.scale(scale);
  effect.render(mid, src, state, { p, w, h });
  mid.pop();
  mid.loadPixels();

  const buf = p.createGraphics(W, H);
  buf.pixelDensity(1);
  buf.push();
  buf.scale(scale);
  second.effect.render(buf, mid, second.state, { p, w, h });
  buf.pop();
  saveCanvas(buf, filename);
  mid.remove();
}

// PNG-encode a p5 buffer's canvas to raw bytes (for zipping).
function canvasToPngBytes(buf) {
  return new Promise((resolve, reject) => {
    buf.canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("toBlob returned null")); return; }
      blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
    }, "image/png");
  });
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Render each color-separation plate to its own scale× buffer, PNG-encode it, and
// bundle the lot into one ZIP. `plates` is [{ name, draw(g) }] from an effect's
// separations() (drawn at logical w×h); the buffer is scaled like exportPNG so
// plates come out at full export resolution. Returns the number of plates written.
export async function exportSeparations(p, plates, w, h, scale, filename) {
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const files = [];
  for (let i = 0; i < plates.length; i++) {
    const buf = p.createGraphics(W, H);
    buf.pixelDensity(1);
    buf.push();
    buf.scale(scale);
    plates[i].draw(buf);
    buf.pop();
    const bytes = await canvasToPngBytes(buf);
    buf.remove();
    const num = String(i + 1).padStart(2, "0");
    files.push({ name: `${num}_${slug(plates[i].name)}.png`, bytes });
  }
  download(makeZipBlob(files), filename);
  return files.length;
}

// Vector export. Returns a status so the UI can explain a skip.
//   { ok:true } | { ok:false, reason:'no-svg'|'unsupported' }
// `p` is passed through in the view so effects that need p5 (e.g. dither's
// noise-based modulation) can reproduce the raster exactly in vector form.
export function exportSVG(effect, src, state, w, h, filename, p) {
  if (typeof effect.renderSVG !== 'function') return { ok: false, reason: 'no-svg' };
  const svg = effect.renderSVG(src, state, { w, h, p });
  if (!svg) return { ok: false, reason: 'unsupported' };
  download(new Blob([svg], { type: 'image/svg+xml' }), filename);
  return { ok: true };
}
