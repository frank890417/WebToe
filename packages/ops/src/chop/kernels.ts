/**
 * CPU kernels behind a swappable interface — the WASM seam (PLAN §5).
 * `tsKernels` is the reference implementation and permanent fallback; a
 * wasm build implementing `Kernels` can be installed via `setKernels()`
 * once a profiled hotspot justifies it. Typed-array-first by design.
 */

export type LfoShape = 'sin' | 'tri' | 'square' | 'saw' | 'pulse';

export interface Kernels {
  /** waveform value at phase 0..1, range -1..1 */
  lfo(shape: LfoShape, phase01: number): number;
  /** deterministic 1D value noise at t, range -1..1 */
  noise1(t: number, seed: number): number;
  /** fractal sum of noise1, normalized to roughly -1..1 */
  fbm1(t: number, octaves: number, seed: number): number;
  /** one exponential-smoothing step toward target (asymmetric up/down lag, seconds) */
  lagStep(current: number, target: number, lagUp: number, lagDown: number, dt: number): number;
}

function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export const tsKernels: Kernels = {
  lfo(shape, phase01) {
    const p = phase01 - Math.floor(phase01);
    switch (shape) {
      case 'sin': return Math.sin(p * Math.PI * 2);
      case 'tri': return 1 - 4 * Math.abs(p - 0.5);
      case 'square': return p < 0.5 ? 1 : -1;
      case 'saw': return p * 2 - 1;
      case 'pulse': return p < 0.1 ? 1 : 0;
    }
  },

  noise1(t, seed) {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f); // smoothstep
    const a = hash01(i + seed * 1000);
    const b = hash01(i + 1 + seed * 1000);
    return (a + (b - a) * u) * 2 - 1;
  },

  fbm1(t, octaves, seed) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    const n = Math.max(1, Math.min(8, Math.floor(octaves)));
    for (let o = 0; o < n; o++) {
      sum += tsKernels.noise1(t * freq, seed + o * 17) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  },

  // TD semantics (measured against TouchDesigner 2025/2026 saves): `lag` is the
  // time for the output to cover 90% of a step, not a time constant — so
  // a = 1 − exp(−dt·ln10/lag). Up/down lag picked by the direction of travel.
  lagStep(current, target, lagUp, lagDown, dt) {
    const lag = target > current ? lagUp : lagDown;
    if (!(lag > 1e-6) || !(dt > 0)) return target;
    const k = 1 - Math.exp((-dt * Math.LN10) / lag);
    return k >= 1 ? target : current + (target - current) * k;
  },
};

let active: Kernels = tsKernels;

export function kernels(): Kernels {
  return active;
}

/** Install an alternative (e.g. wasm) implementation; pass tsKernels to restore. */
export function setKernels(impl: Kernels): void {
  active = impl;
}
