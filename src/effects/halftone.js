// halftone.js — classic halftone screen. Mono single-screen or 4-colour CMYK.
import { avgLuma, avgRGB } from '../input.js';
import { clamp, n, svgDoc } from './_shared.js';

const D2R = Math.PI / 180;

// Walk a grid rotated by `angleDeg` over a w×h field, calling cb for every cell
// centre that lands on (or near) the canvas. Used by render + renderSVG so the
// raster and vector outputs stay identical.
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

function rgb2cmyk(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.9999) return { c: 0, m: 0, y: 0, k: 1 };
  return {
    c: (1 - r - k) / (1 - k),
    m: (1 - g - k) / (1 - k),
    y: (1 - b - k) / (1 - k),
    k,
  };
}

function renderMono(g, src, params, ctx) {
  const { p, w, h } = ctx;
  const { cell, shape, angle, ink, invert } = params;
  const cellSize = Math.max(2, cell);
  const half = cellSize / 2;

  if (shape === 'line') { g.noFill(); g.stroke(ink); g.strokeCap(p.SQUARE); }
  else { g.noStroke(); g.fill(ink); }

  forEachCell(w, h, cellSize, angle, (wx, wy, nx, ny, hwN, hhN) => {
    let l = avgLuma(src, nx, ny, hwN, hhN);
    if (invert) l = 1 - l;
    const r = half * Math.sqrt(clamp(1 - l, 0, 1)); // sqrt → even visual weight
    if (r < 0.35) return;
    if (shape === 'circle') {
      g.circle(wx, wy, 2 * r);
    } else if (shape === 'square') {
      g.push(); g.translate(wx, wy); g.rotate(angle * D2R);
      g.rectMode(p.CENTER); g.rect(0, 0, 2 * r, 2 * r); g.pop();
    } else { // line — variable thickness
      g.push(); g.translate(wx, wy); g.rotate(angle * D2R);
      g.strokeWeight(Math.max(0.4, 2 * r));
      g.line(-half, 0, half, 0); g.pop();
    }
  });
}

// Process inks + screen angles, shared by the composite (overprinted with
// MULTIPLY) and the per-plate separations export so the two stay identical.
const CMYK_CHANNELS = [
  { id: 'c', name: 'Cyan',    ang: 15, col: [0, 174, 239], pick: c => c.c },
  { id: 'm', name: 'Magenta', ang: 75, col: [236, 0, 140], pick: c => c.m },
  { id: 'y', name: 'Yellow',  ang: 0,  col: [255, 242, 0], pick: c => c.y },
  { id: 'k', name: 'Black',   ang: 45, col: [22, 22, 22],  pick: c => c.k },
];

// Draw one CMYK channel's dot screen into g; the fill colour IS the ink. The
// caller picks the blend mode — MULTIPLY to overprint, BLEND for a lone plate.
function drawCmykChannel(g, src, params, ctx, ch) {
  const { p, w, h } = ctx;
  const cellSize = Math.max(2, params.cell);
  const half = cellSize / 2;
  g.fill(ch.col[0], ch.col[1], ch.col[2]);
  forEachCell(w, h, cellSize, ch.ang, (wx, wy, nx, ny, hwN, hhN) => {
    let [r, gg, b] = avgRGB(src, nx, ny, hwN, hhN);
    if (params.invert) { r = 255 - r; gg = 255 - gg; b = 255 - b; }
    const amt = ch.pick(rgb2cmyk(r, gg, b));
    const rad = half * Math.sqrt(clamp(amt, 0, 1));
    if (rad < 0.35) return;
    if (params.shape === 'square') {
      g.push(); g.translate(wx, wy); g.rotate(ch.ang * D2R);
      g.rectMode(p.CENTER); g.rect(0, 0, 2 * rad, 2 * rad); g.pop();
    } else {
      g.circle(wx, wy, 2 * rad); // circle/line → dots in CMYK
    }
  });
}

function renderCMYK(g, src, params, ctx) {
  const { p } = ctx;
  g.noStroke();
  g.blendMode(p.MULTIPLY);
  for (const ch of CMYK_CHANNELS) drawCmykChannel(g, src, params, ctx, ch);
  g.blendMode(p.BLEND); // ALWAYS reset after MULTIPLY
}

export default {
  id: 'halftone',
  name: 'Halftone',
  no: '01',
  params: [
    { key: 'cell',   label: 'Cell size',    type: 'range', min: 3, max: 40, step: 1, value: 8 },
    { key: 'shape',  label: 'Dot shape',    type: 'select', options: ['circle', 'square', 'line'], value: 'circle' },
    { key: 'angle',  label: 'Screen angle', type: 'range', min: 0, max: 90, step: 1, value: 45 },
    { key: 'cmyk',   label: 'CMYK split',   type: 'toggle', value: true },
    { key: 'ink',    label: 'Ink',          type: 'color', value: '#FF3B22' },
    { key: 'paper',  label: 'Paper',        type: 'color', value: '#ffffff', lockRandom: true },
    { key: 'invert', label: 'Invert',       type: 'toggle', value: false },
  ],

  render(g, src, params, ctx) {
    g.background(params.paper);
    if (params.cmyk) renderCMYK(g, src, params, ctx);
    else renderMono(g, src, params, ctx);
  },

  // Per-plate separations — CMYK only (one screened plate per ink, each in its
  // process colour on paper). Mono is a single plate, so it returns null.
  separations(src, params, ctx) {
    if (!params.cmyk) return null;
    const { p } = ctx;
    return CMYK_CHANNELS.map((ch) => ({
      name: ch.name,
      draw: (g) => {
        g.background(params.paper);
        g.noStroke();
        g.blendMode(p.BLEND);
        drawCmykChannel(g, src, params, ctx, ch);
      },
    }));
  },

  // Vector export. Mono → ink-coloured dots/lines. CMYK → one multiply-blended
  // group of process-colour dots per channel (true colour; overprints exactly
  // like the canvas in any viewer that honours mix-blend-mode).
  renderSVG(src, params, view) {
    const { w, h } = view;
    const { cell, shape, angle, ink, paper, invert } = params;
    const cellSize = Math.max(2, cell);
    const half = cellSize / 2;
    const parts = [`<rect width="${w}" height="${h}" fill="${paper}"/>`];

    if (params.cmyk) {
      for (const ch of CMYK_CHANNELS) {
        const fill = `rgb(${ch.col[0]},${ch.col[1]},${ch.col[2]})`;
        const dots = [];
        forEachCell(w, h, cellSize, ch.ang, (wx, wy, nx, ny, hwN, hhN) => {
          let [r, gg, b] = avgRGB(src, nx, ny, hwN, hhN);
          if (invert) { r = 255 - r; gg = 255 - gg; b = 255 - b; }
          const rad = half * Math.sqrt(clamp(ch.pick(rgb2cmyk(r, gg, b)), 0, 1));
          if (rad < 0.35) return;
          if (shape === 'square') {
            dots.push(`<rect x="${n(-rad)}" y="${n(-rad)}" width="${n(2 * rad)}" height="${n(2 * rad)}" transform="translate(${n(wx)} ${n(wy)}) rotate(${ch.ang})"/>`);
          } else {
            dots.push(`<circle cx="${n(wx)}" cy="${n(wy)}" r="${n(rad)}"/>`);
          }
        });
        if (dots.length) parts.push(`<g fill="${fill}" style="mix-blend-mode:multiply">${dots.join('')}</g>`);
      }
      return svgDoc(w, h, parts.join('\n'));
    }

    forEachCell(w, h, cellSize, angle, (wx, wy, nx, ny, hwN, hhN) => {
      let l = avgLuma(src, nx, ny, hwN, hhN);
      if (invert) l = 1 - l;
      const r = half * Math.sqrt(clamp(1 - l, 0, 1));
      if (r < 0.35) return;
      if (shape === 'circle') {
        parts.push(`<circle cx="${n(wx)}" cy="${n(wy)}" r="${n(r)}" fill="${ink}"/>`);
      } else if (shape === 'square') {
        parts.push(`<rect x="${n(-r)}" y="${n(-r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="${ink}" transform="translate(${n(wx)} ${n(wy)}) rotate(${angle})"/>`);
      } else {
        parts.push(`<line x1="${n(-half)}" y1="0" x2="${n(half)}" y2="0" stroke="${ink}" stroke-width="${n(Math.max(0.4, 2 * r))}" stroke-linecap="butt" transform="translate(${n(wx)} ${n(wy)}) rotate(${angle})"/>`);
      }
    });
    return svgDoc(w, h, parts.join('\n'));
  },
};
