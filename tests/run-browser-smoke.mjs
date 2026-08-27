import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const BROWSERS = { chromium, firefox, webkit };
const PAGES = [
  ["browser smoke", "/tests/browser-smoke.html"],
  ["app integration smoke", "/tests/app-integration-smoke.html"],
];
const MIME_TYPES = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function requestedBrowsers() {
  const argument = process.argv.find((value) => value.startsWith("--browser="));
  const value = argument?.slice("--browser=".length) || process.env.BROWSER;
  const names = (value || "chromium,firefox,webkit")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => !BROWSERS[name]);
  if (unknown.length) {
    throw new Error(`Unknown browser target: ${unknown.join(", ")}. Use chromium, firefox, or webkit.`);
  }
  return [...new Set(names)];
}

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

async function runPage(browserName, baseUrl, label, path) {
  const browser = BROWSERS[browserName];
  const instance = await browser.launch({ headless: true });
  const page = await instance.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => window.__smokeDone === true, undefined, { timeout: 120_000 });
    const result = await page.evaluate(() => ({
      details: window.__smokeDetails || document.querySelector("#details")?.textContent || "",
      failures: window.__smokeFailures || 0,
      title: document.title,
    }));
    if (result.failures || !result.title.startsWith("PASS")) {
      throw new Error(result.details || `Smoke page reported ${result.title}.`);
    }
    if (pageErrors.length || consoleErrors.length) {
      throw new Error([
        ...pageErrors.map((error) => `pageerror: ${error}`),
        ...consoleErrors.map((error) => `console.error: ${error}`),
      ].join("\n"));
    }
    console.log(`PASS ${browserName} — ${label}`);
  } finally {
    await page.close();
    await instance.close();
  }
}

async function main() {
  const targets = requestedBrowsers();
  const server = await startStaticServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const failures = [];

  try {
    for (const browserName of targets) {
      for (const [label, path] of PAGES) {
        try {
          await runPage(browserName, baseUrl, label, path);
        } catch (error) {
          failures.push(`${browserName} — ${label}: ${error.stack || error}`);
          console.error(`FAIL ${browserName} — ${label}\n${error.stack || error}`);
        }
      }
    }
  } finally {
    await new Promise((resolveServer) => server.close(resolveServer));
  }

  if (failures.length) {
    throw new Error(`${failures.length} browser smoke target${failures.length === 1 ? "" : "s"} failed.`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  if (/Executable doesn't exist|browserType\.launch/.test(error.message)) {
    console.error("Install the Playwright browsers with: npx playwright install chromium firefox webkit");
  }
  process.exitCode = 1;
});