// gradient-map.js — luminance → multi-stop ramp. Covers duotone / tritone /
// thermal / cyanotype / monochrome / threshold+posterize, all from one ramp.
import { makeRng } from '../util/prng.js';
import { RAMPS, buildRampLUT, cloneStops } from '../color/ramps.js';

export default {
  id: 'gradient-map',
  name: 'Gradient Map',
  no: '10',
  category: 'color',
  params: [
    { key: 'ramp',       label: 'Gradient',       type: 'gradient', value: cloneStops(RAMPS.Duotone) },
    { key: 'steps',      label: 'Posterize',      type: 'range', min: 0, max: 12, step: 1, value: 0 },
    { key: 'mix',        label: 'Mix',            type: 'range', min: 0, max: 1, step: 0.01, value: 1 },
    { key: 'lumaInvert', label: 'Invert luma',    type: 'toggle', value: false },
    { key: 'grain',      label: 'Grain',          type: 'range', min: 0, max: 1, step: 0.01, value: 0 },
    { key: 'grainSeed',  label: 'Grain seed',     type: 'range', min: 0, max: 9999, step: 1, value: 1 },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const out = p.createGraphics(sw, sh);
    out.pixelDensity(1);
    out.loadPixels();
    const op = out.pixels;

    const stops = Array.isArray(params.ramp) && params.ramp.length >= 2 ? params.ramp : RAMPS.Duotone;
    const lut = buildRampLUT(stops, params.steps);
    const mix = params.mix, inv = params.lumaInvert;
    const useGrain = params.grain > 0;
    const rng = useGrain ? makeRng(params.grainSeed) : null;
    const gAmt = params.grain * 0.6;

    for (let i = 0; i < sp.length; i += 4) {
      const r = sp[i], gg = sp[i + 1], b = sp[i + 2];
      let t = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255; // luminance
      if (inv) t = 1 - t;
      if (useGrain) { t += (rng() - 0.5) * gAmt; t = t < 0 ? 0 : t > 1 ? 1 : t; }
      const o = ((t * 255) | 0) * 3;
      let R = lut[o], G = lut[o + 1], B = lut[o + 2];
      if (mix < 1) { R = R * mix + r * (1 - mix); G = G * mix + gg * (1 - mix); B = B * mix + b * (1 - mix); }
      op[i] = R; op[i + 1] = G; op[i + 2] = B; op[i + 3] = sp[i + 3];
    }

    out.updatePixels();
    g.image(out, 0, 0, w, h);
    out.remove();
  },
};
