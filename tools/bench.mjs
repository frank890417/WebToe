#!/usr/bin/env node
/**
 * bench.mjs — reproducible runtime numbers for WebToe in a real browser.
 *
 *   npm run dev                         # (or any server for apps/web on :8643)
 *   node tools/bench.mjs [--url http://localhost:8643/] [--seconds 5] [--backend webgl2|webgpu]
 *
 * For each project it loads, warms up, then measures over a window:
 *   fps        display frames per second (requestAnimationFrame)
 *   cookHz     cook steps per second (the engine's fixed-rate clock)
 *   stepMs     fitted cost per cook step (CPU + the GPU time that lengthens frames)
 *   longestMs  longest frame in the window
 *   heapMB     JS heap growth over the window (allocation pressure)
 *   skipped    steps skipped by resyncs
 * One JSON line per project, so runs can be diffed and charted.
 * Modeled on the EOI engine's scene-shots / fps probes.
 */
import { chromium } from 'playwright-core';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('--url', 'http://localhost:8643/');
const SECONDS = Number(arg('--seconds', '5'));
const BACKEND = arg('--backend', 'webgl2');
const PROJECTS = [
  'examples/02-feedback-trails.webtoe.json',
  'examples/03-lfo-garden.webtoe.json',
  'examples/09-showcase.webtoe.json',
  'examples/10-3d-lines.webtoe.json',
  'examples/toe/2022-fractals.toe',
];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--disable-gpu-vsync', '--use-angle=metal', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

for (const project of PROJECTS) {
  const url = new URL(BASE);
  url.searchParams.set('project', project);
  url.searchParams.set('backend', BACKEND);
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__webtoe?.engine?.gpu, null, { timeout: 15000 });
  await page.waitForTimeout(1500); // warm-up: shader compiles, first imports
  const r = await page.evaluate(async (seconds) => {
    const e = window.__webtoe.engine;
    const orig = e.frame.bind(e);
    let frames = 0, steps = 0, longest = 0, last = performance.now();
    e.frame = (t) => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      frames++;
      const n = orig(t);
      steps += n;
      return n;
    };
    const heap0 = performance.memory?.usedJSHeapSize ?? 0;
    const skipped0 = e.skippedSteps;
    const t0 = performance.now();
    await new Promise((res) => setTimeout(res, seconds * 1000));
    const dt = (performance.now() - t0) / 1000;
    e.frame = orig;
    const heap1 = performance.memory?.usedJSHeapSize ?? 0;
    const errors = [...e.graph.byId.values()].filter((n) => n.error).length;
    return {
      fps: +(frames / dt).toFixed(1),
      cookHz: +(steps / dt).toFixed(1),
      stepMs: +(e.stepCost * 1000).toFixed(3),
      longestMs: +longest.toFixed(1),
      heapMB: +((heap1 - heap0) / 1048576).toFixed(2),
      skipped: e.skippedSteps - skipped0,
      nodes: e.graph.byId.size,
      nodeErrors: errors,
      cookRate: e.cookRate,
    };
  }, SECONDS);
  console.log(JSON.stringify({ project, backend: BACKEND, seconds: SECONDS, ...r }));
}
await browser.close();
