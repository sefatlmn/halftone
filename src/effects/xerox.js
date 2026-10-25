// xerox.js — high-contrast 1-bit photocopy. Boost contrast, soft blur, hard
// threshold with noisy edges, toner dropouts and dust specks.
import { hex2rgb, rng, clamp } from './_shared.js';
import { getScratchPixels, packRGBA } from '../util/scratch.js';

export default {
  id: 'xerox',
  name: 'Xerox',
  no: '05',
  heavy: true,
  params: [
    { key: 'grain',        label: 'Grain size',    type: 'range', min: 0.5, max: 6, step: 0.5, value: 1 },
    { key: 'threshold',    label: 'Threshold',     type: 'range', min: 0.05, max: 0.95, step: 0.01, value: 0.5 },
    { key: 'contrast',     label: 'Contrast',      type: 'range', min: 0, max: 1, step: 0.01, value: 0.55 },
    { key: 'noise',        label: 'Edge noise',    type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 },
    { key: 'tonerDensity', label: 'Toner density', type: 'range', min: 0.3, max: 1, step: 0.01, value: 0.85 },
    { key: 'ink',          label: 'Toner',         type: 'color', value: '#15120D' },
    { key: 'paper',        label: 'Paper',         type: 'color', value: '#ffffff', lockRandom: true },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const ink = hex2rgb(params.ink);
    const paper = hex2rgb(params.paper);
    const ink32 = packRGBA(ink[0], ink[1], ink[2], 255);
    const paper32 = packRGBA(paper[0], paper[1], paper[2], 255);
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const grain = Math.max(0.5, params.grain ?? 1);
    const cols = Math.max(1, Math.min(sw, Math.round(w / grain)));
    const rows = Math.max(1, Math.min(sh, Math.round(h / grain)));

    const { g: tmp, u32, commit } = getScratchPixels(p, `xerox:${ctx.slot || 'fx'}`, cols, rows);

    const rand = rng(1337);
    const cf = 1 + params.contrast * 4;
    const th = params.threshold;
    const nz = params.noise;
    const td = params.tonerDensity;
    const speckProb = 0.0009 * nz;
    const voidProb = 0.0007 * (1 - td);

    // Inline 5-tap cross blur on source luminance (replaces full-canvas p.BLUR + getImageData)
    const blur = 0.4 + (1 - td) * 0.7;
    const wN = (blur * 0.14) / 255;
    const wC = (1 - blur * 0.56) / 255;
    const rowStride = sw << 2;

    let di = 0;
    for (let y = 0; y < rows; y++) {
      const sy = Math.min(sh - 1, ((y + 0.5) * sh / rows) | 0);
      const syU = sy > 0 ? sy - 1 : 0;
      const syD = sy < sh - 1 ? sy + 1 : sh - 1;
      const rowC = sy * rowStride;
      const rowU = syU * rowStride;
      const rowD = syD * rowStride;

      for (let x = 0; x < cols; x++) {
        const sx = Math.min(sw - 1, ((x + 0.5) * sw / cols) | 0);
        const sxL = (sx > 0 ? sx - 1 : 0) << 2;
        const sxR = (sx < sw - 1 ? sx + 1 : sw - 1) << 2;
        const sxC = sx << 2;

        const iC = rowC + sxC;
        const iL = rowC + sxL;
        const iR = rowC + sxR;
        const iU = rowU + sxC;
        const iD = rowD + sxC;

        const lC = 0.299 * sp[iC] + 0.587 * sp[iC + 1] + 0.114 * sp[iC + 2];
        const lN =
          0.299 * (sp[iL] + sp[iR] + sp[iU] + sp[iD]) +
          0.587 * (sp[iL + 1] + sp[iR + 1] + sp[iU + 1] + sp[iD + 1]) +
          0.114 * (sp[iL + 2] + sp[iR + 2] + sp[iU + 2] + sp[iD + 2]);
        let l = lC * wC + lN * wN;
        l = clamp((l - 0.5) * cf + 0.5, 0, 1);
        let on = l < th + (rand() - 0.5) * nz;       // dark → toner, jittered edge
        if (on && rand() > td) on = false;           // toner dropout
        if (!on && rand() < speckProb) on = true;    // stray specks
        if (on && rand() < voidProb) on = false;     // voids in solids
        u32[di++] = on ? ink32 : paper32;
      }
    }
    commit();

    g.background(params.paper);
    const gctx = g.drawingContext;
    gctx.imageSmoothingEnabled = false;
    gctx.drawImage(tmp.canvas, 0, 0, cols, rows, 0, 0, w, h);
    gctx.imageSmoothingEnabled = true;
  },
};

