/**
 * TouchDesigner-fidelity tests for the TOP family.
 *
 * Numbers come from measured TD behaviour documented by the author's EOI
 * dream-engine research (docs/TD-PARITY.md "Fidelity"): the CPU references in
 * top-fidelity-ref.ts mirror the shaders, these tests pin the rules (order of
 * operations, formulas, constants) and check the GLSL/WGSL sources implement
 * the same thing. GPU-vs-reference pixel checks: top-fidelity-gpu.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, type GpuFacade, type NodeInst, type TexturePassSpec, type TextureHandle, type ShaderSources } from '@webtoe/core';
import { registerAllOps, topOps } from '@webtoe/ops';
import * as glsl from '../packages/ops/src/top/glsl';
import * as wgsl from '../packages/ops/src/top/wgsl';
import { rampKeys, LUM709 } from '../packages/ops/src/top/tdmath';
import { edgeRef, levelRef, rampCoord, rampRef } from './top-fidelity-ref';

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

// ---------------------------------------------------------------- uniform parity (all TOP shaders)

class MockGpu implements GpuFacade {
  readonly name = 'webgl2' as const;
  readonly shaders = new Map<string, ShaderSources>();
  readonly passes: { slot: string; spec: TexturePassSpec }[] = [];
  private id = 1;
  setTime(): void {}
  registerShader(id: string, s: ShaderSources): void { if (!this.shaders.has(id)) this.shaders.set(id, s); }
  runPass(_n: NodeInst, spec: TexturePassSpec, slot = 'main'): TextureHandle {
    this.passes.push({ slot, spec });
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
  const shaderOps = topOps.filter((o) => o.shaders && (o.backends ?? []).includes('webgpu'));
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
          expect(src.glsl, `${spec.shaderId} GLSL declares ${k}`).toMatch(new RegExp(`uniform\\s+\\w+\\s+${k}\\b`));
        }
        const m = src.wgsl?.match(/struct Ops \{([^}]*)\}/);
        const fields = m ? [...m[1].matchAll(/(\w+)\s*:\s*vec4f/g)].map((x) => x[1]) : [];
        expect(fields, `${spec.shaderId} WGSL Ops struct`).toEqual(keys);
      }
    });
  }
});
