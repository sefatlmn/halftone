// export.js — PNG (full-res, 1× / 2×) and SVG (for vector-native effects).

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveCanvas(buf, filename) {
  buf.canvas.toBlob((blob) => {
    if (blob) download(blob, filename);
    buf.remove();
  }, 'image/png');
}

// Re-render the effect at scale× into an offscreen buffer and save as PNG.
// We scale the drawing context (not the logical size) so the composition is
// identical to the preview, just at higher device resolution.
//
// `second` (optional) stacks a second effect on the first's output, mirroring
// the live chain: the first effect is drawn into an intermediate buffer at full
// export resolution, then the second effect renders from it into the final buf.
export function exportPNG(p, effect, src, state, w, h, scale, filename, second) {
  const W = Math.round(w * scale), H = Math.round(h * scale);

  if (!second) {
    const buf = p.createGraphics(W, H);
    buf.pixelDensity(1);
    buf.push();
    buf.scale(scale);
    effect.render(buf, src, state, { p, w, h });
    buf.pop();
    saveCanvas(buf, filename);
    return;
  }

  const mid = p.createGraphics(W, H);
  mid.pixelDensity(1);
  mid.push();
  mid.scale(scale);
  effect.render(mid, src, state, { p, w, h });
  mid.pop();
  mid.loadPixels();

  const buf = p.createGraphics(W, H);
  buf.pixelDensity(1);
  buf.push();
  buf.scale(scale);
  second.effect.render(buf, mid, second.state, { p, w, h });
  buf.pop();
  saveCanvas(buf, filename);
  mid.remove();
}

// Vector export. Returns a status so the UI can explain a skip.
//   { ok:true } | { ok:false, reason:'no-svg'|'unsupported' }
export function exportSVG(effect, src, state, w, h, filename) {
  if (typeof effect.renderSVG !== 'function') return { ok: false, reason: 'no-svg' };
  const svg = effect.renderSVG(src, state, { w, h });
  if (!svg) return { ok: false, reason: 'unsupported' };
  download(new Blob([svg], { type: 'image/svg+xml' }), filename);
  return { ok: true };
}
