// glitch.js — static, seeded block-displacement + local corruption.
// Composites four passes per band, each gated by its own amount. All randomness
// comes from makeRng(seed) so a given seed reproduces the exact same glitch.
//
// Works on the raw working buffer OR on another effect's output (acceptsBase).
import { makeRng } from '../util/prng.js';

const idx = (x, y, sw) => (y * sw + x) << 2;

// Split [0,len) into `n` contiguous bands of random size (seeded).
function randomBands(len, n, rng) {
  const cuts = [];
  for (let i = 0; i < n - 1; i++) cuts.push(Math.floor(rng() * len));
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, len];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] > edges[i]) out.push([edges[i], edges[i + 1]]);
  return out;
}

// Pass 1 — shift a band along the primary axis, reading from the source snapshot.
function shiftBand(op, sp, sw, sh, a0, a1, vertical, shift, wrap) {
  if (shift === 0) { // still copy through so the band is filled
    if (!vertical) for (let y = a0; y < a1; y++) for (let x = 0; x < sw; x++) { const i = idx(x, y, sw); op[i] = sp[i]; op[i + 1] = sp[i + 1]; op[i + 2] = sp[i + 2]; op[i + 3] = sp[i + 3]; }
    else for (let x = a0; x < a1; x++) for (let y = 0; y < sh; y++) { const i = idx(x, y, sw); op[i] = sp[i]; op[i + 1] = sp[i + 1]; op[i + 2] = sp[i + 2]; op[i + 3] = sp[i + 3]; }
    return;
  }
  if (!vertical) {
    for (let y = a0; y < a1; y++) {
      for (let x = 0; x < sw; x++) {
        let sx = x - shift;
        sx = wrap ? ((sx % sw) + sw) % sw : (sx < 0 ? 0 : sx >= sw ? sw - 1 : sx);
        const d = idx(x, y, sw), s = idx(sx, y, sw);
        op[d] = sp[s]; op[d + 1] = sp[s + 1]; op[d + 2] = sp[s + 2]; op[d + 3] = sp[s + 3];
      }
    }
  } else {
    for (let x = a0; x < a1; x++) {
      for (let y = 0; y < sh; y++) {
        let sy = y - shift;
        sy = wrap ? ((sy % sh) + sh) % sh : (sy < 0 ? 0 : sy >= sh ? sh - 1 : sy);
        const d = idx(x, y, sw), s = idx(x, sy, sw);
        op[d] = sp[s]; op[d + 1] = sp[s + 1]; op[d + 2] = sp[s + 2]; op[d + 3] = sp[s + 3];
      }
    }
  }
}

// Pass 2 — datamosh: copy a rectangular block from a random source location.
function smearBand(op, sp, sw, sh, a0, a1, vertical, rng) {
  if (!vertical) {
    const bh = a1 - a0;
    const bw = Math.max(2, Math.floor((0.2 + rng() * 0.55) * sw));
    const dstX = Math.floor(rng() * Math.max(1, sw - bw));
    const srcX = Math.floor(rng() * Math.max(1, sw - bw));
    const srcY = Math.floor(rng() * Math.max(1, sh - bh));
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const d = idx(dstX + i, a0 + j, sw), s = idx(srcX + i, srcY + j, sw);
      op[d] = sp[s]; op[d + 1] = sp[s + 1]; op[d + 2] = sp[s + 2]; op[d + 3] = sp[s + 3];
    }
  } else {
    const bw = a1 - a0;
    const bh = Math.max(2, Math.floor((0.2 + rng() * 0.55) * sh));
    const dstY = Math.floor(rng() * Math.max(1, sh - bh));
    const srcY = Math.floor(rng() * Math.max(1, sh - bh));
    const srcX = Math.floor(rng() * Math.max(1, sw - bw));
    for (let i = 0; i < bw; i++) for (let j = 0; j < bh; j++) {
      const d = idx(a0 + i, dstY + j, sw), s = idx(srcX + i, srcY + j, sw);
      op[d] = sp[s]; op[d + 1] = sp[s + 1]; op[d + 2] = sp[s + 2]; op[d + 3] = sp[s + 3];
    }
  }
}

// Pass 3 — local channel tear: offset ONE of R/G/B by a few px within the band.
function tearBand(op, sw, sh, a0, a1, vertical, off, c) {
  if (off === 0) return;
  if (!vertical) {
    const tmp = new Uint8Array(sw);
    for (let y = a0; y < a1; y++) {
      for (let x = 0; x < sw; x++) tmp[x] = op[idx(x, y, sw) + c];
      for (let x = 0; x < sw; x++) { let sx = x - off; sx = sx < 0 ? 0 : sx >= sw ? sw - 1 : sx; op[idx(x, y, sw) + c] = tmp[sx]; }
    }
  } else {
    const tmp = new Uint8Array(sh);
    for (let x = a0; x < a1; x++) {
      for (let y = 0; y < sh; y++) tmp[y] = op[idx(x, y, sw) + c];
      for (let y = 0; y < sh; y++) { let sy = y - off; sy = sy < 0 ? 0 : sy >= sh ? sh - 1 : sy; op[idx(x, y, sw) + c] = tmp[sy]; }
    }
  }
}

// Pass 4 — corrupt: posterize / bit-crush the band (broken-JPEG look).
function corruptBand(op, sw, sh, a0, a1, vertical, amount) {
  const levels = Math.max(2, Math.round(2 + (1 - amount) * 14)); // more amount → fewer levels
  const q = 255 / (levels - 1);
  const crush = (i) => { for (let c = 0; c < 3; c++) op[i + c] = Math.round(Math.round(op[i + c] / q) * q); };
  if (!vertical) for (let y = a0; y < a1; y++) for (let x = 0; x < sw; x++) crush(idx(x, y, sw));
  else for (let x = a0; x < a1; x++) for (let y = 0; y < sh; y++) crush(idx(x, y, sw));
}

export default {
  id: 'glitch',
  name: 'Glitch',
  no: '07',
  heavy: true,
  acceptsBase: true,
  params: [
    { key: 'seed',        label: 'Seed',         type: 'range', min: 0, max: 9999, step: 1, value: 42 },
    { key: 'intensity',   label: 'Intensity',    type: 'range', min: 0, max: 1, step: 0.01, value: 0.7 },
    { key: 'blocks',      label: 'Blocks',       type: 'range', min: 2, max: 48, step: 1, value: 16 },
    { key: 'maxShift',    label: 'Max shift %',  type: 'range', min: 0, max: 50, step: 1, value: 14 },
    { key: 'wrap',        label: 'Wrap',         type: 'toggle', value: true },
    { key: 'smear',       label: 'Smear',        type: 'range', min: 0, max: 1, step: 0.01, value: 0.3 },
    { key: 'channelTear', label: 'Channel tear', type: 'range', min: 0, max: 1, step: 0.01, value: 0.25 },
    { key: 'corrupt',     label: 'Corrupt',      type: 'range', min: 0, max: 1, step: 0.01, value: 0.2 },
    { key: 'direction',   label: 'Direction',    type: 'select', options: ['horizontal', 'vertical'], value: 'horizontal' },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const out = p.createGraphics(sw, sh);
    out.pixelDensity(1);
    out.loadPixels();
    const op = out.pixels;
    op.set(sp); // baseline = source

    const rng = makeRng(params.seed);
    const I = params.intensity;
    const vertical = params.direction === 'vertical';
    const axis = vertical ? sw : sh;          // dimension split into bands
    const shiftDim = vertical ? sh : sw;      // dimension we shift along
    const bands = randomBands(axis, Math.max(1, params.blocks), rng);
    const maxShiftPx = (params.maxShift / 100) * shiftDim * I;

    for (const [a0, a1] of bands) {
      const shift = Math.round((rng() * 2 - 1) * maxShiftPx);
      shiftBand(op, sp, sw, sh, a0, a1, vertical, shift, params.wrap);

      if (params.smear > 0 && rng() < params.smear * I) smearBand(op, sp, sw, sh, a0, a1, vertical, rng);

      if (params.channelTear > 0 && rng() < 0.4 + params.channelTear * 0.5) {
        const off = Math.round((0.5 + rng()) * params.channelTear * 0.03 * shiftDim * I);
        tearBand(op, sw, sh, a0, a1, vertical, off, Math.floor(rng() * 3));
      }

      if (params.corrupt > 0 && rng() < params.corrupt * I) corruptBand(op, sw, sh, a0, a1, vertical, params.corrupt);
    }

    out.updatePixels();
    g.drawingContext.imageSmoothingEnabled = false;
    g.image(out, 0, 0, w, h);
    g.drawingContext.imageSmoothingEnabled = true;
    out.remove();
  },
};
