#!/usr/bin/env node
/**
 * Layout overlap test for card expand/collapse.
 * Serves the repo, opens debug.html in Chromium, expands cards in many
 * combinations, and fails if any card bounding boxes overlap.
 *
 * Usage:
 *   node scripts/test-layout.mjs
 *   npx --yes -p puppeteer-core node scripts/test-layout.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8765;
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 900, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];
const SLACK = 1; // px tolerance for subpixel rounding

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/debug.html";
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  try {
    return require("puppeteer-core");
  } catch {
    // Fall through to dynamic import from npx cache if present
  }
  try {
    const mod = await import("puppeteer-core");
    return mod.default || mod;
  } catch (e) {
    console.error("Install puppeteer-core first, e.g.:");
    console.error("  npm i -D puppeteer-core");
    console.error("  # or: npx -p puppeteer-core node scripts/test-layout.mjs");
    throw e;
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("No Chromium/Chrome binary found (set CHROME_PATH)");
}

async function measureLayout(page) {
  return page.evaluate(slack => {
    const cards = [...document.querySelectorAll("#list .card")];
    const boxes = cards.map(el => {
      const r = el.getBoundingClientRect();
      const col = el.closest(".col");
      const cols = [...document.querySelectorAll("#list > .col")];
      return {
        pk: el.dataset.pk,
        index: +el.dataset.index,
        expanded: el.classList.contains("expanded"),
        col: cols.indexOf(col),
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });

    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > slack && oy > slack) {
          overlaps.push({
            a: a.pk,
            b: b.pk,
            overlapX: +ox.toFixed(2),
            overlapY: +oy.toFixed(2),
            aExpanded: a.expanded,
            bExpanded: b.expanded,
          });
        }
      }
    }
    return { boxes, overlaps, colCount: document.querySelectorAll("#list > .col").length };
  }, SLACK);
}

async function setExpanded(page, indices) {
  await page.evaluate(async idxs => {
    const byIndex = i => document.querySelector(`#list .card[data-index="${i}"]`);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const all = [...document.querySelectorAll("#list .card")];

    for (const el of all) {
      if (el.classList.contains("expanded")) {
        el.click();
        await wait(220);
      }
    }
    for (const i of idxs) {
      const el = byIndex(i);
      if (!el) continue;
      if (!el.classList.contains("expanded")) {
        el.click();
        await wait(500);
      }
    }
    await wait(50);
  }, indices);
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.goto(`http://127.0.0.1:${PORT}/debug.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#list .card");
  // columns.js packs on load
  await page.waitForSelector("#list > .col");

  const n = await page.$$eval("#list .card", els => els.length);
  const scenarios = [
    { name: "none", indices: [] },
    ...Array.from({ length: n }, (_, i) => ({ name: `only-${i}`, indices: [i] })),
    { name: "all", indices: Array.from({ length: n }, (_, i) => i) },
    { name: "0-and-2", indices: [0, 2].filter(i => i < n) },
    { name: "1-and-3", indices: [1, 3].filter(i => i < n) },
  ];

  const results = [];

  // Baseline tops before any expand
  await setExpanded(page, []);
  const baseline = await measureLayout(page);

  for (const sc of scenarios) {
    await setExpanded(page, sc.indices);
    const { boxes, overlaps, colCount } = await measureLayout(page);

    // Cards in columns not affected by an open card must keep baseline top
    const openCols = new Set(
      boxes.filter(b => sc.indices.includes(b.index)).map(b => b.col)
    );
    const movedWrong = [];
    if (sc.indices.length) {
      for (const b of boxes) {
        if (openCols.has(b.col)) continue; // same column may shift
        const before = baseline.boxes.find(x => x.pk === b.pk);
        if (!before) continue;
        if (Math.abs(before.top - b.top) > SLACK) {
          movedWrong.push({ pk: b.pk, col: b.col, before: before.top, after: b.top });
        }
      }
    }

    results.push({
      scenario: sc.name,
      open: sc.indices,
      overlaps,
      movedWrong,
      cardCount: boxes.length,
      colCount,
      heights: boxes.map(b => Math.round(b.height)),
    });
  }

  await page.close();
  return results;
}

async function main() {
  const server = await startServer();
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  let failed = 0;
  const report = [];

  try {
    for (const vp of VIEWPORTS) {
      const results = await runViewport(browser, vp);
      for (const r of results) {
        const ok = r.overlaps.length === 0 && (!r.movedWrong || r.movedWrong.length === 0);
        if (!ok) failed++;
        report.push({ viewport: vp.name, ...r, ok });
        const mark = ok ? "PASS" : "FAIL";
        let detail = ok
          ? `cols=${r.colCount} heights=${r.heights.join(",")}`
          : "";
        if (r.overlaps?.length) {
          detail += r.overlaps.map(o => `overlap ${o.a}∩${o.b}`).join("; ");
        }
        if (r.movedWrong?.length) {
          detail += (detail ? "; " : "") + r.movedWrong.map(m => `moved pk=${m.pk} ${m.before}->${m.after}`).join("; ");
        }
        console.log(`[${mark}] ${vp.name}/${r.scenario} — ${detail}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const out = path.join(ROOT, "scripts", "layout-report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${pathToFileURL(out)}`);
  console.log(failed ? `\n${failed} scenario(s) overlapped` : "\nAll scenarios clear — no overlaps");
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
