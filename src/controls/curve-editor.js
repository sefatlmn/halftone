// curve-editor.js — `type:'curve'` control. A square pad with draggable points
// (linear interpolation), plus an RGB/R/G/B channel toggle. Stores value as data
// ({channel, points}); the LUT is built at apply time in tone.js.
import { sampleCurveAt } from '../color/curve.js';

// RGB master uses the ink token; R/G/B keep true channel hues (functional — they
// must read as red/green/blue, like the demo plate's separations).
const CH_COLORS = { RGB: '#15120D', R: '#d22d2d', G: '#1a8f5a', B: '#2563c7' };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function buildCurveControl(param, state, onChange) {
  const value = state[param.key];

  const row = document.createElement('div');
  row.className = 'row';
  const top = document.createElement('div');
  top.className = 'field__top';
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = param.label;
  top.appendChild(label);
  row.appendChild(top);

  // channel toggle
  const seg = document.createElement('div');
  seg.className = 'seg seg--curve';
  const btns = {};
  for (const ch of ['RGB', 'R', 'G', 'B']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ch;
    if (ch === value.channel) b.classList.add('is-active');
    b.addEventListener('click', () => {
      value.channel = ch;
      for (const k in btns) btns[k].classList.toggle('is-active', k === ch);
      draw();
      commit();
    });
    btns[ch] = b;
    seg.appendChild(b);
  }
  row.appendChild(seg);

  // pad
  const size = 196;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.className = 'curve-pad';
  cv.width = size * dpr; cv.height = size * dpr;
  cv.style.width = size + 'px'; cv.style.height = size + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  row.appendChild(cv);

  const pts = () => value.points[value.channel];
  const commit = () => { pts().sort((a, b) => a.x - b.x); state[param.key] = value; onChange(param.key, value); };
  const fromEvent = (e) => {
    const r = cv.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)];
  };
  const nearest = (x, y, radius = 0.07) => {
    const p = pts(); let bi = -1, bd = 1e9;
    for (let i = 0; i < p.length; i++) { const dx = p[i].x - x, dy = p[i].y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    return Math.sqrt(bd) < radius ? bi : -1;
  };

  function draw() {
    const col = CH_COLORS[value.channel];
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#E5E1D6'; // --paper-2 (recessed)
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(21,18,13,0.14)'; // --ink wash
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const g = (i / 4) * size;
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, size); ctx.moveTo(0, g); ctx.lineTo(size, g); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(21,18,13,0.22)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, size); ctx.lineTo(size, 0); ctx.stroke();
    ctx.setLineDash([]);

    const p = pts();
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= size; sx += 2) {
      const y = sampleCurveAt(p, sx / size);
      const cy = (1 - y) * size;
      if (sx === 0) ctx.moveTo(sx, cy); else ctx.lineTo(sx, cy);
    }
    ctx.stroke();

    for (const pt of p) {
      const cx = pt.x * size, cy = (1 - pt.y) * size;
      ctx.fillStyle = col; ctx.strokeStyle = '#EEEBE3'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(cx - 4, cy - 4, 8, 8); ctx.fill(); ctx.stroke();
    }
  }

  let drag = -1;
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = fromEvent(e);
    // bigger grab radius for fingers (the ~8px points are hard to hit on touch)
    const i = nearest(x, y, e.pointerType === 'touch' ? 0.12 : 0.07);
    if (i >= 0) { drag = i; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const p = pts();
    const [x, y] = fromEvent(e);
    if (drag === 0) p[0].y = y;
    else if (drag === p.length - 1) p[p.length - 1].y = y;
    else {
      const lo = p[drag - 1].x + 0.002, hi = p[drag + 1].x - 0.002;
      p[drag].x = Math.max(lo, Math.min(hi, x));
      p[drag].y = y;
    }
    draw();
    commit();
  });
  cv.addEventListener('pointerup', () => { drag = -1; });
  cv.addEventListener('dblclick', (e) => {
    const [x, y] = fromEvent(e);
    pts().push({ x, y });
    draw();
    commit();
  });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const [x, y] = fromEvent(e);
    const i = nearest(x, y);
    const p = pts();
    if (i > 0 && i < p.length - 1) { p.splice(i, 1); draw(); commit(); }
  });

  draw();
  return row;
}
