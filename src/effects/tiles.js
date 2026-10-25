// tiles.js — cuts the frame into tiles laid out on a grid, where tiles randomly
// span several columns and rows (a packed, Mondrian-like layout), then
// optionally shuffles, rotates, jitters and gaps them. Seeded, so a given seed
// always produces the same layout (and stays stable across animated frames).
import { getScratchPixels } from '../util/scratch.js';
import { hex2rgb } from './_shared.js';
import { makeRng } from '../util/prng.js';

const num = (v, d) => (Number.isFinite(+v) ? +v : d);

// Pack the cols×rows grid with rectangles. Walk cells in reading order; at each
// free cell pick a random span, then shrink it until it fits free cells.
function packGrid(cols, rows, maxSpan, merge, rng) {
  const owner = new Int32Array(cols * rows).fill(-1);
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (owner[r * cols + c] !== -1) continue;
      let sw = 1, sh = 1;
      if (rng() < merge) sw = 1 + Math.floor(rng() * maxSpan);
      if (rng() < merge) sh = 1 + Math.floor(rng() * maxSpan);
      sw = Math.min(sw, cols - c);
      sh = Math.min(sh, rows - r);
      // shrink width until the top row of the span is free
      for (let k = 1; k < sw; k++) if (owner[r * cols + c + k] !== -1) { sw = k; break; }
      // shrink height until every row of the span is free
      outer: for (let j = 1; j < sh; j++) {
        for (let k = 0; k < sw; k++) {
          if (owner[(r + j) * cols + c + k] !== -1) { sh = j; break outer; }
        }
      }
      const id = tiles.length;
      tiles.push({ c, r, w: sw, h: sh });
      for (let j = 0; j < sh; j++) for (let k = 0; k < sw; k++) owner[(r + j) * cols + c + k] = id;
    }
  }
  return { owner, tiles };
}

let _xColBuf = null;

export default {
  id: 'tiles',
  name: 'Tiles',
  no: '11',
  params: [
    { key: 'cols',     label: 'Grid columns', type: 'range', min: 1, max: 40, step: 1, value: 8 },
    { key: 'rows',     label: 'Grid rows',    type: 'range', min: 1, max: 40, step: 1, value: 8 },
    { key: 'maxSpan',  label: 'Max span',     type: 'range', min: 1, max: 8, step: 1, value: 3 },
    { key: 'merge',    label: 'Span chance',  type: 'range', min: 0, max: 1, step: 0.01, value: 0.6 },
    { key: 'shuffle',  label: 'Shuffle',      type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 },
    { key: 'rotate',   label: 'Rotate tiles', type: 'select', options: ['none', '90°', '180°'], value: 'none' },
    { key: 'jitter',   label: 'Offset jitter', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0 },
    { key: 'gap',      label: 'Gap',          type: 'range', min: 0, max: 20, step: 0.5, value: 2 },
    { key: 'gapColor', label: 'Gap colour',   type: 'color', value: '#15120d' },
    { key: 'seed',     label: 'Seed',         type: 'range', min: 0, max: 9999, step: 1, value: 42 },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);

    // never more grid lines than pixels, so every cell is at least 1px
    const cols = Math.max(1, Math.min(sw, num(params.cols, 8) | 0));
    const rows = Math.max(1, Math.min(sh, num(params.rows, 8) | 0));
    const rng = makeRng(num(params.seed, 42));
    const { owner, tiles } = packGrid(
      cols, rows, Math.max(1, num(params.maxSpan, 3) | 0), num(params.merge, 0.6), rng,
    );
    const n = tiles.length;
    const cw = sw / cols, ch = sh / rows;

    // source tile for each destination tile: partial Fisher–Yates. Sources are
    // sampled stretched to fit, so tiles of different sizes can swap.
    const shuffle = num(params.shuffle, 0);
    const map = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      if (rng() < shuffle) {
        const j = Math.floor(rng() * (i + 1));
        const t = map[i]; map[i] = map[j]; map[j] = t;
      }
    }

    // gap is in display px; convert to buffer px, and never let it swallow a
    // whole tile (keep at least ~1px of picture per cell)
    const gapPx = (num(params.gap, 0) * sw) / (w || sw) / 2;
    const gx = Math.max(0, Math.min(gapPx, cw / 2 - 0.5));
    const gy = Math.max(0, Math.min(gapPx, ch / 2 - 0.5));
    const [gr, gg, gb] = hex2rgb(params.gapColor || '#15120d');

    const jitter = num(params.jitter, 0);
    const want90 = params.rotate === '90°', want180 = params.rotate === '180°';
    for (let idx = 0; idx < n; idx++) {
      const t = tiles[idx];
      // a quarter turn only looks right on (near-)square tiles; others get a
      // half turn instead of being squashed
      const pxW = t.w * cw, pxH = t.h * ch;
      const square = Math.abs(pxW - pxH) <= Math.max(pxW, pxH) * 0.15;
      if (want90 && square) t.rot = Math.floor(rng() * 4);
      else if (want90 || want180) t.rot = rng() < 0.5 ? 0 : 2;
      else t.rot = 0;
      t.jx = (rng() - 0.5) * 2 * jitter;
      t.jy = (rng() - 0.5) * 2 * jitter;
      t.x0 = t.c * cw; t.y0 = t.r * ch; t.pw = pxW; t.ph = pxH;
      t.invPw = 1 / pxW;
      t.invPh = 1 / pxH;
      t.maxLx = pxW - gx;
      t.maxLy = pxH - gy;
      t.src = tiles[map[idx]];
    }

    if (!_xColBuf || _xColBuf.length < sw) _xColBuf = new Uint16Array(sw);
    const xCols = _xColBuf;
    const invCw = 1 / cw, invCh = 1 / ch;
    for (let x = 0; x < sw; x++) {
      const rx = (x * invCw) | 0;
      xCols[x] = rx < cols ? rx : cols - 1;
    }

    for (let y = 0; y < sh; y++) {
      let ry = (y * invCh) | 0;
      if (ry >= rows) ry = rows - 1;
      const rowOwnerOff = ry * cols;
      const yRowOff = y * sw;

      for (let x = 0; x < sw; x++) {
        const t = tiles[owner[rowOwnerOff + xCols[x]]];
        const lx = x - t.x0, ly = y - t.y0;
        const o = (yRowOff + x) << 2;
        if (lx < gx || ly < gy || lx >= t.maxLx || ly >= t.maxLy) {
          op[o] = gr; op[o + 1] = gg; op[o + 2] = gb; op[o + 3] = 255;
          continue;
        }
        let u = lx * t.invPw, v = ly * t.invPh, tmp;
        switch (t.rot) {
          case 1: tmp = u; u = v; v = 1 - tmp; break;
          case 2: u = 1 - u; v = 1 - v; break;
          case 3: tmp = u; u = 1 - v; v = tmp; break;
        }
        u += t.jx; v += t.jy;
        u -= Math.floor(u); v -= Math.floor(v); // wrap within the tile
        const s = t.src;
        let sx = (s.x0 + u * s.pw) | 0;
        let sy = (s.y0 + v * s.ph) | 0;
        if (sx < 0) sx = 0; else if (sx >= sw) sx = sw - 1;
        if (sy < 0) sy = 0; else if (sy >= sh) sy = sh - 1;
        const i = (sy * sw + sx) << 2;
        op[o] = sp[i]; op[o + 1] = sp[i + 1]; op[o + 2] = sp[i + 2]; op[o + 3] = 255;
      }
    }

    commit();
    g.image(out, 0, 0, w, h);
  },
};

