// ascii.js — render the image as a grid of monospace glyphs picked from a ramp.
import { lumaAt, rgbAt } from '../input.js';
import { clamp, n, svgDoc } from './_shared.js';
import { getScratchPixels, packRGBA } from '../util/scratch.js';

const DEFAULT_RAMP = ' .:-=+*#%@';

function esc(ch) {
  return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
}
function rgbHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

const mod = {
  id: 'ascii',
  name: 'ASCII',
  no: '03',
  lastText: '',
  params: [
    { key: 'cell',      label: 'Cell size',  type: 'range', min: 5, max: 26, step: 1, value: 11 },
    { key: 'ramp',      label: 'Glyph ramp', type: 'text', value: DEFAULT_RAMP },
    { key: 'colorMode', label: 'Colour',     type: 'select', options: ['mono', 'source'], value: 'source', rebuildOnChange: true },
    { key: 'font',      label: 'Font',       type: 'select', options: ['Space Mono', 'Courier New', 'monospace'], value: 'Space Mono' },
    { key: 'invert',    label: 'Invert',     type: 'toggle', value: false },
    { key: 'showText',  label: 'Selectable text', type: 'toggle', value: false, lockRandom: true },
    // In 'source' mode each cell takes the image colour (glyph and background),
    // so Ink and Paper are unused there.
    { key: 'ink',       label: 'Ink',        type: 'color', value: '#15120D', showIf: s => s.colorMode === 'mono' },
    { key: 'paper',     label: 'Paper',      type: 'color', value: '#ffffff', lockRandom: true, showIf: s => s.colorMode === 'mono' },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const ramp = params.ramp && params.ramp.length ? params.ramp : DEFAULT_RAMP;
    const size = Math.max(5, params.cell);

    g.background(params.paper);
    g.textFont(params.font);
    g.textSize(size);
    g.textAlign(p.LEFT, p.TOP);
    g.noStroke();
    g.fill(params.ink);

    const cw = g.textWidth('M') || size * 0.6; // monospace advance
    const ch = size;                            // chars are taller than wide → good for ASCII
    const cols = Math.max(1, Math.floor(w / cw));
    const rows = Math.max(1, Math.floor(h / ch));
    const last = ramp.length - 1;

    // Sync p5's font properties onto the underlying 2D context once, then draw
    // via native fillText to avoid thousands of p5.Color allocations per frame.
    g.text('', 0, 0);
    const dc = g.drawingContext;
    dc.textAlign = 'left';
    dc.textBaseline = 'top';
    const isSourceColor = params.colorMode === 'source';
    const invert = params.invert;
    if (!isSourceColor) dc.fillStyle = params.ink;

    const sw = src.width, sh = src.height;
    const sp = src.pixels;

    // Source colour: every cell's background is the image colour at that cell,
    // so light areas (sparse glyphs) keep their colour instead of showing paper.
    // One pixel per cell in a tiny buffer, drawn up in a single unsmoothed
    // drawImage; the grid overshoots w×h by up to a cell and is clipped.
    if (isSourceColor) {
      const bc = Math.ceil(w / cw), br = Math.ceil(h / ch);
      const { g: mosaic, u32, commit } = getScratchPixels(p, `ascii:${ctx.slot || 'fx'}`, bc, br);
      for (let r = 0, k = 0; r < br; r++) {
        const sy = Math.min(sh - 1, (clamp((r + 0.5) * ch / h, 0, 1) * sh) | 0);
        for (let c = 0; c < bc; c++, k++) {
          const sx = Math.min(sw - 1, (clamp((c + 0.5) * cw / w, 0, 1) * sw) | 0);
          const pi = (sy * sw + sx) << 2;
          u32[k] = packRGBA(sp[pi], sp[pi + 1], sp[pi + 2], 255);
        }
      }
      commit();
      dc.imageSmoothingEnabled = false;
      dc.drawImage(mosaic.canvas, 0, 0, bc, br, 0, 0, bc * cw, br * ch);
      dc.imageSmoothingEnabled = true;
    }
    const needText = !!params.showText;
    const lines = needText ? new Array(rows) : null;
    let lastRGB = -1;

    const colSx = new Int32Array(cols);
    const colX = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      colX[c] = c * cw;
      const nx = clamp((c + 0.5) * cw / w, 0, 1);
      let sx = (nx * sw) | 0;
      if (sx < 0) sx = 0; else if (sx >= sw) sx = sw - 1;
      colSx[c] = sx << 2;
    }

    for (let r = 0; r < rows; r++) {
      const ny = clamp((r + 0.5) * ch / h, 0, 1);
      let sy = (ny * sh) | 0;
      if (sy < 0) sy = 0; else if (sy >= sh) sy = sh - 1;
      const rowOff = (sy * sw) << 2;
      const py = r * ch;
      let line = '';

      for (let c = 0; c < cols; c++) {
        const pi = rowOff + colSx[c];
        const cr = sp[pi], cg = sp[pi + 1], cb = sp[pi + 2];
        let l = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255;
        if (invert) l = 1 - l;
        const glyph = ramp[clamp(Math.round((1 - l) * last), 0, last)];
        if (needText) line += glyph;
        if (glyph !== ' ') {
          if (isSourceColor) {
            const rgbInt = (cr << 16) | (cg << 8) | cb;
            if (rgbInt !== lastRGB) {
              lastRGB = rgbInt;
              // a darker shade of the cell colour, so the glyph reads on it
              dc.fillStyle = `rgb(${cr >> 1},${cg >> 1},${cb >> 1})`;
            }
          }
          dc.fillText(glyph, colX[c], py);
        }
      }
      if (needText) lines[r] = line;
    }
    mod.lastText = needText ? lines.join('\n') + '\n' : '';
  },

  // Vector export — one <text> element per glyph (selectable, print-ready).
  renderSVG(src, params, view) {
    const { w, h } = view;
    const ramp = params.ramp && params.ramp.length ? params.ramp : DEFAULT_RAMP;
    const size = Math.max(5, params.cell);
    const cw = size * 0.6, ch = size; // approx metrics (no canvas to measure)
    const cols = Math.max(1, Math.floor(w / cw));
    const rows = Math.max(1, Math.floor(h / ch));
    const last = ramp.length - 1;
    const isSourceColor = params.colorMode === 'source';
    const parts = [`<rect width="${w}" height="${h}" fill="${params.paper}"/>`];
    // Source colour: cell backgrounds in the image colour, one rect per run of
    // equal colour along a row (mirrors render()'s mosaic).
    if (isSourceColor) {
      const bc = Math.ceil(w / cw), br = Math.ceil(h / ch);
      for (let r = 0; r < br; r++) {
        const ny = clamp((r + 0.5) * ch / h, 0, 1);
        let runStart = 0, runFill = null;
        for (let c = 0; c <= bc; c++) {
          let fill = null;
          if (c < bc) { const [cr, cg, cb] = rgbAt(src, clamp((c + 0.5) * cw / w, 0, 1), ny); fill = rgbHex(cr, cg, cb); }
          if (fill !== runFill) {
            if (runFill) parts.push(`<rect x="${n(runStart * cw)}" y="${n(r * ch)}" width="${n((c - runStart) * cw)}" height="${n(ch)}" fill="${runFill}"/>`);
            runStart = c; runFill = fill;
          }
        }
      }
    }
    parts.push(`<g font-family="'${params.font}', monospace" font-size="${size}">`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const nx = clamp((c + 0.5) * cw / w, 0, 1);
        const ny = clamp((r + 0.5) * ch / h, 0, 1);
        let l = lumaAt(src, nx, ny);
        if (params.invert) l = 1 - l;
        const glyph = ramp[clamp(Math.round((1 - l) * last), 0, last)];
        if (glyph === ' ') continue;
        let fill = params.ink;
        if (isSourceColor) { const [cr, cg, cb] = rgbAt(src, nx, ny); fill = rgbHex(cr >> 1, cg >> 1, cb >> 1); }
        parts.push(`<text x="${n(c * cw)}" y="${n(r * ch + size * 0.82)}" fill="${fill}">${esc(glyph)}</text>`);
      }
    }
    parts.push('</g>');
    return svgDoc(w, h, parts.join('\n'));
  },
};

export default mod;
