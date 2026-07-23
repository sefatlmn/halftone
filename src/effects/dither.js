// dither.js — ordered (Bayer) and Floyd–Steinberg error-diffusion dithering.
// Quantises to a palette derived from ink/paper. Computed at a low grid
// resolution then upscaled with smoothing OFF for crisp chunky pixels.
import { lumaAt } from '../input.js';
import { hex2rgb, mix, clamp, n, svgDoc } from './_shared.js';
import { getScratch } from '../util/scratch.js';

const GRID_CAP = 1000; // max dither grid edge — bounds error diffusion AND the pooled buffer

const BAYER = {
  2: [[0, 2], [3, 1]],
  4: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
  8: [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
  ],
};

const lumaOf = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function paletteFor(name, ink, paper) {
  let pal;
  switch (name) {
    case 'bw':      pal = [[0, 0, 0], [255, 255, 255]]; break;
    case 'duotone': pal = [ink, paper]; break;
    case '3-tone':  pal = [ink, mix(ink, paper, 0.5), paper]; break;
    case '4-tone':  pal = [ink, mix(ink, paper, 0.34), mix(ink, paper, 0.67), paper]; break;
    case 'cmy':     pal = [[22, 22, 22], [0, 174, 239], [236, 0, 140], [255, 242, 0], [250, 250, 245]]; break;
    default:        pal = [[0, 0, 0], [255, 255, 255]];
  }
  return pal.slice().sort((a, b) => lumaOf(a) - lumaOf(b)); // dark → light
}

function addErr(buf, x, y, cols, rows, e) {
  if (x < 0 || x >= cols || y < 0 || y >= rows) return;
  buf[y * cols + x] += e;
}

function floydSteinberg(lum, idx, cols, rows, L, serpentine) {
  const buf = Float32Array.from(lum);
  for (let y = 0; y < rows; y++) {
    const ltr = !serpentine || y % 2 === 0;
    const dir = ltr ? 1 : -1;
    const xs = ltr ? 0 : cols - 1;
    const xe = ltr ? cols : -1;
    for (let x = xs; x !== xe; x += dir) {
      const i = y * cols + x;
      const old = clamp(buf[i], 0, 1);
      const qi = Math.round(old * (L - 1));
      idx[i] = qi;
      const err = old - qi / (L - 1);
      addErr(buf, x + dir, y, cols, rows, err * 7 / 16);
      addErr(buf, x - dir, y + 1, cols, rows, err * 3 / 16);
      addErr(buf, x, y + 1, cols, rows, err * 5 / 16);
      addErr(buf, x + dir, y + 1, cols, rows, err * 1 / 16);
    }
  }
}

// Shared quantiser: sample a luminance grid at pixel-scale resolution, apply
// optional noise modulation, then map each cell to a palette index (ordered
// Bayer or Floyd–Steinberg). Used by both the raster render and the SVG export
// so they produce the same image. `p` is only needed for noise modulation.
function computeDither(src, params, w, h, p) {
  const { mode, matrixSize, palette, pixelScale, serpentine, modulation } = params;
  const pal = paletteFor(palette, hex2rgb(params.ink), hex2rgb(params.paper));
  const L = pal.length;

  const ps = Math.max(1, pixelScale);
  let cols = Math.max(1, Math.round(w / ps));
  let rows = Math.max(1, Math.round(h / ps));
  if (cols > GRID_CAP) { rows = Math.max(1, Math.round(rows * GRID_CAP / cols)); cols = GRID_CAP; }
  if (rows > GRID_CAP) { cols = Math.max(1, Math.round(cols * GRID_CAP / rows)); rows = GRID_CAP; }

  // sample luminance grid
  const lum = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      lum[y * cols + x] = lumaAt(src, (x + 0.5) / cols, (y + 0.5) / rows);
    }
  }
  // modulation: warp the tone with a coherent noise field (needs p5's noise)
  if (modulation > 0 && p) {
    p.noiseSeed(7);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        lum[y * cols + x] += (p.noise(x * 0.05, y * 0.05) - 0.5) * modulation * 0.55;
      }
    }
  }

  // quantise to palette indices
  const idx = new Uint8Array(cols * rows);
  if (mode === 'floyd-steinberg') {
    floydSteinberg(lum, idx, cols, rows, L, serpentine);
  } else {
    const m = BAYER[matrixSize] || BAYER[4];
    const N = m.length, NN = N * N;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const t = (m[y % N][x % N] + 0.5) / NN;
        const v = clamp(lum[y * cols + x] + (t - 0.5) / L, 0, 1);
        idx[y * cols + x] = Math.round(v * (L - 1));
      }
    }
  }
  return { cols, rows, idx, pal };
}

const rgbCss = (c) => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export default {
  id: 'dither',
  name: 'Dither',
  no: '02',
  heavy: true,
  params: [
    { key: 'mode',       label: 'Algorithm',   type: 'select', options: ['ordered', 'floyd-steinberg'], value: 'floyd-steinberg', rebuildOnChange: true },
    // Bayer matrix only drives the ordered path; serpentine only the Floyd–
    // Steinberg path — hide whichever the current algorithm ignores.
    { key: 'matrixSize', label: 'Bayer matrix', type: 'select', options: ['2', '4', '8'], value: '4', showIf: s => s.mode === 'ordered' },
    { key: 'palette',    label: 'Palette',     type: 'select', options: ['bw', 'duotone', '3-tone', '4-tone', 'cmy'], value: 'cmy', rebuildOnChange: true },
    { key: 'pixelScale', label: 'Pixel size',  type: 'range', min: 1, max: 14, step: 1, value: 3 },
    { key: 'serpentine', label: 'Serpentine',  type: 'toggle', value: true, showIf: s => s.mode === 'floyd-steinberg' },
    { key: 'modulation', label: 'Modulation',  type: 'range', min: 0, max: 1, step: 0.01, value: 0 },
    // bw and cmy use hardcoded palettes, so ink/paper do nothing there.
    { key: 'ink',        label: 'Ink',         type: 'color', value: '#15120D', showIf: s => ['duotone', '3-tone', '4-tone'].includes(s.palette) },
    { key: 'paper',      label: 'Paper',       type: 'color', value: '#ffffff', lockRandom: true, showIf: s => ['duotone', '3-tone', '4-tone'].includes(s.palette) },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const { cols, rows, idx, pal } = computeDither(src, params, w, h, p);

    // Paint indices into a pooled buffer, then upscale crisply. The buffer is
    // fixed at GRID_CAP² because the grid size follows the pixel-size slider —
    // a size-keyed pool entry would reallocate a canvas on every drag tick.
    // Namespaced key (not the bare slot): this buffer's size differs from the
    // slot's shared source-sized buffer, so sharing the key would resize the
    // pooled canvas back and forth whenever dither alternates with another
    // effect. Only the cols×rows corner is written and blitted.
    const tmp = getScratch(p, `dither:${ctx.slot || 'fx'}`, GRID_CAP, GRID_CAP);
    const tctx = tmp.drawingContext;
    const id = tctx.createImageData(cols, rows);
    const px = id.data;
    for (let i = 0; i < idx.length; i++) {
      const c = pal[idx[i]];
      const j = i << 2;
      px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255;
    }
    tctx.putImageData(id, 0, 0);

    g.background(params.paper);
    const gctx = g.drawingContext;
    gctx.imageSmoothingEnabled = false;
    gctx.drawImage(tmp.canvas, 0, 0, cols, rows, 0, 0, w, h); // respects g's transform (export scale)
    gctx.imageSmoothingEnabled = true;
  },

  // Vector export — the chunky pixels become <rect>s, in colour. Equal-colour
  // cells in a row are merged into one rect and all rects of a palette colour
  // share a <g fill>, which keeps the file far smaller than one rect per cell.
  renderSVG(src, params, view) {
    const { w, h } = view;
    const { cols, rows, idx, pal } = computeDither(src, params, w, h, view.p);
    const cw = w / cols, ch = h / rows;
    const buckets = pal.map(() => []);
    for (let y = 0; y < rows; y++) {
      let x = 0;
      while (x < cols) {
        const id = idx[y * cols + x];
        let x2 = x + 1;
        while (x2 < cols && idx[y * cols + x2] === id) x2++;
        buckets[id].push(
          `<rect x="${n(x * cw)}" y="${n(y * ch)}" width="${n((x2 - x) * cw)}" height="${n(ch)}"/>`,
        );
        x = x2;
      }
    }
    const parts = [`<rect width="${w}" height="${h}" fill="${params.paper}"/>`];
    for (let i = 0; i < pal.length; i++) {
      if (buckets[i].length) parts.push(`<g fill="${rgbCss(pal[i])}" shape-rendering="crispEdges">${buckets[i].join('')}</g>`);
    }
    return svgDoc(w, h, parts.join('\n'));
  },
};
