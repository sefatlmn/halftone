// riso.js — risograph spot-colour separation. Splits the source into 2–3
// layers (by luminance band or RGB channel), screens each in a spot colour,
// offsets them (misregistration), composites with MULTIPLY, then lays grain.
import { avgLuma, avgRGB } from '../input.js';
import { hex2rgb, rng, clamp, n, svgDoc } from './_shared.js';

const D2R = Math.PI / 180;

function forEachCell(w, h, cell, angleDeg, cb) {
  const a = angleDeg * D2R;
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = w / 2, cy = h / 2;
  const diag = Math.sqrt(w * w + h * h);
  const start = -Math.ceil(diag / 2 / cell) * cell;
  const hwN = cell / 2 / w, hhN = cell / 2 / h;
  for (let gy = start; gy <= diag / 2; gy += cell) {
    for (let gx = start; gx <= diag / 2; gx += cell) {
      const wx = cx + gx * cos - gy * sin;
      const wy = cy + gx * sin + gy * cos;
      if (wx < -cell || wx > w + cell || wy < -cell || wy > h + cell) continue;
      cb(wx, wy, wx / w, wy / h, hwN, hhN);
    }
  }
}

function layerAmount(src, split, layers, li, nx, ny, hwN, hhN) {
  if (split === 'rgb') {
    const rgb = avgRGB(src, nx, ny, hwN, hhN);
    return 1 - rgb[li] / 255; // low channel value → more spot ink
  }
  // luminance: triangular tonal separation across the layers
  const d = 1 - avgLuma(src, nx, ny, hwN, hhN);
  const center = (li + 0.5) / layers;
  return clamp(1 - Math.abs(d - center) * layers, 0, 1);
}

const RISO_ANGLES = [15, 75, 45];
const RISO_OFFSETS = [[-1, -0.4], [1, 0.6], [0.25, -1]];

// Draw layer `li`'s screened dots into g in its spot colour. `rand` drives the
// stochastic 'grain' screen; ox/oy apply misregistration (0 for a clean plate).
function drawRisoLayer(g, src, params, ctx, li, col, rand, ox, oy) {
  const { w, h } = ctx;
  const layers = parseInt(params.layers, 10);
  const cell = Math.max(3, params.cell);
  const half = cell / 2;
  g.fill(col[0], col[1], col[2]);
  forEachCell(w, h, cell, RISO_ANGLES[li], (wx, wy, nx, ny, hwN, hhN) => {
    const amt = layerAmount(src, params.split, layers, li, nx, ny, hwN, hhN);
    if (amt <= 0.01) return;
    let r;
    if (params.screen === 'grain') {
      if (rand() > amt) return;          // stochastic coverage
      r = half * (0.45 + 0.55 * rand());
    } else {
      r = half * Math.sqrt(clamp(amt, 0, 1));
    }
    if (r < 0.35) return;
    g.circle(wx + ox, wy + oy, 2 * r);
  });
}

function addGrain(g, ctx, amount) {
  const { p, w, h } = ctx;
  const rand = rng(2024);
  const count = Math.floor(w * h * 0.015 * amount);
  g.noStroke();
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h;
    const dark = rand() < 0.5;
    g.fill(dark ? 0 : 255, (30 + rand() * 70) * amount);
    const s = 0.8 + rand() * 1.4;
    g.rect(x, y, s, s);
  }
}

export default {
  id: 'riso',
  name: 'Risograph',
  no: '04',
  heavy: true,
  params: [
    { key: 'layers', label: 'Layers',          type: 'select', options: ['2', '3'], value: '3', rebuildOnChange: true },
    { key: 'split',  label: 'Separation',       type: 'select', options: ['luminance', 'rgb'], value: 'luminance' },
    { key: 'screen', label: 'Screen',           type: 'select', options: ['dots', 'grain'], value: 'dots' },
    { key: 'cell',   label: 'Screen cell',      type: 'range', min: 3, max: 18, step: 1, value: 6 },
    { key: 'misreg', label: 'Misregistration',  type: 'range', min: 0, max: 14, step: 1, value: 4 },
    { key: 'grain',  label: 'Paper grain',      type: 'range', min: 0, max: 1, step: 0.01, value: 0.25 },
    { key: 'color1', label: 'Layer 1',          type: 'color', value: '#ff48b0' },
    { key: 'color2', label: 'Layer 2',          type: 'color', value: '#0078bf' },
    { key: 'color3', label: 'Layer 3',          type: 'color', value: '#ffe800', showIf: s => s.layers === '3' },
    { key: 'paper',  label: 'Paper',            type: 'color', value: '#ffffff', lockRandom: true },
  ],

  render(g, src, params, ctx) {
    const { p } = ctx;
    const layers = parseInt(params.layers, 10);
    const cols = [hex2rgb(params.color1), hex2rgb(params.color2), hex2rgb(params.color3)];

    g.background(params.paper);
    g.noStroke();
    g.blendMode(p.MULTIPLY);
    for (let li = 0; li < layers; li++) {
      const ox = RISO_OFFSETS[li][0] * params.misreg;
      const oy = RISO_OFFSETS[li][1] * params.misreg;
      // per-layer seed, matching separations() — the exported plates must
      // reproduce this exact grain screen
      drawRisoLayer(g, src, params, ctx, li, cols[li], rng(99 + li * 1000), ox, oy);
    }
    g.blendMode(p.BLEND); // ALWAYS reset after MULTIPLY

    if (params.grain > 0) addGrain(g, ctx, params.grain);
  },

  // Spot-colour separations — one registered plate per layer (no misregistration,
  // no paper grain), each its spot ink on paper: the natural riso print workflow.
  separations(src, params, ctx) {
    const { p } = ctx;
    const layers = parseInt(params.layers, 10);
    const cols = [hex2rgb(params.color1), hex2rgb(params.color2), hex2rgb(params.color3)];
    const plates = [];
    for (let li = 0; li < layers; li++) {
      plates.push({
        name: `Layer ${li + 1}`,
        draw: (g) => {
          g.background(params.paper);
          g.noStroke();
          g.blendMode(p.BLEND);
          drawRisoLayer(g, src, params, ctx, li, cols[li], rng(99 + li * 1000), 0, 0);
        },
      });
    }
    return plates;
  },

  // Vector export — one multiply-blended group of spot-colour dots per layer,
  // in colour, with misregistration preserved (paper grain is raster-only, so
  // it's dropped). Mirrors render(); overprints like the canvas in viewers that
  // honour mix-blend-mode.
  renderSVG(src, params, view) {
    const { w, h } = view;
    const layers = parseInt(params.layers, 10);
    const cols = [hex2rgb(params.color1), hex2rgb(params.color2), hex2rgb(params.color3)];
    const cell = Math.max(3, params.cell);
    const half = cell / 2;
    const parts = [`<rect width="${w}" height="${h}" fill="${params.paper}"/>`];
    for (let li = 0; li < layers; li++) {
      const rand = rng(99 + li * 1000); // per-layer seed, matching render()/separations()
      const col = cols[li];
      const fill = `rgb(${col[0]},${col[1]},${col[2]})`;
      const ox = RISO_OFFSETS[li][0] * params.misreg;
      const oy = RISO_OFFSETS[li][1] * params.misreg;
      const dots = [];
      forEachCell(w, h, cell, RISO_ANGLES[li], (wx, wy, nx, ny, hwN, hhN) => {
        const amt = layerAmount(src, params.split, layers, li, nx, ny, hwN, hhN);
        if (amt <= 0.01) return;
        let r;
        if (params.screen === 'grain') {
          if (rand() > amt) return;
          r = half * (0.45 + 0.55 * rand());
        } else {
          r = half * Math.sqrt(clamp(amt, 0, 1));
        }
        if (r < 0.35) return;
        dots.push(`<circle cx="${n(wx + ox)}" cy="${n(wy + oy)}" r="${n(r)}"/>`);
      });
      if (dots.length) parts.push(`<g fill="${fill}" style="mix-blend-mode:multiply">${dots.join('')}</g>`);
    }
    return svgDoc(w, h, parts.join('\n'));
  },
};
