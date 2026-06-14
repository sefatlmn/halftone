// xerox.js — high-contrast 1-bit photocopy. Boost contrast, soft blur, hard
// threshold with noisy edges, toner dropouts and dust specks.
import { hex2rgb, rng, clamp } from './_shared.js';

export default {
  id: 'xerox',
  name: 'Xerox',
  no: '05',
  heavy: true,
  params: [
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

    const tmp = p.createGraphics(sw, sh);
    tmp.pixelDensity(1);
    tmp.image(src, 0, 0);
    tmp.filter(p.BLUR, 0.4 + (1 - params.tonerDensity) * 0.7); // photocopier softness
    tmp.loadPixels();

    const px = tmp.pixels;
    const rand = rng(1337);
    const cf = 1 + params.contrast * 4;
    const th = params.threshold;
    const nz = params.noise;
    const td = params.tonerDensity;

    for (let i = 0; i < px.length; i += 4) {
      let l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      l = clamp((l - 0.5) * cf + 0.5, 0, 1);
      let on = l < th + (rand() - 0.5) * nz;       // dark → toner, jittered edge
      if (on && rand() > td) on = false;           // toner dropout
      if (!on && rand() < 0.0009 * nz) on = true;  // stray specks
      if (on && rand() < 0.0007 * (1 - td)) on = false; // voids in solids
      const c = on ? ink : paper;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
    tmp.updatePixels();

    g.background(params.paper);
    g.drawingContext.imageSmoothingEnabled = false;
    g.image(tmp, 0, 0, w, h);
    g.drawingContext.imageSmoothingEnabled = true;
    tmp.remove(); // free the offscreen buffer (avoid leaking canvases)
  },
};
