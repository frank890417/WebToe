#!/usr/bin/env node
/**
 * capture-screens.mjs — regenerate the README screenshots in docs/media/.
 * Uses playwright-core with the system Chrome (no browser download).
 *
 *   npm run dev          # in one shell (port 8643)
 *   node tools/capture-screens.mjs
 *
 * Frames run on the real clock (new headless Chrome runs requestAnimationFrame),
 * so the HUD shows the true display fps and cook rate — no manual frame driving.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.WEBTOE_URL ?? 'http://localhost:8643/app/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'media');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });

async function boot(url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__webtoe?.engine?.gpu, null, { timeout: 20000 });
  await page.waitForTimeout(800);
}

async function loadExample(optionIndex) {
  await page.evaluate((idx) => {
    const s = document.querySelector('.wt-bar select');
    s.value = s.options[idx].value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, optionIndex);
  await page.waitForTimeout(1500);
}

async function shot(name) {
  await page.waitForTimeout(2500); // thumbnails, backdrop readback and the fps meter settle in real time
  await page.screenshot({ path: join(OUT, name) });
  console.log('wrote', name);
}

// 1) hero — lfo garden on webgl2
await boot(BASE);
await loadExample(3);
await shot('hero-lfo-garden.png');

// 2) feedback trails with a mouse orbit, in real time
await loadExample(2);
await page.evaluate(() => new Promise((res) => {
  const v = document.querySelector('.wt-viewer');
  const r = v.getBoundingClientRect();
  let i = 0;
  const id = setInterval(() => {
    const a = (i / 50) * Math.PI * 2;
    v.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: r.left + r.width / 2 + Math.cos(a) * r.width * 0.3,
      clientY: r.top + r.height / 2 + Math.sin(a) * r.height * 0.3,
    }));
    if (++i >= 150) { clearInterval(id); res(); }
  }, 16);
}));
await page.screenshot({ path: join(OUT, 'feedback-trails.png') });
console.log('wrote feedback-trails.png');

// 3) chop scope — select merge1 in the playground
await loadExample(5);
await page.evaluate(() => {
  const m = [...document.querySelectorAll('.wt-node')].find(
    (n) => n.querySelector('.wt-label')?.textContent === 'merge1');
  m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
});
await shot('chop-scope.png');

// 4) palette over the starter patch
await boot(BASE);
await page.evaluate(() => {
  const net = document.querySelector('.wt-net');
  net.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 640, clientY: 430 }));
});
await shot('palette.png');

// 5) import report — a real native decode of a raw TouchDesigner file (example 12,
//    saved by TD 2021.16410): the dialog the editor shows, nothing staged
await boot(BASE);
await loadExample(12);
await shot('import-report.png');

// 6) webgpu backend — the same lfo garden as the hero, on WebGPU
await boot(BASE + '?backend=webgpu');
await loadExample(3);
await shot('webgpu.png');

await browser.close();
console.log('done →', OUT);
