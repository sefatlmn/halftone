// none.js — the null "effect": a pass-through that shows the source after
// Source + Pre-adjust (and any colour pre-stage / base) exactly as-is, with no
// screen applied. It's the default plate on load, so you can dial in Pre-adjust
// before committing to an effect — and selecting it in slot B is how you clear
// the second effect (B is "on" whenever its effect isn't None).
export default {
  id: "none",
  name: "None",
  no: "00",
  hint: "Pick an effect from the strip below to start.",
  params: [],

  render(g, src, params, ctx) {
    const { w, h } = ctx;
    g.image(src, 0, 0, w, h); // draw the (pre-adjusted) working buffer straight through
  },
};
