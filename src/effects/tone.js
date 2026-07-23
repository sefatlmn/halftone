// tone.js — Curves + Levels + Brightness/Contrast folded into one combined
// 256 LUT per channel (applied by lookup), plus an optional 3×3 colour matrix.
import { buildLUT, defaultCurve } from '../color/curve.js';
import { getScratch } from '../util/scratch.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function satMatrix(s) {
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  return [
    lr * (1 - s) + s, lg * (1 - s), lb * (1 - s),
    lr * (1 - s), lg * (1 - s) + s, lb * (1 - s),
    lr * (1 - s), lg * (1 - s), lb * (1 - s) + s,
  ];
}
const MATRICES = {
  identity: IDENTITY,
  sepia: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
  'swap-rb': [0, 0, 1, 0, 1, 0, 1, 0, 0],
  saturate: satMatrix(1.6),
  desaturate: satMatrix(0.4),
  grayscale: satMatrix(0),
};
const blendMatrix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

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
    { key: 'brightness',   label: 'Brightness',   type: 'range', min: -100, max: 100, step: 1, value: 0 },
    { key: 'contrast',     label: 'Contrast',     type: 'range', min: -100, max: 100, step: 1, value: 0 },
    { key: 'advanced',     label: 'Colour matrix', type: 'toggle', value: false, rebuildOnChange: true },
    { key: 'matrixPreset', label: 'Matrix',       type: 'select', options: ['identity', 'sepia', 'swap-rb', 'saturate', 'desaturate', 'grayscale'], value: 'identity', showIf: s => s.advanced, rebuildOnChange: true },
    // The identity preset leaves the matrix null, so its amount slider is inert.
    { key: 'matrixAmount', label: 'Matrix amount', type: 'range', min: 0, max: 1, step: 0.01, value: 1, showIf: s => s.advanced && s.matrixPreset !== 'identity' },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const out = getScratch(p, ctx.slot || 'fx', sw, sh); // pooled per slot
    out.loadPixels();
    const op = out.pixels;

    const cv = params.curve || defaultCurve();
    const lutRGB = buildLUT(cv.points.RGB);
    const chLut = { R: buildLUT(cv.points.R), G: buildLUT(cv.points.G), B: buildLUT(cv.points.B) };

    const inB = params.inBlack / 255, inW = params.inWhite / 255;
    const span = (inW - inB) || 1e-6;
    const gInv = 1 / Math.max(0.01, params.gamma);
    const outB = params.outBlack / 255, outW = params.outWhite / 255;
    const cc = (params.contrast / 100) * 255;
    const cFactor = (259 * (cc + 255)) / (255 * (259 - cc));
    const bright = params.brightness / 100;

    // combined per-channel LUT: levels+gamma → bright/contrast → RGB curve → channel curve → output levels
    const combo = (chl) => {
      const lut = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        let x = v / 255;
        x = (x - inB) / span; x = x < 0 ? 0 : x > 1 ? 1 : x;
        x = Math.pow(x, gInv);
        x = (x - 0.5) * cFactor + 0.5 + bright; x = x < 0 ? 0 : x > 1 ? 1 : x;
        x = lutRGB[(x * 255) | 0] / 255;
        x = chl[(x * 255) | 0] / 255;
        x = outB + x * (outW - outB); x = x < 0 ? 0 : x > 1 ? 1 : x;
        lut[v] = Math.round(x * 255);
      }
      return lut;
    };
    const LR = combo(chLut.R), LG = combo(chLut.G), LB = combo(chLut.B);

    let M = null;
    if (params.advanced && params.matrixPreset !== 'identity') {
      M = blendMatrix(IDENTITY, MATRICES[params.matrixPreset], params.matrixAmount);
    }

    for (let i = 0; i < sp.length; i += 4) {
      let r = LR[sp[i]], gg = LG[sp[i + 1]], b = LB[sp[i + 2]];
      if (M) {
        const nr = M[0] * r + M[1] * gg + M[2] * b;
        const ng = M[3] * r + M[4] * gg + M[5] * b;
        const nb = M[6] * r + M[7] * gg + M[8] * b;
        r = nr < 0 ? 0 : nr > 255 ? 255 : nr;
        gg = ng < 0 ? 0 : ng > 255 ? 255 : ng;
        b = nb < 0 ? 0 : nb > 255 ? 255 : nb;
      }
      op[i] = r; op[i + 1] = gg; op[i + 2] = b; op[i + 3] = sp[i + 3];
    }

    out.updatePixels();
    g.image(out, 0, 0, w, h);
  },
};
