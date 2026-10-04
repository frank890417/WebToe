#!/usr/bin/env node
// make-shots — the site's screenshots, all real.
//
//   npm run build && node tools/site/make-shots.mjs      (npm run site:shots)
//
// 1. docs/media/<name>.png (2000×1250, the README screenshots captured by
//    tools/capture-screens.mjs) → cropped to 16:7 from the top (the network and
//    the viewer; the empty lower canvas goes).
// 2. Fresh captures of the built editor (apps/web/dist, served through the
//    local bridge) running examples the README has no picture of yet.
// Both → site/assets/shots/<name>-{1600,800}.webp, encoded by headless Chrome's
// canvas through playwright-core (no image tooling). Outputs are committed.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createBridgeServer } from '../../packages/bridge/index.mjs';
import { ROOT } from './build.mjs';
import { SHOTS } from './home/page.mjs';

const OUT = path.join(ROOT, 'site/assets/shots');
const RATIO = 7 / 16;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** Crop a PNG (buffer) at source offset y to 16:7 and write both widths. */
async function encode(name, png, y = 0) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>encode</title>');
  const outs = await page.evaluate(async ({ dataUrl, y, ratio }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const sw = img.naturalWidth, sh = Math.round(sw * ratio);
    return [1600, 800].map((w) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.round(w * ratio);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, Math.min(y, img.naturalHeight - sh), sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', 0.86);
    });
  }, { dataUrl: 'data:image/png;base64,' + png.toString('base64'), y, ratio: RATIO });
  await page.close();
  for (const [i, w] of [1600, 800].entries()) {
    const buf = Buffer.from(outs[i].split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, `${name}-${w}.webp`), buf);
    console.log(`wrote site/assets/shots/${name}-${w}.webp (${(buf.length / 1024).toFixed(0)} KB)`);
  }
}

// 1 · from docs/media
for (const s of SHOTS.filter((s) => s.media)) {
  await encode(s.name, fs.readFileSync(path.join(ROOT, 'docs/media', s.name + '.png')), s.y ?? 0);
}

// 2 · fresh captures from the built editor
const fresh = SHOTS.filter((s) => s.capture);
const DIST = path.join(ROOT, 'apps/web/dist');
if (fresh.length && !fs.existsSync(path.join(DIST, 'app/index.html'))) {
  console.warn('⚠ apps/web/dist/app is missing — run npm run build, then this again, for: ' + fresh.map((s) => s.name).join(', '));
} else if (fresh.length) {
  const server = createBridgeServer({ appDist: DIST });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}/app/`;
  // the same viewport and scale as tools/capture-screens.mjs, so all shots match
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
  for (const s of fresh) {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__webtoe, null, { timeout: 20000 });
    await page.evaluate(([file, name]) => window.__webtoe.loadUrl(`examples/${file}`, name), s.capture);
    // editor shortcuts, typed into the network (e.g. 'd' toggles the output backdrop)
    for (const key of s.keys ?? []) { await page.focus('.wt-net'); await page.keyboard.press(key); }
    if (s.pointer) {
      // hold the mouse over the viewer (examples 08/09 read it through mouse in)
      await page.evaluate(([fx, fy]) => {
        const v = document.querySelector('.wt-viewer');
        setInterval(() => {
          const r = v.getBoundingClientRect();
          v.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }));
        }, 50);
      }, s.pointer);
    }
    // current headless Chrome runs requestAnimationFrame: let the patch play in
    // real time, so the HUD's fps reads what the machine actually does
    await page.waitForTimeout(s.wait ?? 3000);
    await encode(s.name, await page.screenshot(), s.y ?? 0);
  }
  server.close();
}
await browser.close();
