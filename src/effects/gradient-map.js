// gradient-map.js — luminance → multi-stop ramp. Covers duotone / tritone /
// thermal / cyanotype / monochrome / threshold+posterize, all from one ramp.
import { getScratchPixels } from '../util/scratch.js';
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
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);

    const stops = Array.isArray(params.ramp) && params.ramp.length >= 2 ? params.ramp : RAMPS.Duotone;
    const lut = buildRampLUT(stops, params.steps);
    const mix = params.mix;
    const len = sp.length;

    if (mix === 1) {
      for (let i = 0; i < len; i += 4) {
        const t = (0.2126 * sp[i] + 0.7152 * sp[i + 1] + 0.0722 * sp[i + 2]) / 255;
        const o = ((t * 255) | 0) * 3;
        op[i]     = lut[o];
        op[i + 1] = lut[o + 1];
        op[i + 2] = lut[o + 2];
        op[i + 3] = sp[i + 3];
      }
    } else {
      const invMix = 1 - mix;
      for (let i = 0; i < len; i += 4) {
        const r = sp[i], gg = sp[i + 1], b = sp[i + 2];
        const t = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
        const o = ((t * 255) | 0) * 3;
        let R = lut[o], G = lut[o + 1], B = lut[o + 2];
        if (mix < 1) { R = R * mix + r * invMix; G = G * mix + gg * invMix; B = B * mix + b * invMix; }
        op[i] = R; op[i + 1] = G; op[i + 2] = B; op[i + 3] = sp[i + 3];
      }
    }

    commit();
    g.image(out, 0, 0, w, h);
  },
};

