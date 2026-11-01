// analog.js — a MiniDV camera signal shown on a CRT. The source is resampled
// onto a virtual raster of `lines` scanlines, degraded like DV (4:1:1 chroma,
// highlight clip, edge enhancement, DCT blocks at high values), then drawn as
// brightness-dependent Gaussian beams through a phosphor mask, with beam
// defocus and glass halation. Stateless and deterministic, so animated frames and
// exports match the preview. All structure is sized relative to the frame.
import { getScratchPixels } from '../util/scratch.js';

// ---- pooled buffers ----------------------------------------------------------
const pool = {};
function buf(name, len) {
  let a = pool[name];
  if (!a || a.length < len) a = pool[name] = new Float32Array(len);
  return a;
}

// ---- transfer LUTs (sRGB-ish gamma 2.2) --------------------------------------
const LIN_N = 4096;
const TO_LIN = new Float32Array(LIN_N + 1);
const TO_SRGB = new Uint8Array(LIN_N + 1);
for (let i = 0; i <= LIN_N; i++) {
  TO_LIN[i] = Math.pow(i / LIN_N, 2.2);
  TO_SRGB[i] = Math.round(255 * Math.pow(i / LIN_N, 1 / 2.2));
}

// ---- beam profile LUT --------------------------------------------------------
// BEAM[vi * (D_N + 1) + di] = normalised Gaussian weight for a line of linear
// brightness vi/V_N at distance di/D_N (0..1 line spacing). The beam widens
// with brightness, from sMin to sMax, which Scanlines sets: dark lines thin
// into visible gaps while highlights fill in. Each sigma is normalised by the
// energy the two nearest lines capture, so a flat field keeps its brightness.
// The beam is also convolved with one output pixel (variance += px²/12), so
// lines thinner than the screen can draw soften instead of aliasing.
const V_N = 63, D_N = 64;
const BEAM = new Float32Array((V_N + 1) * (D_N + 1));
let _beamKey = '';
function buildBeam(linePx, scan) {
  const key = `${Math.round(linePx * 100)}|${scan}`;
  if (key === _beamKey) return;
  const sMin = 0.4 + (0.12 - 0.4) * scan, sMax = 0.6 + (0.3 - 0.6) * scan;
  const pxVar = 1 / (12 * linePx * linePx);   // one output pixel, in line units
  for (let vi = 0; vi <= V_N; vi++) {
    const s0 = sMin + (sMax - sMin) * (vi / V_N);
    const twoVar = 2 * (s0 * s0 + pxVar);
    const g = (d) => Math.exp(-(d * d) / twoVar);
    // mean over a line spacing of g(d) + g(1 - d), integrated numerically
    let mean = 0;
    for (let k = 0; k < 64; k++) { const d = (k + 0.5) / 64; mean += g(d) + g(1 - d); }
    mean /= 64;
    for (let di = 0; di <= D_N; di++) BEAM[vi * (D_N + 1) + di] = g(di / D_N) / mean;
  }
  _beamKey = key;
}

// ---- 8x8 DCT (luma only, at high Signal) -------------------------------------
const DCT_C = new Float32Array(64);
for (let u = 0; u < 8; u++) {
  const cu = u === 0 ? Math.SQRT1_2 : 1;
  for (let x = 0; x < 8; x++) DCT_C[u * 8 + x] = 0.5 * cu * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
}
const JPEG_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const _blk = new Float32Array(64), _tmp = new Float32Array(64);
function dctQuantise(Y, C, R, strength) {
  const q = new Float32Array(64);
  for (let i = 0; i < 64; i++) q[i] = (JPEG_Q[i] * strength) / 255;
  for (let by = 0; by + 8 <= R; by += 8) {
    for (let bx = 0; bx + 8 <= C; bx += 8) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) _blk[y * 8 + x] = Y[(by + y) * C + bx + x] - 0.5;
      // forward: rows then columns
      for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
        let s = 0; for (let x = 0; x < 8; x++) s += DCT_C[u * 8 + x] * _blk[y * 8 + x];
        _tmp[y * 8 + u] = s;
      }
      for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
        let s = 0; for (let y = 0; y < 8; y++) s += DCT_C[v * 8 + y] * _tmp[y * 8 + u];
        const qq = q[v * 8 + u];
        _blk[v * 8 + u] = Math.round(s / qq) * qq;
      }
      // inverse: columns then rows
      for (let u = 0; u < 8; u++) for (let y = 0; y < 8; y++) {
        let s = 0; for (let v = 0; v < 8; v++) s += DCT_C[v * 8 + y] * _blk[v * 8 + u];
        _tmp[y * 8 + u] = s;
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        let s = 0; for (let u = 0; u < 8; u++) s += DCT_C[u * 8 + x] * _tmp[y * 8 + u];
        Y[(by + y) * C + bx + x] = s + 0.5;
      }
    }
  }
}

// In-place symmetric exponential blur along one axis of a row-major plane
// (forward then backward one-pole filter): `n` samples per run, `runs` runs,
// `step` between samples, `stride` between runs, time constant `r` samples.
// Its falloff is the soft exponential tail of real halation, and the cost
// doesn't grow with the radius.
function expBlur(a, n, runs, step, stride, r) {
  if (r <= 0) return;
  const k = 1 - Math.exp(-1 / r), j = 1 - k;
  const last = (n - 1) * step;
  for (let run = 0; run < runs; run++) {
    const o = run * stride;
    let y = a[o];
    for (let i = o; i <= o + last; i += step) { y = k * a[i] + j * y; a[i] = y; }
    y = a[o + last];
    for (let i = o + last; i >= o; i -= step) { y = k * a[i] + j * y; a[i] = y; }
  }
}
const blurRows = (a, C, R, r) => expBlur(a, C, R, 1, C, r);
// Same filter down the columns, swept row by row so memory is read in order.
function blurCols(a, C, R, r) {
  if (r <= 0) return;
  const k = 1 - Math.exp(-1 / r), j = 1 - k;
  for (let y = 1; y < R; y++) {
    const o = y * C, q = o - C;
    for (let x = 0; x < C; x++) a[o + x] = k * a[o + x] + j * a[q + x];
  }
  for (let y = R - 2; y >= 0; y--) {
    const o = y * C, q = o + C;
    for (let x = 0; x < C; x++) a[o + x] = k * a[o + x] + j * a[q + x];
  }
}

// ---- render stages (top-level so each hot loop optimises on its own) ----------

// 1. Box-average the source onto the C×R raster, as gamma-encoded Y'CbCr.
// Each raster row is accumulated in a small row buffer and flushed once, so
// the hot loop never scatters writes across the whole raster.
function rasterize(sp, sw, sh, C, R, Y, Cb, Cr, acc, xMap, colN) {
  colN.fill(0, 0, C);
  for (let x = 0; x < sw; x++) { const c = Math.min(C - 1, ((x * C) / sw) | 0); xMap[x] = c * 3; colN[c]++; }
  let y = 0;
  for (let r = 0; r < R; r++) {
    acc.fill(0, 0, C * 3);
    const yEnd = r === R - 1 ? sh : Math.min(sh, Math.ceil(((r + 1) * sh) / R));
    const rows = Math.max(1, yEnd - y);
    for (; y < yEnd; y++) {
      let si = y * sw * 4;
      for (let x = 0; x < sw; x++, si += 4) {
        const j = xMap[x];
        acc[j] += sp[si]; acc[j + 1] += sp[si + 1]; acc[j + 2] += sp[si + 2];
      }
    }
    const o = r * C;
    for (let c = 0; c < C; c++) {
      const k = 1 / (255 * rows * (colN[c] || 1));
      const rr = acc[c * 3] * k, gg = acc[c * 3 + 1] * k, b = acc[c * 3 + 2] * k;
      const yy = 0.299 * rr + 0.587 * gg + 0.114 * b;
      Y[o + c] = yy; Cb[o + c] = b - yy; Cr[o + c] = rr - yy;
    }
  }
}

// 4:1:1 — chroma averaged over groups of `grp` raster px (DV keeps 180 chroma
// samples of 720), linearly reconstructed and mixed in by `mixSub`.
function subsampleChroma(P, C, R, grp, mixSub, tmp) {
  const nG = Math.ceil(C / grp);
  for (let y = 0; y < R; y++) {
    const o = y * C;
    for (let gI = 0; gI < nG; gI++) {
      const x0 = gI * grp, x1 = Math.min(C, x0 + grp);
      let s = 0;
      for (let x = x0; x < x1; x++) s += P[o + x];
      tmp[gI] = s / (x1 - x0);
    }
    for (let x = 0; x < C; x++) {
      const t = (x + 0.5) / grp - 0.5;
      let g0 = Math.floor(t); if (g0 < 0) g0 = 0; else if (g0 > nG - 1) g0 = nG - 1;
      const g1 = g0 + 1 < nG ? g0 + 1 : nG - 1;
      let f = t - g0; if (f < 0) f = 0; else if (f > 1) f = 1;
      const sub = tmp[g0] + (tmp[g1] - tmp[g0]) * f;
      P[o + x] += (sub - P[o + x]) * mixSub;
    }
  }
}

// Camera luma: highlights clip early, then horizontal aperture correction.
function cameraLuma(Y, C, R, sig, tmp) {
  const knee = 1 - 0.18 * sig, kGain = 1 + 2.2 * sig;
  const sharp = 0.9 * sig;
  for (let y = 0; y < R; y++) {
    const o = y * C;
    for (let x = 0; x < C; x++) {
      const v = Y[o + x];
      tmp[x] = v > knee ? Math.min(1, knee + (v - knee) * kGain) : v;
    }
    for (let x = 0; x < C; x++) {
      const l = tmp[x > 0 ? x - 1 : 0], c = tmp[x], r = tmp[x < C - 1 ? x + 1 : C - 1];
      Y[o + x] = c + sharp * (c - 0.5 * (l + r));
    }
  }
}

function toLinear(Y, Cb, Cr, N, Lr, Lg, Lb) {
  for (let i = 0; i < N; i++) {
    const yy = Y[i];
    let r = yy + Cr[i], b = yy + Cb[i];
    let gg = (yy - 0.299 * r - 0.114 * b) / 0.587;
    r = r < 0 ? 0 : r > 1 ? 1 : r; gg = gg < 0 ? 0 : gg > 1 ? 1 : gg; b = b < 0 ? 0 : b > 1 ? 1 : b;
    Lr[i] = TO_LIN[(r * LIN_N) | 0]; Lg[i] = TO_LIN[(gg * LIN_N) | 0]; Lb[i] = TO_LIN[(b * LIN_N) | 0];
  }
}

// Halation for one channel: 2×2 average down to C2×R2, exponential blur, then
// bilinear back up into `dst` at full raster size.
function halation(src, dst, C, R, C2, R2, h2, r) {
  for (let y = 0; y < R2; y++) {
    const y0 = (y << 1) * C, y1 = Math.min(R - 1, (y << 1) + 1) * C;
    for (let x = 0; x < C2; x++) {
      const x0 = x << 1, x1 = Math.min(C - 1, x0 + 1);
      h2[y * C2 + x] = 0.25 * (src[y0 + x0] + src[y0 + x1] + src[y1 + x0] + src[y1 + x1]);
    }
  }
  blurRows(h2, C2, R2, r);
  blurCols(h2, C2, R2, r);
  for (let y = 0; y < R; y++) {
    let fy = (y - 0.5) / 2; if (fy < 0) fy = 0;
    const ya = Math.min(R2 - 1, fy | 0), yb = Math.min(R2 - 1, ya + 1), ty = fy - ya;
    const ra = ya * C2, rb = yb * C2, o = y * C;
    for (let x = 0; x < C; x++) {
      let fx = (x - 0.5) / 2; if (fx < 0) fx = 0;
      const xa = Math.min(C2 - 1, fx | 0), xb = Math.min(C2 - 1, xa + 1), tx = fx - xa;
      const top = h2[ra + xa] + (h2[ra + xb] - h2[ra + xa]) * tx;
      const bot = h2[rb + xa] + (h2[rb + xb] - h2[rb + xa]) * tx;
      dst[o + x] = top + (bot - top) * ty;
    }
  }
}

const D1 = D_N + 1;
const SHOULDER = 0.85;
// 4. Display: beams of the two nearest lines, phosphor mask, halation. Rows
// and columns map to the raster independently, so both use small tables.
function display(op, sw, sh, C, R, Lr, Lg, Lb, Br, Bg, Bb, bA, scan, ms, mR, mG, mB, triad, slotA, slotB, xs, xf) {
  const useSlot = slotA !== null;
  const mixBeam = Math.min(1, scan * 4);       // 0 → exact flat resample
  let k = 0;
  for (let y = 0; y < sh; y++) {
    const ry = ((y + 0.5) / sh) * R - 0.5;
    let l0 = Math.floor(ry), d = ry - l0;
    if (l0 < 0) { l0 = 0; d = 0; } else if (l0 > R - 2) { l0 = R - 2; d = 1; }
    const dI = (d * D_N) | 0, dJ = D_N - dI;
    d = dI / D_N;
    const row0 = l0 * C, bRow = dI < 32 ? row0 : row0 + C;
    const sA = useSlot ? slotA[y] : 1, sB = useSlot ? slotB[y] : 1;
    for (let x = 0; x < sw; x++, k++) {
      const i0 = row0 + xs[x], i1 = i0 + C, fx = xf[x];

      const r0 = Lr[i0] + (Lr[i0 + 1] - Lr[i0]) * fx, r1 = Lr[i1] + (Lr[i1 + 1] - Lr[i1]) * fx;
      const g0 = Lg[i0] + (Lg[i0 + 1] - Lg[i0]) * fx, g1 = Lg[i1] + (Lg[i1 + 1] - Lg[i1]) * fx;
      const b0 = Lb[i0] + (Lb[i0 + 1] - Lb[i0]) * fx, b1 = Lb[i1] + (Lb[i1 + 1] - Lb[i1]) * fx;

      // flat (bilinear) and beam profiles
      let R_ = r0 + (r1 - r0) * d, G_ = g0 + (g1 - g0) * d, B_ = b0 + (b1 - b0) * d;
      if (mixBeam > 0) {
        const bR = r0 * BEAM[((r0 * V_N) | 0) * D1 + dI] + r1 * BEAM[((r1 * V_N) | 0) * D1 + dJ];
        const bG = g0 * BEAM[((g0 * V_N) | 0) * D1 + dI] + g1 * BEAM[((g1 * V_N) | 0) * D1 + dJ];
        const bB = b0 * BEAM[((b0 * V_N) | 0) * D1 + dI] + b1 * BEAM[((b1 * V_N) | 0) * D1 + dJ];
        R_ += (bR - R_) * mixBeam; G_ += (bG - G_) * mixBeam; B_ += (bB - B_) * mixBeam;
      }

      if (ms > 0) {
        const tw = triad[x], sr = sA * tw + sB * (1 - tw);
        R_ *= mR[x] * sr; G_ *= mG[x] * sr; B_ *= mB[x] * sr;
      }

      // halation in the glass, after the mask (it carries no structure); the
      // field is very smooth, so the nearest line with a horizontal lerp is enough
      if (bA > 0) {
        const bi = bRow + xs[x];
        R_ = R_ * (1 - bA) + (Br[bi] + (Br[bi + 1] - Br[bi]) * fx) * bA * 1.6;
        G_ = G_ * (1 - bA) + (Bg[bi] + (Bg[bi + 1] - Bg[bi]) * fx) * bA * 1.6;
        B_ = B_ * (1 - bA) + (Bb[bi] + (Bb[bi + 1] - Bb[bi]) * fx) * bA * 1.6;
      }

      // soft shoulder so mask/beam peaks roll off instead of clipping
      if (R_ > SHOULDER) R_ = SHOULDER + (R_ - SHOULDER) / (1 + (R_ - SHOULDER) / (1 - SHOULDER));
      if (G_ > SHOULDER) G_ = SHOULDER + (G_ - SHOULDER) / (1 + (G_ - SHOULDER) / (1 - SHOULDER));
      if (B_ > SHOULDER) B_ = SHOULDER + (B_ - SHOULDER) / (1 + (B_ - SHOULDER) / (1 - SHOULDER));
      const o = k << 2;
      op[o] = TO_SRGB[(R_ * LIN_N) | 0];
      op[o + 1] = TO_SRGB[(G_ * LIN_N) | 0];
      op[o + 2] = TO_SRGB[(B_ * LIN_N) | 0];
      op[o + 3] = 255;
    }
  }
}

export default {
  id: 'analog',
  name: 'Analog',
  no: '06',
  heavy: true,
  params: [
    { key: 'lines',        label: 'Lines',         type: 'range', min: 120, max: 600, step: 10, value: 300, lockRandom: true },
    { key: 'mask',         label: 'Mask',          type: 'select', options: ['grille', 'slot', 'none'], value: 'grille' },
    { key: 'maskStrength', label: 'Mask strength', type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 },
    { key: 'scanlines',    label: 'Scanlines',     type: 'range', min: 0, max: 1, step: 0.01, value: 0.75 },
    { key: 'bloom',        label: 'Bloom',         type: 'range', min: 0, max: 1, step: 0.01, value: 0.25 },
    { key: 'signal',       label: 'Signal',        type: 'range', min: 0, max: 1, step: 0.01, value: 0.3 },
    { key: 'blur',         label: 'Blur',          type: 'range', min: 0, max: 1, step: 0.01, value: 0.2 },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sig = params.signal, scan = params.scanlines, bloom = params.bloom;

    // 1. virtual raster: R scanlines, square raster pixels
    const R = Math.max(2, Math.min(sh, Math.round(params.lines)));
    const C = Math.max(2, Math.min(sw, Math.round(R * (sw / sh))));
    const N = C * R;
    const Y = buf('Y', N), Cb = buf('Cb', N), Cr = buf('Cr', N);
    rasterize(src.pixels, sw, sh, C, R, Y, Cb, Cr, buf('acc', C * 3), buf('xMap', sw), buf('colN', C));

    // 2. DV signal
    const tmp = buf('tmp', Math.max(C, R) + 2);
    if (sig > 0) {
      const grp = Math.max(2, Math.round((4 * C) / 720));
      const mixSub = Math.min(1, sig * 3.3);
      const bleed = sig * 3;
      subsampleChroma(Cb, C, R, grp, mixSub, tmp); blurRows(Cb, C, R, bleed);
      subsampleChroma(Cr, C, R, grp, mixSub, tmp); blurRows(Cr, C, R, bleed);
      cameraLuma(Y, C, R, sig, tmp);
      if (sig >= 0.6) dctQuantise(Y, C, R, 0.4 + ((sig - 0.6) / 0.4) * 2.6);
    }
    const Lr = buf('Lr', N), Lg = buf('Lg', N), Lb = buf('Lb', N);
    toLinear(Y, Cb, Cr, N, Lr, Lg, Lb);

    // beam defocus and signal bandwidth: a soft spot that smears mostly along
    // the line (the analog signal's limited bandwidth) and only a little
    // across lines, so the scanline structure survives
    if (params.blur > 0) {
      const bh = params.blur * 3.5, bv = params.blur * 0.6;
      for (const L of [Lr, Lg, Lb]) { blurRows(L, C, R, bh); blurCols(L, C, R, bv); }
    }

    // 3. halation: a soft, energy-conserving scatter of the raster light
    const bA = bloom * 0.45;
    let Br = null, Bg = null, Bb = null;
    if (bA > 0) {
      // the glow is very smooth, so it is blurred at half raster resolution
      // and scaled back up
      Br = buf('Br', N); Bg = buf('Bg', N); Bb = buf('Bb', N);
      const C2 = (C + 1) >> 1, R2 = (R + 1) >> 1, h2 = buf('half', C2 * R2);
      const rb = ((1 + bloom * 5) * (R / 240)) / 2;
      halation(Lr, Br, C, R, C2, R2, h2, rb);
      halation(Lg, Bg, C, R, C2, R2, h2, rb);
      halation(Lb, Bb, C, R, C2, R2, h2, rb);
    }

    // 4. display, at the target's device resolution (pixel density and export
    // scale included) but never above the working buffer: structure finer than
    // the screen can't be shown, so it is neither computed nor left to alias.
    const tf = g.drawingContext.getTransform ? g.drawingContext.getTransform() : null;
    const dev = Math.abs(tf ? tf.a : 1);
    const ow = Math.max(2, Math.min(sw, Math.round(w * dev)));
    const oh = Math.max(2, Math.min(sh, Math.round(h * dev)));
    const { pixels: op, g: out, commit } = getScratchPixels(p, `analog:${ctx.slot || 'fx'}`, ow, oh);
    const linePx = oh / R;                       // output px per scanline
    buildBeam(linePx, scan);

    // Phosphor mask, band-limited: each channel's stripe is a cosine at the
    // triad pitch, plus its second harmonic only once the pitch can carry it.
    // A hard-edged stripe pattern this fine would alias into moiré bands.
    const P = linePx;                            // triad pitch: one triad per line height
    const ms = params.mask === 'none' ? 0 : params.maskStrength;
    const a1 = Math.max(0, Math.min(1, (P - 2.2) / 1.3));
    const a2 = 0.5 * Math.max(0, Math.min(1, (P - 4.5) / 2));
    const mR = buf('mR', ow), mG = buf('mG', ow), mB = buf('mB', ow), triad = buf('triad', ow);
    for (let x = 0; x < ow; x++) {
      const t = ((x + 0.5) / P) * 2 * Math.PI;
      const ch = (c) => {
        const th = t - (c * 2 * Math.PI) / 3;
        return 1 + ms * (a1 * Math.cos(th) + a2 * Math.cos(2 * th));
      };
      mR[x] = ch(0); mG[x] = ch(1); mB[x] = ch(2);
      triad[x] = 0.5 + 0.5 * Math.cos(t / 2);    // smooth A/B stagger weight for the slot mask
    }
    // slot mask: dark bars every line height, staggered half a slot on
    // alternate triads; also a cosine, faded the same way
    let slotA = null, slotB = null;
    if (params.mask === 'slot' && ms > 0) {
      slotA = buf('slotA', oh); slotB = buf('slotB', oh);
      const b1 = 0.6 * Math.max(0, Math.min(1, (linePx - 2.2) / 1.3));
      for (let y = 0; y < oh; y++) {
        const t = ((y + 0.5) / linePx) * 2 * Math.PI;
        slotA[y] = 1 + ms * b1 * Math.cos(t);
        slotB[y] = 1 - ms * b1 * Math.cos(t);
      }
    }

    const xs = buf('xs', ow), xf = buf('xf', ow);
    for (let x = 0; x < ow; x++) {
      let rx = ((x + 0.5) / ow) * C - 0.5;
      rx = rx < 0 ? 0 : rx > C - 1 ? C - 1 : rx;
      xs[x] = Math.min(C - 2, rx | 0); xf[x] = rx - xs[x];
    }
    display(op, ow, oh, C, R, Lr, Lg, Lb, Br, Bg, Bb, bA, scan, ms, mR, mG, mB, triad, slotA, slotB, xs, xf);

    commit();
    g.image(out, 0, 0, w, h);
  },
};
