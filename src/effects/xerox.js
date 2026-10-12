// xerox.js — high-contrast 1-bit photocopy. Boost contrast, soft blur, hard
// threshold with noisy edges, toner dropouts and dust specks.
import { hex2rgb, rng, clamp } from './_shared.js';
import { getScratch } from '../util/scratch.js';

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
    const sw = src.width, sh = src.height;
    const grain = Math.max(0.5, params.grain ?? 1);
    const cols = Math.max(1, Math.min(sw, Math.round(w / grain)));
    const rows = Math.max(1, Math.min(sh, Math.round(h / grain)));

    // Pooled scratch: reusing it also reuses p5's cached blur-filter layer
    // instead of standing up (and leaking) a fresh one per render.
    const tmp = getScratch(p, ctx.slot || 'fx', sw, sh);
    tmp.image(src, 0, 0); // opaque source covers the full buffer — old frame gone
    tmp.filter(p.BLUR, 0.4 + (1 - params.tonerDensity) * 0.7); // photocopier softness
    tmp.loadPixels();

    const px = tmp.pixels;
    const rand = rng(1337);
    const cf = 1 + params.contrast * 4;
    const th = params.threshold;
    const nz = params.noise;
    const td = params.tonerDensity;

    for (let y = 0; y < rows; y++) {
      const sy = Math.min(sh - 1, ((y + 0.5) * sh / rows) | 0);
      for (let x = 0; x < cols; x++) {
        const sx = Math.min(sw - 1, ((x + 0.5) * sw / cols) | 0);
        const si = (sy * sw + sx) << 2;
        let l = (0.299 * px[si] + 0.587 * px[si + 1] + 0.114 * px[si + 2]) / 255;
        l = clamp((l - 0.5) * cf + 0.5, 0, 1);
        let on = l < th + (rand() - 0.5) * nz;       // dark → toner, jittered edge
        if (on && rand() > td) on = false;           // toner dropout
        if (!on && rand() < 0.0009 * nz) on = true;  // stray specks
        if (on && rand() < 0.0007 * (1 - td)) on = false; // voids in solids
        const c = on ? ink : paper;
        const di = (y * sw + x) << 2;
        px[di] = c[0]; px[di + 1] = c[1]; px[di + 2] = c[2]; px[di + 3] = 255;
      }
    }
    tmp.updatePixels();

    g.background(params.paper);
    const gctx = g.drawingContext;
    gctx.imageSmoothingEnabled = false;
    gctx.drawImage(tmp.canvas, 0, 0, cols, rows, 0, 0, w, h);
    gctx.imageSmoothingEnabled = true;
  },
};
