// scratch.js — pooled, reusable offscreen p5.Graphics.
//
// Pixel-pass effects need a scratch canvas per render (they write pixels into
// it, then draw it scaled onto the target). Creating one per render and
// .remove()-ing it after is fine in Chrome but is exactly what crashes Safari:
// removed canvases are reclaimed lazily, so a slider drag — dozens of renders
// a second, each allocating a sampling- or display-resolution canvas — blows
// through Safari's per-tab canvas-memory budget, and its watchdog answers by
// killing and reloading the page (the "infinite loading loop"). Reusing one
// buffer per pipeline slot caps that at a small constant instead.
//
// Callers key their buffer by pipeline SLOT (ctx.slot: 'pre' | 'base' | 'a' |
// 'b' | 'exp' | 'exp2' | 'sep'), not by effect: only one effect renders per
// slot per frame, and every effect in a slot works at that slot's buffer size
// (its source's dimensions), so all of them can share one buffer. That keeps
// the whole pool at a handful of stable entries — switching effects reuses the
// same canvas instead of allocating a new one per effect. The one exception is
// dither, which keys as `dither:${slot}`: its buffer is a fixed grid-cap
// canvas (a deliberately different size), and sharing a slot key would resize
// the buffer back and forth every time the user alternated effects.
//
// A buffer is private to its key and carries last frame's contents: the caller
// must fully overwrite it every render. Every current user does — they either
// .set() the whole pixels array or draw an opaque source over the full area.

// Above the realistic concurrent working set (pre, base, a, b + export keys +
// a dither variant or two) while staying small: worst case is MAX_BUFFERS
// sampling-res buffers pinned (~8 MB each), which has to stay well inside an
// iOS tab's canvas budget. Eviction is safe at any cap — a scratch buffer only
// matters during its own render call — so overflow costs a reallocation, never
// correctness.
const MAX_BUFFERS = 8;

const pool = new Map(); // key → p5.Graphics, in LRU order (oldest first)

export function getScratch(p, key, w, h) {
  let g = pool.get(key);
  if (g) pool.delete(key); // re-inserted below, so Map order stays LRU
  if (g && (g.width !== w || g.height !== h)) {
    g.remove(); // size changed (canvas resize) — rebuild once, not per frame
    g = null;
  }
  if (!g) {
    g = p.createGraphics(w, h);
    g.pixelDensity(1);
  }
  pool.set(key, g);
  if (pool.size > MAX_BUFFERS) {
    const [oldKey, oldG] = pool.entries().next().value;
    pool.delete(oldKey);
    oldG.remove(); // evicting between render calls is safe — a buffer only matters during its own render
  }
  return g;
}
