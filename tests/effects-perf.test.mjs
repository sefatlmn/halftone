import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const MIME_TYPES = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const file = resolve(ROOT, relative);
      if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.code === "ENOENT" ? "Not found" : "Server error");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

test("All 15 effects render valid pixels across modes, edge cases, stacking, and animated playback", async () => {
  const server = await startStaticServer();
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.stack || String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__hp?.p), null, { timeout: 15_000 });
    await page.click("#btn-demo");
    await page.waitForFunction(() => Boolean(window.__hp?.srcImage), null, { timeout: 15_000 });

    const report = await page.evaluate(async () => {
      const EFFECTS = (await import("./src/effects/index.js")).default;
      const { defaultsOf } = await import("./src/controls.js");
      const { createEffectStack } = await import("./src/effects/stack.js");
      const hp = window.__hp;
      const p = hp.p;

      function sampleCanvasStats(gOrCanvas) {
        const c = gOrCanvas.canvas || gOrCanvas;
        const ctx = c.getContext("2d");
        const { width, height } = c;
        const data = ctx.getImageData(0, 0, width, height).data;
        let nonZeroAlpha = 0;
        let minLuma = 255;
        let maxLuma = 0;
        const step = 16;
        for (let i = 0; i < data.length; i += step) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a > 0) nonZeroAlpha++;
          const y = (r * 77 + g * 150 + b * 29) >> 8;
          if (y < minLuma) minLuma = y;
          if (y > maxLuma) maxLuma = y;
        }
        return { nonZeroAlpha, minLuma, maxLuma, spread: maxLuma - minLuma };
      }

      // 1. Test all 15 effects + real schema variants on the live app stack
      const effectTimings = {};
      const customVariants = {
        halftone: [
          { cmyk: false, shape: "circle" },
          { cmyk: false, shape: "square" },
          { cmyk: true, shape: "star" },
          { cmyk: true, shape: "line", invert: true },
        ],
        dither: [
          { mode: "floyd-steinberg", palette: "bw", modulation: 0, serpentine: true },
          { mode: "floyd-steinberg", palette: "cmyk", modulation: 0, serpentine: false },
          { mode: "ordered", matrixSize: "2", palette: "duotone", modulation: 0.25 },
          { mode: "ordered", matrixSize: "4", palette: "3-tone", modulation: 0.15 },
          { mode: "ordered", matrixSize: "8", palette: "4-tone", modulation: 0 },
        ],
        ascii: [
          { colorMode: "mono", showText: false },
          { colorMode: "source", showText: true },
          { colorMode: "mono", invert: true, showText: false },
        ],
        riso: [
          { layers: "2", split: "luminance", screen: "dots", misreg: 6 },
          { layers: "3", split: "rgb", screen: "grain", misreg: 0 },
        ],
        xerox: [
          { threshold: 0.5, contrast: 0.65, grain: 1.5, noise: 0.3, tonerDensity: 0.85 },
          { threshold: 0.4, contrast: 0.2, grain: 1, noise: 0, tonerDensity: 1 },
        ],
        analog: [
          {},
          { mask: "slot", blur: 0.8, bloom: 0.6 },
          { mask: "none", scanlines: 1, signal: 1 },
          { lines: 40 },
          { lines: 450, maskStrength: 1 },
        ],
        glitch: [
          { blocks: 18, maxShift: 20, channelTear: 0.4, smear: 0.25, intensity: 0.6, direction: "horizontal" },
          { blocks: 10, maxShift: 15, channelTear: 0.2, smear: 0.2, intensity: 0.5, direction: "vertical" },
          { blocks: 8, maxShift: 0, channelTear: 0, smear: 0, intensity: 0, direction: "horizontal" },
        ],
        "rgb-shift": [
          { mode: "linear", amount: 16, angle: 15, edgeBias: 0 },
          { mode: "linear", amount: 16, angle: 15, edgeBias: 0.5 },
          { mode: "radial", radialStrength: 30, edgeBias: 0 },
          { mode: "radial", radialStrength: 30, edgeBias: 0.5 },
        ],
        "pixel-sort": [
          { direction: "horizontal", sortKey: "brightness", intervalMode: "threshold", order: "ascending" },
          { direction: "vertical", sortKey: "hue", intervalMode: "edge", order: "descending" },
          { direction: "horizontal", sortKey: "saturation", intervalMode: "random", order: "ascending" },
          { direction: "vertical", sortKey: "brightness", intervalMode: "full", order: "descending" },
        ],
        "gradient-map": [
          { steps: 0, mix: 1 },
          { steps: 5, mix: 0.75 },
        ],
        tone: [
          { gamma: 1.1, inBlack: 10, inWhite: 240 },
          { outBlack: 20, outWhite: 230 },
        ],
        "hue-sat": [
          { hueShift: 0, saturation: 0, lightness: 0 },
          { hueShift: 90, saturation: 40, lightness: -15 },
        ],
        emboss: [
          { mode: "grey", angle: 135, depth: 2, distance: 1, blend: 0 },
          { mode: "tint", angle: 45, depth: 3, distance: 2, blend: 0.35 },
          { mode: "colour", angle: 90, depth: 2.5, distance: 1, blend: 0.2 },
        ],
        tiles: [
          { cols: 8, rows: 8, maxSpan: 3, merge: 0.6, shuffle: 0.35, rotate: "none" },
          { cols: 6, rows: 6, maxSpan: 2, merge: 0.5, shuffle: 0.5, rotate: "90°" },
          { cols: 6, rows: 6, maxSpan: 2, merge: 0.5, shuffle: 0.5, rotate: "180°" },
        ],
      };

      const targetG = p.createGraphics(hp.canvasW, hp.canvasH);
      targetG.pixelDensity(1);
      const liveCap = Math.min(960, Math.max(480, Math.max(hp.canvasW, hp.canvasH)));

      for (const eff of EFFECTS) {
        const baseParams = defaultsOf(eff.params);
        const paramKeys = new Set(eff.params.map((param) => param.key));
        const variants = customVariants[eff.id] || [{}];
        for (const v of variants) {
          for (const k of Object.keys(v)) {
            if (!paramKeys.has(k)) {
              throw new Error(`Invalid test variant param "${k}" for effect "${eff.id}"`);
            }
          }
          const params = Object.assign({}, baseParams, v);
          hp.mediaVersion += 1;
          const bundle = {
            pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
            sourceVersion: hp.mediaVersion,
            preStage: "none",
            preStageParams: {},
            effect: eff.id,
            effectParams: params,
            effect2: "none",
            effect2Params: {},
            samplingCap: liveCap,
          };
          hp.stack.renderInto(targetG, hp.srcImage, bundle, hp.canvasW, hp.canvasH);
          const stats = sampleCanvasStats(targetG);
          if (stats.nonZeroAlpha === 0 || stats.spread === 0) {
            throw new Error(`Effect ${eff.id} rendered blank/uniform canvas for variant ${JSON.stringify(v)}`);
          }
          if (eff.id === "ascii") {
            if (params.showText && (!eff.lastText || eff.lastText.length < 10)) {
              throw new Error("ASCII showText=true did not populate eff.lastText");
            }
            if (!params.showText && eff.lastText !== "") {
              throw new Error("ASCII showText=false should not build eff.lastText string");
            }
          }
        }

        // Verify ASCII top-row vertical alignment (no duplicate yAscent shift)
        if (eff.id === "ascii") {
          const asciiParams = Object.assign({}, baseParams, {
            cell: 16,
            colorMode: "mono",
            ink: "#000000",
            paper: "#ffffff",
            ramp: "M",
          });
          hp.mediaVersion += 1;
          hp.stack.renderInto(
            targetG,
            hp.srcImage,
            {
              pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
              sourceVersion: hp.mediaVersion,
              preStage: "none",
              preStageParams: {},
              effect: "ascii",
              effectParams: asciiParams,
              effect2: "none",
              effect2Params: {},
              samplingCap: liveCap,
            },
            hp.canvasW,
            hp.canvasH,
          );
          const d = targetG.drawingContext.getImageData(0, 0, hp.canvasW, 32).data;
          let firstInkY = -1;
          outer: for (let y = 0; y < 32; y++) {
            for (let x = 0; x < hp.canvasW; x++) {
              if (d[(y * hp.canvasW + x) * 4] < 200) {
                firstInkY = y;
                break outer;
              }
            }
          }
          if (firstInkY < 0 || firstInkY >= 12) {
            throw new Error(`ASCII top row shifted down unexpectedly: firstInkY=${firstInkY}`);
          }
        }

        // Measure warm animated playback frame time (3 frames with incrementing sourceVersion)
        let warmTotal = 0;
        for (let f = 0; f < 3; f++) {
          hp.mediaVersion += 1;
          const t0 = performance.now();
          hp.stack.renderInto(
            targetG,
            hp.srcImage,
            {
              pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
              sourceVersion: hp.mediaVersion,
              preStage: "none",
              preStageParams: {},
              effect: eff.id,
              effectParams: baseParams,
              effect2: "none",
              effect2Params: {},
              samplingCap: liveCap,
            },
            hp.canvasW,
            hp.canvasH,
          );
          warmTotal += performance.now() - t0;
        }
        effectTimings[eff.id] = Number((warmTotal / 3).toFixed(2));

        // Verify separations (including drawing each plate!) and SVG if supported
        const src = hp.stack.sourceFor(
          hp.srcImage,
          {
            pre: { brightness: 0, contrast: 0, gamma: 1, invert: false },
            sourceVersion: hp.mediaVersion,
            preStage: "none",
            preStageParams: {},
            effect: eff.id,
            effectParams: baseParams,
            effect2: "none",
            effect2Params: {},
          },
          hp.canvasW,
          hp.canvasH,
        );
        if (typeof eff.separations === "function") {
          const plates = eff.separations(src, baseParams, { p, w: hp.canvasW, h: hp.canvasH, slot: "test-sep" });
          if (!Array.isArray(plates) || plates.length === 0) {
            throw new Error(`Effect ${eff.id} separations returned empty plates`);
          }
          for (const plate of plates) {
            targetG.clear();
            plate.draw(targetG);
            const pStats = sampleCanvasStats(targetG);
            if (pStats.nonZeroAlpha === 0 || pStats.spread === 0) {
              throw new Error(`Effect ${eff.id} separation plate "${plate.name}" rendered blank/uniform`);
            }
          }
        }
        if (typeof eff.renderSVG === "function") {
          const svg = eff.renderSVG(src, baseParams, { w: hp.canvasW, h: hp.canvasH, p });
          if (
            typeof svg !== "string" ||
            !svg.includes("<svg") ||
            svg.includes("undefined") ||
            svg.includes("NaN")
          ) {
            throw new Error(`Effect ${eff.id} renderSVG returned invalid SVG`);
          }
        }
      }

      // 2. Test edge-case tiny dimensions (1x1 and 3x2) across all 15 effects
      const tinyStack = createEffectStack(p);
      const tinySrc = p.createGraphics(2, 2);
      tinySrc.pixelDensity(1);
      tinySrc.background(128, 64, 200);
      const tinyOut = p.createGraphics(1, 1);
      tinyOut.pixelDensity(1);
      for (const eff of EFFECTS) {
        const params = defaultsOf(eff.params);
        tinyStack.renderInto(
          tinyOut,
          tinySrc,
          {
            pre: { brightness: 10, contrast: 15, gamma: 1.2, grain: 0.3, invert: true },
            sourceVersion: 1,
            preStage: "tone",
            preStageParams: defaultsOf(EFFECTS.find((e) => e.id === "tone").params),
            effect: eff.id,
            effectParams: params,
            effect2: "none",
            effect2Params: {},
          },
          1,
          1,
        );
      }
      tinyStack.dispose();
      tinySrc.remove();
      tinyOut.remove();

      // 3. Test stacked chain (A + B) + pre-adjust + color pre-stage
      hp.mediaVersion += 1;
      hp.stack.renderInto(
        targetG,
        hp.srcImage,
        {
          pre: { brightness: 10, contrast: 20, gamma: 1.1, invert: false },
          sourceVersion: hp.mediaVersion,
          preStage: "gradient-map",
          preStageParams: defaultsOf(EFFECTS.find((e) => e.id === "gradient-map").params),
          effect: "halftone",
          effectParams: defaultsOf(EFFECTS.find((e) => e.id === "halftone").params),
          effect2: "xerox",
          effect2Params: defaultsOf(EFFECTS.find((e) => e.id === "xerox").params),
        },
        hp.canvasW,
        hp.canvasH,
      );
      const stackedStats = sampleCanvasStats(targetG);

      // 4. Test mid-flight encodeGif abort while a frame is in flight to the worker
      const { encodeGif } = await import("./src/animated-export.js");
      const abortCtrl = new AbortController();
      async function* abortingFrames() {
        yield {
          rgba: new Uint8Array(16 * 16 * 4),
          delay: 50,
          progress: 0.5,
        };
        // Abort while frame 0 is in flight / before frame 1 finishes
        abortCtrl.abort();
        yield {
          rgba: new Uint8Array(16 * 16 * 4),
          delay: 50,
          progress: 1.0,
        };
      }
      let abortCaught = false;
      try {
        await encodeGif({
          width: 16,
          height: 16,
          frames: abortingFrames(),
          signal: abortCtrl.signal,
        });
      } catch (err) {
        if (err?.name === "AbortError") abortCaught = true;
        else throw err;
      }
      if (!abortCaught) {
        throw new Error("encodeGif did not reject with AbortError on mid-flight abort");
      }

      // 5. Verify playing vs paused animated media renders identical pixel output
      // on pixel-space effects (rgb-shift, emboss, glitch, pixel-sort)
      const prevMediaSource = hp.mediaSource;
      const prevMediaPlaying = hp.mediaPlaying;
      const prevActiveId = hp.activeId;
      try {
        hp.mediaSource = { kind: "video", duration: 2, currentTime: 0.5, fps: 15 };
        for (const fxId of ["rgb-shift", "emboss", "glitch", "pixel-sort"]) {
          hp.activeId = fxId;
          hp.mediaPlaying = true;
          p.redraw();
          const playPixels = new Uint8Array(
            p.drawingContext.getImageData(0, 0, hp.canvasW, hp.canvasH).data,
          );
          hp.mediaPlaying = false;
          p.redraw();
          const pausePixels = new Uint8Array(
            p.drawingContext.getImageData(0, 0, hp.canvasW, hp.canvasH).data,
          );
          for (let i = 0; i < playPixels.length; i++) {
            if (playPixels[i] !== pausePixels[i]) {
              throw new Error(
                `Effect ${fxId} changed pixel output between playing and paused at byte ${i} (${playPixels[i]} vs ${pausePixels[i]})`,
              );
            }
          }
        }
      } finally {
        hp.mediaSource = prevMediaSource;
        hp.mediaPlaying = prevMediaPlaying;
        hp.activeId = prevActiveId;
      }

      targetG.remove();

      return { effectTimings, stackedSpread: stackedStats.spread };
    });

    assert.equal(errors.length, 0, `Unexpected browser errors: ${errors.join("\n")}`);
    assert.ok(report.stackedSpread > 0, "Stacked effect chain produced uniform/blank output");
    // 50 ms locally; CI sets EFFECT_BUDGET_MS higher because shared runners are slower
    const budget = Number(process.env.EFFECT_BUDGET_MS) || 50;
    console.log(`warm frame ms (budget ${budget}):`, JSON.stringify(report.effectTimings));
    for (const [id, ms] of Object.entries(report.effectTimings)) {
      assert.ok(Number.isFinite(ms) && ms >= 0, `Invalid timing for ${id}: ${ms}`);
      assert.ok(ms < budget, `Effect ${id} warm frame took too long (${ms}ms)`);
    }
  } finally {
    await page.close();
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});

test("pre-adjust curves keep their endpoints, grain is deterministic, unshuffled tiles are exact, and analog keeps brightness", async () => {
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

  const errors = [];
  page.on("pageerror", (err) => errors.push(err.stack || String(err)));

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__hp?.p), null, { timeout: 15_000 });
    await page.click("#btn-demo");
    await page.waitForFunction(() => Boolean(window.__hp?.srcImage), null, { timeout: 15_000 });

    const report = await page.evaluate(async () => {
      const { buildWorking } = await import("./src/input.js");
      const { createEffectStack } = await import("./src/effects/stack.js");
      const EFFECTS = (await import("./src/effects/index.js")).default;
      const { defaultsOf } = await import("./src/controls.js");
      const hp = window.__hp;
      const p = hp.p;

      // 256x16 horizontal ramp: working pixel x has value x, so the buffer reads back as the LUT
      const ramp = p.createGraphics(256, 16);
      ramp.pixelDensity(1);
      ramp.noStroke();
      for (let x = 0; x < 256; x++) { ramp.fill(x); ramp.rect(x, 0, 1, 16); }
      const rampRow = (pre) => {
        const g = buildWorking(p, ramp, 128, 8, "contain", pre, null, 1600);
        g.loadPixels();
        const row = [];
        for (let x = 0; x < 256; x++) row.push(g.pixels[(8 * g.width + x) * 4]);
        g.remove();
        return row;
      };
      const curves = {};
      for (const [name, pre] of [
        ["bright-100", { brightness: -100 }], ["bright+100", { brightness: 100 }],
        ["contrast-100", { contrast: -100 }], ["contrast+100", { contrast: 100 }],
      ]) {
        const row = rampRow(pre);
        let monotonic = true;
        for (let i = 1; i < 256; i++) if (row[i] < row[i - 1]) monotonic = false;
        curves[name] = { first: row[0], last: row[255], levels: new Set(row).size, monotonic };
      }
      const identity = rampRow({}).every((v, x) => v === x);

      const grainA = rampRow({ grain: 0.5 }), grainB = rampRow({ grain: 0.5 });
      const grainDeterministic = grainA.every((v, i) => v === grainB[i]);
      const grainChanges = grainA.some((v, x) => v !== x);

      // tiles with shuffle 0 and no rotation must reproduce the 'none' pass-through exactly
      const stack = createEffectStack(p);
      const out = p.createGraphics(hp.canvasW, hp.canvasH);
      out.pixelDensity(1);
      const bundle = (effect, effectParams) => ({
        pre: {}, sourceVersion: 1, preStage: "none", preStageParams: {},
        effect, effectParams, effect2: "none", effect2Params: {},
      });
      const snap = () => out.canvas.getContext("2d").getImageData(0, 0, out.canvas.width, out.canvas.height).data;
      stack.renderInto(out, hp.srcImage, bundle("none", {}), hp.canvasW, hp.canvasH);
      const base = Uint8ClampedArray.from(snap());
      stack.renderInto(out, hp.srcImage, bundle("tiles", { cols: 8, rows: 8, maxSpan: 3, merge: 0.6, shuffle: 0, rotate: "none" }), hp.canvasW, hp.canvasH);
      const tiled = snap();
      let tileDiff = 0;
      for (let i = 0; i < base.length; i++) if (base[i] !== tiled[i]) tileDiff++;

      // analog keeps overall brightness: its mask, beams and halation are energy-neutral
      const meanLuma = (d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return s / (d.length / 4); };
      const baseMean = meanLuma(base);
      const analogDefaults = defaultsOf(EFFECTS.find((e) => e.id === "analog").params);
      stack.renderInto(out, hp.srcImage, bundle("analog", analogDefaults), hp.canvasW, hp.canvasH);
      const analogDefaultDelta = meanLuma(snap()) / baseMean - 1;
      stack.renderInto(out, hp.srcImage, bundle("analog", { ...analogDefaults, maskStrength: 0, scanlines: 0, bloom: 0, signal: 0, blur: 0 }), hp.canvasW, hp.canvasH);
      const analogOffDelta = meanLuma(snap()) / baseMean - 1;

      // SVG export stops at the shape budget instead of building a huge string
      const { SVG_TOO_LARGE } = await import("./src/effects/_shared.js");
      const dither = EFFECTS.find((e) => e.id === "dither");
      const fine = { ...defaultsOf(dither.params), pixelScale: 0.5 };
      const dSrc = stack.sourceFor(hp.srcImage, bundle("dither", fine), hp.canvasW, hp.canvasH);
      const svgHuge = dither.renderSVG(dSrc, fine, { w: 2000, h: 2500, p });
      const svgNormal = dither.renderSVG(dSrc, defaultsOf(dither.params), { w: hp.canvasW, h: hp.canvasH, p });
      const svgGuard = svgHuge === SVG_TOO_LARGE && typeof svgNormal === "string" && svgNormal.includes("<svg");

      out.remove();
      ramp.remove();
      stack.dispose();
      return { curves, identity, grainDeterministic, grainChanges, tileDiff, analogDefaultDelta, analogOffDelta, svgGuard };
    });

    assert.equal(errors.length, 0, `Unexpected browser errors: ${errors.join("\n")}`);
    assert.ok(report.identity, "Pre-adjust at defaults must leave the source untouched");
    for (const [name, c] of Object.entries(report.curves)) {
      assert.ok(c.monotonic, `${name}: curve must be monotonic`);
      // negative contrast compresses the range by design (gain 0.25 leaves ~64 levels)
      if (name !== "contrast-100") assert.ok(c.levels >= 150, `${name}: only ${c.levels} distinct levels (banding)`);
    }
    assert.equal(report.curves["bright-100"].first, 0, "Brightness keeps black pinned");
    assert.equal(report.curves["bright+100"].last, 255, "Brightness keeps white pinned");
    assert.ok(report.curves["bright-100"].levels >= 200 && report.curves["bright+100"].levels >= 200, "Brightness extremes must not crush the tails");
    assert.ok(report.grainDeterministic, "Grain must be identical across rebuilds");
    assert.ok(report.grainChanges, "Grain above 0 must change pixels");
    assert.equal(report.tileDiff, 0, "Unshuffled tiles must reproduce the source exactly");
    assert.ok(Math.abs(report.analogDefaultDelta) <= 0.06, `Analog defaults shift mean luminance by ${(report.analogDefaultDelta * 100).toFixed(1)}%`);
    assert.ok(report.svgGuard, "SVG export must stop at the shape budget and still export normal settings");
    assert.ok(Math.abs(report.analogOffDelta) <= 0.03, `Analog with every stage off shifts mean luminance by ${(report.analogOffDelta * 100).toFixed(1)}%`);
  } finally {
    await page.close();
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
