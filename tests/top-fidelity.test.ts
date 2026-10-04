/**
 * TouchDesigner-fidelity tests for the TOP family.
 *
 * Numbers come from measured TD behaviour documented by the author's production
 * web-port research (docs/TD-PARITY.md "Fidelity"): the CPU references in
 * top-fidelity-ref.ts mirror the shaders, these tests pin the rules (order of
 * operations, formulas, constants) and check the GLSL/WGSL sources implement
 * the same thing. GPU-vs-reference pixel checks: top-fidelity-gpu.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, type GpuFacade, type NodeInst, type TexturePassSpec, type TextureHandle, type ShaderSources } from '@webtoe/core';
import { registerAllOps, topOps } from '@webtoe/ops';
import * as glsl from '../packages/ops/src/top/glsl';
import * as wgsl from '../packages/ops/src/top/wgsl';
import {
  BLUR_DELTA, BLUR_TYPES, COMP_OPS, GRAD3, GRAD4, LUM709, NOISE_TYPES, PERM, SIMPLEX4, TD_NOISE_SEED,
  blurF, blurKernel, blurKernelPixels, compOverlayUV, gradByte, noiseCoord, noiseSeedOffset, noiseXform, rampKeys,
} from '../packages/ops/src/top/tdmath';
import {
  blurRef, compRef, edgeRef, levelRef, noiseGpuRef, perlin2Ref, perlin3Ref, perlin4Ref, permTextureData,
  rampCoord, rampRef, resample, simplex2Ref, simplexNRef,
} from './top-fidelity-ref';

beforeAll(() => registerAllOps());

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(eps);

// ---------------------------------------------------------------- 1. Level

describe('Level TOP (TD order of operations)', () => {
  it('inverts before the black level', () => {
    // invert first: 0.2 → 0.8 → (0.8 − 0.5)/0.5 = 0.6; the other order would give 1.6
    close(levelRef([0.2, 0.2, 0.2, 1], { invert: 1, blacklevel: 0.5 })[0], 0.6);
  });
  it('black level does not clamp by itself', () => {
    close(levelRef([0.1, 0, 0, 1], { blacklevel: 0.2, clampinput: false })[0], -0.125);
  });
  it('clamps after brightness1 (8-bit input) and never after', () => {
    // 0.8·2 → clamp 1 → contrast 2 about 0.5 → 1.5 survives (no later clamp)
    close(levelRef([0.8, 0, 0, 1], { brightness1: 2, contrast: 2 })[0], 1.5);
  });
  it('applies gamma before contrast, gamma = x^(1/γ)', () => {
    close(levelRef([0.25, 0, 0, 1], { gamma1: 2 })[0], 0.5);
    close(levelRef([0.25, 0, 0, 1], { gamma1: 2, contrast: 3 })[0], 0.5);   // gamma puts it on the pivot first
    close(levelRef([0.25, 0, 0, 1], { contrast: 3 })[0], -0.25);
  });
  it('opacity multiplies RGB and alpha', () => {
    const o = levelRef([0.5, 0.4, 0.3, 0.8], { opacity: 0.5 });
    [0.25, 0.2, 0.15, 0.4].forEach((v, i) => close(o[i], v));
  });
  it('range then per-channel low/high', () => {
    close(levelRef([0.5, 0, 0, 1], { inlow: 0.25, inhigh: 0.75, outlow: 0.1, outhigh: 0.3 })[0], 0.2);
    close(levelRef([0.5, 0.5, 0.5, 1], { low: [0.2, 0, 0, 0], high: [0.4, 1, 1, 1] })[0], 0.3);
  });
  it('shaders run the stages in the same order (GLSL and WGSL)', () => {
    const stages = ['u_pre.x', 'u_pre.y', 'u_pre.z', 'lvGamma(x, u_pre.w)', 'u_contrast', 'u_range.x', 'u_low.rgb', 'lvGamma(x, u_post.x)', 'u_post.y', 'u_opacity'];
    for (const [src, prefix] of [[glsl.levelGlsl, ''], [wgsl.levelWgsl, 'P.']] as const) {
      const body = src.slice(src.search(/void main|@fragment/));
      const pos = stages.map((s) => {
        const i = body.indexOf(s.replace(/\bu_/g, `${prefix}u_`));
        expect(i, s).toBeGreaterThan(0);
        return i;
      });
      expect(pos).toEqual([...pos].sort((a, b) => a - b));
    }
  });
});

// ---------------------------------------------------------------- 2. Edge

/** W×H grey image from f(x, y). */
function grey(W: number, H: number, f: (x: number, y: number) => number): Float64Array {
  const img = new Float64Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f(x, y), o = (y * W + x) * 4; img[o] = img[o + 1] = img[o + 2] = v; img[o + 3] = 1; }
  return img;
}

describe('Edge TOP (√strength, /√offset, black level, Rec.709)', () => {
  const W = 16, H = 8, at = (img: Float64Array, x: number, y: number) => img[(y * W + x) * 4];
  it('a 0.1 step gives |∇| = 0.4 at strength 1 and scales with √strength', () => {
    const img = grey(W, H, (x) => (x >= 8 ? 0.1 : 0));
    close(at(edgeRef(img, W, H), 8, 4), 0.4, 1e-12);
    close(at(edgeRef(img, W, H, { strength: 4 }), 8, 4), 0.8, 1e-12);   // √4·0.4, not 4·0.4
  });
  it('sample step: a linear ramp brightens by √offset (TD measured ×1/√2, ×1/√3 vs |∇| alone)', () => {
    const img = grey(64, 8, (x) => x * 0.01);
    const e = (o: number) => edgeRef(img, 64, 8, { offsetx: o, offsety: o })[(4 * 64 + 32) * 4];
    close(e(1), 0.08, 1e-12);
    close(e(2) / e(1), Math.SQRT2, 1e-9);
    close(e(3) / e(1), Math.sqrt(3), 1e-9);
  });
  it('black level: e = √(1−bl)·g − bl (slopes √0.985 and √0.9 as measured)', () => {
    const img = grey(W, H, (x) => (x >= 8 ? 0.1 : 0)), img2 = grey(W, H, (x) => (x >= 8 ? 0.2 : 0));
    for (const bl of [0.015, 0.1]) {
      const a = at(edgeRef(img, W, H, { blacklevel: bl }), 8, 4), b = at(edgeRef(img2, W, H, { blacklevel: bl }), 8, 4);
      close((b - a) / 0.4, Math.sqrt(1 - bl), 1e-9);
      close(a, Math.sqrt(1 - bl) * 0.4 - bl, 1e-12);
    }
  });
  it('selects Rec.709 luminance after sampling, and compinput is edge over input', () => {
    const img = new Float64Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; img[o + 1] = x >= 8 ? 0.2 : 0; img[o + 3] = 1; }
    const e = 4 * 0.2 * LUM709[1];           // 0.572 (Rec.601 would give 0.4696)
    close(edgeRef(img, W, H)[(4 * W + 8) * 4], e, 1e-12);
    const c = edgeRef(img, W, H, { compinput: true, edgecolor: [1, 0, 0, 1] }), o = (4 * W + 8) * 4;
    close(c[o], e, 1e-12);                    // red edge
    close(c[o + 1], 0.2 * (1 - e), 1e-12);   // input green under it
  });
  it('shaders: Rec.709 weights, √strength, /√offset, √(1−bl), over-composite — no Rec.601 left', () => {
    for (const src of [glsl.edgeGlsl, wgsl.edgeWgsl]) {
      expect(src).toContain('0.2126, 0.7152, 0.0722');
      expect(src).not.toContain('0.299');
      expect(src).toMatch(/sqrt\(max\((P\.)?u_strength(\.x)?, 0\.0\)/);
      expect(src).toMatch(/1\.0 \/ max\(abs\((P\.)?u_offset/);
      expect(src).toMatch(/sqrt\(max\(1\.0 - (P\.)?u_blacklevel/);
      expect(src).toMatch(/src \* \(1\.0 - clamp\(col\.a/);
    }
  });
});

// ---------------------------------------------------------------- 3. luminance = Rec.709

describe('Monochrome / luminance', () => {
  it('every luminance-driven TOP shader uses Rec.709, not Rec.601', () => {
    for (const src of [glsl.monochromeGlsl, wgsl.monochromeWgsl, glsl.lookupGlsl, glsl.edgeGlsl, wgsl.edgeWgsl]) {
      expect(src).toContain('0.2126, 0.7152, 0.0722');
      expect(src).not.toMatch(/0\.299|0\.587|0\.114/);
    }
  });
  it('monochrome defaults to luminance with clamp on (TD defaults)', () => {
    const spec = topOps.find((o) => o.type === 'top:monochrome')!;
    expect(spec.params.find((p) => p.key === 'rgb')?.default).toBe('luminance');
    expect(spec.params.find((p) => p.key === 'alpha')?.default).toBe('alpha');
    expect(spec.params.find((p) => p.key === 'clamp')?.default).toBe(true);
  });
});

// ---------------------------------------------------------------- 4. Ramp

describe('Ramp TOP (key wrap, phase/period, extend)', () => {
  const RED = [1, 0, 0, 1], BLUE = [0, 0, 1, 1];
  it('wraps keys: after the last key the colour heads back to the first one', () => {
    const k = rampKeys([[0.2, ...RED], [0.6, ...BLUE]]);
    expect(k.map((r) => r[0])).toEqual([-0.4, 0.2, 0.6, 1.2]);
    const c = rampRef(0.9, k);                 // halfway from blue (0.6) to red (1.2)
    close(c[0], 0.5); close(c[2], 0.5);
    const c2 = rampRef(0.1, k);                // halfway from blue (−0.4) to red (0.2)… 5/6 of the way
    close(c2[0], 5 / 6); close(c2[2], 1 / 6);
  });
  it('keys at 0 and 1 add no wrap key', () => {
    expect(rampKeys([[0, ...RED], [1, ...BLUE]]).length).toBe(2);
  });
  it('horizontal/vertical: t = (u − phase)/period (phase moves the ramp right)', () => {
    close(rampCoord('horizontal', 0.25, 0.9, { phase: 0.25 }), 0);
    close(rampCoord('horizontal', 0.75, 0, { phase: 0.25, period: 2 }), 0.25);
    close(rampCoord('vertical', 0.1, 0.6, { phase: 0.1 }), 0.5);
  });
  it('radial/circular: t = base/period − phase; position only moves their centre', () => {
    close(rampCoord('circular', 0.75, 0.5, { period: 2, phase: 0.1 }), 0.5 / 2 - 0.1);
    close(rampCoord('radial', 0.5, 1, {}), 0.25);            // straight up = a quarter turn CCW from +x
    close(rampCoord('circular', 0.6, 0.5, { position: [0.1, 0] }), 0);
    close(rampCoord('horizontal', 0.6, 0.5, { position: [0.1, 0] }), 0.6);
  });
  it('extend modes outside 0..1', () => {
    const k = rampKeys([[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]]);
    close(rampRef(1.25, k, { extendleft: 'repeat' })[0], 0.25);
    close(rampRef(1.25, k, { extendleft: 'mirror' })[0], 0.75);
    close(rampRef(1.25, k, { extendleft: 'hold' })[0], 1);
    expect(rampRef(1.25, k, { extendleft: 'zero' })).toEqual([0, 0, 0, 0]);
    expect(rampRef(-0.5, k, { extendleft: 'black', extendright: 'hold' })).toEqual([0, 0, 0, 1]);
  });
  it('shaders implement the TD phase rule and carry 32 keys in ≤vec4 uniforms', () => {
    for (const src of [glsl.rampGlsl, wgsl.rampWgsl]) {
      expect(src).toMatch(/\(t - (P\.)?u_phase(\.x)?\) \* (P\.)?u_repeat/);
      expect(src).toMatch(/t \* (P\.)?u_repeat(\.x)? - (P\.)?u_phase/);
      expect(src).toContain('u_kc31');
      expect(src).toContain('u_kp7');
      expect(src).not.toContain('fract(t + ');
    }
  });
});

// ---------------------------------------------------------------- 5. Blur

/** JS mirror of the shaders' in-loop weights (A&S erf, telescoping normalisation). */
function shaderBlurWeights(S: number, type: number): number[] {
  const erfAS = (x0: number) => {
    const s = Math.sign(x0), x = Math.abs(x0), t = 1 / (1 + 0.3275911 * x);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  const si = (x: number) => { let sum = 0, term = x; for (let n = 0; n < 30; n++) { sum += term / (2 * n + 1); term *= (-x * x) / ((2 * n + 2) * (2 * n + 3)); } return sum; };
  const Fk = (v: number) => [
    v - 0.83333333 * v ** 3 + 0.375 * v ** 4,
    0.59081795 * erfAS(1.5 * v),
    v,
    v - 0.5 * v * v,
    si(6.28318531 * v) / 6.28318531,
    0.5 * v + Math.sin(3.14159265 * v) / 6.28318531,
    0.42 * v + Math.sin(3.14159265 * v) / 6.28318531 + (0.08 / 6.28318531) * Math.sin(6.28318531 * v),
  ][type];
  const F = (u: number) => { const d = 1 / 1024, a = Math.min(Math.abs(u), 1); return Math.sign(u) * (Math.min(a, d) + (1 - d) * Fk(Math.max(a - d, 0) / (1 - d))); };
  const R = S / 2, c = (S - 1) / 2, norm = 0.5 / F(1);
  let fl = -F(1);
  const w: number[] = [];
  for (let i = 0; i < S; i++) { const fr = F((i - c + 0.5) / R); w.push((fr - fl) * norm); fl = fr; }
  return w;
}

describe('Blur TOP (generated kernel, size = full width, preshrink)', () => {
  it('TD size is the full kernel width: S taps at i − (S−1)/2', () => {
    const k7 = blurKernel(7), k8 = blurKernel(8);
    expect([...k7.x]).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect([...k8.x]).toEqual([-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.5]);   // even S: half texels
    expect(blurKernelPixels(8).weights.length).toBe(9);
  });
  it('weights are normalised, symmetric, and catmull has no negative lobe', () => {
    for (const type of BLUR_TYPES) for (const S of [2, 3, 7, 16, 33, 80]) {
      const { w } = blurKernel(S, type);
      close(w.reduce((a, b) => a + b, 0), 1, 1e-12);
      for (let i = 0; i < S; i++) close(w[i], w[S - 1 - i], 1e-12);
      if (type === 'catmull' || type === 'gaussian' || type === 'box') expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(Array.from(blurKernel(5, 'box').w, (v) => v.toFixed(12))).size).toBe(1);
  });
  it('kernel shapes: catmull 1−2.5v²+1.5v³, gaussian exp(−(1.5v)²) (σ = S/(3√2) ≈ 0.2357·S), flat top inside the 1/1024 inset', () => {
    const d = BLUR_DELTA, dK = (u: number, t: (typeof BLUR_TYPES)[number]) => (blurF(u + 1e-7, t) - blurF(u - 1e-7, t)) / 2e-7;
    for (const u of [0.2, 0.5, 0.8]) {
      const v = (u - d) / (1 - d);
      close(dK(u, 'catmull'), 1 - 2.5 * v * v + 1.5 * v ** 3, 1e-6);
      close(dK(u, 'gaussian'), Math.exp(-((1.5 * v) ** 2)), 1e-6);
    }
    close(dK(d / 2, 'catmull'), 1, 1e-6);
    close(1 / (3 * Math.SQRT2), 0.2357, 1e-4);
  });
  it('shader weights (computed in-loop, no normalising pass) match the reference kernel', () => {
    for (let type = 0; type < BLUR_TYPES.length; type++) for (const S of [2, 3, 5, 7, 8, 13, 32, 80]) {
      const ref = blurKernel(S, BLUR_TYPES[type]).w, got = shaderBlurWeights(S, type);
      for (let i = 0; i < S; i++) close(got[i], ref[i], 2e-6);
    }
  });
  it('preshrink is one bilinear tap: p 2 = 2×2 mean, p 4 reads only the middle 2×2 of each 4×4', () => {
    const W = 16, img = Array.from({ length: W * W }, (_, i) => ((i * 7919) % 101) / 100);
    const at = (x: number, y: number) => img[y * W + x];
    const s2 = resample(img, W, W, 8, 8);
    close(s2[3 * 8 + 5], (at(10, 6) + at(11, 6) + at(10, 7) + at(11, 7)) / 4, 1e-12);
    const s4 = resample(img, W, W, 4, 4);
    close(s4[1 * 4 + 2], (at(9, 5) + at(10, 5) + at(9, 6) + at(10, 6)) / 4, 1e-12);
  });
  it('an impulse keeps its energy through preshrink + both passes + upsample', () => {
    const W = 64, img = new Float64Array(W * W); img[32 * W + 32] = 1;
    for (const p of [{ size: 7 }, { size: 16, type: 'gaussian' as const }, { size: 9, preshrink: 2 }, { size: 5, offsetx: 3, offsety: 3 }]) {
      const out = blurRef(img, W, W, p);
      close(out.reduce((a, b) => a + b, 0), 1, 1e-9);
    }
  });
  it('cook plan: preshrink → horizontal → vertical → upsample, taps = round(size·filterscale)', () => {
    const gpu = cookWithMock('top:blur', { size: 7, preshrink: 4, filterscaley: 2 });
    const plan = gpu.passes.filter((p) => p.node === 'n1')
      .map((p) => [p.spec.shaderId, p.spec.output.width, p.spec.output.height, p.spec.uniforms.u_taps ?? null, p.slot]);
    expect(plan).toEqual([
      ['top:resample', 16, 8, null, 'p0'],
      ['top:blur', 16, 8, 7, 'p1'],
      ['top:blur', 16, 8, 14, 'p2'],
      ['top:resample', 64, 32, null, 'main'],
    ]);
    const plain = cookWithMock('top:blur', {});
    expect(plain.passes.filter((p) => p.node === 'n1').map((p) => p.slot)).toEqual(['p0', 'main']);   // h then v writes main directly
  });
  it('shaders carry the generated kernel (not a Gaussian radius)', () => {
    for (const src of [glsl.blurGlsl, wgsl.blurWgsl]) {
      expect(src).toContain('u_taps');
      expect(src).toContain('0.83333333');      // catmull integral
      expect(src).toContain('0.3275911');       // A&S erf
      expect(src).toContain('1.0 / 1024.0');    // kernel inset
      expect(src).not.toContain('sigma');
    }
  });
});

// ---------------------------------------------------------------- 6. Noise

/** JS mirror of the shaders' integer emulation of Gustavson's lookup textures (noiselib.ts). */
const tdPT = (x: number, y: number) => PERM[(x + PERM[y & 255]) & 255];
const tdIdx = (v: number) => (v === 255 ? 0 : v);
const tdG3 = (v: number) => GRAD3[v & 15].map(gradByte);
const tdG4 = (v: number) => GRAD4[v & 31].map(gradByte);
const fadeJS = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mixJS = (a: number, b: number, t: number) => a + (b - a) * t;
const dotJS = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const intNoise = {
  perlin2([x, y]: number[]) {
    const I = [Math.floor(x), Math.floor(y)], f = [x - I[0], y - I[1]];
    const n = (ox: number, oy: number) => dotJS(tdG3(tdPT(I[0] + ox, I[1] + oy)).slice(0, 2), sub(f, [ox, oy]));
    return mixJS(mixJS(n(0, 0), n(1, 0), fadeJS(f[0])), mixJS(n(0, 1), n(1, 1), fadeJS(f[0])), fadeJS(f[1]));
  },
  perlin3(P: number[]) {
    const I = P.map(Math.floor), f = P.map((v, i) => v - I[i]);
    const n = (ox: number, oy: number, oz: number) => dotJS(tdG3(tdPT(tdIdx(tdPT(I[0] + ox, I[1] + oy)), I[2] + oz)), sub(f, [ox, oy, oz]));
    const X = (oy: number, oz: number) => mixJS(n(0, oy, oz), n(1, oy, oz), fadeJS(f[0]));
    return mixJS(mixJS(X(0, 0), X(1, 0), fadeJS(f[1])), mixJS(X(0, 1), X(1, 1), fadeJS(f[1])), fadeJS(f[2]));
  },
  perlin4(P: number[]) {
    const I = P.map(Math.floor), f = P.map((v, i) => v - I[i]);
    const n = (a: number, b: number, c: number, d: number) => dotJS(tdG4(tdPT(tdIdx(tdPT(I[0] + a, I[1] + b)), tdIdx(tdPT(I[2] + c, I[3] + d)))), sub(f, [a, b, c, d]));
    const X = (b: number, c: number, d: number) => mixJS(n(0, b, c, d), n(1, b, c, d), fadeJS(f[0]));
    const Y = (c: number, d: number) => mixJS(X(0, c, d), X(1, c, d), fadeJS(f[1]));
    const Z = (d: number) => mixJS(Y(0, d), Y(1, d), fadeJS(f[2]));
    return mixJS(Z(0), Z(1), fadeJS(f[3]));
  },
  simplex(P: number[]) {
    const D = P.length, F = [0, 0, 0.366025403784, 0.333333333333, 0.309016994375][D], G = [0, 0, 0.211324865405, 0.166666666667, 0.138196601125][D];
    const R2 = D === 2 ? 0.5 : 0.6, K = [0, 0, 70, 32, 27][D];
    const s = P.reduce((a, b) => a + b, 0) * F, Pi = P.map((v) => Math.floor(v + s)), t = Pi.reduce((a, b) => a + b, 0) * G;
    const f0 = P.map((v, i) => v - (Pi[i] - t));
    const grad = (o: number[]) => (D === 2 ? tdG3(tdPT(Pi[0] + o[0], Pi[1] + o[1])).slice(0, 2)
      : D === 3 ? tdG3(tdPT(tdIdx(tdPT(Pi[0] + o[0], Pi[1] + o[1])), Pi[2] + o[2]))
        : tdG4(tdPT(tdIdx(tdPT(Pi[0] + o[0], Pi[1] + o[1])), tdIdx(tdPT(Pi[2] + o[2], Pi[3] + o[3])))));
    const corner = (o: number[], k: number) => {
      const f = f0.map((v, i) => v - o[i] + k * G);
      let q = R2 - dotJS(f, f);
      if (q < 0) return 0;
      q *= q;
      return q * q * dotJS(grad(o), f);
    };
    let offs: number[][];
    if (D === 2) offs = [f0[0] > f0[1] ? [1, 0] : [0, 1]];
    else {
      let idx = (f0[0] > f0[1] ? 32 : 0) + (f0[0] > f0[2] ? 16 : 0) + (f0[1] > f0[2] ? 8 : 0);
      if (D === 4) idx += (f0[0] > f0[3] ? 4 : 0) + (f0[1] > f0[3] ? 2 : 0) + (f0[2] > f0[3] ? 1 : 0);
      const off = SIMPLEX4[idx].slice(0, D);
      offs = (D === 3 ? [96, 32] : [160, 96, 32]).map((th) => off.map((v) => (v >= th ? 1 : 0)));
    }
    let sum = corner(new Array(D).fill(0), 0);
    offs.forEach((o, m) => { sum += corner(o, m + 1); });
    sum += corner(new Array(D).fill(1), D);
    return K * sum;
  },
};

describe('Noise TOP (Gustavson tables, TD coordinates, seeds, octaves)', () => {
  it('the integer table emulation addresses exactly the texels the texture version reads', () => {
    const perm = permTextureData();
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      expect(tdPT(x, y)).toBe(perm[(y * 256 + x) * 4 + 3]);
      const v = perm[(y * 256 + x) * 4 + 3];
      expect(tdG3(v).map((g) => Math.round((g + 1) / 4 * 255))).toEqual([0, 1, 2].map((k) => perm[(y * 256 + x) * 4 + k]));
    }
    // a permutation value reused as a texture coordinate v/255 hits texel v — except 255 (= 1.0) wraps to 0
    for (let v = 0; v < 256; v++) expect(Math.floor((v / 255) * 256) % 256).toBe(tdIdx(v));
    // the 8-bit gradient encoding TD reads: −1, 1/255, 257/255 instead of −1, 0, 1
    expect([-1, 0, 1].map(gradByte)).toEqual([-1, 1 / 255, 257 / 255].map((x) => expect.closeTo(x, 12)));
  });
  it('integer formulation (what the shaders run) equals the texture formulation for all six GPU types', () => {
    const rnd = (i: number) => ((i * 2654435761) % 4294967296) / 4294967296;
    for (let i = 0; i < 300; i++) {
      const P = [0, 1, 2, 3].map((k) => (rnd(i * 4 + k + 1) - 0.5) * 1200);
      close(intNoise.perlin2(P.slice(0, 2)), perlin2Ref(P[0], P[1]), 1e-9);
      close(intNoise.perlin3(P.slice(0, 3)), perlin3Ref(P[0], P[1], P[2]), 1e-9);
      close(intNoise.perlin4(P), perlin4Ref(P[0], P[1], P[2], P[3]), 1e-9);
      close(intNoise.simplex(P.slice(0, 2)), simplex2Ref(P[0], P[1]), 1e-9);
      close(intNoise.simplex(P.slice(0, 3)), simplexNRef(P.slice(0, 3)), 1e-9);
      close(intNoise.simplex(P), simplexNRef(P), 1e-9);
    }
  });
  it('classic Perlin is 0 on lattice points', () => {
    for (const [x, y, z] of [[0, 0, 0], [3, -7, 12], [255, 256, -1]]) {
      close(perlin2Ref(x, y), 0, 1e-12);
      close(perlin3Ref(x, y, z), 0, 1e-12);
    }
  });
  it('coordinates: P = 4·pixel/max(w,h) − 2, anchored bottom-left (512×256 spans y −2..0)', () => {
    expect(noiseCoord(512, 256)).toEqual([1, 0.5]);
    expect(noiseCoord(512, 256, false)).toEqual([1, 1]);
    const ps = noiseCoord(512, 256), Py = (v: number) => 4 * v * ps[1] - 2;
    close(Py(0), -2); close(Py(1), 0);
  });
  it('transform page: translate subtracts and is not divided by period; scale/rotate are forward', () => {
    const M = noiseXform({ tx: 0.3 }, 0.5);
    close(M[0] * 1 + M[3], 1 / 0.5 - 0.3);      // P.x = 1 → 2 − 0.3
    const S = noiseXform({ sx: 1.5 }, 1);
    close(S[0], 1.5);                            // denser pattern
    const R = noiseXform({ rz: 90 }, 1);           // pivot at P = −0.5: (1, 0) → −0.5 + Rz·(1.5, 0.5) = (−1, 1)
    close(R[0] * 1 + R[3], -1);
    close(R[4] * 1 + R[7], 1);
  });
  it('seeds: measured offsets; channel 1 = 2·channel 0 − (½, ½, 0) for every measured seed', () => {
    expect(noiseSeedOffset(1, 0)).toEqual([428.5, -184.5, 201, 0]);
    expect(noiseSeedOffset(1, 1)).toEqual([856.5, -369.5, 402, 0]);
    for (const [seed, row] of Object.entries(TD_NOISE_SEED)) {
      const c0 = row[0]!, c1 = noiseSeedOffset(Number(seed), 1);
      close(c1[0], 2 * c0[0] - 0.5); close(c1[1], 2 * c0[1] - 0.5);
      if (c0[2] != null) close(c1[2], 2 * c0[2]);
    }
    // unmeasured seeds are deterministic hashes
    expect(noiseSeedOffset(42, 0)).toEqual(noiseSeedOffset(42, 0));
    expect(noiseSeedOffset(42, 0)).not.toEqual(noiseSeedOffset(43, 0));
  });
  it('octaves = harmon + 1, chain sign·|amp·n|^exp + offset', () => {
    const M = noiseXform({}, 1), seed = noiseSeedOffset(1, 0);
    const one = noiseGpuRef('perlin2d', 0.3, 0.6, M, [1, 1], seed, 0, { harmon: 0, amp: 1, offset: 0 });
    const P = [4 * 0.3 - 2 + seed[0], 4 * 0.6 - 2 + seed[1]];
    close(one, perlin2Ref(P[0], P[1]), 1e-12);
    const two = noiseGpuRef('perlin2d', 0.3, 0.6, M, [1, 1], seed, 0, { harmon: 1, amp: 1, offset: 0, gain: 0.5 });
    close(two, perlin2Ref(P[0], P[1]) + 0.5 * perlin2Ref(2 * P[0], 2 * P[1]), 1e-12);
    const ex = noiseGpuRef('perlin2d', 0.3, 0.6, M, [1, 1], seed, 0, { harmon: 0, amp: 0.8, offset: 0.2, exp: 2 });
    close(ex, Math.sign(one) * (0.8 * Math.abs(one)) ** 2 + 0.2, 1e-12);
  });
  it('cook: TD defaults, octaves = harmonics + 1, seed offsets per channel, time-driven tz only via speed', () => {
    const spec = topOps.find((o) => o.type === 'top:noise')!;
    const d = Object.fromEntries(spec.params.map((p) => [p.key, p.default]));
    expect(d).toMatchObject({ type: 'simplex3d', seed: 1, period: 1, harmonics: 2, spread: 2, gain: 0.7, exponent: 1, amp: 0.5, offset: 0.5, mono: true, aspectcorrect: true, alpha: 'one' });
    const gpu = cookWithMock('top:noise', { harmonics: 4, speed: 0, mono: false });
    const u = gpu.passes.find((p) => p.node === 'n1')!.spec.uniforms;
    expect(u.u_oct).toBe(5);
    expect(u.u_seed0).toEqual([428.5, -184.5, 201, 0]);
    expect(u.u_seed1).toEqual([856.5, -369.5, 402, 0]);
    expect(u.u_type).toBe(NOISE_TYPES.indexOf('simplex3d'));
  });
  it('shaders: Gustavson notice kept, TD coordinate rule, both backends', () => {
    for (const [src, coord] of [[glsl.noiseGlsl, '4.0 * v_uv * u_ps - 2.0'], [wgsl.noiseWgsl, '4.0 * uv * P.u_ps.xy - 2.0']]) {
      expect(src).toContain('provided that my name and this notice appears intact');
      expect(src).toContain('David Hoskins');
      expect(src).toContain(coord);
      expect(src).toContain(PERM.slice(0, 8).join(', '));
    }
  });
});

// ---------------------------------------------------------------- 7. Composite

describe('Composite TOP (46 TD operations, premultiplied, left fold, transform page)', () => {
  it('menu carries all 46 TD operations, each implemented in GLSL and WGSL', () => {
    expect(COMP_OPS.length).toBe(46);
    expect(new Set(COMP_OPS).size).toBe(46);
    const spec = topOps.find((o) => o.type === 'top:composite')!;
    expect(spec.params.find((p) => p.key === 'operation')?.menu).toEqual([...COMP_OPS]);
    for (const src of [glsl.compositeGlsl, wgsl.compositeWgsl]) {
      for (let i = 0; i < COMP_OPS.length; i++) expect(src, COMP_OPS[i]).toMatch(new RegExp(`op == ${i}\\b`));
    }
  });
  it('over is premultiplied: A + B·(1 − A.a)', () => {
    const r = compRef('over', [0.3, 0.1, 0, 0.5], [0.2, 0.8, 0.4, 1]);
    [0.4, 0.5, 0.2, 1].forEach((v, i) => close(r[i], v, 1e-12));
  });
  it('subtract is A − B with A = the first input (WebToe used to subtract the other way)', () => {
    const r = compRef('subtract', [0.8, 0.5, 0.2, 1], [0.3, 0.1, 0.1, 1]);
    close(r[0], 0.5, 1e-12);
  });
  it('blend modes lay the mode result over A with B\'s alpha', () => {
    const A = [0.4, 0.3, 0.2, 1], B = [0.25, 0.25, 0.25, 0.5];        // B un-premultiplied = 0.5 grey
    const r = compRef('multiply', A, B), s = compRef('softlight', A, B);
    close(r[0], 0.1, 1e-12);
    const X = 0.4, Y = 0.5, soft = (1 - 2 * Y) * X * X + 2 * X * Y;
    close(s[0], X * (1 - 0.5) + soft * 0.5, 1e-12);
  });
  it('transform page is forward R·S·(p + t): the translate is scaled by sx before rotation', () => {
    const W = 200, H = 100;
    const [u] = compOverlayUV(0.7, 0.5, W, H, { tx: 0.1, sx: 2 });
    close(u, 0.5, 1e-12);                                               // overlay centre lands at 0.5 + 0.1·2
    const [u2, v2] = compOverlayUV(0.5, 0.5 + 0.1, W, H, { rotate: 90, ty: 0, tx: 0.1 / 2 });   // tx·asp rotated onto +y
    close(u2, 0.5, 1e-9); close(v2, 0.5, 1e-9);
  });
  it('cook: identity transform samples input 0 directly; operation index = shader code', () => {
    const gpu = cookWithMock('top:composite', { operation: 'subtractive' });
    const u = gpu.passes.find((p) => p.node === 'n1')!.spec.uniforms;
    expect(u.u_op).toBe(COMP_OPS.indexOf('subtractive'));
    expect(u.u_count).toBe(4);
    expect((u.u_ovc as number[])[3]).toBe(1);
  });
  it('shaders fold left with input 0 on top and honour swaporder', () => {
    expect(glsl.compositeGlsl).toContain('u_swap > 0.5 ? tdComp(next, acc, op) : tdComp(acc, next, op)');
    expect(wgsl.compositeWgsl).toContain('return tdComp(acc, next, op)');
    for (const src of [glsl.compositeGlsl, wgsl.compositeWgsl]) expect(src).toContain('Sam Hocevar');
  });
});

// ---------------------------------------------------------------- uniform parity (all TOP shaders)

class MockGpu implements GpuFacade {
  readonly name = 'webgl2' as const;
  readonly shaders = new Map<string, ShaderSources>();
  readonly passes: { node: string; slot: string; spec: TexturePassSpec }[] = [];
  private id = 1;
  setTime(): void {}
  registerShader(id: string, s: ShaderSources): void { if (!this.shaders.has(id)) this.shaders.set(id, s); }
  runPass(n: NodeInst, spec: TexturePassSpec, slot = 'main'): TextureHandle {
    this.passes.push({ node: n.name, slot, spec });
    return { id: this.id++, width: Math.round(spec.output.width), height: Math.round(spec.output.height) };
  }
  previousFrame(): TextureHandle | null { return null; }
  uploadMedia(): TextureHandle { return { id: this.id++, width: 4, height: 4 }; }
  clearCanvas(): void {}
  blitToCanvas(): void {}
  readPixels(): Uint8ClampedArray { return new Uint8ClampedArray(0); }
  renderScene(): TextureHandle { return { id: this.id++, width: 4, height: 4 }; }
  releaseNode(): void {}
  dispose(): void {}
}

/** Cook `type` once with constant inputs wired to every inlet; return the recorded passes. */
function cookWithMock(type: string, params: Record<string, unknown> = {}): MockGpu {
  const engine = new Engine();
  const gpu = new MockGpu();
  engine.gpu = gpu;
  const spec = topOps.find((o) => o.type === type)!;
  const node = engine.graph.create(type, engine.graph.root, 'n1');
  for (const [k, v] of Object.entries(params)) node.params.set(k, { mode: 'const', value: v as never });
  for (let i = 0; i < spec.inputs.max; i++) {
    const c = engine.graph.create('top:constant', engine.graph.root, `c${i}`);
    c.params.set('resmode', { mode: 'const', value: 'custom' });
    c.params.set('resw', { mode: 'const', value: 64 });
    c.params.set('resh', { mode: 'const', value: 32 });
    engine.graph.connect(c, node, i);
  }
  engine.cook(node);
  expect(node.error, `${type} cook error`).toBeFalsy();
  return gpu;
}

describe('uniform parity: what a pass uploads is what both shaders declare', () => {
  const shaderOps = topOps.filter((o) => o.shaders);
  for (const op of shaderOps) {
    it(op.type, () => {
      const gpu = cookWithMock(op.type);
      expect(gpu.passes.length).toBeGreaterThan(0);
      for (const { spec } of gpu.passes) {
        const src = gpu.shaders.get(spec.shaderId)!;
        const keys = Object.keys(spec.uniforms).sort();
        for (const k of keys) {
          const v = spec.uniforms[k];
          expect(typeof v === 'number' || (v.length >= 2 && v.length <= 4), `${spec.shaderId}.${k} must be a scalar or vec2..4`).toBe(true);
          // numbers upload with uniform1f, arrays with uniform{2,3,4}fv: the GLSL type must match exactly
          const glslType = typeof v === 'number' ? 'float' : `vec${v.length}`;
          expect(src.glsl, `${spec.shaderId} GLSL declares ${glslType} ${k}`).toMatch(new RegExp(`uniform\\s+${glslType}\\s+${k}\\b`));
        }
        if (!(op.backends ?? []).includes('webgpu')) continue;
        // the WebGPU backend packs uniforms by sorted key, one vec4 each — the struct must list exactly those, in that order
        const m = src.wgsl?.match(/struct Ops \{([^}]*)\}/);
        const fields = m ? [...m[1].matchAll(/(\w+)\s*:\s*vec4f/g)].map((x) => x[1]) : [];
        expect(fields, `${spec.shaderId} WGSL Ops struct`).toEqual(keys);
      }
    });
  }
});
