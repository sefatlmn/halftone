// tone.js — Curves + Levels folded into one combined 256 LUT per channel
// (applied by lookup).
import { buildLUT, defaultCurve } from '../color/curve.js';
import { getScratchPixels } from '../util/scratch.js';

export default {
  id: 'tone',
  name: 'Tone',
  no: '11',
  category: 'color',
  params: [
    { key: 'curve',        label: 'Curves',       type: 'curve', value: defaultCurve() },
    { key: 'inBlack',      label: 'Input black',  type: 'range', min: 0, max: 254, step: 1, value: 0 },
    { key: 'inWhite',      label: 'Input white',  type: 'range', min: 1, max: 255, step: 1, value: 255 },
    { key: 'gamma',        label: 'Gamma',        type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 },
    { key: 'outBlack',     label: 'Output black', type: 'range', min: 0, max: 255, step: 1, value: 0 },
    { key: 'outWhite',     label: 'Output white', type: 'range', min: 0, max: 255, step: 1, value: 255 },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);

    const cv = params.curve || defaultCurve();
    const lutRGB = buildLUT(cv.points.RGB);
    const chLut = { R: buildLUT(cv.points.R), G: buildLUT(cv.points.G), B: buildLUT(cv.points.B) };

    const inB = params.inBlack / 255, inW = params.inWhite / 255;
    const span = (inW - inB) || 1e-6;
    const gInv = 1 / Math.max(0.01, params.gamma);
    const outB = params.outBlack / 255, outW = params.outWhite / 255;

    // combined per-channel LUT: levels+gamma → RGB curve → channel curve → output levels
    const combo = (chl) => {
      const lut = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        let x = v / 255;
        x = (x - inB) / span; x = x < 0 ? 0 : x > 1 ? 1 : x;
        x = Math.pow(x, gInv);
        x = lutRGB[(x * 255) | 0] / 255;
        x = chl[(x * 255) | 0] / 255;
        x = outB + x * (outW - outB); x = x < 0 ? 0 : x > 1 ? 1 : x;
        lut[v] = Math.round(x * 255);
      }
      return lut;
    };
    const LR = combo(chLut.R), LG = combo(chLut.G), LB = combo(chLut.B);

    const len = sp.length;
    for (let i = 0; i < len; i += 4) {
      op[i]     = LR[sp[i]];
      op[i + 1] = LG[sp[i + 1]];
      op[i + 2] = LB[sp[i + 2]];
      op[i + 3] = sp[i + 3];
    }

    commit();
    g.image(out, 0, 0, w, h);
  },
};

