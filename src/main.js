// main.js — p5 instance, app state, and all the wiring between the input stage,
// the auto-generated controls, the effect pipeline, and export.

import EFFECTS from "./effects/index.js";
import { createEffectStack } from "./effects/stack.js";
import {
  buildPanel,
  appendParams,
  defaultsOf,
  randomizeInto,
} from "./controls.js";
import { exportPNG, exportSeparations, exportSVG } from "./export.js";

const $ = (sel) => document.querySelector(sel);

/* ----------------------------------------------------------------
   App state
   ---------------------------------------------------------------- */
const App = {
  p: null,
  srcImage: null,
  stack: null, // the reusable EffectStack (whole pipeline, self-caching)
  pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
  activeId: EFFECTS[0].id,
  states: {}, // per-effect param values
  canvasW: 0,
  canvasH: 0,
  baseLayer: "none", // composition: id of a base effect, or 'none'
  preStage: "none", // color pre-stage: id of a color module, or 'none'
  preStageParams: {}, // pre-stage params, kept separate from active-effect params
  effect2Id: "none", // the second slot's effect; 'none' = no second pass (slot B off)
  states2: {}, // per-effect param values for the second slot (independent)
  filmTarget: "A", // which slot the preset filmstrip currently edits: 'A' | 'B'
  _pending: false,
  _debounce: null,
  _resize: null,
};

const PRE_SCHEMA = [
  {
    key: "brightness",
    label: "Brightness",
    type: "range",
    min: -100,
    max: 100,
    step: 1,
    value: 0,
  },
  {
    key: "contrast",
    label: "Contrast",
    type: "range",
    min: -100,
    max: 100,
    step: 1,
    value: 0,
  },
  {
    key: "gamma",
    label: "Gamma",
    type: "range",
    min: 0.2,
    max: 3,
    step: 0.05,
    value: 1,
  },
  { key: "invert", label: "Invert source", type: "toggle", value: false },
];

for (const e of EFFECTS) App.states[e.id] = defaultsOf(e.params);
// the stacked second effect keeps its own independent param set per effect
for (const e of EFFECTS) App.states2[e.id] = defaultsOf(e.params);
// color modules keep a second, independent set of params for the pre-stage
for (const e of EFFECTS)
  if (e.category === "color") App.preStageParams[e.id] = defaultsOf(e.params);

const activeEffect = () => EFFECTS.find((e) => e.id === App.activeId);
const activeState = () => App.states[App.activeId];
const effect2 = () => EFFECTS.find((e) => e.id === App.effect2Id);
const effect2State = () => App.states2[App.effect2Id];
// Slot B is "on" whenever its effect isn't the null/None pass-through.
const isEffect2On = () => App.effect2Id !== "none";
// The param state the canvas finally shows — slot 2 when stacked, else slot 1.
const finalState = () => (isEffect2On() ? effect2State() : activeState());
// The effect id the filmstrip presets currently apply to (slot A or B).
const targetEffectId = () =>
  App.filmTarget === "B" ? App.effect2Id : App.activeId;

/* ----------------------------------------------------------------
   p5 instance (INSTANCE mode — coexists with the DOM panel)
   ---------------------------------------------------------------- */
new p5((p) => {
  p.setup = () => {
    App.p = p;
    App.stack = createEffectStack(p);
    const { w, h } = computeCanvasSize();
    App.canvasW = w;
    App.canvasH = h;
    const c = p.createCanvas(w, h);
    c.parent("canvas-holder");
    p.pixelDensity(1);
    p.noLoop();
    p.background(255);
  };

  p.draw = () => renderActive();

  p.windowResized = () => {
    clearTimeout(App._resize);
    App._resize = setTimeout(() => {
      const { w, h } = computeCanvasSize();
      App.canvasW = w;
      App.canvasH = h;
      p.resizeCanvas(w, h, true);
      if (App.srcImage) recompute();
      else p.background(255);
    }, 120);
  };
});

/* ----------------------------------------------------------------
   Sizing / pipeline
   ---------------------------------------------------------------- */
// Sizing limits. The proof always shows the *whole* image (contain — never
// cropped), so the canvas itself takes the image's aspect ratio and is fitted
// inside the stage frame. AR_MIN/AR_MAX clamp the proof's shape so a freakishly
// tall/wide image can't collapse the canvas or overflow the layout (such images
// just letterbox onto paper inside the clamped proof); EDGE_CAP caps resolution.
const AR_MIN = 0.45; // tallest proof allowed (~9:20)
const AR_MAX = 2.2; // widest proof allowed (~11:5)
const EDGE_CAP = 1600; // absolute long-edge cap (performance)

function computeCanvasSize() {
  const frame = $("#canvas-holder").parentElement; // .stage-frame
  const rect = frame.getBoundingClientRect();
  const pad = 44;
  const availW = Math.max(120, rect.width - pad);
  const availH = Math.max(120, rect.height - pad);

  // No image yet → fill the available area (the empty-state overlay covers it).
  if (!App.srcImage || !App.srcImage.height) {
    return {
      w: Math.round(Math.min(availW, EDGE_CAP)),
      h: Math.round(Math.min(availH, EDGE_CAP)),
    };
  }

  // Proof = image aspect ratio (clamped), fitted inside the frame.
  const ar = Math.min(
    AR_MAX,
    Math.max(AR_MIN, App.srcImage.width / App.srcImage.height),
  );
  let w = availW,
    h = w / ar;
  if (h > availH) {
    h = availH;
    w = h * ar;
  }

  const long = Math.max(w, h);
  if (long > EDGE_CAP) {
    const k = EDGE_CAP / long;
    w *= k;
    h *= k;
  }

  return { w: Math.round(w), h: Math.round(h) };
}

// The EffectStack rebuilds its working buffer automatically when the image,
// pre-adjust, or canvas size changes (it keys each stage by a signature), so a
// "recompute" is just a request to redraw. Kept as a named function because
// pre-adjust / fit / resize callbacks read clearer calling it.
function recompute() {
  if (!App.p || !App.srcImage) return;
  requestRender();
}

function requestRender() {
  const eff = activeEffect();
  if (eff && eff.heavy) {
    clearTimeout(App._debounce);
    App._debounce = setTimeout(scheduleFrame, 70); // debounce heavy passes
  } else {
    scheduleFrame();
  }
}

// Single mode's params bundle for the shared EffectStack: the global pre-adjust,
// colour pre-stage, active effect, and (for glitch-family effects) the base layer.
function singleBundle() {
  const eff = activeEffect();
  const usesBase = eff.acceptsBase && App.baseLayer !== "none";
  return {
    pre: App.pre,
    preStage: App.preStage,
    preStageParams: App.preStageParams[App.preStage] || {},
    effect: App.activeId,
    effectParams: activeState(),
    baseLayer: eff.acceptsBase ? App.baseLayer : "none",
    baseParams: usesBase ? App.states[App.baseLayer] : {},
    effect2: App.effect2Id, // 'none' → the stack skips the second pass
    effect2Params: effect2State(),
  };
}

// The buffer the active effect samples from (staged + optional base layer), at
// sampling resolution — used by export, which re-renders the effect at scale.
function getSourceForActive() {
  if (!App.srcImage) return null;
  return App.stack.sourceFor(
    App.srcImage,
    singleBundle(),
    App.canvasW,
    App.canvasH,
  );
}

function scheduleFrame() {
  if (!App.p || App._pending) return;
  App._pending = true;
  requestAnimationFrame(() => {
    App._pending = false;
    App.p.redraw();
  });
}

function renderActive() {
  const p = App.p;
  if (!App.srcImage) return;
  p.push();
  const eff = App.stack.renderInto(
    p,
    App.srcImage,
    singleBundle(),
    App.canvasW,
    App.canvasH,
  );
  p.pop();
  updateAsciiOverlay(eff, finalState());
}

/* ----------------------------------------------------------------
   Source loading
   ---------------------------------------------------------------- */
function loadFromFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    App.p.loadImage(
      reader.result,
      (img) => setSource(img),
      () => note("Could not read that image file."),
    );
  };
  reader.readAsDataURL(file);
}

function setSource(img) {
  App.srcImage = img;
  $("#empty").setAttribute("hidden", "");
  $("#canvas-holder").removeAttribute("hidden");
  const { w, h } = computeCanvasSize();
  App.canvasW = w;
  App.canvasH = h;
  App.p.resizeCanvas(w, h, true);
  recompute();
  updateMeta();
}

// A generated demo "plate" so the tool works without an upload — smooth tones
// for halftone/dither plus shapes and a wordmark for ASCII/stamp texture.
function useDemo() {
  const p = App.p;
  const W = 1000,
    H = 1250;
  const g = p.createGraphics(W, H);
  g.pixelDensity(1);
  for (let y = 0; y < H; y++) {
    g.stroke(40 + (y / H) * 175);
    g.line(0, y, W, y);
  }
  g.noStroke();
  const cx = W * 0.5,
    cy = H * 0.4,
    R = 360;
  for (let r = R; r > 0; r -= 1.5) {
    g.fill(255 * Math.pow(1 - r / R, 0.6));
    g.circle(cx, cy, r * 2);
  }
  // colour accents so CMYK / RGB-split modes have something to separate
  g.fill(198, 32, 58);
  g.circle(W * 0.78, H * 0.72, 200); // crimson
  g.fill(18, 142, 132);
  g.circle(W * 0.24, H * 0.78, 160); // teal
  g.fill(242, 172, 28);
  g.circle(W * 0.21, H * 0.24, 130); // amber
  g.fill(15);
  g.textAlign(p.CENTER, p.CENTER);
  g.textFont("Archivo");
  g.textStyle(p.BOLD);
  g.textSize(140);
  g.text("HALFTONE", W * 0.5, H * 0.88);
  const img = g.get();
  g.remove();
  setSource(img);
}

/* ----------------------------------------------------------------
   UI building
   ---------------------------------------------------------------- */
function labeledRow(text, control) {
  const row = document.createElement("div");
  row.className = "row";
  const top = document.createElement("div");
  top.className = "field__top";
  const l = document.createElement("span");
  l.className = "field__label";
  l.textContent = text;
  top.appendChild(l);
  row.appendChild(top);
  row.appendChild(control);
  return row;
}

// The bottom filmstrip IS the effect selector — one "film" per effect, each
// with a small printer's motif thumbnail and a numbered caption. Clicking a film
// applies that effect to the currently targeted slot (A or B); the highlight
// follows the target and recolours (red → blue) to match it.
function buildEffectChips() {
  const root = $("#films");
  root.innerHTML = "";
  root.classList.toggle("is-b", App.filmTarget === "B");
  const sel = targetEffectId();
  EFFECTS.forEach((e, i) => {
    const film = document.createElement("button");
    film.type = "button";
    film.className = "film" + (e.id === sel ? " on" : "");
    film.setAttribute("role", "tab");
    film.setAttribute("aria-selected", String(e.id === sel));
    film.innerHTML =
      `<span class="thumb">${effectMotif(e.id, i)}</span>` +
      `<span class="cap"><b>${e.no}</b><span>${e.name}</span></span>`;
    film.addEventListener("click", () => applyPreset(e.id));
    root.appendChild(film);
  });
}

// Apply a filmstrip preset to whichever slot is targeted. For slot B, picking
// None clears the second pass; picking anything else stacks it on A's output.
function applyPreset(id) {
  if (App.filmTarget === "B") {
    App.effect2Id = id;
    buildEffect2Panel();
    buildFilmTargetToggle();
    buildEffectChips();
    updateSwapBtn();
    updateMeta();
    requestRender();
  } else {
    setEffect(id);
  }
}

// The A / B toggle in the strip head — chooses which slot presets edit. Picking
// B with no second effect yet adds one. Each active slot lights in its colour.
function buildFilmTargetToggle() {
  const root = $("#film-target");
  if (!root) return;
  root.innerHTML = "";
  ["A", "B"].forEach((slot) => {
    const b = document.createElement("button");
    b.type = "button";
    const active = slot === App.filmTarget;
    b.className = "abtog__btn" + (active ? " is-active" : "");
    // Dim B when it holds no effect — unless it's the slot you're aiming at.
    if (slot === "B" && !isEffect2On() && !active) b.classList.add("is-empty");
    b.dataset.slot = slot;
    b.textContent = slot;
    b.title =
      slot === "A"
        ? "Target effect A"
        : isEffect2On()
          ? "Target effect B"
          : "Target slot B — pick an effect to stack";
    b.addEventListener("click", () => setFilmTarget(slot));
    root.appendChild(b);
  });
}

// Switch which slot the filmstrip edits. Slot B starts empty (None); choosing
// it just aims the strip there so the next pick stacks onto A's output.
function setFilmTarget(slot) {
  App.filmTarget = slot;
  buildFilmTargetToggle();
  buildEffectChips();
}

// A tiny, on-brand SVG motif per effect for its filmstrip thumbnail. Static
// (not a live render) — fast, and faithful to the design mockup. `idx` keeps
// any internal pattern/gradient ids unique across films.
function effectMotif(id, idx) {
  // Motif palette mirrors the CSS tokens (SVG strings can't read CSS vars):
  // P paper · K ink · A signal red · S press mustard — the five-colour system.
  const P = "#EEEBE3",
    A = "#FF3B22",
    K = "#15120D",
    S = "#D4920A";
  const u = (s) => `${s}${idx}`;
  const wrap = (inner) =>
    `<svg viewBox="0 0 118 88" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="118" height="88" fill="${P}"/>${inner}</svg>`;
  switch (id) {
    case "none":
      return wrap(
        `<rect x="24" y="20" width="70" height="48" fill="none" stroke="${K}" stroke-width="2"/>` +
          `<line x1="24" y1="68" x2="94" y2="20" stroke="${K}" stroke-width="2"/>`,
      );
    case "halftone":
      return wrap(
        `<defs><pattern id="${u("hp")}" width="10" height="10" patternUnits="userSpaceOnUse">` +
          `<circle cx="5" cy="5" r="3.6" fill="${A}"/></pattern></defs>` +
          `<rect width="118" height="88" fill="url(#${u("hp")})" opacity=".92"/>`,
      );
    case "dither":
      return wrap(
        `<g fill="${K}">` +
          [
            [6, 8],
            [16, 8],
            [11, 16],
            [26, 12],
            [36, 20],
            [46, 10],
            [56, 26],
            [20, 34],
            [70, 14],
            [84, 30],
            [96, 18],
            [40, 48],
            [64, 54],
            [100, 60],
            [30, 64],
            [80, 70],
            [52, 74],
          ]
            .map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="4"/>`)
            .join("") +
          `</g>`,
      );
    case "ascii":
      return wrap(
        `<g font-family="monospace" font-size="13" fill="${K}">` +
          `<text x="8" y="22">@%#*+=-:.</text><text x="8" y="40">#*+=-:. @%</text>` +
          `<text x="8" y="58">+=-:.@%#*</text><text x="8" y="76">%#*+= :.@</text></g>`,
      );
    case "riso":
      return wrap(
        `<circle cx="45" cy="44" r="30" fill="${A}" opacity=".85"/>` +
          `<circle cx="64" cy="50" r="30" fill="${K}" opacity=".5"/>`,
      );
    case "xerox":
      return wrap(
        `<g fill="${K}" opacity=".82"><rect x="14" y="16" width="90" height="6"/>` +
          `<rect x="14" y="30" width="70" height="6"/><rect x="20" y="44" width="84" height="6"/>` +
          `<rect x="14" y="58" width="60" height="6"/></g>`,
      );
    case "stamp":
      return wrap(
        `<rect x="26" y="20" width="66" height="48" fill="none" stroke="${K}" stroke-width="5"/>` +
          `<circle cx="40" cy="34" r="3" fill="${K}"/><circle cx="80" cy="56" r="2.5" fill="${K}"/>` +
          `<circle cx="60" cy="44" r="5" fill="${A}"/>`,
      );
    case "glitch":
      return wrap(
        `<rect x="0" y="18" width="118" height="12" fill="${A}" opacity=".8"/>` +
          `<rect x="20" y="40" width="118" height="10" fill="${K}" opacity=".7"/>` +
          `<rect x="-14" y="60" width="118" height="9" fill="${K}" opacity=".5"/>`,
      );
    case "rgb-shift":
      return wrap(
        `<circle cx="52" cy="44" r="24" fill="none" stroke="${A}" stroke-width="3"/>` +
          `<circle cx="64" cy="44" r="24" fill="none" stroke="${K}" stroke-width="3"/>` +
          `<circle cx="58" cy="48" r="24" fill="none" stroke="${S}" stroke-width="1.5"/>`,
      );
    case "pixel-sort":
      return wrap(
        `<g>` +
          [
            [14, A, 30, 0.9],
            [26, K, 55, 0.7],
            [38, K, 20, 0.5],
            [50, A, 44, 0.8],
            [62, K, 60, 0.6],
            [74, K, 34, 0.7],
            [86, A, 50, 0.5],
            [98, K, 24, 0.6],
          ]
            .map(
              ([x, c, h, o]) =>
                `<rect x="${x}" y="${82 - h}" width="6" height="${h}" fill="${c}" opacity="${o}"/>`,
            )
            .join("") +
          `</g>`,
      );
    case "gradient-map":
      return wrap(
        `<defs><linearGradient id="${u("gm")}" x1="0" y1="0" x2="1" y2="0">` +
          `<stop offset="0" stop-color="${K}"/><stop offset=".5" stop-color="${A}"/>` +
          `<stop offset="1" stop-color="${P}"/></linearGradient></defs>` +
          `<rect x="10" y="22" width="98" height="44" fill="url(#${u("gm")})"/>`,
      );
    case "tone":
      return wrap(
        `<polyline points="14,74 104,14" fill="none" stroke="${S}" stroke-width="1" opacity=".5"/>` +
          `<path d="M14,74 C44,72 46,28 104,14" fill="none" stroke="${A}" stroke-width="3"/>`,
      );
    case "hue-sat":
      return wrap(
        `<g>` +
          [A, K, S, A, K, S]
            .map(
              (c, i) =>
                `<rect x="${14 + i * 15}" y="22" width="13" height="44" fill="${c}" opacity="${[0.9, 0.8, 0.6, 0.7, 0.85, 0.5][i]}"/>`,
            )
            .join("") +
          `</g>`,
      );
    default:
      return wrap(
        `<text x="59" y="50" text-anchor="middle" font-size="14" fill="${K}">${idx + 1}</text>`,
      );
  }
}

function buildParamPanel() {
  const eff = activeEffect();
  $("#param-title").textContent = eff.name;
  $(".block--a .block-tools").hidden = !eff.params.length;
  const root = $("#param-controls");
  root.innerHTML = "";
  if (eff.acceptsBase) root.appendChild(buildBaseLayerControl());
  if (!eff.params.length && eff.hint) {
    const hint = document.createElement("p");
    hint.className = "note";
    hint.textContent = eff.hint;
    root.appendChild(hint);
  }
  appendParams(root, eff.params, activeState(), onParamChange);
}

// Param change: if the param gates others' visibility, rebuild the panel so
// showIf re-evaluates; then re-render.
function onParamChange(key) {
  const param = activeEffect().params.find((p) => p.key === key);
  if (param && param.rebuildOnChange) buildParamPanel();
  requestRender();
}

/* ----------------------------------------------------------------
   Stage 04 — stacked second effect (runs on the first's output)
   ---------------------------------------------------------------- */
function makeTool(label, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tool";
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

// Builds the header tools and body of block B. With None selected it's just a
// prompt to pick a second effect; with a real effect it mirrors block A (params,
// Randomize/Reset). The effect itself is chosen from the filmstrip (target B) —
// selecting None there clears it, so there's no separate Add/Remove button.
function buildEffect2Panel() {
  const tools = $("#effect2-tools");
  const body = $("#param2-controls");
  tools.innerHTML = "";
  body.innerHTML = "";

  const on = isEffect2On();
  $("#block-effect2").classList.toggle("is-on", on);
  $("#param2-title").textContent = effect2().name;

  if (!on) {
    const hint = document.createElement("p");
    hint.className = "note note--add";
    hint.innerHTML =
      "No second effect. Target <b>B</b> in the strip below and pick one to run it on the output of the effect above.";
    body.appendChild(hint);
    return;
  }

  tools.appendChild(
    makeTool("Randomize", "Randomize second effect", doRandomize2),
  );
  tools.appendChild(makeTool("Reset", "Reset second effect", doReset2));
  appendParams(body, effect2().params, effect2State(), onParam2Change);
}

function onParam2Change(key) {
  const param = effect2().params.find((p) => p.key === key);
  if (param && param.rebuildOnChange) buildEffect2Panel();
  requestRender();
}

function doRandomize2() {
  if (!App.srcImage) {
    note("Load an image first.");
    return;
  }
  randomizeInto(effect2().params, effect2State());
  buildEffect2Panel();
  requestRender();
}

function doReset2() {
  App.states2[App.effect2Id] = defaultsOf(effect2().params);
  buildEffect2Panel();
  requestRender();
}

// Global "Base layer" selector — only shown for effects that accept a base.
// Options: None + every non-glitch effect (you can't base a glitch on a glitch).
function buildBaseLayerControl() {
  const sel = document.createElement("select");
  const opts = [{ value: "none", label: "None (source image)" }].concat(
    EFFECTS.filter(
      (e) => e.id !== "none" && !e.acceptsBase && e.category !== "color",
    ).map((e) => ({ value: e.id, label: e.name })),
  );
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = App.baseLayer;
  sel.addEventListener("change", () => {
    App.baseLayer = sel.value;
    requestRender();
  });
  const row = labeledRow("Base layer", sel);
  row.classList.add("row--base");
  return row;
}

// Color pre-stage selector (None + each color module) + its own param group.
function buildPreStageSelect() {
  const root = $("#prestage-select");
  root.innerHTML = "";
  const sel = document.createElement("select");
  const none = document.createElement("option");
  none.value = "none";
  none.textContent = "None";
  sel.appendChild(none);
  for (const m of EFFECTS.filter((e) => e.category === "color")) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name;
    sel.appendChild(o);
  }
  sel.value = App.preStage;
  sel.addEventListener("change", () => {
    App.preStage = sel.value;
    buildPreStageControls();
    requestRender();
  });
  root.appendChild(labeledRow("Color pre-stage", sel));
}

// The pre-stage module's params (auto-generated) — written to preStageParams,
// with their own rebuild-on-change handling, independent of the active effect.
function buildPreStageControls() {
  const root = $("#prestage-controls");
  root.innerHTML = "";
  if (App.preStage === "none") return;
  const mod = EFFECTS.find((e) => e.id === App.preStage);
  if (!mod) return;
  appendParams(root, mod.params, App.preStageParams[mod.id], (key) => {
    const param = mod.params.find((p) => p.key === key);
    if (param && param.rebuildOnChange) buildPreStageControls();
    requestRender();
  });
}

function setEffect(id) {
  App.activeId = id;
  buildEffectChips();
  buildParamPanel();
  updateSwapBtn();
  updateMeta();
  requestRender();
}

function doRandomize() {
  if (!App.srcImage) {
    note("Load an image first.");
    return;
  }
  randomizeInto(activeEffect().params, activeState());
  buildParamPanel();
  requestRender();
}

function doReset() {
  App.states[App.activeId] = defaultsOf(activeEffect().params);
  buildParamPanel();
  requestRender();
}

/* ----------------------------------------------------------------
   Export
   ---------------------------------------------------------------- */
// scale 1 = free Screen PNG; scale 2 = Print PNG (tier ≥ 1). The composition is
// identical — exportPNG just renders the effect at scale× device resolution.
function doExportPNG(scale) {
  if (!App.srcImage) { note("Load an image first."); return; }
  const eff = activeEffect();
  const src = getSourceForActive();
  const second = isEffect2On()
    ? { effect: effect2(), state: effect2State() }
    : null;
  const name = second ? `${eff.id}+${App.effect2Id}` : eff.id;
  const w = App.canvasW * scale, h = App.canvasH * scale;
  exportPNG(
    App.p, eff, src, activeState(),
    App.canvasW, App.canvasH, scale,
    `halftone-press_${name}_${w}x${h}.png`,
    second,
  );
  note(`Exported PNG · ${w}×${h}`);
  closeExportPanel();
}

/* ----------------------------------------------------------------
   Swap A ↔ B
   ---------------------------------------------------------------- */
function doSwap() {
  if (!isEffect2On()) return;
  const oldAId = App.activeId;
  const oldBId = App.effect2Id;
  const aState = App.states[oldAId];
  const bState = App.states2[oldBId];
  App.activeId = oldBId;
  App.effect2Id = oldAId;
  App.states[oldBId] = bState;
  App.states2[oldAId] = aState;
  buildEffectChips();
  buildParamPanel();
  buildEffect2Panel();
  buildFilmTargetToggle();
  updateSwapBtn();
  updateMeta();
  requestRender();
}

function updateSwapBtn() {
  const btn = $("#btn-swap");
  if (btn) btn.disabled = !isEffect2On();
}

// The active effect's separation plates, or null. Gated like SVG: a stacked
// chain has no single set of plates, so it's disabled while slot B is on.
function activeSeparations() {
  if (isEffect2On()) return null;
  const eff = activeEffect();
  if (typeof eff.separations !== "function") return null;
  const src = getSourceForActive();
  if (!src) return null;
  const list = eff.separations(src, activeState(), {
    p: App.p,
    w: App.canvasW,
    h: App.canvasH,
  });
  return list && list.length ? list : null;
}

async function doExportSeparations() {
  const plates = activeSeparations();
  if (!plates) {
    note("No separations for this effect.");
    return;
  }
  const btn = $("#xbtn-sep");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Building…";
  try {
    const n = await exportSeparations(
      App.p,
      plates,
      App.canvasW,
      App.canvasH,
      2, // tier 2 includes 2× resolution
      `halftone-press_${App.activeId}_separations_2x.zip`,
    );
    note(`Exported ${n} separation plates · 2× ZIP.`);
    closeExportPanel();
  } catch (e) {
    console.error(e);
    note("Couldn’t build the separations ZIP.");
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

function doExportSVG() {
  if (!App.srcImage) { note("Load an image first."); return; }
  if (isEffect2On()) {
    note("SVG isn’t available while a second effect is stacked.");
    return;
  }
  const eff = activeEffect();
  const res = exportSVG(
    eff,
    getSourceForActive(),
    activeState(),
    App.canvasW,
    App.canvasH,
    `halftone-press_${eff.id}.svg`,
    App.p,
  );
  if (res.ok) {
    note("Exported SVG (vector).");
    closeExportPanel();
  } else if (res.reason === "unsupported") {
    note("SVG isn’t 1:1 for these settings — export PNG instead.");
  } else {
    note("SVG export isn’t available for this effect.");
  }
}

/* ----------------------------------------------------------------
   Export overlay — all exports are free. Buttons export directly; the only
   gating left is availability (separations/SVG don't apply to every effect,
   or to a stacked chain).
   ---------------------------------------------------------------- */
function openExportPanel() {
  if (!App.srcImage) { note("Load an image first."); return; }
  const eff = activeEffect();
  const stacked = isEffect2On();

  // Color separations — available only when the active effect yields plates.
  const plates = activeSeparations();
  $("#xbtn-sep").disabled = !plates;
  $("#xsep-desc").textContent = plates
    ? `${eff.name} · ${plates.length} plates · 2× ZIP`
    : stacked ? "Not available when effects are stacked."
              : "Not available for this effect.";

  // Vector SVG — needs a vector renderer and not a stacked chain.
  const svgOk = !stacked && typeof eff.renderSVG === "function";
  $("#xbtn-svg").disabled = !svgOk;
  $("#xsvg-desc").textContent = svgOk
    ? "True vector · scalable to any size."
    : stacked ? "Not available when effects are stacked."
              : "Not available for this effect.";

  $("#xpanel").removeAttribute("hidden");
}

function closeExportPanel() {
  $("#xpanel").setAttribute("hidden", "");
}

/* ----------------------------------------------------------------
   Misc UI
   ---------------------------------------------------------------- */
function updateMeta() {
  const chain =
    activeEffect().name + (isEffect2On() ? ` → ${effect2().name}` : "");
  $("#meta-fx").textContent = chain;
  $("#meta-dims").textContent = App.srcImage
    ? `${App.srcImage.width}×${App.srcImage.height}`
    : "— × —";
}

function updateAsciiOverlay(eff, state) {
  const pre = $("#ascii-text");
  if (eff.id === "ascii" && state && state.showText && eff.lastText) {
    pre.textContent = eff.lastText;
    pre.hidden = false;
  } else {
    pre.hidden = true;
  }
}

let noteTimer = null;
function note(msg) {
  const el = $("#drop-note");
  el.textContent = msg;
  el.style.color = "var(--ink)";
  el.style.fontWeight = "700";
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    el.textContent = "Tip: drag & drop an image anywhere onto the proof.";
    el.style.color = "";
    el.style.fontWeight = "";
  }, 2600);
}

/* ----------------------------------------------------------------
   Events
   ---------------------------------------------------------------- */
function wireEvents() {
  $("#file-input").addEventListener("change", (e) => {
    loadFromFile(e.target.files[0]);
    e.target.value = "";
  });
  ["#btn-upload", "#btn-upload-2"].forEach((s) =>
    $(s).addEventListener("click", () => $("#file-input").click()),
  );
  ["#btn-demo", "#btn-demo-2"].forEach((s) =>
    $(s).addEventListener("click", () => useDemo()),
  );

  $("#btn-randomize").addEventListener("click", doRandomize);
  $("#btn-reset").addEventListener("click", doReset);
  $("#btn-swap").addEventListener("click", doSwap);
  $("#btn-export").addEventListener("click", openExportPanel);
  $("#xpanel-close").addEventListener("click", closeExportPanel);
  $("#xpanel-backdrop").addEventListener("click", closeExportPanel);
  $("#xbtn-print").addEventListener("click", () => doExportPNG(2));
  $("#xbtn-svg").addEventListener("click", doExportSVG);
  $("#xbtn-sep").addEventListener("click", doExportSeparations);

  // Drag & drop anywhere
  const empty = $("#empty");
  ["dragenter", "dragover"].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      e.preventDefault();
      empty.classList.add("is-hover");
    }),
  );
  ["dragleave", "dragend"].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      if (e.relatedTarget === null) empty.classList.remove("is-hover");
    }),
  );
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    empty.classList.remove("is-hover");
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFromFile(f);
  });

  // Keyboard: R randomize, E export
  window.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    if (e.key === "r" || e.key === "R") doRandomize();
    else if (e.key === "e" || e.key === "E") openExportPanel();
    else if (e.key === "Escape") closeExportPanel();
  });

  // Re-render once webfonts are ready (ASCII metrics depend on them)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => requestRender());
  }
}

/* ----------------------------------------------------------------
   Init
   ---------------------------------------------------------------- */
function init() {
  buildPanel($("#preadjust-controls"), PRE_SCHEMA, App.pre, () => recompute());
  buildPreStageSelect();
  buildPreStageControls();
  buildEffectChips();
  buildFilmTargetToggle();
  buildParamPanel();
  buildEffect2Panel();
  updateSwapBtn();
  updateMeta();
  wireEvents();
}

init();

// Debug / automation handle — lets you inspect state from the console.
window.__hp = App;
