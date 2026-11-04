// _shared.js — helpers used across effect modules.

// Seeded PRNG lives in util/prng.js now; re-exported here as `rng` so existing
// effects (riso, xerox) keep importing it from this module unchanged.
export { makeRng as rng } from '../util/prng.js';

// Parse "#rrggbb" (or "#rgb") to [r,g,b] 0..255.
export function hex2rgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Linear blend of two [r,g,b] arrays.
export function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Round to 2 decimals for compact SVG output.
export function n(x) { return Math.round(x * 100) / 100; }

// SVG export budget. Vector exports emit one element per dot, glyph or run, so
// fine settings on a large canvas can reach millions of shapes and a string big
// enough to freeze the tab (worst on Safari). Each renderSVG counts shapes as
// it goes and returns SVG_TOO_LARGE once past the cap, so memory stays bounded.
// ~500k shapes is roughly a 30 MB file.
export const SVG_MAX_SHAPES = 500_000;
export const SVG_TOO_LARGE = 'svg-too-large';

// Wrap inner markup in a complete SVG document string.
export function svgDoc(w, h, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${inner}\n</svg>`;
}
