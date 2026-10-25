// rgb-shift.js — chromatic aberration. Split R/G/B, offset each independently,
// recombine. Static and deterministic (no seed needed).
import { getScratchPixels } from '../util/scratch.js';

// Nearest-neighbour single-channel sample with edge clamp.
function chan(sp, sw, sh, fx, fy, c) {
  let x = Math.round(fx), y = Math.round(fy);
  x = x < 0 ? 0 : x >= sw ? sw - 1 : x;
  y = y < 0 ? 0 : y >= sh ? sh - 1 : y;
  return sp[((y * sw + x) << 2) + c];
}

export default {
  id: 'rgb-shift',
  name: 'RGB Shift',
  no: '08',
  params: [
    { key: 'mode',           label: 'Mode',            type: 'select', options: ['linear', 'radial'], value: 'linear', rebuildOnChange: true },
    // amount/angle only drive the linear mode — radial ignores them, so hide
    // them there rather than showing dead sliders
    { key: 'amount',         label: 'Amount',          type: 'range', min: 0, max: 40, step: 0.5, value: 6, showIf: s => !s.advanced && s.mode !== 'radial' },
    { key: 'angle',          label: 'Angle',           type: 'range', min: 0, max: 360, step: 1, value: 0, showIf: s => !s.advanced && s.mode !== 'radial' },
    { key: 'radialStrength', label: 'Radial strength', type: 'range', min: 0, max: 60, step: 0.5, value: 18, showIf: s => s.mode === 'radial' },
    { key: 'edgeBias',       label: 'Edge bias',       type: 'range', min: 0, max: 1, step: 0.01, value: 0 },
    { key: 'advanced',       label: 'Advanced (per-channel)', type: 'toggle', value: false, rebuildOnChange: true },
    { key: 'rx', label: 'Red X',   type: 'range', min: -40, max: 40, step: 0.5, value: 6,  showIf: s => s.advanced },
    { key: 'ry', label: 'Red Y',   type: 'range', min: -40, max: 40, step: 0.5, value: 0,  showIf: s => s.advanced },
    { key: 'gx', label: 'Green X', type: 'range', min: -40, max: 40, step: 0.5, value: 0,  showIf: s => s.advanced },
    { key: 'gy', label: 'Green Y', type: 'range', min: -40, max: 40, step: 0.5, value: 0,  showIf: s => s.advanced },
    { key: 'bx', label: 'Blue X',  type: 'range', min: -40, max: 40, step: 0.5, value: -6, showIf: s => s.advanced },
    { key: 'by', label: 'Blue Y',  type: 'range', min: -40, max: 40, step: 0.5, value: 0,  showIf: s => s.advanced },
  ],

  render(g, src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    const sp = src.pixels;
    const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);

    const { mode, advanced, edgeBias } = params;
    const cx = sw / 2, cy = sh / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy) || 1;
    const ar = (params.angle * Math.PI) / 180;
    const dx = Math.cos(ar) * params.amount, dy = Math.sin(ar) * params.amount;

    // Fast path: linear mode with zero edgeBias has constant integer offsets across the image.
    if (mode !== 'radial' && !(edgeBias > 0)) {
      const rOx = advanced ? params.rx : dx;
      const rOy = advanced ? params.ry : dy;
      const gOx = advanced ? params.gx : 0;
      const gOy = advanced ? params.gy : 0;
      const bOx = advanced ? params.bx : -dx;
      const bOy = advanced ? params.by : -dy;
      const maxX = sw - 1, maxY = sh - 1;

      for (let y = 0; y < sh; y++) {
        let ry = Math.round(y - rOy); if (ry < 0) ry = 0; else if (ry > maxY) ry = maxY;
        let gy = Math.round(y - gOy); if (gy < 0) gy = 0; else if (gy > maxY) gy = maxY;
        let by = Math.round(y - bOy); if (by < 0) by = 0; else if (by > maxY) by = maxY;
        const rRow = ry * sw, gRow = gy * sw, bRow = by * sw, outRow = y * sw;

        for (let x = 0; x < sw; x++) {
          let rx = Math.round(x - rOx); if (rx < 0) rx = 0; else if (rx > maxX) rx = maxX;
          let gx = Math.round(x - gOx); if (gx < 0) gx = 0; else if (gx > maxX) gx = maxX;
          let bx = Math.round(x - bOx); if (bx < 0) bx = 0; else if (bx > maxX) bx = maxX;
          const oi = (outRow + x) << 2;
          op[oi]     = sp[(rRow + rx) << 2];
          op[oi + 1] = sp[((gRow + gx) << 2) + 1];
          op[oi + 2] = sp[((bRow + bx) << 2) + 2];
          op[oi + 3] = 255;
        }
      }
      commit();
      g.image(out, 0, 0, w, h);
      return;
    }

    const radScale = params.radialStrength / maxD;
    const edgeScale = (edgeBias * 2) / maxD;

    for (let y = 0; y < sh; y++) {
      const ddy = y - cy;
      const ddy2 = ddy * ddy;
      const outRow = y * sw;
      for (let x = 0; x < sw; x++) {
        const ddx = x - cx;
        let rOx, rOy, gOx, gOy, bOx, bOy;

        if (mode === 'radial') {
          // ux * mag = (ddx / d) * (radialStrength * (d / maxD)) = ddx * (radialStrength / maxD)
          rOx = ddx * radScale; rOy = ddy * radScale;
          gOx = 0; gOy = 0;
          bOx = -rOx; bOy = -rOy;
          if (advanced) { rOx += params.rx; rOy += params.ry; gOx = params.gx; gOy = params.gy; bOx += params.bx; bOy += params.by; }
        } else if (advanced) {
          rOx = params.rx; rOy = params.ry; gOx = params.gx; gOy = params.gy; bOx = params.bx; bOy = params.by;
        } else {
          rOx = dx; rOy = dy; gOx = 0; gOy = 0; bOx = -dx; bOy = -dy;
        }

        let s = 1;
        if (edgeBias > 0) {
          s = 1 + Math.sqrt(ddx * ddx + ddy2) * edgeScale;
        }

        const oi = (outRow + x) << 2;
        op[oi]     = chan(sp, sw, sh, x - rOx * s, y - rOy * s, 0);
        op[oi + 1] = chan(sp, sw, sh, x - gOx * s, y - gOy * s, 1);
        op[oi + 2] = chan(sp, sw, sh, x - bOx * s, y - bOy * s, 2);
        op[oi + 3] = 255;
      }
    }

    commit();
    g.image(out, 0, 0, w, h); // smooth upscale is fine for chromatic fringing
  },

  // RGB channel separations — additive: each channel is rendered in its own
  // colour on black, so the three plates recombine to the full image. The
  // per-pixel shift mirrors render() (kept inline there for speed) and is
  // computed once, lazily, on the first plate draw, then shared.
  separations(src, params, ctx) {
    const { p, w, h } = ctx;
    const sw = src.width, sh = src.height;
    let planes = null;

    const build = () => {
      if (planes) return planes;
      const sp = src.pixels;
      const cx = sw / 2, cy = sh / 2;
      const maxD = Math.sqrt(cx * cx + cy * cy) || 1;
      const { mode, advanced, edgeBias } = params;
      const ar = (params.angle * Math.PI) / 180;
      const dx = Math.cos(ar) * params.amount, dy = Math.sin(ar) * params.amount;
      const R = new Uint8ClampedArray(sw * sh * 4);
      const G = new Uint8ClampedArray(sw * sh * 4);
      const B = new Uint8ClampedArray(sw * sh * 4);
      const radScale = params.radialStrength / maxD;
      const edgeScale = (edgeBias * 2) / maxD;

      for (let y = 0; y < sh; y++) {
        const ddy = y - cy;
        const ddy2 = ddy * ddy;
        for (let x = 0; x < sw; x++) {
          const ddx = x - cx;
          let rOx, rOy, gOx, gOy, bOx, bOy;
          if (mode === 'radial') {
            rOx = ddx * radScale; rOy = ddy * radScale; gOx = 0; gOy = 0; bOx = -rOx; bOy = -rOy;
            if (advanced) { rOx += params.rx; rOy += params.ry; gOx = params.gx; gOy = params.gy; bOx += params.bx; bOy += params.by; }
          } else if (advanced) {
            rOx = params.rx; rOy = params.ry; gOx = params.gx; gOy = params.gy; bOx = params.bx; bOy = params.by;
          } else {
            rOx = dx; rOy = dy; gOx = 0; gOy = 0; bOx = -dx; bOy = -dy;
          }

          let s = 1;
          if (edgeBias > 0) {
            s = 1 + Math.sqrt(ddx * ddx + ddy2) * edgeScale;
          }

          const oi = (y * sw + x) << 2;
          R[oi]     = chan(sp, sw, sh, x - rOx * s, y - rOy * s, 0); R[oi + 3] = 255;
          G[oi + 1] = chan(sp, sw, sh, x - gOx * s, y - gOy * s, 1); G[oi + 3] = 255;
          B[oi + 2] = chan(sp, sw, sh, x - bOx * s, y - bOy * s, 2); B[oi + 3] = 255;
        }
      }
      planes = [R, G, B];
      return planes;
    };

    const plate = (name, i) => ({
      name,
      draw: (g) => {
        const { g: out, pixels: op, commit } = getScratchPixels(p, ctx.slot || 'fx', sw, sh);
        op.set(build()[i]);
        commit();
        g.image(out, 0, 0, w, h);
      },
    });
    return [plate('Red', 0), plate('Green', 1), plate('Blue', 2)];
  },
};

