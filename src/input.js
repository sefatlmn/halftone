// input.js — load / fit / pre-adjust the source into a working buffer,
// plus the luminance / colour sampling helpers every effect uses.
//
// The working buffer is a p5.Graphics at *sampling* resolution (long edge
// capped at SAMPLING_CAP) with pixelDensity(1) so pixel indexing is trivial.
// Effects sample from it with normalised 0..1 coordinates and draw shapes at
// full display resolution.

// Long edge of the sampling buffer. Effects iterate over this buffer, so its
// area sets per-render CPU cost and memory: 3000 quadrupled both vs. the 1200
// this tool shipped with and could freeze the tab on load. 1600 keeps more
// detail than the original while staying cheap. Raise for sharper exports.
export const SAMPLING_CAP = 1600; // px on the long edge of the sampling buffer

/* ----------------------------------------------------------------
   Working-buffer construction
   ---------------------------------------------------------------- */

// Build (or rebuild) the working buffer for a given display aspect.
// outW/outH describe the display canvas; the buffer matches that aspect but is
// capped to SAMPLING_CAP on its long edge. Pre-adjust is baked in once here.
// Pass the previous buffer as `reuse`: a pre-adjust slider drag rebuilds this
// every tick, and allocating a fresh sampling-res canvas per tick is exactly
// the churn Safari's lazy canvas reclamation turns into an OOM tab reload.
export function buildWorking(p, srcImage, outW, outH, fit, pre, reuse = null, maxCap = SAMPLING_CAP) {
  const cap = Math.min(SAMPLING_CAP, maxCap > 0 ? maxCap : SAMPLING_CAP);
  const aspect = outW / outH;
  let w, h;
  if (outW >= outH) {
    w = Math.min(outW * 2, cap);
    h = Math.round(w / aspect);
  } else {
    h = Math.min(outH * 2, cap);
    w = Math.round(h * aspect);
  }
  w = Math.max(2, w);
  h = Math.max(2, h);

  let g = reuse;
  if (g && (g.width !== w || g.height !== h)) {
    g.remove();
    g = null;
  }
  if (!g) {
    g = p.createGraphics(w, h);
    g.pixelDensity(1);
  }
  g.background(255); // paper-white letterbox for "contain" (also clears a reused buffer)
  drawFitted(g, srcImage, w, h, fit);
  if (!applyPreAdjust(g, pre)) {
    g.loadPixels(); // keep pixels[] resident for the lifetime of the buffer
  }
  return g;
}

function drawFitted(g, img, w, h, fit) {
  const ia = img.width / img.height;
  const ca = w / h;
  let dw, dh;
  if (fit === 'contain') {
    if (ia > ca) { dw = w; dh = w / ia; }
    else { dh = h; dw = h * ia; }
  } else { // cover
    if (ia > ca) { dh = h; dw = h * ia; }
    else { dw = w; dh = w / ia; }
  }
  g.image(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

let _preLutKey = '';
const _preLut = new Uint8ClampedArray(256);

// Brightness / contrast / gamma / invert, applied in-place to a buffer.
// Returns true if pixels were loaded and updated, false if no-op.
function applyPreAdjust(g, pre) {
  const { brightness = 0, contrast = 0, gamma = 1, invert = false } = pre || {};
  if (brightness === 0 && contrast === 0 && gamma === 1 && !invert) return false;

  const key = `${brightness}|${contrast}|${gamma}|${invert ? 1 : 0}`;
  if (key !== _preLutKey) {
    const c = (contrast / 100) * 255;          // -255..255
    const cf = (259 * (c + 255)) / (255 * (259 - c));
    const gInv = 1 / Math.max(0.01, gamma);
    const b = (brightness / 100) * 255;
    for (let val = 0; val < 256; val++) {
      let v = cf * (val - 128) + 128 + b;      // contrast + brightness
      v = clamp(v, 0, 255) / 255;
      v = 255 * Math.pow(v, gInv);             // gamma
      if (invert) v = 255 - v;
      _preLut[val] = v;
    }
    _preLutKey = key;
  }

  g.loadPixels();
  const px = g.pixels;
  const lut = _preLut;
  for (let i = 0, len = px.length; i < len; i += 4) {
    px[i]     = lut[px[i]];
    px[i + 1] = lut[px[i + 1]];
    px[i + 2] = lut[px[i + 2]];
  }
  g.updatePixels();
  return true;
}

/* ----------------------------------------------------------------
   Sampling helpers — operate on a pixels-loaded, pixelDensity(1) buffer
   ---------------------------------------------------------------- */

// Luminance 0..1 at a normalised point.
export function lumaAt(g, nx, ny) {
  const w = g.width, h = g.height;
  let x = (nx * w) | 0; if (x < 0) x = 0; else if (x >= w) x = w - 1;
  let y = (ny * h) | 0; if (y < 0) y = 0; else if (y >= h) y = h - 1;
  const i = (y * w + x) << 2;
  const px = g.pixels;
  return (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
}

// [r,g,b] 0..255 at a normalised point.
export function rgbAt(g, nx, ny, out = null) {
  const w = g.width, h = g.height;
  let x = (nx * w) | 0; if (x < 0) x = 0; else if (x >= w) x = w - 1;
  let y = (ny * h) | 0; if (y < 0) y = 0; else if (y >= h) y = h - 1;
  const i = (y * w + x) << 2;
  const px = g.pixels;
  if (out) {
    out[0] = px[i];
    out[1] = px[i + 1];
    out[2] = px[i + 2];
    return out;
  }
  return [px[i], px[i + 1], px[i + 2]];
}

// Average luminance across a small cell, given normalised centre + half-extents.
// Samples a 3×3 grid — cheap and a good stand-in for a true cell average.
export function avgLuma(g, cx, cy, hw, hh) {
  const w = g.width, h = g.height;
  const px = g.pixels;
  const dx = hw * 0.62, dy = hh * 0.62;
  let x0 = ((cx - dx) * w) | 0; if (x0 < 0) x0 = 0; else if (x0 >= w) x0 = w - 1;
  let x1 = (cx * w) | 0;        if (x1 < 0) x1 = 0; else if (x1 >= w) x1 = w - 1;
  let x2 = ((cx + dx) * w) | 0; if (x2 < 0) x2 = 0; else if (x2 >= w) x2 = w - 1;
  let y0 = ((cy - dy) * h) | 0; if (y0 < 0) y0 = 0; else if (y0 >= h) y0 = h - 1;
  let y1 = (cy * h) | 0;        if (y1 < 0) y1 = 0; else if (y1 >= h) y1 = h - 1;
  let y2 = ((cy + dy) * h) | 0; if (y2 < 0) y2 = 0; else if (y2 >= h) y2 = h - 1;
  x0 <<= 2; x1 <<= 2; x2 <<= 2;
  const r0 = (y0 * w) << 2, r1 = (y1 * w) << 2, r2 = (y2 * w) << 2;
  const i00 = r0 + x0, i01 = r0 + x1, i02 = r0 + x2;
  const i10 = r1 + x0, i11 = r1 + x1, i12 = r1 + x2;
  const i20 = r2 + x0, i21 = r2 + x1, i22 = r2 + x2;
  const r = px[i00] + px[i01] + px[i02] + px[i10] + px[i11] + px[i12] + px[i20] + px[i21] + px[i22];
  const gg = px[i00 + 1] + px[i01 + 1] + px[i02 + 1] + px[i10 + 1] + px[i11 + 1] + px[i12 + 1] + px[i20 + 1] + px[i21 + 1] + px[i22 + 1];
  const b = px[i00 + 2] + px[i01 + 2] + px[i02 + 2] + px[i10 + 2] + px[i11 + 2] + px[i12 + 2] + px[i20 + 2] + px[i21 + 2] + px[i22 + 2];
  return (0.299 * r + 0.587 * gg + 0.114 * b) / (9 * 255);
}

// Average RGB across a small cell (3×3) — used by the CMYK / channel splits.
export function avgRGB(g, cx, cy, hw, hh, out = [0, 0, 0]) {
  const w = g.width, h = g.height;
  const px = g.pixels;
  const dx = hw * 0.62, dy = hh * 0.62;
  let x0 = ((cx - dx) * w) | 0; if (x0 < 0) x0 = 0; else if (x0 >= w) x0 = w - 1;
  let x1 = (cx * w) | 0;        if (x1 < 0) x1 = 0; else if (x1 >= w) x1 = w - 1;
  let x2 = ((cx + dx) * w) | 0; if (x2 < 0) x2 = 0; else if (x2 >= w) x2 = w - 1;
  let y0 = ((cy - dy) * h) | 0; if (y0 < 0) y0 = 0; else if (y0 >= h) y0 = h - 1;
  let y1 = (cy * h) | 0;        if (y1 < 0) y1 = 0; else if (y1 >= h) y1 = h - 1;
  let y2 = ((cy + dy) * h) | 0; if (y2 < 0) y2 = 0; else if (y2 >= h) y2 = h - 1;
  x0 <<= 2; x1 <<= 2; x2 <<= 2;
  const r0 = (y0 * w) << 2, r1 = (y1 * w) << 2, r2 = (y2 * w) << 2;
  const i00 = r0 + x0, i01 = r0 + x1, i02 = r0 + x2;
  const i10 = r1 + x0, i11 = r1 + x1, i12 = r1 + x2;
  const i20 = r2 + x0, i21 = r2 + x1, i22 = r2 + x2;
  out[0] = (px[i00] + px[i01] + px[i02] + px[i10] + px[i11] + px[i12] + px[i20] + px[i21] + px[i22]) / 9;
  out[1] = (px[i00 + 1] + px[i01 + 1] + px[i02 + 1] + px[i10 + 1] + px[i11 + 1] + px[i12 + 1] + px[i20 + 1] + px[i21 + 1] + px[i22 + 1]) / 9;
  out[2] = (px[i00 + 2] + px[i01 + 2] + px[i02 + 2] + px[i10 + 2] + px[i11 + 2] + px[i12 + 2] + px[i20 + 2] + px[i21 + 2] + px[i22 + 2]) / 9;
  return out;
}

/* ----------------------------------------------------------------
   small utilities
   ---------------------------------------------------------------- */
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

