# Halftone Tools

A browser-based **print-effects workshop** built with [p5.js](https://p5js.org/). Load an
image, run it through a dozen halftone / dither / glitch / colour screens with live controls,
**stack two effects**, and export to PNG, SVG, or colour-separated plates. No backend, no framework, no build step —
just static files, all processing in your browser.

![Halftone Tools](https://img.shields.io/badge/p5.js-1.11.x-ff3d8b) ![No build step](https://img.shields.io/badge/build-none-181410)

## Effects

| #   | Effect          | What it does                                                                                                                                                                                  |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00  | **None**        | Pass-through — shows the source after Pre-adjust with no screen. Default on load; selecting it in slot B clears the second effect.                                                            |
| 01  | **Halftone**    | Rotated dot screen, radius ∝ √(darkness). Circle / square / line dots, single mono ink or full **CMYK** separation (15° / 75° / 0° / 45°, MULTIPLY).                                          |
| 02  | **Dither**      | **Ordered** (2×2 / 4×4 / 8×8 Bayer) and **Floyd–Steinberg** error diffusion with optional serpentine scan. Palettes (1-bit, duotone, 3/4-tone, C/M/Y), chunky pixels, and a modulation field. |
| 03  | **ASCII**       | Glyph grid from an editable ramp, mono or source-coloured, in a real monospace font. Optional selectable-text overlay.                                                                        |
| 04  | **Risograph**   | 2–3 spot-colour separations (luminance bands or RGB channels), per-layer halftone/grain screens, misregistration offset, MULTIPLY composite, paper grain.                                     |
| 05  | **Xerox**       | High-contrast 1-bit photocopy: contrast boost, soft blur, noisy threshold, toner dropouts and dust.                                                                                           |
| 06  | **Print Stamp** | Hard 1-bit threshold with coherent (Perlin) rough edges and an ink-texture mask — rubber-stamp / letterpress.                                                                                 |
| 07  | **Glitch**      | Static, **seeded** datamosh: random-height band shifts, block smears, local channel tears, and bit-crush corruption. Horizontal / vertical.                                                   |
| 08  | **RGB Shift**   | Chromatic aberration — `linear` or `radial` (lens fringing), simple amount/angle or `advanced` per-channel offsets, optional `edgeBias`.                                                      |
| 09  | **Pixel Sort**  | Sort pixel runs by brightness/hue/saturation/R/G/B. Interval modes: `threshold` (Asendorf), `edge`, seeded `random`, `full`. Horizontal / vertical.                                           |
| 10  | **Gradient Map**| Map luminance onto a multi-stop colour ramp — duotone / tritone / thermal / cyanotype / viridis presets, editable stops, optional posterise.                                                  |
| 11  | **Tone**        | Tone curves (composite + per-channel R/G/B) plus colour matrices — sepia, saturate, desaturate, channel swap.                                                                                 |
| 12  | **Hue / Sat**   | Global hue rotation, saturation, and lightness.                                                                                                                                               |

Effects 07–09 are **glitch-family**: they accept a **base layer** (see [Composition](#base-layer-composition)) so you can glitch a halftone, pixel-sort a dither, and so on. Their randomness is seeded — the same `seed` always reproduces the same result, and **Randomize** rerolls it.

Effects 10–12 are **colour modules**: use them as a main effect, or as the **Colour pre-stage** (recolour the source _before_ the screen runs — e.g. gradient-map into a halftone).

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

1. **Load image** (or **Demo plate**) — or drag & drop an image onto the stage.
2. **Pre-adjust** (brightness / contrast / gamma / invert), and optionally a **Colour pre-stage**
   (Gradient Map / Tone / Hue·Sat) — applied once into the working buffer before the effect.
3. Pick **Effect A** from the bottom filmstrip and tweak its parameters; the preview updates live.
4. To **stack a second effect**, click **B** in the filmstrip toggle, then pick any effect —
   B runs on A's rendered output. Picking **00 None** in slot B clears the stack.
5. **Export** (button, or `E`) opens the overlay — every export is free and full-resolution:
   - **PNG** — the composed proof at 2× device resolution.
   - **Colour separation ZIP** — one plate per ink, for Halftone (CMYK), RGB Shift, and Risograph.
   - **SVG** (true vectors) — for Halftone, ASCII, Dither, and Risograph; not available for the
     raster effects or while two effects are stacked.

**Keyboard:** `R` randomize the active effect · `E` open Export · `Esc` close it.

## Architecture

```
index.html        # markup + p5 CDN + Google Fonts + GoatCounter analytics
style.css         # print-shop / risograph styling (five-colour token system, no rounded corners)
src/
  main.js         # p5 instance (instance mode), app state, all wiring
  input.js        # load / fit / pre-adjust → working buffer + sampling helpers
  controls.js     # auto-generate controls from each effect's param schema
  export.js       # PNG (2×) + SVG + colour-separation ZIP export
  zip.js          # minimal STORE-only ZIP writer (bundles separation plates)
  effects/
    index.js      # registry (array of effect modules, in UI order)
    stack.js      # the pipeline: pre-adjust → colour pre-stage → [base →] effect → [stacked effect]
    none.js       # pass-through (00 None) — default state and "clear B" mechanism
    halftone.js  dither.js  ascii.js  riso.js  xerox.js  stamp.js
    glitch.js  rgb-shift.js  pixel-sort.js      # glitch-family (accept a base layer)
    gradient-map.js  tone.js  hue-sat.js         # colour modules (effect or pre-stage)
    _shared.js    # colour / SVG helpers (re-exports the PRNG as `rng`)
  controls/
    curve-editor.js     # tone-curve pad control
    gradient-editor.js  # gradient-ramp control
  color/
    curve.js      # curve sampling / LUT
    ramps.js      # gradient-map ramp presets + sampling
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
  long edge is ≤ 1600 px (`SAMPLING_CAP`). Effects read luminance/colour from it via the helpers in
  `input.js` and draw shapes at full display resolution.
- `ctx = { p, w, h }` provides the p5 instance (for constants/helpers) and the logical
  canvas size.
- The control panel is generated from `params` (range → slider, select → dropdown,
  toggle → switch, color → swatch, text → input, gradient/curve → editor). Adding a param gives it a control for free.
- Params may declare `showIf(state)` (hidden until a condition holds) and `rebuildOnChange`
  (a gating control that rebuilds the panel) — used by RGB Shift's _advanced_ toggle and
  Pixel Sort's interval modes.

### The pipeline (`stack.js`)

`createEffectStack(p)` runs the whole chain as a self-caching unit:

```
source image → pre-adjust → colour pre-stage → [base effect →] effect A → [effect B]
```

Each stage is keyed by a signature and only recomputed when its inputs change. **Effect B**
(when stacked) renders on **A's rasterised output**: A is drawn into an intermediate buffer,
its pixels loaded, then handed to B as its `src` — so any second effect, even a pixel reader,
can sample it. Slot B is considered active whenever its selected effect is anything other than
`none`; selecting `00 None` in slot B is how you clear the stack.

### Base layer (composition)

The `render(g, src, params)` contract makes stacking trivial — it's just swapping `src`.
The glitch-family effects (Glitch, RGB Shift, Pixel Sort) show a **Base layer** selector.
When you pick a base effect, it's rendered once into an offscreen `p5.Graphics` sized to the
working buffer, then passed as `src` to the active effect — so a glitch runs on a halftone
instead of the raw photo. The base render is cached by a signature (base id + size + params +
working-buffer version) and only recomputed when something changes. The base uses that
effect's last-used params — configure Halftone, then switch to Glitch with Halftone as the base.

### Performance notes

- The uploaded image is downscaled to ≤ 2560 px (`SRC_CAP`) on load — the pipeline never
  samples above `SAMPLING_CAP`, so keeping the full-res original would only waste memory.
- The working buffer is rebuilt only when the image, fit, or pre-adjust changes — effect
  params just re-render.
- Sampling always reads the capped buffer, never the full-res image.
- Heavier passes (Dither, Risograph, Xerox, Print Stamp, Glitch, Pixel Sort) are debounced;
  pixel-based effects compute on the capped buffer and upscale with smoothing off for crisp output.
- Renders are coalesced through `requestAnimationFrame` — with a `setTimeout` fallback so a
  frame scheduled while the tab is unfocused (e.g. the file picker is open) can't wedge the
  pipeline. The display canvas long edge is capped at 2200 px (`EDGE_CAP`).

## Notes / scope

- **SVG export** covers **Halftone**, **ASCII**, **Dither**, and **Risograph** — the effects
  that are genuinely vector (dots → `<circle>`/`<rect>`/`<line>`, glyphs → `<text>`, dither
  cells → `<rect>`). CMYK / spot-colour overprints use `mix-blend-mode: multiply`, so they
  match the canvas in any viewer that honours it. The raster effects (Xerox, Print Stamp,
  Glitch, RGB Shift, Pixel Sort) and any stacked (A → B) chain fall back to PNG; the SVG
  button disables itself and explains when it can't help.
- Everything runs locally in the browser; no image ever leaves your machine.

## Privacy

Your images never leave your machine — all processing happens in the browser, and there is no
backend or upload. The site loads **[GoatCounter](https://www.goatcounter.com/)**, a lightweight,
cookieless analytics script that records only anonymous, aggregate page-view counts. No
personal data, no cross-site tracking, no fingerprinting — GDPR-friendly.

## License

**[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)** — free to use, share, and adapt,
including commercially. The one condition: **give credit** — _Halftone Tools_ by
**[Sefa Tolaman](https://www.sefatolaman.design)**, with a link back where reasonable.
