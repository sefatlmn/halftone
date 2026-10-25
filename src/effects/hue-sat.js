// hue-sat.js — HSL hue shift / saturation / lightness. RGB→HSL→RGB per pixel.
import { getScratchPixels } from '../util/scratch.js';

function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export default {
  id: 'hue-sat',
  name: 'Hue / Sat',
  no: '12',
  category: 'color',
  params: [
    { key: 'hueShift',   label: 'Hue shift',  type: 'range', min: -180, max: 180, step: 1, value: 0 },
    { key: 'saturation', label: 'Saturation', type: 'range', min: -100, max: 100, step: 1, value: 0 },
    { key: 'lightness',  label: 'Lightness',  type: 'range', min: -100, max: 100, step: 1, value: 0 },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);

    const hue = params.hueShift;
    const sMul = 1 + params.saturation / 100;
    const lAdd = params.lightness / 200;

    if (hue === 0 && params.saturation === 0 && params.lightness === 0) {
      op.set(sp);
      commit();
      g.image(out, 0, 0, w, h);
      return;
    }

    const inv255 = 1 / 255;
    const inv360 = 1 / 360;
    for (let i = 0, len = sp.length; i < len; i += 4) {
      const r = sp[i] * inv255;
      const gg = sp[i + 1] * inv255;
      const b = sp[i + 2] * inv255;

      const mx = r > gg ? (r > b ? r : b) : (gg > b ? gg : b);
      const mn = r < gg ? (r < b ? r : b) : (gg < b ? gg : b);
      let L = (mx + mn) * 0.5;
      const d = mx - mn;

      let H = 0, S = 0;
      if (d > 1e-9) {
        S = L > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) H = ((gg - b) / d) % 6;
        else if (mx === gg) H = (b - r) / d + 2;
        else H = (r - gg) / d + 4;
        H *= 60;
        if (H < 0) H += 360;
      }

      H = (H + hue) % 360;
      if (H < 0) H += 360;
      S *= sMul;
      if (S < 0) S = 0; else if (S > 1) S = 1;
      L += lAdd;
      if (L < 0) L = 0; else if (L > 1) L = 1;

      if (S === 0) {
        const v = (L * 255 + 0.5) | 0;
        op[i] = v; op[i + 1] = v; op[i + 2] = v;
      } else {
        const hn = H * inv360;
        const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
        const p0 = 2 * L - q;
        op[i]     = (hue2rgb(p0, q, hn + 1 / 3) * 255 + 0.5) | 0;
        op[i + 1] = (hue2rgb(p0, q, hn) * 255 + 0.5) | 0;
        op[i + 2] = (hue2rgb(p0, q, hn - 1 / 3) * 255 + 0.5) | 0;
      }
      op[i + 3] = sp[i + 3];
    }

    commit();
    g.image(out, 0, 0, w, h);
  },
};

