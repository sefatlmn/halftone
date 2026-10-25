// stamp.js — rubber-stamp / letterpress 1-bit. Hard threshold with rough,
// coherent (Perlin) edge jitter plus an ink-texture mask that breaks up solids.
import { hex2rgb } from './_shared.js';
import { getScratchPixels, packRGBA } from '../util/scratch.js';

let _jitKey = '';
let _jitBuf = null;
let _texKey = '';
let _texBuf = null;

let _gridPool = null;
function fillNoiseBilinear(p, out, cols, rows, scaleX, scaleY, z, offset, mul) {
  const gw = ((cols + 1) >> 1) + 1;
  const gh = ((rows + 1) >> 1) + 1;
  const gLen = gw * gh;
  if (!_gridPool || _gridPool.length < gLen) _gridPool = new Float32Array(gLen);
  let gi = 0;
  for (let gy = 0; gy < gh; gy++) {
    const ny = (gy << 1) * scaleY;
    if (z === undefined) {
      for (let gx = 0; gx < gw; gx++) {
        _gridPool[gi++] = (p.noise((gx << 1) * scaleX, ny) + offset) * mul;
      }
    } else {
      for (let gx = 0; gx < gw; gx++) {
        _gridPool[gi++] = (p.noise((gx << 1) * scaleX, ny, z) + offset) * mul;
      }
    }
  }
  for (let y = 0; y < rows; y++) {
    const gy = y >> 1;
    const fy = y & 1;
    const r0 = gy * gw;
    const r1 = r0 + gw;
    const rowOff = y * cols;
    if (fy === 0) {
      for (let x = 0; x < cols; x++) {
        const gx = x >> 1;
        out[rowOff + x] = (x & 1) === 0
          ? _gridPool[r0 + gx]
          : 0.5 * (_gridPool[r0 + gx] + _gridPool[r0 + gx + 1]);
      }
    } else {
      for (let x = 0; x < cols; x++) {
        const gx = x >> 1;
        out[rowOff + x] = (x & 1) === 0
          ? 0.5 * (_gridPool[r0 + gx] + _gridPool[r1 + gx])
          : 0.25 * (_gridPool[r0 + gx] + _gridPool[r0 + gx + 1] + _gridPool[r1 + gx] + _gridPool[r1 + gx + 1]);
      }
    }
  }
}

function getEdgeJitter(p, cols, rows, rough) {
  const key = `${cols}x${rows}|${rough}`;
  if (key === _jitKey && _jitBuf) return _jitBuf;
  const len = cols * rows;
  if (!_jitBuf || _jitBuf.length < len) _jitBuf = new Float32Array(len);
  if (rough === 0) {
    _jitBuf.fill(0, 0, len);
  } else {
    p.noiseSeed(42);
    const edgeScale = 0.05 + rough * 0.12;
    const scale = rough * 0.85;
    fillNoiseBilinear(p, _jitBuf, cols, rows, edgeScale, edgeScale, undefined, -0.5, scale);
  }
  _jitKey = key;
  return _jitBuf;
}

function getTexNoise(p, cols, rows) {
  const key = `${cols}x${rows}`;
  if (key === _texKey && _texBuf) return _texBuf;
  const len = cols * rows;
  if (!_texBuf || _texBuf.length < len) _texBuf = new Float32Array(len);
  p.noiseSeed(42);
  const texScale = 0.22;
  fillNoiseBilinear(p, _texBuf, cols, rows, texScale, texScale, 50, 0, 1);
  _texKey = key;
  return _texBuf;
}

export default {
  id: 'stamp',
  name: 'Print Stamp',
  no: '06',
  heavy: true,
  params: [
    { key: 'grain',           label: 'Grain size',     type: 'range', min: 0.5, max: 6, step: 0.5, value: 1 },
    { key: 'threshold',       label: 'Threshold',      type: 'range', min: 0.05, max: 0.95, step: 0.01, value: 0.52 },
    { key: 'roughness',       label: 'Edge roughness', type: 'range', min: 0, max: 1, step: 0.01, value: 0.45 },
    { key: 'textureStrength', label: 'Ink texture',    type: 'range', min: 0, max: 1, step: 0.01, value: 0.3 },
    { key: 'ink',             label: 'Ink',            type: 'color', value: '#15120D' },
    { key: 'paper',           label: 'Paper',          type: 'color', value: '#ffffff', lockRandom: true },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const ink = hex2rgb(params.ink);
    const paper = hex2rgb(params.paper);
    const ink32 = packRGBA(ink[0], ink[1], ink[2], 255);
    const paper32 = packRGBA(paper[0], paper[1], paper[2], 255);
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const grain = Math.max(0.5, params.grain ?? 1);
    const cols = Math.max(1, Math.min(sw, Math.round(w / grain)));
    const rows = Math.max(1, Math.min(sh, Math.round(h / grain)));

    const { g: tmp, u32, commit } = getScratchPixels(p, `stamp:${ctx.slot || 'fx'}`, cols, rows);

    const th = params.threshold;
    const rough = params.roughness;
    const tex = params.textureStrength;
    const texCut = tex * 0.55;
    const jitArr = getEdgeJitter(p, cols, rows, rough);
    const texArr = tex > 0 ? getTexNoise(p, cols, rows) : null;

    let di = 0;
    for (let y = 0; y < rows; y++) {
      const sy = Math.min(sh - 1, ((y + 0.5) * sh / rows) | 0);
      const rowOff = sy * sw;
      for (let x = 0; x < cols; x++) {
        const sx = Math.min(sw - 1, ((x + 0.5) * sw / cols) | 0);
        const si = (rowOff + sx) << 2;
        const l = (0.299 * sp[si] + 0.587 * sp[si + 1] + 0.114 * sp[si + 2]) / 255;
        let on = l < th + jitArr[di];
        if (on && texArr && texArr[di] < texCut) on = false;
        u32[di++] = on ? ink32 : paper32;
      }
    }
    commit();

    g.background(params.paper);
    const gctx = g.drawingContext;
    gctx.imageSmoothingEnabled = false;
    gctx.drawImage(tmp.canvas, 0, 0, cols, rows, 0, 0, w, h);
    gctx.imageSmoothingEnabled = true;
  },
};

