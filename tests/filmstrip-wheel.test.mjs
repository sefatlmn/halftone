import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
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

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const file = resolve(ROOT, relative);
      if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

test("effects strip scrolls horizontally on mousewheel at desktop breakpoint", async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });

    const films = await page.$("#films");
    assert(films, "#films element should exist");
    const box = await films.boundingBox();
    assert(box, "#films bounding box should exist");

    // Initial scrollLeft should be 0
    const initialScroll = await films.evaluate((el) => el.scrollLeft);
    assert.equal(initialScroll, 0);

    // Scrolling down moves strip right
    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    const scrollRight = await films.evaluate((el) => el.scrollLeft);
    assert.equal(scrollRight, 120, "Scrolling wheel down should scroll right");

    // Scrolling up moves strip left
    await page.mouse.wheel(0, -50);
    const scrollLeft = await films.evaluate((el) => el.scrollLeft);
    assert.equal(scrollLeft, 70, "Scrolling wheel up should scroll left");

    // Scrolling over .strip-head also scrolls the strip
    const head = await page.$(".strip-head");
    const headBox = await head.boundingBox();
    await page.mouse.move(headBox.x + 50, headBox.y + headBox.height / 2);
    await page.mouse.wheel(0, 60);
    const scrollFromHead = await films.evaluate((el) => el.scrollLeft);
    assert.equal(scrollFromHead, 130, "Scrolling wheel over .strip-head should scroll effects strip");

    // Clamping at zero
    await page.mouse.wheel(0, -500);
    const clampedZero = await films.evaluate((el) => el.scrollLeft);
    assert.equal(clampedZero, 0, "Scrolling past beginning should clamp at 0");

    // Clamping at maxScroll
    await page.mouse.wheel(0, 10000);
    const maxScroll = await films.evaluate((el) => el.scrollWidth - el.clientWidth);
    const clampedMax = await films.evaluate((el) => el.scrollLeft);
    assert.equal(clampedMax, maxScroll, "Scrolling past end should clamp at maxScroll");

    // ctrlKey / metaKey (zoom) is ignored
    await films.evaluate((el) => {
      el.scrollLeft = 50;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, cancelable: true, bubbles: true }));
    });
    const afterCtrl = await films.evaluate((el) => el.scrollLeft);
    assert.equal(afterCtrl, 50, "ctrlKey wheel should not scroll strip");

    // deltaX predominant (trackpad horizontal) is ignored by wheel handler
    await films.evaluate((el) => {
      el.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, deltaY: 10, cancelable: true, bubbles: true }));
    });
    const afterTrackpad = await films.evaluate((el) => el.scrollLeft);
    assert.equal(afterTrackpad, 50, "Horizontal trackpad scroll should not be modified by deltaY");

    // Non-cancelable wheel event does not double-scroll
    await films.evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 50, cancelable: false, bubbles: true }));
    });
    const afterNonCancelable = await films.evaluate((el) => el.scrollLeft);
    assert.equal(afterNonCancelable, 50, "Non-cancelable wheel event should scroll exactly 50px without duplicate bubbling");

    // deltaMode = 1 (lines) scales delta by 32
    await films.evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: 2, deltaMode: 1, cancelable: true, bubbles: true }));
    });
    const afterLineMode = await films.evaluate((el) => el.scrollLeft);
    assert.equal(afterLineMode, 64, "deltaMode 1 should scale delta by 32px per line");

    // Mobile breakpoint (<= 720px) does not scroll on wheel
    await page.setViewportSize({ width: 500, height: 800 });
    await films.evaluate((el) => { el.scrollLeft = 0; });
    await page.mouse.move(box.x + 100, box.y + 20);
    await page.mouse.wheel(0, 100);
    const mobileScroll = await films.evaluate((el) => el.scrollLeft);
    assert.equal(mobileScroll, 0, "Mobile breakpoint (<= 720px) should not scroll effects strip on wheel");

    await page.close();

    // Hybrid touchscreen laptop / tablet at desktop breakpoint scrolls properly
    const touchContext = await browser.newContext({ hasTouch: true });
    const touchPage = await touchContext.newPage();
    await touchPage.setViewportSize({ width: 1280, height: 800 });
    await touchPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    const touchFilms = await touchPage.$("#films");
    const touchBox = await touchFilms.boundingBox();
    await touchPage.mouse.move(touchBox.x + 100, touchBox.y + touchBox.height / 2);
    await touchPage.mouse.wheel(0, 120);
    const touchScroll = await touchFilms.evaluate((el) => el.scrollLeft);
    assert.equal(touchScroll, 120, "Hybrid touchscreen device at desktop breakpoint should scroll on wheel");
    await touchPage.close();
    await touchContext.close();
  } finally {
    await browser.close();
    server.close();
  }
});
