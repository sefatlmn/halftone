// riso.js — risograph spot-colour separation. Splits the source into 2–3
// layers (by luminance band or RGB channel), screens each in a spot colour,
// offsets them (misregistration), composites with MULTIPLY, then lays grain.
import { avgLuma, avgRGB, lumaAt, rgbAt } from '../input.js';
import { hex2rgb, rng, clamp, n, svgDoc } from './_shared.js';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;

function forEachCell(w, h, cell, angleDeg, cb) {
  const a = angleDeg * D2R;
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = w / 2, cy = h / 2;
  const diag = Math.sqrt(w * w + h * h);
  const halfDiag = diag / 2;
  const start = -Math.ceil(halfDiag / cell) * cell;
  const invW = 1 / w, invH = 1 / h;
  const hwN = (cell / 2) * invW, hhN = (cell / 2) * invH;
  const minX = -cell, maxX = w + cell, minY = -cell, maxY = h + cell;
  for (let gy = start; gy <= halfDiag; gy += cell) {
    const baseX = cx - gy * sin;
    const baseY = cy + gy * cos;
    for (let gx = start; gx <= halfDiag; gx += cell) {
      const wx = baseX + gx * cos;
      const wy = baseY + gx * sin;
      if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;
      cb(wx, wy, wx * invW, wy * invH, hwN, hhN);
    }
  }
}

const _rgb = [0, 0, 0];
function layerAmount(src, split, layers, li, nx, ny, hwN, hhN, fastSample) {
  if (split === 'rgb') {
    const rgb = fastSample ? rgbAt(src, nx, ny, _rgb) : avgRGB(src, nx, ny, hwN, hhN, _rgb);
    return 1 - rgb[li] / 255; // low channel value → more spot ink
  }
  // luminance: triangular tonal separation across the layers
  const d = 1 - (fastSample ? lumaAt(src, nx, ny) : avgLuma(src, nx, ny, hwN, hhN));
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
  const cell = Math.max(1, params.cell);
  const half = cell / 2;
  const minR = Math.min(0.35, cell * 0.12);
  const fastSample = cell <= 2.5;
  g.fill(col[0], col[1], col[2]);
  const dc = g.drawingContext;
  dc.beginPath();
  let batch = 0;
  forEachCell(w, h, cell, RISO_ANGLES[li], (wx, wy, nx, ny, hwN, hhN) => {
    const amt = layerAmount(src, params.split, layers, li, nx, ny, hwN, hhN, fastSample);
    if (amt <= 0.01) return;
    let r;
    if (params.screen === 'grain') {
      if (rand() > amt) return;          // stochastic coverage
      r = half * (0.45 + 0.55 * rand());
    } else {
      r = half * Math.sqrt(clamp(amt, 0, 1));
    }
    if (r < minR) return;
    const cx = wx + ox, cy = wy + oy;
    dc.moveTo(cx + r, cy);
    dc.arc(cx, cy, r, 0, TAU);
    if (++batch >= 4096) {
      dc.fill();
      dc.beginPath();
      batch = 0;
    }
  });
  if (batch > 0) dc.fill();
}

const GRAIN_BUCKETS = 8;
const _grainDark = Array.from({ length: GRAIN_BUCKETS }, () => []);
const _grainLight = Array.from({ length: GRAIN_BUCKETS }, () => []);

function addGrain(g, ctx, amount) {
  const { w, h } = ctx;
  const rand = rng(2024);
  const count = Math.floor(w * h * 0.015 * amount);
  if (count <= 0) return;
  for (let b = 0; b < GRAIN_BUCKETS; b++) {
    _grainDark[b].length = 0;
    _grainLight[b].length = 0;
  }
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h;
    const dark = rand() < 0.5;
    const aNorm = rand();
    const s = 0.4 + rand() * 1.0;
    const bi = Math.min(GRAIN_BUCKETS - 1, (aNorm * GRAIN_BUCKETS) | 0);
    const list = dark ? _grainDark[bi] : _grainLight[bi];
    list.push(x, y, s);
  }
  const dc = g.drawingContext;
  for (let b = 0; b < GRAIN_BUCKETS; b++) {
    const alpha = (((30 + ((b + 0.5) / GRAIN_BUCKETS) * 70) * amount) / 255).toFixed(3);
    const dList = _grainDark[b];
    if (dList.length) {
      dc.fillStyle = `rgba(0,0,0,${alpha})`;
      dc.beginPath();
      for (let j = 0; j < dList.length; j += 3) {
        dc.rect(dList[j], dList[j + 1], dList[j + 2], dList[j + 2]);
      }
      dc.fill();
    }
    const lList = _grainLight[b];
    if (lList.length) {
      dc.fillStyle = `rgba(255,255,255,${alpha})`;
      dc.beginPath();
      for (let j = 0; j < lList.length; j += 3) {
        dc.rect(lList[j], lList[j + 1], lList[j + 2], lList[j + 2]);
      }
      dc.fill();
    }
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
    { key: 'cell',   label: 'Screen cell',      type: 'range', min: 1, max: 18, step: 0.5, value: 6 },
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
    const cell = Math.max(1, params.cell);
    const half = cell / 2;
    const minR = Math.min(0.35, cell * 0.12);
    const fastSample = cell <= 2.5;
    const parts = [`<rect width="${w}" height="${h}" fill="${params.paper}"/>`];
    for (let li = 0; li < layers; li++) {
      const rand = rng(99 + li * 1000); // per-layer seed, matching render()/separations()
      const col = cols[li];
      const fill = `rgb(${col[0]},${col[1]},${col[2]})`;
      const ox = RISO_OFFSETS[li][0] * params.misreg;
      const oy = RISO_OFFSETS[li][1] * params.misreg;
      const dots = [];
      forEachCell(w, h, cell, RISO_ANGLES[li], (wx, wy, nx, ny, hwN, hhN) => {
        const amt = layerAmount(src, params.split, layers, li, nx, ny, hwN, hhN, fastSample);
        if (amt <= 0.01) return;
        let r;
        if (params.screen === 'grain') {
          if (rand() > amt) return;
          r = half * (0.45 + 0.55 * rand());
        } else {
          r = half * Math.sqrt(clamp(amt, 0, 1));
        }
        if (r < minR) return;
        dots.push(`<circle cx="${n(wx + ox)}" cy="${n(wy + oy)}" r="${n(r)}"/>`);
      });
      if (dots.length) parts.push(`<g fill="${fill}" style="mix-blend-mode:multiply">${dots.join('')}</g>`);
    }
    return svgDoc(w, h, parts.join('\n'));
  },
};
