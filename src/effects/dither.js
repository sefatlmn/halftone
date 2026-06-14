// dither.js — ordered (Bayer) and Floyd–Steinberg error-diffusion dithering.
// Quantises to a palette derived from ink/paper. Computed at a low grid
// resolution then upscaled with smoothing OFF for crisp chunky pixels.
import { lumaAt } from '../input.js';
import { hex2rgb, mix, clamp } from './_shared.js';

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

export default {
  id: 'dither',
  name: 'Dither',
  no: '02',
  heavy: true,
  params: [
    { key: 'mode',       label: 'Algorithm',   type: 'select', options: ['ordered', 'floyd-steinberg'], value: 'floyd-steinberg' },
    { key: 'matrixSize', label: 'Bayer matrix', type: 'select', options: ['2', '4', '8'], value: '4' },
    { key: 'palette',    label: 'Palette',     type: 'select', options: ['bw', 'duotone', '3-tone', '4-tone', 'cmy'], value: 'cmy' },
    { key: 'pixelScale', label: 'Pixel size',  type: 'range', min: 1, max: 14, step: 1, value: 3 },
    { key: 'serpentine', label: 'Serpentine',  type: 'toggle', value: true },
    { key: 'modulation', label: 'Modulation',  type: 'range', min: 0, max: 1, step: 0.01, value: 0 },
    { key: 'ink',        label: 'Ink',         type: 'color', value: '#15120D' },
    { key: 'paper',      label: 'Paper',       type: 'color', value: '#ffffff', lockRandom: true },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const { mode, matrixSize, palette, pixelScale, serpentine, modulation } = params;
    const pal = paletteFor(palette, hex2rgb(params.ink), hex2rgb(params.paper));
    const L = pal.length;

    const ps = Math.max(1, pixelScale);
    let cols = Math.max(1, Math.round(w / ps));
    let rows = Math.max(1, Math.round(h / ps));
    const MAXC = 1000; // keep error diffusion bounded
    if (cols > MAXC) { rows = Math.max(1, Math.round(rows * MAXC / cols)); cols = MAXC; }
    if (rows > MAXC) { cols = Math.max(1, Math.round(cols * MAXC / rows)); rows = MAXC; }

    // sample luminance grid
    const lum = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        lum[y * cols + x] = lumaAt(src, (x + 0.5) / cols, (y + 0.5) / rows);
      }
    }
    // modulation: warp the tone with a coherent noise field
    if (modulation > 0) {
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

    // paint indices into a small buffer, then upscale crisply
    const tmp = p.createGraphics(cols, rows);
    tmp.pixelDensity(1);
    tmp.loadPixels();
    const px = tmp.pixels;
    for (let i = 0; i < idx.length; i++) {
      const c = pal[idx[i]];
      const j = i << 2;
      px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255;
    }
    tmp.updatePixels();

    g.background(params.paper);
    g.drawingContext.imageSmoothingEnabled = false;
    g.image(tmp, 0, 0, w, h);
    g.drawingContext.imageSmoothingEnabled = true;
    tmp.remove(); // free the offscreen buffer (avoid leaking canvases)
  },
};
