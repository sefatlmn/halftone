// ascii.js — render the image as a grid of monospace glyphs picked from a ramp.
import { lumaAt, rgbAt } from '../input.js';
import { clamp, n, svgDoc } from './_shared.js';

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
    { key: 'colorMode', label: 'Colour',     type: 'select', options: ['mono', 'source'], value: 'mono' },
    { key: 'font',      label: 'Font',       type: 'select', options: ['Space Mono', 'Courier New', 'monospace'], value: 'Space Mono' },
    { key: 'invert',    label: 'Invert',     type: 'toggle', value: false },
    { key: 'showText',  label: 'Selectable text', type: 'toggle', value: false, lockRandom: true },
    { key: 'ink',       label: 'Ink',        type: 'color', value: '#15120D' },
    { key: 'paper',     label: 'Paper',      type: 'color', value: '#ffffff', lockRandom: true },
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

    const cw = g.textWidth('M') || size * 0.6; // monospace advance
    const ch = size;                            // chars are taller than wide → good for ASCII
    const cols = Math.max(1, Math.floor(w / cw));
    const rows = Math.max(1, Math.floor(h / ch));
    const last = ramp.length - 1;

    if (params.colorMode === 'mono') g.fill(params.ink);
    let text = '';
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) {
        const nx = clamp((c + 0.5) * cw / w, 0, 1);
        const ny = clamp((r + 0.5) * ch / h, 0, 1);
        let l = lumaAt(src, nx, ny);
        if (params.invert) l = 1 - l;
        const glyph = ramp[clamp(Math.round((1 - l) * last), 0, last)];
        line += glyph;
        if (glyph !== ' ') {
          if (params.colorMode === 'source') {
            const [cr, cg, cb] = rgbAt(src, nx, ny);
            g.fill(cr, cg, cb);
          }
          g.text(glyph, c * cw, r * ch);
        }
      }
      text += line + '\n';
    }
    mod.lastText = text;
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
    const parts = [
      `<rect width="${w}" height="${h}" fill="${params.paper}"/>`,
      `<g font-family="'${params.font}', monospace" font-size="${size}">`,
    ];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const nx = clamp((c + 0.5) * cw / w, 0, 1);
        const ny = clamp((r + 0.5) * ch / h, 0, 1);
        let l = lumaAt(src, nx, ny);
        if (params.invert) l = 1 - l;
        const glyph = ramp[clamp(Math.round((1 - l) * last), 0, last)];
        if (glyph === ' ') continue;
        let fill = params.ink;
        if (params.colorMode === 'source') { const [cr, cg, cb] = rgbAt(src, nx, ny); fill = rgbHex(cr, cg, cb); }
        parts.push(`<text x="${n(c * cw)}" y="${n(r * ch + size * 0.82)}" fill="${fill}">${esc(glyph)}</text>`);
      }
    }
    parts.push('</g>');
    return svgDoc(w, h, parts.join('\n'));
  },
};

export default mod;
