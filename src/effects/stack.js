// stack.js — the full print pipeline as a reusable, self-caching unit:
//
//   source image → pre-adjust → color pre-stage → effect → [effect 2]
//
// An optional SECOND effect runs on the rendered output of the first (raster on
// raster) — the first effect is drawn into an intermediate buffer, then handed
// to the second as its source. Off unless the bundle carries `effect2`.
//
// The stack renders straight onto the main canvas (or, for export, a clean
// offscreen buffer). Each instance keeps its own working/staged buffers
// and recomputes a stage only when that stage's inputs change.

import EFFECTS from './index.js';
import { buildWorking } from '../input.js';

const byId = (id) => EFFECTS.find((e) => e.id === id);
const j = (o) => JSON.stringify(o || null);

// Lazy stable id per source image, so output signatures notice a new image.
let _imgSeq = 0;
function imgId(img) {
  if (!img) return 'none';
  if (img.__hpId == null) img.__hpId = ++_imgSeq;
  return img.__hpId;
}

// A params bundle has the shape:
//   { pre, preStage, preStageParams, effect, effectParams, effect2, effect2Params }
// Anything missing falls back to a sensible default.
export function emptyBundle() {
  return {
    pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    preStage: 'none',
    preStageParams: {},
    effect: EFFECTS[0].id,
    effectParams: {},
    effect2: 'none',
    effect2Params: {},
  };
}

export function createEffectStack(p) {
  let working = null, staged = null, chainPG = null;
  let wSig = null, sSig = null, cSig = null;

  function sizeBuffer(buf, w, h) {
    if (buf && buf.width === w && buf.height === h) return buf;
    if (buf) buf.remove();
    const g = p.createGraphics(w, h);
    g.pixelDensity(1);
    return g;
  }

  // Run pre-adjust → pre-stage and return the buffer the active effect
  // should sample from, plus the resolved effect module.
  function prepare(src, bundle, w, h) {
    const b = bundle || emptyBundle();

    // 1. working buffer (image fitted + pre-adjust baked in, at sampling res).
    // The old buffer is passed in for reuse — same dims means no reallocation.
    const wsig = `${imgId(src)}:${b.sourceVersion || 0}|${w}x${h}|${j(b.pre)}`;
    if (wsig !== wSig || !working) {
      working = buildWorking(p, src, w, h, 'contain', b.pre || {}, working);
      wSig = wsig; sSig = null;
    }

    // 2. colour pre-stage (optional)
    let stagedBuf = working;
    const mod = (b.preStage && b.preStage !== 'none') ? byId(b.preStage) : null;
    if (mod) {
      staged = sizeBuffer(staged, working.width, working.height);
      const sig = `${wSig}|${b.preStage}|${j(b.preStageParams)}`;
      if (sig !== sSig) {
        staged.blendMode(p.BLEND);
        mod.render(staged, working, b.preStageParams || {}, { p, w: staged.width, h: staged.height, slot: 'pre' });
        staged.loadPixels();
        sSig = sig;
      }
      stagedBuf = staged;
    } else {
      sSig = null;
    }

    const eff = byId(b.effect) || EFFECTS[0];
    const activeSrc = stagedBuf;
    return { activeSrc, eff };
  }

  // Render the final active effect into `target` at display size w×h. Used by
  // Single mode (target = main canvas) and export (target = clean export buffer).
  // Does not touch the cached output buffer.
  function renderInto(target, src, bundle, w, h) {
    const { activeSrc, eff } = prepare(src, bundle, w, h);
    const b = bundle || {};
    const eff2 = (b.effect2 && b.effect2 !== 'none') ? byId(b.effect2) : null;

    if (!eff2) {
      target.blendMode(p.BLEND);
      if (target.noTint) target.noTint();
      eff.render(target, activeSrc, b.effectParams || {}, { p, w, h, slot: 'a' });
      return eff;
    }

    // Chained: draw the first effect into an intermediate buffer at display
    // resolution (pixels loaded so any second effect — sampler or pixel-reader
    // — can read it), then render the second effect from that into the target.
    // Distinct scratch slots ('a' vs 'b') keep the same effect in both passes
    // from resizing one pooled buffer back and forth every frame.
    const activeSrcSig = (b.preStage && b.preStage !== 'none') ? sSig : `${wSig}:none`;
    const csig = `${activeSrcSig}|${b.effect}|${j(b.effectParams)}|${w}x${h}`;
    if (csig !== cSig || !chainPG) {
      chainPG = sizeBuffer(chainPG, w, h);
      chainPG.blendMode(p.BLEND);
      if (chainPG.noTint) chainPG.noTint();
      chainPG.clear();
      eff.render(chainPG, activeSrc, b.effectParams || {}, { p, w, h, slot: 'a' });
      chainPG.loadPixels();
      cSig = csig;
    }

    target.blendMode(p.BLEND);
    if (target.noTint) target.noTint();
    eff2.render(target, chainPG, b.effect2Params || {}, { p, w, h, slot: 'b' });
    return eff2;
  }

  // The source buffer the active effect samples (staged), at sampling
  // res — handy for SVG export, which re-renders the effect at scale.
  function sourceFor(src, bundle, w, h) {
    return prepare(src, bundle, w, h).activeSrc;
  }

  function dispose() {
    [working, staged, chainPG].forEach((g) => g && g.remove());
    working = staged = chainPG = null;
    wSig = sSig = cSig = null;
  }

  return { renderInto, sourceFor, prepare, dispose };
}
