#!/usr/bin/env node
// verify — open the built site the way a visitor does and record what happens.
//
//   npm run build && node tools/site/verify.mjs [outDir=site-shots]
//
// Serves apps/web/dist through the real local bridge (createBridgeServer, the
// server behind `npx webtoe`), then with headless Chrome (playwright-core):
//   · screenshots /, /zh/, /docs/, two docs pages and the editor running an
//     example, at 1440 and 390 px wide
//   · fails on console errors, page errors, failed requests and horizontal overflow
//   · checks the root shim: editor queries and framed visits forward to /app/,
//     tracking-only queries stay on the homepage
// Screenshots go to site-shots/ (gitignored).

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createBridgeServer } from '../../packages/bridge/index.mjs';
import { ROOT } from './build.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'site-shots'));
const DIST = path.join(ROOT, 'apps/web/dist');
if (!fs.existsSync(path.join(DIST, 'app/index.html'))) { console.error('run npm run build first'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const server = createBridgeServer({ appDist: DIST });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const PAGES = [
  ['home', '/'],
  ['home-zh', '/zh/'],
  ['docs', '/docs/'],
  ['docs-importing', '/docs/importing/'],
  ['docs-operators-zh', '/zh/docs/operators/'],
  ['app-3d-lines', '/app/?project=examples/10-3d-lines.webtoe.json'],
];
const WIDTHS = [[1440, 900], [390, 844]];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const problems = [];
const shots = [];

for (const [w, h] of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
  for (const [name, url] of PAGES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(BASE + url, { waitUntil: 'load' });
    const isApp = url.startsWith('/app/');
    if (isApp) {
      await page.waitForFunction(() => !!window.__webtoe, null, { timeout: 20000 });
      await page.waitForTimeout(800);
      // headless tabs pause requestAnimationFrame: drive frames by hand
      await page.evaluate(() => new Promise((res) => {
        let i = 0;
        const id = setInterval(() => { window.__webtoe.loop(); if (++i >= 120) { clearInterval(id); res(); } }, 16);
      }));
      const nodeErrors = await page.evaluate(() => [...window.__webtoe.engine.graph.byId.values()].filter((n) => n.error).map((n) => `${n.name}: ${n.error}`));
      if (nodeErrors.length) errs.push(...nodeErrors.map((e) => `node error ${e}`));
    } else {
      await page.evaluate(() => document.fonts.ready);
      // scroll through once so lazy images load, as they would for a reader
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
      });
      try {
        await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10000 });
      } catch { /* reported below */ }
      const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.currentSrc || i.src));
      for (const b of broken) errs.push(`image did not load: ${b}`);
      // full-page captures misplace sticky elements after scrolling; pin the bar for the picture only
      await page.addStyleTag({ content: '.top { position: relative !important; }' });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errs.push(`horizontal overflow: ${overflow}px`);
    const file = path.join(OUT, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: !isApp });
    shots.push(path.relative(ROOT, file));
    for (const e of errs) problems.push(`${name} @${w}: ${e}`);
    await page.close();
  }
  await ctx.close();
}

// the root shim
const shimCases = [
  ['/?project=examples/01-hello-noise.webtoe.json#x', '/app/?project=examples/01-hello-noise.webtoe.json#x'],
  ['/zh/?backend=webgpu', '/app/?backend=webgpu'],
  ['/?utm_source=x&fbclid=y', '/?utm_source=x&fbclid=y'],
  ['/#parity', '/#parity'],
];
const ctx = await browser.newContext();
for (const [from, want] of shimCases) {
  const page = await ctx.newPage();
  await page.goto(BASE + from, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const got = page.url().replace(BASE, '');
  if (got !== want) problems.push(`shim: ${from} → ${got}, want ${want}`);
  await page.close();
}
// framed: an iframe of the root lands on the editor
const host = await ctx.newPage();
await host.goto(BASE + '/docs/');
await host.evaluate((src) => new Promise((res) => {
  const f = document.createElement('iframe'); f.src = src; f.onload = () => res(); document.body.append(f);
}), BASE + '/?project=examples/01-hello-noise.webtoe.json');
await host.waitForTimeout(800);
const framedUrl = host.frames()[1]?.url().replace(BASE, '');
if (!framedUrl?.startsWith('/app/')) problems.push(`shim: framed root stayed at ${framedUrl}`);
await ctx.close();

await browser.close();
server.close();

console.log('screenshots:\n  ' + shots.join('\n  '));
if (problems.length) { console.error(`✗ ${problems.length} problem(s):\n  ` + problems.join('\n  ')); process.exit(1); }
console.log('✅ no console errors, no failed requests, no horizontal overflow; shim forwards as specified');
