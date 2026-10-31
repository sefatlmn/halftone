// tiles.js — cuts the frame into tiles laid out on a grid, where tiles randomly
// span several columns and rows (a packed, Mondrian-like layout), then
// optionally shuffles and rotates them. The layout is seeded with a fixed seed,
// so it is always the same for the same params (and stays stable across
// animated frames). Tiles are resampled bilinearly so a small source tile
// stretched over a larger one stays smooth instead of blocky.
import { getScratchPixels } from '../util/scratch.js';
import { makeRng } from '../util/prng.js';

const SEED = 42;

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
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);

    // never more grid lines than pixels, so every cell is at least 1px
    const cols = Math.max(1, Math.min(sw, num(params.cols, 8) | 0));
    const rows = Math.max(1, Math.min(sh, num(params.rows, 8) | 0));
    const rng = makeRng(SEED);
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
      t.x0 = t.c * cw; t.y0 = t.r * ch; t.pw = pxW; t.ph = pxH;
      t.invPw = 1 / pxW;
      t.invPh = 1 / pxH;
      t.src = tiles[map[idx]];
    }
    // pixel range each tile owns; taps clamp to it so a swapped tile never
    // blends in its neighbour's pixels
    for (const t of tiles) {
      t.minX = Math.min(sw - 1, Math.ceil(t.x0 - 1e-6));
      t.maxX = Math.min(sw - 1, Math.max(t.minX, Math.ceil(t.x0 + t.pw - 1e-6) - 1));
      t.minY = Math.min(sh - 1, Math.ceil(t.y0 - 1e-6));
      t.maxY = Math.min(sh - 1, Math.max(t.minY, Math.ceil(t.y0 + t.ph - 1e-6) - 1));
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
        const o = (yRowOff + x) << 2;
        if (t.src === t && !t.rot) { // identity tile: copy the pixel
          op[o] = sp[o]; op[o + 1] = sp[o + 1]; op[o + 2] = sp[o + 2]; op[o + 3] = 255;
          continue;
        }
        // pixel-centre coordinates inside the tile
        let u = (x - t.x0 + 0.5) * t.invPw, v = (y - t.y0 + 0.5) * t.invPh, tmp;
        switch (t.rot) {
          case 1: tmp = u; u = v; v = 1 - tmp; break;
          case 2: u = 1 - u; v = 1 - v; break;
          case 3: tmp = u; u = 1 - v; v = tmp; break;
        }
        const s = t.src;
        // bilinear sample of the source tile (identity mapping lands exactly
        // on pixel centres, so unshuffled tiles are not softened)
        const fx = s.x0 + u * s.pw - 0.5, fy = s.y0 + v * s.ph - 0.5;
        let x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        let x1 = x0 + 1, y1 = y0 + 1;
        if (x0 < s.minX) x0 = s.minX; else if (x0 > s.maxX) x0 = s.maxX;
        if (x1 < s.minX) x1 = s.minX; else if (x1 > s.maxX) x1 = s.maxX;
        if (y0 < s.minY) y0 = s.minY; else if (y0 > s.maxY) y0 = s.maxY;
        if (y1 < s.minY) y1 = s.minY; else if (y1 > s.maxY) y1 = s.maxY;
        const i00 = (y0 * sw + x0) << 2, i10 = (y0 * sw + x1) << 2;
        const i01 = (y1 * sw + x0) << 2, i11 = (y1 * sw + x1) << 2;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        op[o]     = sp[i00] * w00 + sp[i10] * w10 + sp[i01] * w01 + sp[i11] * w11;
        op[o + 1] = sp[i00 + 1] * w00 + sp[i10 + 1] * w10 + sp[i01 + 1] * w01 + sp[i11 + 1] * w11;
        op[o + 2] = sp[i00 + 2] * w00 + sp[i10 + 2] * w10 + sp[i01 + 2] * w01 + sp[i11 + 2] * w11;
        op[o + 3] = 255;
      }
    }

    commit();
    g.image(out, 0, 0, w, h);
  },
};

