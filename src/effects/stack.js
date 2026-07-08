// stack.js — the full print pipeline as a reusable, self-caching unit:
//
//   source image → pre-adjust → color pre-stage → [base effect →] effect → [effect 2]
//
// An optional SECOND effect runs on the rendered output of the first (raster on
// raster) — the first effect is drawn into an intermediate buffer, then handed
// to the second as its source. Off unless the bundle carries `effect2`.
//
// The stack renders straight onto the main canvas (or, for export, a clean
// offscreen buffer). Each instance keeps its own working/staged/base buffers
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
//   { pre, preStage, preStageParams, effect, effectParams, baseLayer, baseParams }
// Anything missing falls back to a sensible default.
export function emptyBundle() {
  return {
    pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
    preStage: 'none',
    preStageParams: {},
    effect: EFFECTS[0].id,
    effectParams: {},
    baseLayer: 'none',
    baseParams: {},
    effect2: 'none',
    effect2Params: {},
  };
}

export function createEffectStack(p) {
  let working = null, staged = null, basePG = null, chainPG = null;
  let wSig = null, sSig = null, bSig = null;

  function sizeBuffer(buf, w, h) {
    if (buf && buf.width === w && buf.height === h) return buf;
    if (buf) buf.remove();
    const g = p.createGraphics(w, h);
    g.pixelDensity(1);
    return g;
  }

  // Run pre-adjust → pre-stage → base layer and return the buffer the active
  // effect should sample from, plus the resolved effect module.
  function prepare(src, bundle, w, h) {
    const b = bundle || emptyBundle();

    // 1. working buffer (image fitted + pre-adjust baked in, at sampling res)
    const wsig = `${imgId(src)}|${w}x${h}|${j(b.pre)}`;
    if (wsig !== wSig || !working) {
      if (working) working.remove();
      working = buildWorking(p, src, w, h, 'contain', b.pre || {});
      wSig = wsig; sSig = null; bSig = null;
    }

    // 2. colour pre-stage (optional)
    let stagedBuf = working;
    const mod = (b.preStage && b.preStage !== 'none') ? byId(b.preStage) : null;
    if (mod) {
      staged = sizeBuffer(staged, working.width, working.height);
      const sig = `${wSig}|${b.preStage}|${j(b.preStageParams)}`;
      if (sig !== sSig) {
        staged.blendMode(p.BLEND);
        mod.render(staged, working, b.preStageParams || {}, { p, w: staged.width, h: staged.height });
        staged.loadPixels();
        sSig = sig; bSig = null;
      }
      stagedBuf = staged;
    } else {
      // Pre-stage off: sSig must clear, or the base-layer signature below
      // (which folds in `sSig || wSig`) would still carry the stale pre-stage
      // signature and serve an outdated cached base render.
      sSig = null;
    }

    // 3. base layer (only for effects that accept one, e.g. glitch family)
    const eff = byId(b.effect) || EFFECTS[0];
    let activeSrc = stagedBuf;
    if (eff.acceptsBase && b.baseLayer && b.baseLayer !== 'none') {
      const be = byId(b.baseLayer);
      if (be) {
        basePG = sizeBuffer(basePG, stagedBuf.width, stagedBuf.height);
        const sig = `${b.baseLayer}|${sSig || wSig}|${j(b.baseParams)}`;
        if (sig !== bSig) {
          basePG.blendMode(p.BLEND);
          be.render(basePG, stagedBuf, b.baseParams || {}, { p, w: basePG.width, h: basePG.height });
          basePG.loadPixels();
          bSig = sig;
        }
        activeSrc = basePG;
      }
    }

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
      eff.render(target, activeSrc, b.effectParams || {}, { p, w, h });
      return eff;
    }

    // Chained: draw the first effect into an intermediate buffer at display
    // resolution (pixels loaded so any second effect — sampler or pixel-reader
    // — can read it), then render the second effect from that into the target.
    chainPG = sizeBuffer(chainPG, w, h);
    chainPG.blendMode(p.BLEND);
    if (chainPG.noTint) chainPG.noTint();
    chainPG.clear();
    eff.render(chainPG, activeSrc, b.effectParams || {}, { p, w, h });
    chainPG.loadPixels();

    target.blendMode(p.BLEND);
    if (target.noTint) target.noTint();
    eff2.render(target, chainPG, b.effect2Params || {}, { p, w, h });
    return eff2;
  }

  // The source buffer the active effect samples (staged + base), at sampling
  // res — handy for SVG export, which re-renders the effect at scale.
  function sourceFor(src, bundle, w, h) {
    return prepare(src, bundle, w, h).activeSrc;
  }

  function dispose() {
    [working, staged, basePG, chainPG].forEach((g) => g && g.remove());
    working = staged = basePG = chainPG = null;
    wSig = sSig = bSig = null;
  }

  return { renderInto, sourceFor, prepare, dispose };
}
