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
export function buildWorking(p, srcImage, outW, outH, fit, pre, reuse = null) {
  const aspect = outW / outH;
  let w, h;
  if (outW >= outH) {
    w = Math.min(outW, SAMPLING_CAP);
    h = Math.round(w / aspect);
  } else {
    h = Math.min(outH, SAMPLING_CAP);
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
  applyPreAdjust(g, pre);
  g.loadPixels(); // keep pixels[] resident for the lifetime of the buffer
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

// Brightness / contrast / gamma / invert, applied in-place to a buffer.
function applyPreAdjust(g, pre) {
  const { brightness = 0, contrast = 0, gamma = 1, invert = false } = pre || {};
  if (brightness === 0 && contrast === 0 && gamma === 1 && !invert) return;

  g.loadPixels();
  const px = g.pixels;
  const c = (contrast / 100) * 255;          // -255..255
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const gInv = 1 / Math.max(0.01, gamma);
  const b = (brightness / 100) * 255;

  for (let i = 0; i < px.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = px[i + k];
      v = cf * (v - 128) + 128 + b;          // contrast + brightness
      v = clamp(v, 0, 255) / 255;
      v = 255 * Math.pow(v, gInv);            // gamma
      if (invert) v = 255 - v;
      px[i + k] = clamp(v, 0, 255);
    }
  }
  g.updatePixels();
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
export function rgbAt(g, nx, ny) {
  const w = g.width, h = g.height;
  let x = (nx * w) | 0; if (x < 0) x = 0; else if (x >= w) x = w - 1;
  let y = (ny * h) | 0; if (y < 0) y = 0; else if (y >= h) y = h - 1;
  const i = (y * w + x) << 2;
  const px = g.pixels;
  return [px[i], px[i + 1], px[i + 2]];
}

// Average luminance across a small cell, given normalised centre + half-extents.
// Samples a 3×3 grid — cheap and a good stand-in for a true cell average.
export function avgLuma(g, cx, cy, hw, hh) {
  let s = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      s += lumaAt(g, cx + i * hw * 0.62, cy + j * hh * 0.62);
    }
  }
  return s / 9;
}

// Average RGB across a small cell (3×3) — used by the CMYK / channel splits.
export function avgRGB(g, cx, cy, hw, hh) {
  let r = 0, gg = 0, b = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const c = rgbAt(g, cx + i * hw * 0.62, cy + j * hh * 0.62);
      r += c[0]; gg += c[1]; b += c[2];
    }
  }
  return [r / 9, gg / 9, b / 9];
}

/* ----------------------------------------------------------------
   small utilities
   ---------------------------------------------------------------- */
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
