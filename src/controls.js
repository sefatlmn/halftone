// controls.js — build the control panel from a param schema. The same builder
// drives effect params and the global pre-adjust block, so adding a param to an
// effect automatically gives it a UI control. Types: range, select, toggle,
// color, text, gradient, curve.
import { buildGradientControl } from './controls/gradient-editor.js';
import { buildCurveControl } from './controls/curve-editor.js';

const LABELS = {
  'floyd-steinberg': 'Floyd–Steinberg',
  'ordered': 'Ordered (Bayer)',
  'bw': '1-bit B/W',
  'cmy': 'C / M / Y',
  '3-tone': '3-tone',
  '4-tone': '4-tone',
  'luminance': 'Luminance',
  'rgb': 'RGB channels',
};

function prettify(v) {
  if (LABELS[v]) return LABELS[v];
  return String(v).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmt(v, step) {
  if (step >= 1) return String(Math.round(v));
  const dec = ((String(step).split('.')[1]) || '').length;
  return v.toFixed(Math.min(2, dec));
}

function fieldShell(labelText) {
  const row = document.createElement('div');
  row.className = 'row';
  const top = document.createElement('div');
  top.className = 'field__top';
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = labelText;
  top.appendChild(label);
  row.appendChild(top);
  return { row, top };
}

function buildRow(param, state, onChange) {
  if (param.type === 'gradient') return buildGradientControl(param, state, onChange);
  if (param.type === 'curve') return buildCurveControl(param, state, onChange);

  const cur = param.key in state ? state[param.key] : param.value;
  const set = (v) => { state[param.key] = v; onChange(param.key, v); };

  if (param.type === 'range') {
    const { row, top } = fieldShell(param.label);
    const badge = document.createElement('span');
    badge.className = 'field__val';
    badge.textContent = fmt(cur, param.step);
    top.appendChild(badge);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = param.min; input.max = param.max; input.step = param.step;
    input.value = cur;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      badge.textContent = fmt(v, param.step);
      set(v);
    });
    row.appendChild(input);
    return row;
  }

  if (param.type === 'select') {
    const { row } = fieldShell(param.label);
    const sel = document.createElement('select');
    for (const o of param.options) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = prettify(o);
      sel.appendChild(opt);
    }
    sel.value = cur;
    sel.addEventListener('change', () => set(sel.value));
    row.appendChild(sel);
    return row;
  }

  if (param.type === 'toggle') {
    const { row, top } = fieldShell(param.label);
    const lab = document.createElement('label');
    lab.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!cur;
    const track = document.createElement('span');
    track.className = 'toggle__track';
    input.addEventListener('change', () => set(input.checked));
    lab.appendChild(input); lab.appendChild(track);
    top.appendChild(lab);
    return row;
  }

  if (param.type === 'color') {
    const { row } = fieldShell(param.label);
    const wrap = document.createElement('div');
    wrap.className = 'color-field';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = cur;
    const hex = document.createElement('span');
    hex.className = 'color-field__hex';
    hex.textContent = cur;
    input.addEventListener('input', () => { hex.textContent = input.value; set(input.value); });
    wrap.appendChild(input); wrap.appendChild(hex);
    row.appendChild(wrap);
    return row;
  }

  if (param.type === 'text') {
    const { row } = fieldShell(param.label);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cur;
    input.spellcheck = false;
    input.addEventListener('input', () => set(input.value));
    row.appendChild(input);
    return row;
  }

  return document.createElement('div');
}

// Append a schema's rows into `root` (without clearing it). Params with a
// `showIf(state)` predicate that returns false are skipped — toggle a gating
// param (marked `rebuildOnChange`) and the caller rebuilds to reveal/hide them.
export function appendParams(root, schema, state, onChange) {
  for (const param of schema) {
    if (typeof param.showIf === 'function' && !param.showIf(state)) continue;
    root.appendChild(buildRow(param, state, onChange));
  }
}

// Render a whole schema into `root`, wired to `state` via `onChange(key,val)`.
export function buildPanel(root, schema, state, onChange) {
  root.innerHTML = '';
  appendParams(root, schema, state, onChange);
}

// A chunky segmented control for non-schema toggles (fit, export scale).
export function buildSegmented(options, current, onPick) {
  const seg = document.createElement('div');
  seg.className = 'seg';
  const btns = [];
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    if (o.value === current) b.classList.add('is-active');
    b.addEventListener('click', () => {
      btns.forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      onPick(o.value);
    });
    btns.push(b);
    seg.appendChild(b);
  }
  return seg;
}

// Default-value snapshot from a schema (for Reset). Object values (gradient
// stops, curve points) are deep-cloned so every state owns an independent copy.
export function defaultsOf(schema) {
  const out = {};
  for (const p of schema) {
    out[p.key] = (p.value && typeof p.value === 'object')
      ? JSON.parse(JSON.stringify(p.value))
      : p.value;
  }
  return out;
}

// Randomise a schema's values into `state` (respecting lockRandom). Returns state.
export function randomizeInto(schema, state) {
  for (const p of schema) {
    if (p.lockRandom) continue;
    if (p.type === 'range') {
      const steps = Math.round((p.max - p.min) / p.step);
      state[p.key] = p.min + Math.round(Math.random() * steps) * p.step;
    } else if (p.type === 'select') {
      state[p.key] = p.options[Math.floor(Math.random() * p.options.length)];
    } else if (p.type === 'toggle') {
      state[p.key] = Math.random() < 0.5;
    } else if (p.type === 'color') {
      const h = Math.floor(Math.random() * 360);
      state[p.key] = hslToHex(h, 70 + Math.random() * 25, 45 + Math.random() * 20);
    }
    // text params (e.g. ASCII ramp) are left as-is
  }
  return state;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
