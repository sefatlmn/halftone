// gradient-editor.js — `type:'gradient'` control. A gradient bar with draggable
// stops, a preset dropdown, per-stop colour inputs. Value is data
// ([{pos,color}...]); the bar is always re-rendered from that data.
//
// Add: double-click the bar. Delete: right-click a stop, or drag it well below
// the bar (min 2 stops). Drag: move a stop horizontally.
import { RAMPS, sampleRamp, rampCss, cloneStops } from '../color/ramps.js';

const rgbHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export function buildGradientControl(param, state, onChange) {
  let stops = state[param.key];

  const row = document.createElement('div');
  row.className = 'row';
  const top = document.createElement('div');
  top.className = 'field__top';
  const label = document.createElement('span');
  label.className = 'field__label';
  label.textContent = param.label;
  top.appendChild(label);
  row.appendChild(top);

  // preset dropdown
  const preset = document.createElement('select');
  preset.className = 'grad-preset';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = 'Preset…';
  preset.appendChild(ph);
  for (const name of Object.keys(RAMPS)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    preset.appendChild(o);
  }
  preset.addEventListener('change', () => {
    if (!preset.value) return;
    stops = cloneStops(RAMPS[preset.value]);
    preset.value = '';
    commit(); render();
  });
  row.appendChild(preset);

  const bar = document.createElement('div');
  bar.className = 'grad-bar';
  row.appendChild(bar);

  const swatches = document.createElement('div');
  swatches.className = 'grad-swatches';
  row.appendChild(swatches);

  const barPos = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const commit = () => { stops.sort((a, b) => a.pos - b.pos); state[param.key] = stops; onChange(param.key, stops); };
  const updateBg = () => { bar.style.background = rampCss(stops); };

  function render() {
    stops.sort((a, b) => a.pos - b.pos);
    updateBg();
    [...bar.querySelectorAll('.grad-stop')].forEach((e) => e.remove());
    for (const s of stops) {
      const handle = document.createElement('div');
      handle.className = 'grad-stop';
      handle.style.left = s.pos * 100 + '%';
      handle.style.background = s.color;
      handle.addEventListener('pointerdown', (e) => startDrag(e, s, handle));
      handle.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (stops.length > 2) { stops.splice(stops.indexOf(s), 1); commit(); render(); }
      });
      bar.appendChild(handle);
    }
    swatches.innerHTML = '';
    for (const s of stops) {
      const ci = document.createElement('input');
      ci.type = 'color';
      ci.value = s.color;
      ci.addEventListener('input', () => { s.color = ci.value; updateBg(); commit(); });
      swatches.appendChild(ci);
    }
  }

  function startDrag(e, stop, handle) {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    let removing = false;
    const move = (ev) => {
      stop.pos = barPos(ev);
      handle.style.left = stop.pos * 100 + '%';
      const r = bar.getBoundingClientRect();
      removing = stops.length > 2 && Math.abs(ev.clientY - (r.top + r.height / 2)) > 42;
      handle.classList.toggle('removing', removing);
      updateBg();
      onChange(param.key, stops); // live
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      if (removing) stops.splice(stops.indexOf(stop), 1);
      commit();
      render();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  bar.addEventListener('dblclick', (e) => {
    const pos = barPos(e);
    stops.push({ pos, color: rgbHex(sampleRamp(stops, pos)) });
    commit();
    render();
  });

  render();
  return row;
}
