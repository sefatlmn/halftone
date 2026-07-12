// stamp.js — rubber-stamp / letterpress 1-bit. Hard threshold with rough,
// coherent (Perlin) edge jitter plus an ink-texture mask that breaks up solids.
import { hex2rgb, clamp } from './_shared.js';
import { getScratch } from '../util/scratch.js';

export default {
  id: 'stamp',
  name: 'Print Stamp',
  no: '06',
  heavy: true,
  params: [
    { key: 'threshold',       label: 'Threshold',      type: 'range', min: 0.05, max: 0.95, step: 0.01, value: 0.52 },
    { key: 'roughness',       label: 'Edge roughness', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45 },
    { key: 'textureStrength', label: 'Ink texture',    type: 'range', min: 0, max: 1, step: 0.01, value: 0.3 },
    { key: 'ink',             label: 'Ink',            type: 'color', value: '#15120D' },
    { key: 'paper',           label: 'Paper',          type: 'color', value: '#ffffff', lockRandom: true },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const ink = hex2rgb(params.ink);
    const paper = hex2rgb(params.paper);
    const sw = src.width, sh = src.height;

    const tmp = getScratch(p, `${ctx.slot || 'fx'}:stamp`, sw, sh); // pooled
    tmp.image(src, 0, 0); // opaque source covers the full buffer — old frame gone
    tmp.loadPixels();
    const px = tmp.pixels;

    p.noiseSeed(42);
    const th = params.threshold;
    const rough = params.roughness;
    const tex = params.textureStrength;
    const edgeScale = 0.05 + rough * 0.12;
    const texScale = 0.22;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) << 2;
        const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
        const jit = (p.noise(x * edgeScale, y * edgeScale) - 0.5) * rough * 0.85;
        let on = l < th + jit;
        if (on && tex > 0 && p.noise(x * texScale, y * texScale, 50) < tex * 0.55) on = false;
        const c = on ? ink : paper;
        px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      }
    }
    tmp.updatePixels();

    g.background(params.paper);
    g.drawingContext.imageSmoothingEnabled = false;
    g.image(tmp, 0, 0, w, h);
    g.drawingContext.imageSmoothingEnabled = true;
  },
};
