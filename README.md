# Halftone Tools

A free, browser-based **print-effects workshop** built with [p5.js](https://p5js.org/).

Load an image, run it through halftone screens, dithering, risograph separations, ASCII, glitch effects and more, all with live controls. You can stack two effects on top of each other and export to PNG, SVG, or colour-separated plates.

There's no backend, no framework, no build step. Just static files. Everything runs in your browser and your images never leave your machine.

![p5.js 1.11.x](https://img.shields.io/badge/p5.js-1.11.x-ff3d8b) ![No build step](https://img.shields.io/badge/build-none-181410)

## Effects

| #   | Effect          | What it does |
| --- | --------------- | ------------ |
| 00  | **None**        | Pass-through. Shows the source after pre-adjust with no screen applied. Selecting this in slot B clears the second effect. |
| 01  | **Halftone**    | Classic rotated dot screen where the dot radius maps to darkness. Supports circle, square, and line dots in a single mono ink or full CMYK separation with proper screen angles and multiply blending. |
| 02  | **Dither**      | Ordered dithering (2x2, 4x4, 8x8 Bayer) and Floyd-Steinberg error diffusion with optional serpentine scan. Multiple palettes (1-bit, duotone, 3/4-tone, C/M/Y), chunky pixel scaling, and a modulation field. |
| 03  | **ASCII**       | Converts the image to a grid of characters from an editable brightness ramp. Mono or source-coloured, rendered in a real monospace font. There's an optional selectable-text overlay so you can copy the output. |
| 04  | **Risograph**   | Simulates 2 or 3 spot-colour separations using luminance bands or RGB channels. Each layer gets its own halftone or grain screen, with misregistration offset, multiply compositing, and paper grain. |
| 05  | **Xerox**       | High-contrast photocopy look. Cranks up contrast, applies a soft blur, adds a noisy threshold, and sprinkles in toner dropouts and dust. |
| 06  | **Print Stamp** | Hard black-and-white threshold with Perlin noise rough edges and an ink-texture mask. Gives you that rubber-stamp or letterpress feel. |
| 07  | **Glitch**      | Static, seeded datamosh. Random-height band shifts, block smears, channel tears, and bit-crush corruption. Works horizontal or vertical. |
| 08  | **RGB Shift**   | Chromatic aberration in linear or radial (lens fringing) mode. Simple amount/angle control or advanced per-channel offsets with edge bias. |
| 09  | **Pixel Sort**  | Sorts pixel runs by brightness, hue, saturation, or individual R/G/B channels. Several interval modes: threshold (Asendorf-style), edge detection, seeded random, or full row/column. |
| 10  | **Gradient Map**| Maps luminance to a multi-stop colour ramp. Comes with presets for duotone, tritone, thermal, cyanotype, and viridis. Stops are fully editable, and there's an optional posterise control. |
| 11  | **Tone**        | Tone curves (composite plus individual R/G/B channels) and colour matrices for sepia, saturate, desaturate, and channel swap. |
| 12  | **Hue / Sat**   | Simple global hue rotation, saturation, and lightness adjustments. |

Effects 07 to 09 are the **glitch family**: they accept a **base layer** so you can glitch a halftone, pixel-sort a dither, and so on. Their randomness is seeded, so the same seed always gives you the same result. Hit **Randomize** to reroll.

Effects 10 to 12 are **colour modules**: you can use them as a main effect, or set them as the **Colour pre-stage** to recolour the source before the screen runs (e.g. gradient-map into a halftone).

## How to run it

It's a static site, so any file server works. From this folder:

```bash
# Node
npx serve .

# or Python 3
python3 -m http.server 8000
```

Then open the URL it prints (usually `http://localhost:8000`). Opening `index.html` directly via `file://` won't work because the app uses ES modules, which browsers only load over HTTP.

Tested on current Chrome, Firefox, and Safari.

## How to use it

1. **Load an image** (or try the **Demo plate**). You can also drag and drop onto the stage.
2. **Pre-adjust** brightness, contrast, gamma, and invert. Optionally pick a **Colour pre-stage** (Gradient Map, Tone, or Hue/Sat) that gets applied to the working buffer before the effect runs.
3. Pick **Effect A** from the filmstrip at the bottom and tweak its parameters. The preview updates live.
4. Want to **stack a second effect**? Click **B** in the filmstrip toggle, then pick any effect. B runs on A's rendered output. Picking **00 None** in slot B clears the stack.
5. **Export** (button or press `E`) opens the overlay. Every export is free, full-resolution:
   - **PNG** at 2x device resolution
   - **Colour separation ZIP** with one plate per ink (for Halftone CMYK, RGB Shift, and Risograph)
   - **SVG** with true vectors (for Halftone, ASCII, Dither, and Risograph). Not available for raster effects or while two effects are stacked.

**Keyboard shortcuts:** `R` randomize the active effect, `E` open Export, `Esc` close it.

## Architecture

```
index.html          markup + p5 CDN + Google Fonts + GoatCounter analytics
style.css           five-colour token system, no rounded corners, Swiss styling
src/
  main.js           p5 instance mode, app state, all wiring
  input.js          image loading, fitting, pre-adjust, working buffer + sampling helpers
  controls.js       auto-generates UI controls from each effect's param schema
  export.js         PNG (2x) + SVG + colour-separation ZIP export
  zip.js            minimal STORE-only ZIP writer for separation plates
  effects/
    index.js        effect registry (array of modules, in UI order)
    stack.js         rendering pipeline: pre-adjust → pre-stage → [base →] A → [B]
    _shared.js      colour/SVG helpers, re-exports the PRNG
    none.js halftone.js dither.js ascii.js riso.js xerox.js stamp.js
    glitch.js rgb-shift.js pixel-sort.js gradient-map.js tone.js hue-sat.js
  controls/
    curve-editor.js gradient-editor.js
  color/
    curve.js ramps.js
  util/
    prng.js          mulberry32 seeded PRNG
```

Every effect is a self-describing module with an `id`, `name`, `params` array (which drives the control panel automatically), and `render()` / optional `renderSVG()` methods. The pipeline in `stack.js` caches each stage by signature and only recomputes when inputs actually change.

## Privacy

Your images never leave your machine. There is no backend, no upload. The site loads [GoatCounter](https://www.goatcounter.com/), a lightweight, cookieless analytics script that only records anonymous page-view counts. No personal data, no cross-site tracking, no fingerprinting.

## Support

If you find Halftone Tools useful, consider [buying me a coffee](https://www.buymeacoffee.com/sefatolaman) ☕️

## License

**Personal Use Only.** See [LICENSE.md](LICENSE.md) for the full terms.

You're free to use and modify Halftone Tools for personal, non-commercial purposes. Commercial use and redistribution (of the original or modified versions) are not permitted. Credit is required: *Halftone Tools* by [Sefa Tolaman](https://www.sefatolaman.design).
