// curve.js — tone-curve math shared by the curve editor (drawing) and the Tone
// effect (LUT). A curve value is data:
//   { channel:'RGB', points:{ RGB:[{x,y}...], R:[...], G:[...], B:[...] } }
// with x,y in 0..1 (y up = output). Linear interpolation between points.

export function defaultCurve() {
  const line = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  return { channel: 'RGB', points: { RGB: line(), R: line(), G: line(), B: line() } };
}

// Output y (0..1) for input x (0..1), linear interp, clamped to endpoints.
export function sampleCurveAt(points, x) {
  const p = points.length > 1 ? points.slice().sort((a, b) => a.x - b.x) : points;
  if (x <= p[0].x) return p[0].y;
  const last = p[p.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 0; i < p.length - 1; i++) {
    if (x >= p[i].x && x <= p[i + 1].x) {
      const span = p[i + 1].x - p[i].x || 1e-6;
      return p[i].y + (p[i + 1].y - p[i].y) * ((x - p[i].x) / span);
    }
  }
  return last.y;
}

// 256-entry Uint8 LUT mapping input → output for a channel's points.
export function buildLUT(points) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let y = sampleCurveAt(points, i / 255);
    y = y < 0 ? 0 : y > 1 ? 1 : y;
    lut[i] = Math.round(y * 255);
  }
  return lut;
}
