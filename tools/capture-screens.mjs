#!/usr/bin/env node
/**
 * capture-screens.mjs — regenerate the README screenshots in docs/media/.
 * Uses playwright-core with the system Chrome (no browser download).
 *
 *   npm run dev          # in one shell (port 8643)
 *   node tools/capture-screens.mjs
 *
 * Headless tabs pause requestAnimationFrame, so frames are driven manually
 * through the `__webtoe` debug handle.
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
  await page.waitForFunction(() => !!window.__webtoe, null, { timeout: 20000 });
}

const drive = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__webtoe.loop(); }, n);

async function loadExample(optionIndex) {
  await page.evaluate((idx) => {
    const s = document.querySelector('.wt-bar select');
    s.value = s.options[idx].value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, optionIndex);
  await page.waitForTimeout(700);
  await drive(20);
}

async function shot(name) {
  await drive(25);            // settle thumbs (async readback needs a kick cycle)
  await page.waitForTimeout(250);
  // settle the fps meter with realtime-spaced frames (manual driving inflates it)
  await page.evaluate(() => new Promise((res) => {
    let i = 0;
    const id = setInterval(() => {
      window.__webtoe.loop();
      if (++i >= 160) { clearInterval(id); res(); }
    }, 16);
  }));
  await page.screenshot({ path: join(OUT, name) });
  console.log('wrote', name);
}

// 1) hero — lfo garden on webgl2
await boot(BASE);
await loadExample(3);
await drive(60);
await shot('hero-lfo-garden.png');

// 2) feedback trails with a mouse orbit
await loadExample(2);
await page.evaluate(() => {
  const v = document.querySelector('.wt-viewer');
  const r = v.getBoundingClientRect();
  for (let i = 0; i < 150; i++) {
    const a = (i / 50) * Math.PI * 2;
    v.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: r.left + r.width / 2 + Math.cos(a) * r.width * 0.3,
      clientY: r.top + r.height / 2 + Math.sin(a) * r.height * 0.3,
    }));
    window.__webtoe.loop();
  }
});
await shot('feedback-trails.png');

// 3) chop scope — select merge1 in the playground
await loadExample(5);
await drive(150);
await page.evaluate(() => {
  const m = [...document.querySelectorAll('.wt-node')].find(
    (n) => n.querySelector('.wt-label')?.textContent === 'merge1');
  m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
});
await drive(120);
await shot('chop-scope.png');

// 4) palette over the starter patch
await boot(BASE);
await drive(40);
await page.evaluate(() => {
  const net = document.querySelector('.wt-net');
  net.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 640, clientY: 430 }));
});
await page.waitForTimeout(200);
await shot('palette.png');

// 5) import report dialog — the real dialog with real measured numbers from a
//    213-node production import (see WORKLOG 2026-06-11)
await page.evaluate(() => {
  document.querySelector('.wt-palette')?.remove();
  window.__webtoe.showReport({
    nodesTotal: 213, nodesMapped: 71, nodesStubbed: 142,
    exprTranslated: 9, exprDisabled: 14,
    notes: [
      'stubbed op types: POP:merge×12, POP:circle×9, POP:primitive×9, POP:tube×9, TOP:switch×8, …',
      '7 cross-network or unresolved wires skipped (v1 limitation)',
    ],
  });
});
await shot('import-report.png');

// 6) webgpu backend
await boot(BASE + '?backend=webgpu');
await loadExample(3);
await drive(80);
await page.waitForTimeout(300);
await shot('webgpu.png');

await browser.close();
console.log('done →', OUT);
