// rgb-shift.js — chromatic aberration. Split R/G/B, offset each independently,
// recombine. Static and deterministic (no seed needed).
//
// Works on the raw working buffer OR on another effect's output (acceptsBase).
import { getScratch } from '../util/scratch.js';

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
  acceptsBase: true,
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
    const out = getScratch(p, `${ctx.slot || 'fx'}:rgb-shift`, sw, sh); // pooled
    out.loadPixels();
    const op = out.pixels;

    const { mode, advanced, edgeBias } = params;
    const cx = sw / 2, cy = sh / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy) || 1;
    const ar = (params.angle * Math.PI) / 180;
    const dx = Math.cos(ar) * params.amount, dy = Math.sin(ar) * params.amount;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let rOx, rOy, gOx, gOy, bOx, bOy;

        if (mode === 'radial') {
          const ddx = x - cx, ddy = y - cy;
          const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const mag = params.radialStrength * (d / maxD);
          const ux = ddx / d, uy = ddy / d;
          rOx = ux * mag; rOy = uy * mag; gOx = 0; gOy = 0; bOx = -ux * mag; bOy = -uy * mag;
          if (advanced) { rOx += params.rx; rOy += params.ry; gOx = params.gx; gOy = params.gy; bOx += params.bx; bOy += params.by; }
        } else if (advanced) {
          rOx = params.rx; rOy = params.ry; gOx = params.gx; gOy = params.gy; bOx = params.bx; bOy = params.by;
        } else {
          rOx = dx; rOy = dy; gOx = 0; gOy = 0; bOx = -dx; bOy = -dy;
        }

        let s = 1;
        if (edgeBias > 0) {
          const ddx = x - cx, ddy = y - cy;
          s = 1 + edgeBias * 2 * (Math.sqrt(ddx * ddx + ddy * ddy) / maxD);
        }

        const oi = (y * sw + x) << 2;
        op[oi]     = chan(sp, sw, sh, x - rOx * s, y - rOy * s, 0);
        op[oi + 1] = chan(sp, sw, sh, x - gOx * s, y - gOy * s, 1);
        op[oi + 2] = chan(sp, sw, sh, x - bOx * s, y - bOy * s, 2);
        op[oi + 3] = 255;
      }
    }

    out.updatePixels();
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

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          let rOx, rOy, gOx, gOy, bOx, bOy;
          if (mode === 'radial') {
            const ddx = x - cx, ddy = y - cy;
            const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
            const mag = params.radialStrength * (d / maxD);
            const ux = ddx / d, uy = ddy / d;
            rOx = ux * mag; rOy = uy * mag; gOx = 0; gOy = 0; bOx = -ux * mag; bOy = -uy * mag;
            if (advanced) { rOx += params.rx; rOy += params.ry; gOx = params.gx; gOy = params.gy; bOx += params.bx; bOy += params.by; }
          } else if (advanced) {
            rOx = params.rx; rOy = params.ry; gOx = params.gx; gOy = params.gy; bOx = params.bx; bOy = params.by;
          } else {
            rOx = dx; rOy = dy; gOx = 0; gOy = 0; bOx = -dx; bOy = -dy;
          }

          let s = 1;
          if (edgeBias > 0) {
            const ddx = x - cx, ddy = y - cy;
            s = 1 + edgeBias * 2 * (Math.sqrt(ddx * ddx + ddy * ddy) / maxD);
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
        const out = getScratch(p, `${ctx.slot || 'fx'}:rgb-shift`, sw, sh); // pooled
        out.loadPixels();
        out.pixels.set(build()[i]);
        out.updatePixels();
        g.image(out, 0, 0, w, h);
      },
    });
    return [plate('Red', 0), plate('Green', 1), plate('Blue', 2)];
  },
};
