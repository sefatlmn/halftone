# Halftone Press

A browser-based **print-effects workshop** built with [p5.js](https://p5js.org/). Upload an
image and run it through six print / halftone style screens with live controls and export.
No backend, no framework, no build step — just static files.

![Halftone Press](https://img.shields.io/badge/p5.js-1.11.x-ff3d8b) ![No build step](https://img.shields.io/badge/build-none-181410)

## Effects

| #   | Effect          | What it does                                                                                                                                                                                  |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | **Halftone**    | Rotated dot screen, radius ∝ √(darkness). Circle / square / line dots, single mono ink or full **CMYK** separation (15° / 75° / 0° / 45°, MULTIPLY).                                          |
| 02  | **Dither**      | **Ordered** (2×2 / 4×4 / 8×8 Bayer) and **Floyd–Steinberg** error diffusion with optional serpentine scan. Palettes (1-bit, duotone, 3/4-tone, C/M/Y), chunky pixels, and a modulation field. |
| 03  | **ASCII**       | Glyph grid from an editable ramp, mono or source-coloured, in a real monospace font. Optional selectable-text overlay.                                                                        |
| 04  | **Risograph**   | 2–3 spot-colour separations (luminance bands or RGB channels), per-layer halftone/grain screens, misregistration offset, MULTIPLY composite, paper grain.                                     |
| 05  | **Xerox**       | High-contrast 1-bit photocopy: contrast boost, soft blur, noisy threshold, toner dropouts and dust.                                                                                           |
| 06  | **Print Stamp** | Hard 1-bit threshold with coherent (Perlin) rough edges and an ink-texture mask — rubber-stamp / letterpress.                                                                                 |
| 07  | **Glitch**      | Static, **seeded** datamosh: random-height band shifts, block smears, local channel tears, and bit-crush corruption. Horizontal / vertical.                                                   |
| 08  | **RGB Shift**   | Chromatic aberration — `linear` or `radial` (lens fringing), simple amount/angle or `advanced` per-channel offsets, optional `edgeBias`.                                                      |
| 09  | **Pixel Sort**  | Sort pixel runs by brightness/hue/saturation/R/G/B. Interval modes: `threshold` (Asendorf), `edge`, seeded `random`, `full`. Horizontal / vertical.                                           |

Effects 07–09 are **glitch-family**: they accept a **base layer** (see [Composition](#base-layer-composition)) so you can glitch a halftone, pixel-sort a dither, and so on. Their randomness is seeded — the same `seed` always reproduces the same result, and **Randomize** rerolls it.

## Run it

It's a static site, so any static file server works. From this folder:

```bash
# Node
npx serve .

# or Python 3
python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:8000`). Opening `index.html`
directly via `file://` **will not work** — the app uses ES modules, which browsers
only load over `http(s)`.

Tested on current Chrome, Firefox, and Safari.

## Using it

1. **Load image** (or **Demo plate**) — or just drag & drop an image onto the proof.
2. Adjust **Pre-adjust** (brightness / contrast / gamma / invert) — applied once into the working buffer.
3. Pick an **Effect** and tweak its parameters; the preview updates live.
4. **Export PNG** at 1× or 2×. For Halftone (mono) and ASCII you can also **Export SVG** (true vectors).

**Keyboard:** `R` randomize the active effect · `E` export PNG.

## Architecture

```
index.html        # markup + p5 CDN + Google Fonts
style.css         # risograph / print-shop styling
src/
  main.js         # p5 instance (instance mode), app state, all wiring
  input.js        # load / fit / pre-adjust → working buffer + sampling helpers
  controls.js     # auto-generate controls from each effect's param schema
  export.js       # PNG (1×/2×) + SVG export
  effects/
    index.js      # registry (array of effect modules)
    halftone.js  dither.js  ascii.js  riso.js  xerox.js  stamp.js
    glitch.js  rgb-shift.js  pixel-sort.js   # glitch-family (accept a base layer)
    _shared.js    # colour / SVG helpers (re-exports the PRNG as `rng`)
  util/
    prng.js       # makeRng(seed) → mulberry32 generator (reproducible randomness)
```

Every effect is a self-describing module:

```js
export default {
  id: "halftone",
  name: "Halftone",
  params: [
    /* {key,label,type,...} — drives the UI automatically */
  ],
  render(g, src, params, ctx) {
    /* draw into g, sampling from src */
  },
  renderSVG(src, params, view) {
    /* optional: return an SVG string */
  },
};
```

- `g` is the draw target (the live canvas, or an offscreen buffer for export).
- `src` is the **working buffer**: the source fit + pre-adjusted, downsampled so its
  long edge is ≤ 1200 px. Effects read luminance/colour from it via the helpers in
  `input.js` and draw shapes at full display resolution.
- `ctx = { p, w, h }` provides the p5 instance (for constants/helpers) and the logical
  canvas size.
- The control panel is generated from `params` (range → slider, select → dropdown,
  toggle → switch, color → swatch, text → input). Adding a param gives it a control for free.
- Params may declare `showIf(state)` (hidden until a condition holds) and `rebuildOnChange`
  (a gating control that rebuilds the panel) — used by RGB Shift's _advanced_ toggle and
  Pixel Sort's interval modes.

### Base layer (composition)

The `render(g, src, params)` contract makes stacking trivial — it's just swapping `src`.
The glitch-family effects (Glitch, RGB Shift, Pixel Sort) show a **Base layer** selector.
When you pick a base effect, `main.js` renders it once into an offscreen `p5.Graphics`
sized to the working buffer, then passes _that_ image as `src` to the active effect — so a
glitch runs on a halftone instead of the raw photo. The base render is cached by a signature
(base id + size + params + working-buffer version) and only recomputed when something
changes. No effect module needed editing: every effect already draws into its `g` target and
reads from `src`, so a `p5.Graphics` drops in cleanly. The base uses that effect's last-used
params — configure Halftone, then switch to Glitch with Halftone as the base.

### Performance notes

- The working buffer is rebuilt only when the image, fit, or pre-adjust changes — effect
  params just re-render.
- Sampling always reads the capped buffer, never the full-res image.
- Heavier passes (Floyd–Steinberg, Riso, Xerox, Stamp, Glitch, Pixel Sort) are debounced
  and show a brief "rendering…" state; pixel-based effects compute on the capped buffer and
  upscale with smoothing off for crisp output.

## Notes / scope

- **SVG export** is implemented for **Halftone (mono)** and **ASCII** — the effects that
  are genuinely vector (dots → `<circle>`/`<rect>`/`<line>`, glyphs → `<text>`). CMYK
  halftone and the raster effects (Dither/Riso/Xerox/Stamp and glitch-family
  Glitch/RGB Shift/Pixel Sort) fall back to PNG, since their MULTIPLY/per-pixel looks don't
  flatten 1:1 to flat SVG. The SVG button disables itself and explains when it can't help.
- Everything runs locally in the browser; no image ever leaves your machine.

## License

MIT — do what you like.
