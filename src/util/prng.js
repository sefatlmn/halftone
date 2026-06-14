// prng.js — seeded pseudo-random generator (mulberry32).
//
// makeRng(seed) returns a function () => float in [0, 1). The same seed always
// produces the same sequence, so effects that route ALL their randomness through
// it are reproducible and stable across re-renders. Never use Math.random() in
// an effect's render path — output would jump on every redraw.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
