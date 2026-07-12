// hue-sat.js — HSL hue shift / saturation / lightness. RGB→HSL→RGB per pixel.
import { getScratch } from '../util/scratch.js';

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  const d = mx - mn;
  if (d > 1e-9) { // achromatic stays h=0, s=0 (avoids NaN hue)
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h, s, l) {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
    const out = getScratch(p, ctx.slot || 'fx', sw, sh); // pooled per slot
    out.loadPixels();
    const op = out.pixels;

    const hue = params.hueShift;
    const sMul = 1 + params.saturation / 100;
    const lAdd = params.lightness / 200;

    for (let i = 0; i < sp.length; i += 4) {
      const hsl = rgb2hsl(sp[i], sp[i + 1], sp[i + 2]);
      let H = hsl[0] + hue; H %= 360; if (H < 0) H += 360;
      const S = clamp01(hsl[1] * sMul);
      const L = clamp01(hsl[2] + lAdd);
      const rgb = hsl2rgb(H, S, L);
      op[i] = rgb[0]; op[i + 1] = rgb[1]; op[i + 2] = rgb[2]; op[i + 3] = sp[i + 3];
    }

    out.updatePixels();
    g.image(out, 0, 0, w, h);
  },
};
