// ramps.js — gradient-map presets + ramp sampling / LUT.
// A ramp is data: [{ pos: 0..1, color: '#hex' }, ...]. Kept serialisable.
import { hex2rgb } from '../effects/_shared.js';

export const RAMPS = {
  Duotone:    [{ pos: 0, color: '#181410' }, { pos: 1, color: '#f4ecd8' }],
  Tritone:    [{ pos: 0, color: '#1a1340' }, { pos: 0.5, color: '#c8366f' }, { pos: 1, color: '#f7e7c2' }],
  Thermal:    [{ pos: 0, color: '#000000' }, { pos: 0.25, color: '#3b0a6b' }, { pos: 0.5, color: '#d81e2c' }, { pos: 0.7, color: '#f77f00' }, { pos: 0.88, color: '#ffd400' }, { pos: 1, color: '#ffffff' }],
  Cyanotype:  [{ pos: 0, color: '#08203f' }, { pos: 0.5, color: '#2a6f97' }, { pos: 1, color: '#eef6fb' }],
  Monochrome: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }],
  'Riso Pink/Blue': [{ pos: 0, color: '#0078bf' }, { pos: 0.5, color: '#7a4f9f' }, { pos: 1, color: '#ff48b0' }],
  Viridis:    [{ pos: 0, color: '#440154' }, { pos: 0.25, color: '#3b528b' }, { pos: 0.5, color: '#21918c' }, { pos: 0.75, color: '#5ec962' }, { pos: 1, color: '#fde725' }],
};

export function cloneStops(stops) {
  return stops.map((s) => ({ pos: s.pos, color: s.color }));
}

const sorted = (stops) => stops.slice().sort((a, b) => a.pos - b.pos);

// Colour [r,g,b] at normalised position t (0..1), linearly interpolated.
export function sampleRamp(stops, t) {
  const s = sorted(stops);
  if (t <= s[0].pos) return hex2rgb(s[0].color);
  const last = s[s.length - 1];
  if (t >= last.pos) return hex2rgb(last.color);
  for (let i = 0; i < s.length - 1; i++) {
    if (t >= s[i].pos && t <= s[i + 1].pos) {
      const span = s[i + 1].pos - s[i].pos || 1e-6;
      const f = (t - s[i].pos) / span;
      const c0 = hex2rgb(s[i].color), c1 = hex2rgb(s[i + 1].color);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return hex2rgb(last.color);
}

// 256×3 Uint8 LUT for the ramp. steps>=2 posterises luminance into that many bands.
export function buildRampLUT(stops, steps) {
  const lut = new Uint8Array(256 * 3);
  const post = steps >= 2;
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    if (post) t = Math.min(steps - 1, Math.floor(t * steps)) / (steps - 1);
    const c = sampleRamp(stops, t);
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
}

// CSS gradient string for the editor bar.
export function rampCss(stops) {
  return `linear-gradient(to right, ${sorted(stops).map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`;
}
