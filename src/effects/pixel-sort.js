// pixel-sort.js — sort contiguous runs of pixels along rows or columns.
// Static. Vertical mode walks columns via stride (no rotated copy).
import { makeRng } from '../util/prng.js';

function rgb2hue(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function rgb2sat(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

export default {
  id: 'pixel-sort',
  name: 'Pixel Sort',
  no: '09',
  heavy: true,
  acceptsBase: true,
  params: [
    { key: 'direction',     label: 'Direction',      type: 'select', options: ['horizontal', 'vertical'], value: 'horizontal' },
    { key: 'sortKey',       label: 'Sort by',        type: 'select', options: ['brightness', 'hue', 'saturation', 'r', 'g', 'b'], value: 'brightness' },
    { key: 'intervalMode',  label: 'Intervals',      type: 'select', options: ['threshold', 'edge', 'random', 'full'], value: 'threshold', rebuildOnChange: true },
    { key: 'low',           label: 'Low',            type: 'range', min: 0, max: 1, step: 0.01, value: 0.25, showIf: s => s.intervalMode === 'threshold' },
    { key: 'high',          label: 'High',           type: 'range', min: 0, max: 1, step: 0.01, value: 0.8, showIf: s => s.intervalMode === 'threshold' },
    { key: 'edgeThreshold', label: 'Edge threshold', type: 'range', min: 0.01, max: 1, step: 0.01, value: 0.2, showIf: s => s.intervalMode === 'edge' },
    { key: 'maxInterval',   label: 'Max interval',   type: 'range', min: 2, max: 400, step: 1, value: 90, showIf: s => s.intervalMode === 'random' },
    { key: 'seed',          label: 'Seed',           type: 'range', min: 0, max: 9999, step: 1, value: 7, showIf: s => s.intervalMode === 'random' },
    { key: 'order',         label: 'Order',          type: 'select', options: ['ascending', 'descending'], value: 'ascending' },
    { key: 'reverse',       label: 'Reverse',        type: 'toggle', value: false },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const out = p.createGraphics(sw, sh);
    out.pixelDensity(1);
    out.loadPixels();
    const op = out.pixels;
    op.set(sp); // pixels outside any sorted interval keep their place

    const vertical = params.direction === 'vertical';
    const nLines = vertical ? sw : sh;
    const lineLen = vertical ? sh : sw;
    const stride = vertical ? sw * 4 : 4;
    const mode = params.intervalMode;
    const key = params.sortKey;
    const desc = (params.order === 'descending') !== params.reverse;
    const lo = Math.min(params.low, params.high);
    const hi = Math.max(params.low, params.high);
    const rng = mode === 'random' ? makeRng(params.seed) : null;

    // reusable per-line scratch (sized to the longest line)
    const R = new Uint8Array(lineLen), G = new Uint8Array(lineLen), B = new Uint8Array(lineLen), A = new Uint8Array(lineLen);
    const K = new Float32Array(lineLen), bright = new Float32Array(lineLen);

    for (let L = 0; L < nLines; L++) {
      const base = vertical ? L * 4 : L * sw * 4;

      for (let q = 0; q < lineLen; q++) {
        const off = base + q * stride;
        const r = op[off], gg = op[off + 1], b = op[off + 2];
        R[q] = r; G[q] = gg; B[q] = b; A[q] = op[off + 3];
        const br = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
        bright[q] = br;
        K[q] = key === 'r' ? r : key === 'g' ? gg : key === 'b' ? b
          : key === 'hue' ? rgb2hue(r, gg, b) : key === 'saturation' ? rgb2sat(r, gg, b) : br;
      }

      const sortInterval = (s, e) => {
        if (e - s < 2) return;
        const order = new Array(e - s);
        for (let k = 0; k < order.length; k++) order[k] = s + k;
        order.sort((a, b) => K[a] - K[b]);
        if (desc) order.reverse();
        for (let k = 0; k < order.length; k++) {
          const dst = base + (s + k) * stride, sIdx = order[k];
          op[dst] = R[sIdx]; op[dst + 1] = G[sIdx]; op[dst + 2] = B[sIdx]; op[dst + 3] = A[sIdx];
        }
      };

      if (mode === 'full') {
        sortInterval(0, lineLen);
      } else if (mode === 'threshold') {
        let s = -1;
        for (let q = 0; q < lineLen; q++) {
          const inBand = bright[q] >= lo && bright[q] <= hi;
          if (inBand && s < 0) s = q;
          else if (!inBand && s >= 0) { sortInterval(s, q); s = -1; }
        }
        if (s >= 0) sortInterval(s, lineLen);
      } else if (mode === 'edge') {
        const et = params.edgeThreshold;
        let s = 0;
        for (let q = 1; q < lineLen; q++) {
          if (Math.abs(bright[q] - bright[q - 1]) > et) { sortInterval(s, q); s = q; }
        }
        sortInterval(s, lineLen);
      } else { // random
        let s = 0;
        while (s < lineLen) {
          const e = Math.min(lineLen, s + 1 + Math.floor(rng() * params.maxInterval));
          sortInterval(s, e);
          s = e;
        }
      }
    }

    out.updatePixels();
    g.drawingContext.imageSmoothingEnabled = false;
    g.image(out, 0, 0, w, h);
    g.drawingContext.imageSmoothingEnabled = true;
    out.remove();
  },
};
