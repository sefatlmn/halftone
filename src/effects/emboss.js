// emboss.js — relief / embossed-metal look. Takes the luminance gradient along
// a light direction and maps it around mid-grey, so edges facing the light rise
// and edges facing away sink. Static and deterministic.
import { getScratch } from '../util/scratch.js';
import { hex2rgb, clamp } from './_shared.js';

let cachedL = null;
function getLuminanceBuffer(len) {
  if (!cachedL || cachedL.length < len) cachedL = new Float32Array(len);
  return cachedL;
}

export default {
  id: 'emboss',
  name: 'Emboss',
  no: '10',
  params: [
    { key: 'angle',    label: 'Light angle', type: 'range', min: 0, max: 360, step: 1, value: 135 },
    { key: 'depth',    label: 'Depth',       type: 'range', min: 0.5, max: 12, step: 0.1, value: 3 },
    { key: 'distance', label: 'Distance',    type: 'range', min: 1, max: 6, step: 1, value: 1 },
    { key: 'blend',    label: 'Original mix', type: 'range', min: 0, max: 1, step: 0.01, value: 0 },
    { key: 'mode',     label: 'Mode', type: 'select', options: ['grey', 'colour', 'tint'], value: 'grey', rebuildOnChange: true },
    { key: 'tint',     label: 'Tint', type: 'color', value: '#c9a46a', showIf: s => s.mode === 'tint' },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const out = getScratch(p, ctx.slot || 'fx', sw, sh);
    out.loadPixels();
    const op = out.pixels;

    // luminance plane once (reusing pooled buffer to prevent GC churn)
    const totalPixels = sw * sh;
    const L = getLuminanceBuffer(totalPixels);
    for (let i = 0, j = 0; i < totalPixels; i++, j += 4) {
      L[i] = 0.299 * sp[j] + 0.587 * sp[j + 1] + 0.114 * sp[j + 2];
    }

    const a = (params.angle * Math.PI) / 180;
    const d = params.distance;
    const ox = Math.round(Math.cos(a) * d), oy = Math.round(-Math.sin(a) * d);
    const depth = params.depth, blend = params.blend, mode = params.mode;
    const [tr, tg, tb] = hex2rgb(params.tint || '#c9a46a');

    for (let y = 0; y < sh; y++) {
      const y1 = Math.min(sh - 1, Math.max(0, y - oy));
      const y2 = Math.min(sh - 1, Math.max(0, y + oy));
      for (let x = 0; x < sw; x++) {
        const x1 = Math.min(sw - 1, Math.max(0, x - ox));
        const x2 = Math.min(sw - 1, Math.max(0, x + ox));
        const diff = (L[y2 * sw + x2] - L[y1 * sw + x1]) * depth * 0.5;
        const v = clamp(128 + diff, 0, 255);
        const i = (y * sw + x) << 2;
        let r, gg, b;
        if (mode === 'colour') {
          r = clamp(sp[i] + diff, 0, 255);
          gg = clamp(sp[i + 1] + diff, 0, 255);
          b = clamp(sp[i + 2] + diff, 0, 255);
        } else if (mode === 'tint') {
          const t = v / 255;
          r = clamp(tr * t * 1.6, 0, 255);
          gg = clamp(tg * t * 1.6, 0, 255);
          b = clamp(tb * t * 1.6, 0, 255);
        } else {
          r = gg = b = v;
        }
        if (blend > 0) {
          r += (sp[i] - r) * blend; gg += (sp[i + 1] - gg) * blend; b += (sp[i + 2] - b) * blend;
        }
        op[i] = r; op[i + 1] = gg; op[i + 2] = b; op[i + 3] = 255;
      }
    }

    out.updatePixels();
    g.image(out, 0, 0, w, h);
  },
};
