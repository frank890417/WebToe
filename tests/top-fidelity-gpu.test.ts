/**
 * GPU-vs-reference pixel checks for the TD-faithful TOPs: renders tiny graphs
 * in a real browser (WebGL2, system Chrome via playwright-core) and compares
 * the 8-bit readback with the CPU references. Skipped unless a running dev
 * server is given:
 *
 *   npm run dev            # or: npx vite --port 8653 apps/web
 *   WEBTOE_GPU_URL=http://localhost:8643/ npx vitest run tests/top-fidelity-gpu.test.ts
 *
 * Tolerances account for 8-bit render targets (±0.5/255 per write), GPU
 * float32 vs double references, and the 8-bit bilinear weights of GPU
 * texture filtering (the same effect measured on TD's side).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { COMP_OPS, noiseCoord, noiseSeedOffset, noiseXform, rampKeys, type CompOp } from '../packages/ops/src/top/tdmath';
import { blurRef, compRef, edgeRef, levelRef, noiseGpuRef, rampCoord, rampRef, type LevelParams } from './top-fidelity-ref';

const URL = process.env.WEBTOE_GPU_URL ?? '';
const run = URL ? describe : describe.skip;

type Img = { w: number; h: number; px: number[] };
interface NodeDef { name: string; type: string; params?: Record<string, unknown>; inputs?: string[] }

let browser: Browser | null = null;
let page: Page | null = null;

/** Build the nodes in the live editor's engine, cook `outputs`, read them back (row 0 = bottom). */
async function render(nodes: NodeDef[], outputs: string[]): Promise<Record<string, Img>> {
  return page!.evaluate(({ nodes, outputs }) => {
    const ed = (window as unknown as { __webtoe: { engine: any } }).__webtoe;
    const eng = ed.engine, g = eng.graph;
    const tag = `t${Math.random().toString(36).slice(2, 8)}_`;
    const made: Record<string, any> = {};
    for (const n of nodes) {
      const node = g.create(n.type, g.root, tag + n.name);
      for (const [k, v] of Object.entries(n.params ?? {})) node.params.set(k, { mode: 'const', value: v });
      made[n.name] = node;
    }
    for (const n of nodes) (n.inputs ?? []).forEach((src, i) => g.connect(made[src], made[n.name], i));
    eng.time = { ...eng.time, frame: eng.time.frame + 1000, seconds: 0 };
    const out: Record<string, { w: number; h: number; px: number[] }> = {};
    for (const name of outputs) {
      const o = eng.cook(made[name]);
      if (!o || o.kind !== 'top') throw new Error(`${name}: ${made[name].error ?? 'no output'}`);
      out[name] = { w: o.tex.width, h: o.tex.height, px: Array.from(eng.gpu.readPixels(o.tex, o.tex.width, o.tex.height) as Uint8ClampedArray) };
    }
    for (const node of Object.values(made)) { eng.gpu.releaseNode(node); g.delete(node); }
    return out;
  }, { nodes, outputs });
}

const toF = (img: Img) => Float64Array.from(img.px, (v) => v / 255);
const res = (w: number, h: number) => ({ resmode: 'custom', resw: w, resh: h });

function stats(errs: number[]) {
  const s = [...errs].sort((a, b) => a - b);
  return { max: s[s.length - 1], p99: s[Math.floor(0.99 * (s.length - 1))], mean: errs.reduce((a, b) => a + b, 0) / errs.length };
}

run('TOP shaders vs CPU references on the GPU (WebGL2)', () => {
  beforeAll(async () => {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as { __webtoe?: unknown }).__webtoe, null, { timeout: 20000 });
  }, 30000);
  afterAll(async () => { await browser?.close(); });

  it('Noise: six GPU types, non-square, seed 1 per channel, transform page', async () => {
    const W = 192, H = 96;
    const cases: { type: string; p: Record<string, number> }[] = [
      ...['perlin2d', 'perlin3d', 'perlin4d', 'simplex2d', 'simplex3d', 'simplex4d'].map((type) => ({ type, p: {} })),
      { type: 'perlin3d', p: { period: 0.5, tx: 0.3, rz: 30, harmonics: 1, amp: 0.8, exponent: 2, offset: 0.2 } },
      { type: 'simplex4d', p: { t4d: 0.7, spread: 2.5, gain: 0.5 } },
    ];
    const nodes = cases.map((c, i) => ({ name: `n${i}`, type: 'top:noise', params: { ...res(W, H), type: c.type, mono: false, speed: 0, ...c.p } }));
    const out = await render(nodes, nodes.map((n) => n.name));
    const bad: string[] = [];
    cases.forEach((c, i) => {
      const p = { harmonics: 2, period: 1, amp: 0.5, offset: 0.5, exponent: 1, spread: 2, gain: 0.7, t4d: 0, ...c.p };
      const M = noiseXform(p as Record<string, number>, p.period), ps = noiseCoord(W, H), img = out[`n${i}`], errs: number[] = [];
      for (let ch = 0; ch < 3; ch++) {
        const seed = noiseSeedOffset(1, ch);
        for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
          const ref = noiseGpuRef(c.type, (x + 0.5) / W, (y + 0.5) / H, M, ps, seed, p.t4d, { harmon: p.harmonics, spread: p.spread, gain: p.gain, exp: p.exponent, amp: p.amp, offset: p.offset });
          errs.push(Math.abs(Math.min(1, Math.max(0, ref)) - img.px[(y * W + x) * 4 + ch] / 255));
        }
      }
      const s = stats(errs);
      if (s.p99 > 2.5 / 255 || s.max > 0.06) bad.push(`${c.type} ${JSON.stringify(c.p)}: p99 ${s.p99.toFixed(4)} max ${s.max.toFixed(4)}`);
    });
    expect(bad).toEqual([]);
  }, 60000);

  it('Ramp: keys wrap, phase/period, extend, radial/circular', async () => {
    const W = 128, H = 64;
    const A = [0.9, 0.2, 0.1, 1], B = [0.1, 0.3, 1, 1];
    const cases = [
      { type: 'horizontal', phase: 0.25, period: 0.5, extendleft: 'mirror' },
      { type: 'vertical', phase: -0.2, period: 1.5, extendleft: 'hold' },
      { type: 'radial', phase: 0.1, period: 1, extendleft: 'repeat' },
      { type: 'circular', phase: 0, period: 0.7, extendleft: 'zero', positionx: 0.1 },
    ];
    const nodes = cases.map((c, i) => ({ name: `r${i}`, type: 'top:ramp', params: { ...res(W, H), colora: A, colorb: B, ...c } }));
    const out = await render(nodes, nodes.map((n) => n.name));
    const keys = rampKeys([[0, ...A], [1, ...B]]), bad: string[] = [];
    cases.forEach((c, i) => {
      const errs: number[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = rampCoord(c.type, (x + 0.5) / W, (y + 0.5) / H, { phase: c.phase, period: c.period, aspect: [1, H / W], position: [c.positionx ?? 0, 0] });
        const col = rampRef(t, keys, { extendleft: c.extendleft }), pm = [col[0] * col[3], col[1] * col[3], col[2] * col[3], col[3]];
        for (let k = 0; k < 4; k++) errs.push(Math.abs(pm[k] - out[`r${i}`].px[(y * W + x) * 4 + k] / 255));
      }
      const s = stats(errs);   // seams (repeat wrap, radial 0/360°) may differ by a pixel
      if (s.p99 > 1.5 / 255) bad.push(`${JSON.stringify(c)}: p99 ${s.p99.toFixed(4)} max ${s.max.toFixed(4)}`);
    });
    expect(bad).toEqual([]);
  }, 60000);

  it('Level: TD order on an 8-bit ramp', async () => {
    const W = 256, H = 2;
    const cases: Record<string, unknown>[] = [
      { invert: 1, blacklevel: 0.25 }, { brightness: 2, contrast: 1.5 }, { gamma: 2.2, contrast: 1.3 },
      { inlow: 0.2, inhigh: 0.8, outlow: 0.1, outhigh: 0.9, opacity: 0.6 }, { low: [0.1, 0, 0, 0], high: [0.9, 0.5, 1, 1], gamma2: 0.7, brightness2: 1.2 },
    ];
    const nodes: NodeDef[] = [{ name: 'src', type: 'top:ramp', params: { ...res(W, H), extendleft: 'hold' } },
      ...cases.map((p, i) => ({ name: `l${i}`, type: 'top:level', params: p, inputs: ['src'] }))];
    const out = await render(nodes, ['src', ...cases.map((_, i) => `l${i}`)]);
    const src = toF(out.src), bad: string[] = [];
    cases.forEach((p, i) => {
      const lp: LevelParams = { invert: p.invert as number, blacklevel: p.blacklevel as number, brightness1: p.brightness as number, gamma1: p.gamma as number, contrast: p.contrast as number,
        inlow: p.inlow as number, inhigh: p.inhigh as number, outlow: p.outlow as number, outhigh: p.outhigh as number, opacity: p.opacity as number,
        low: p.low as never, high: p.high as never, gamma2: p.gamma2 as number, brightness2: p.brightness2 as number };
      const errs: number[] = [];
      for (let x = 0; x < W; x++) {
        const r = levelRef([src[x * 4], src[x * 4 + 1], src[x * 4 + 2], src[x * 4 + 3]], lp);
        for (let k = 0; k < 4; k++) errs.push(Math.abs(Math.min(1, Math.max(0, r[k])) - out[`l${i}`].px[x * 4 + k] / 255));
      }
      const s = stats(errs);
      if (s.max > 1.01 / 255) bad.push(`${JSON.stringify(p)}: max ${s.max.toFixed(4)}`);
    });
    expect(bad).toEqual([]);
  }, 60000);

  it('Edge and Blur on a smooth noise input', async () => {
    const W = 96, H = 64;
    const edges = [{}, { strength: 2, offsetx: 1.8, offsety: 1.8, blacklevel: 0.1 }, { select: 'rgbmax', strength: 0.648 }, { compinput: true, edgecolor: [1, 0.5, 0, 1] }];
    const blurs = [{}, { type: 'gaussian', size: 16 }, { size: 9, preshrink: 2 }, { type: 'box', size: 4, offsetx: 2, offsety: 2 }];
    const nodes: NodeDef[] = [
      { name: 'src', type: 'top:noise', params: { ...res(W, H), mono: false, speed: 0, period: 0.8, harmonics: 1 } },
      ...edges.map((p, i) => ({ name: `e${i}`, type: 'top:edge', params: p, inputs: ['src'] })),
      ...blurs.map((p, i) => ({ name: `b${i}`, type: 'top:blur', params: p, inputs: ['src'] })),
    ];
    const out = await render(nodes, ['src', ...edges.map((_, i) => `e${i}`), ...blurs.map((_, i) => `b${i}`)]);
    const src = toF(out.src), bad: string[] = [];
    edges.forEach((p, i) => {
      const ref = edgeRef(src, W, H, p as never), errs: number[] = [];
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) for (let k = 0; k < 4; k++) {
        errs.push(Math.abs(Math.min(1, Math.max(0, ref[(y * W + x) * 4 + k])) - out[`e${i}`].px[(y * W + x) * 4 + k] / 255));
      }
      const s = stats(errs);
      if (s.p99 > 2 / 255 || s.max > 6 / 255) bad.push(`edge ${JSON.stringify(p)}: p99 ${s.p99.toFixed(4)} max ${s.max.toFixed(4)}`);
    });
    blurs.forEach((p, i) => {
      const r = Float64Array.from({ length: W * H }, (_, q) => src[q * 4]);
      const ref = blurRef(r, W, H, p as never), errs: number[] = [];
      for (let q = 0; q < W * H; q++) errs.push(Math.abs(ref[q] - out[`b${i}`].px[q * 4] / 255));
      const s = stats(errs);
      if (s.p99 > 2 / 255 || s.max > 4 / 255) bad.push(`blur ${JSON.stringify(p)}: p99 ${s.p99.toFixed(4)} max ${s.max.toFixed(4)}`);
    });
    expect(bad).toEqual([]);
  }, 60000);

  it('Composite: all operations, premultiplied, A = first input', async () => {
    const W = 64, H = 32;
    const nodes: NodeDef[] = [
      { name: 'a', type: 'top:noise', params: { ...res(W, H), mono: false, speed: 0, alpha: 'random', seed: 2 } },
      { name: 'b', type: 'top:ramp', params: { ...res(W, H), colora: [0.1, 0.8, 0.3, 0.4], colorb: [0.9, 0.2, 0.6, 1] } },
      ...COMP_OPS.map((op) => ({ name: `c_${op}`, type: 'top:composite', params: { operation: op }, inputs: ['a', 'b'] })),
    ];
    const out = await render(nodes, ['a', 'b', ...COMP_OPS.map((op) => `c_${op}`)]);
    const A = toF(out.a), B = toF(out.b), bad: string[] = [];
    for (const op of COMP_OPS) {
      const errs: number[] = [];
      for (let q = 0; q < W * H; q++) {
        const r = compRef(op as CompOp, Array.from(A.slice(q * 4, q * 4 + 4)), Array.from(B.slice(q * 4, q * 4 + 4)));
        for (let k = 0; k < 4; k++) {
          if (!Number.isFinite(r[k])) continue;
          errs.push(Math.abs(Math.min(1, Math.max(0, r[k])) - out[`c_${op}`].px[q * 4 + k] / 255));
        }
      }
      const s = stats(errs);
      if (s.p99 > 1.5 / 255) bad.push(`${op}: p99 ${s.p99.toFixed(4)} max ${s.max.toFixed(4)}`);
    }
    expect(bad).toEqual([]);
  }, 60000);
});
