/**
 * CPU-side math for the TouchDesigner-faithful TOPs: everything a TOP needs to
 * compute on the host before a pass (kernel weights, colour-key tables, noise
 * transforms, seed offsets) plus the lookup tables the noise shaders embed.
 *
 * The behaviour reproduced here was measured black-box against TouchDesigner
 * 2025 (feed known inputs, read outputs) by the author's EOI "dream engine"
 * project and ported into WebToe with permission. No code was taken from the
 * TouchDesigner binaries. Measured tolerances are listed in docs/TD-PARITY.md.
 *
 * Third-party material in this file (see THIRD_PARTY_NOTICES.md):
 *  - PERM: Ken Perlin, "Improved Noise reference implementation" (2002).
 *  - GRAD3 / GRAD4 / SIMPLEX4: Stefan Gustavson, GLSL noise (2004),
 *    "You may use, modify and redistribute this code free of charge,
 *    provided that my name and this notice appears intact."
 */

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** ITU-R BT.709 luma weights — TD's "luminance" everywhere (Monochrome, Edge, Lookup…). */
export const LUM709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

// ---------------------------------------------------------------- Ramp

export type RampKey = [number, number, number, number, number]; // pos r g b a

/**
 * Sorted ramp keys with TD's wrap-around: TD treats the key list as a loop, so
 * between the last key and 1.0 the colour interpolates toward the first key
 * (placed at pos₀ + 1). Symmetrically a first key above 0 gets a mirror of the
 * last key at posₙ − 1 on its left (inferred). A last key exactly at 1 adds
 * nothing, so `extend hold` never picks up the wrapped colour.
 */
export function rampKeys(keysIn: readonly (readonly number[])[] | null | undefined): RampKey[] {
  const src = keysIn && keysIn.length ? keysIn : [[0, 0, 0, 0, 1], [1, 1, 1, 1, 1]];
  let ks: RampKey[] = src
    .map((k) => [k[0] ?? 0, k[1] ?? 0, k[2] ?? 0, k[3] ?? 0, k[4] ?? 1] as RampKey)
    .sort((a, b) => a[0] - b[0]);
  if (ks.length > 1) {
    const first = ks[0], last = ks[ks.length - 1];
    if (first[0] > 0) ks = [[last[0] - 1, last[1], last[2], last[3], last[4]], ...ks];
    if (last[0] < 1) ks = [...ks, [first[0] + 1, first[1], first[2], first[3], first[4]]];
  }
  return ks;
}

/** Ramp keys DAT text (`pos r g b a` rows, optional header) → raw keys. */
export function parseRampDat(text: string): number[][] {
  const out: number[][] = [];
  const rows = text.trim().split('\n').map((r) => r.trim().split(/\t|\s+/));
  for (const r of rows) {
    if (r.length < 5) continue;
    const v = r.slice(0, 5).map(Number);
    if (v.some((x) => !Number.isFinite(x))) continue; // header row or junk
    out.push(v);
  }
  return out;
}

/** Maximum ramp keys a pass can carry (after wrap keys are added). */
export const RAMP_MAX_KEYS = 32;
/** Uniform names for the ramp keys: one colour vec4 per key, positions packed
 *  four per vec4 (zero-padded so the names sort in index order). */
export const RAMP_KC: readonly string[] = Array.from({ length: RAMP_MAX_KEYS }, (_, i) => `u_kc${String(i).padStart(2, '0')}`);
export const RAMP_KP: readonly string[] = Array.from({ length: RAMP_MAX_KEYS / 4 }, (_, i) => `u_kp${i}`);

// ---------------------------------------------------------------- Blur

/** Blur TOP filter types in TD menu order. catmull/gaussian/box are measured;
 *  the four window functions after them are standard shapes (inferred). */
export const BLUR_TYPES = ['catmull', 'gaussian', 'box', 'bartlette', 'sinc', 'hanning', 'blackman'] as const;
export type BlurType = (typeof BLUR_TYPES)[number];

/** erf by Maclaurin series (|x| ≤ 1.5 here; ~40 terms reach double precision). */
export function erf(x: number): number {
  const a = Math.abs(x);
  if (a > 3) return Math.sign(x) * (1 - Math.exp(-a * a) / (a * Math.sqrt(Math.PI)));
  let term = a, sum = a;
  for (let n = 1; n < 60; n++) {
    term *= (-a * a) / n;
    const t = term / (2 * n + 1);
    sum += t;
    if (Math.abs(t) < 1e-17) break;
  }
  return Math.sign(x) * sum * (2 / Math.sqrt(Math.PI));
}

/** Sine integral Si(x) by series (x ≤ 2π here). */
export function sinIntegral(x: number): number {
  let sum = 0, term = x;           // term = (-1)^n x^(2n+1) / (2n+1)!
  for (let n = 0; n < 40; n++) {
    const t = term / (2 * n + 1);
    sum += t;
    if (Math.abs(t) < 1e-17) break;
    term *= (-x * x) / ((2 * n + 2) * (2 * n + 3));
  }
  return sum;
}

/** ∫₀ᵛ K for each kernel shape K(v), v = |x| / (S/2) ∈ [0, 1]. */
const BLUR_F: Record<BlurType, (v: number) => number> = {
  catmull: (v) => v - (5 / 6) * v ** 3 + (3 / 8) * v ** 4,      // K = 1 − 2.5v² + 1.5v³ (positive lobe only)
  gaussian: (v) => (Math.sqrt(Math.PI) / 3) * erf(1.5 * v),     // K = exp(−(1.5v)²), cut at v = 1
  box: (v) => v,
  bartlette: (v) => v - (v * v) / 2,
  sinc: (v) => sinIntegral(2 * Math.PI * v) / (2 * Math.PI),    // K = sin(2πv)/(2πv)
  hanning: (v) => v / 2 + Math.sin(Math.PI * v) / (2 * Math.PI),
  blackman: (v) => 0.42 * v + (0.5 / Math.PI) * Math.sin(Math.PI * v) + (0.08 / (2 * Math.PI)) * Math.sin(2 * Math.PI * v),
};

/** Kernel coordinate inset: K is really K((|u| − δ)/(1 − δ)) with a flat top
 *  for |u| < δ. Fitting 13 sizes at once needs it (1.6e-4 → ≤ 7e-7). */
export const BLUR_DELTA = 1 / 1024;

export function blurF(u: number, type: BlurType = 'catmull'): number {
  const F = BLUR_F[type] ?? BLUR_F.catmull, a = Math.min(Math.abs(u), 1), d = BLUR_DELTA;
  return Math.sign(u) * (Math.min(a, d) + (1 - d) * F(Math.max(a - d, 0) / (1 - d)));
}

/**
 * TD Blur TOP 1-D kernel for an integer tap count S (TD's `size` is the full
 * width, not a radius): taps at x_i = i − (S−1)/2 sample steps (even S lands on
 * half texels, bilinear splits them), weight w_i = the continuous kernel
 * integrated over [x_i − ½, x_i + ½], normalised. Support ±S/2; catmull has no
 * negative lobes. The weights telescope, so Σ = 2·blurF(1) exactly — shaders
 * use that to normalise without a loop.
 */
export function blurKernel(size: number, type: BlurType = 'catmull'): { x: Float64Array; w: Float64Array } {
  const S = Math.max(1, Math.round(size));
  const x = new Float64Array(S), w = new Float64Array(S);
  if (S === 1) { w[0] = 1; return { x, w }; }
  const R = S / 2;
  let sum = 0;
  for (let i = 0; i < S; i++) {
    x[i] = i - (S - 1) / 2;
    w[i] = blurF((x[i] + 0.5) / R, type) - blurF((x[i] - 0.5) / R, type);
    sum += w[i];
  }
  for (let i = 0; i < S; i++) w[i] /= sum;
  return { x, w };
}

/** blurKernel spread onto whole pixels (even S: each half-texel tap split
 *  evenly between its two neighbours). */
export function blurKernelPixels(size: number, type: BlurType = 'catmull'): { offsets: number[]; weights: number[] } {
  const { x, w } = blurKernel(size, type), S = x.length;
  if (S % 2 === 1) return { offsets: Array.from(x), weights: Array.from(w) };
  const weights = new Array<number>(S + 1).fill(0);
  for (let i = 0; i < S; i++) { weights[i] += 0.5 * w[i]; weights[i + 1] += 0.5 * w[i]; }
  return { offsets: weights.map((_, i) => i - S / 2), weights };
}

// ---------------------------------------------------------------- Composite

/** TD Composite operations in TD menu order; the index is the shader op code.
 *  37 were measured against TD outputs, 9 fitted to the same data. */
export const COMP_OPS = [
  'add', 'atop', 'average', 'brightest', 'burncolor', 'burnlinear', 'chromadifference', 'color', 'darkercolor', 'difference',
  'dimmest', 'divide', 'dodge', 'exclude', 'freeze', 'glow', 'hardlight', 'hardmix', 'heat', 'hue',
  'inside', 'insideluminance', 'inverse', 'lightercolor', 'luminancedifference', 'maximum', 'minimum', 'multiply',
  'negate', 'outside', 'outsideluminance', 'over', 'overlay', 'pinlight', 'reflect', 'screen', 'softlight',
  'linearlight', 'stencilluminance', 'subtract', 'subtractive', 'under', 'vividlight', 'xor', 'yfilm', 'zfilm',
] as const;
export type CompOp = (typeof COMP_OPS)[number];
export const COMP_FITTED: readonly CompOp[] = ['burncolor', 'chromadifference', 'color', 'divide', 'freeze', 'hue', 'luminancedifference', 'yfilm', 'zfilm'];

/** Fitted coefficients for color/burncolor and luminancedifference (rows = output r, g, b). */
export const COMP_COLOR_Y = [0.29029125, 0.5699029, 0.13980582] as const;
export const COMP_COLOR_B = [
  [0.70970872, -0.56929602, -0.13980583],
  [-0.29029123, 0.43173089, -0.13980583],
  [-0.29029129, -0.57782309, 0.86019416],
] as const;
export const COMP_LUMDIFF_A = [
  [0.7038, -0.59008, -0.11372],
  [-0.29907, 0.4126, -0.11353],
  [-0.30675, -0.57636, 0.88311],
] as const;

/**
 * Overlay placement for the Composite transform page (prefit fill, justify
 * centre): TD maps the overlay forward as R·S·(p + t) — the translate is scaled
 * by sx/sy first, then rotated. Returns the overlay layer's centre in output UV
 * and the inverse rotate/scale needed by the shader.
 */
export function compOverlay(W: number, H: number, p: { tx?: number; ty?: number; rotate?: number; sx?: number; sy?: number }) {
  const asp = W / H, sx = p.sx ?? 1, sy = p.sy ?? 1;
  const th = ((p.rotate ?? 0) * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const ax = (p.tx ?? 0) * sx * asp, ay = (p.ty ?? 0) * sy;
  return {
    center: [0.5 + (c * ax - s * ay) / asp, 0.5 + (s * ax + c * ay)] as [number, number],
    xf: [c, s, 1 / (sx || 1e-6), 1 / (sy || 1e-6)] as [number, number, number, number],
    asp,
  };
}

/** Output UV → overlay UV (CPU mirror of the shader). */
export function compOverlayUV(u: number, v: number, W: number, H: number, p: Parameters<typeof compOverlay>[2]): [number, number] {
  const { center, xf, asp } = compOverlay(W, H, p);
  let dx = (u - center[0]) * asp, dy = v - center[1];
  [dx, dy] = [xf[0] * dx + xf[1] * dy, -xf[1] * dx + xf[0] * dy];
  return [(dx / asp) * xf[2] + 0.5, dy * xf[3] + 0.5];
}

// ---------------------------------------------------------------- Noise

export const NOISE_TYPES = [
  'perlin2d', 'perlin3d', 'perlin4d', 'simplex2d', 'simplex3d', 'simplex4d', 'random',
  'sparse', 'hermite', 'harmonic', 'alligator',
] as const;
export type NoiseType = (typeof NOISE_TYPES)[number];

/** Per-axis scale so P = 4·uv·ps − 2 equals TD's 4·pixel/max(w,h) − 2 (bottom-left anchored). */
export function noiseCoord(w: number, h: number, aspectcorrect = true): [number, number] {
  if (!aspectcorrect) return [1, 1];
  const m = Math.max(w, h);
  return [w / m, h / m];
}

/**
 * Measured TD seed → noise-space offset [x, y, z, w] per channel (null =
 * derived or hashed). Channel 1 always equals 2·channel0 − (½, ½, 0) (held for
 * all 12 measured seeds), so it is not stored. Seed 1 channel 0 is absolute
 * (a non-integer spread pinned the multiples of 256 too); the rest are
 * representatives valid for integer spreads.
 */
export const TD_NOISE_SEED: Record<string, ([number, number, number | null, number] | null)[]> = {
  0: [[154.5, 159.5, null, 0]],
  0.5: [[83.5, 28.5, null, 0]],
  1: [[428.5, -184.5, 201, 0], null, [123.5, 165.5, 529, 0]],
  2: [[126.5, 114.5, null, 0]],
  7: [[-374.5, 49.5, -460, 0]],
  1607: [[-189.5, -235.5, 204, 0], null, [-328.5, -148.5, -233, 0]],
  2591: [[-95.5, 244.5, 249, 0], null, [-25.5, 131.5, 81, 0]],
  2798: [[79.5, 147.5, 82, 0], null, [-102.5, 57.5, 195, 0]],
  3472: [[-123.5, -195.5, -76, 0], null, [-691.5, -417.5, -329, 0]],
  3524: [[126.5, 69.5, 198, 0], null, [23.5, 179.5, 21, 0]],
  3731: [[45.5, 228.5, 31, 0], null, [-309.5, -247.5, -256, 0]],
  4042: [[270.5, 52.5, 59, 0], null, [-174.5, -186.5, 70, 0]],
  6062: [[-7.5, -201.5, -188, 0], null, [-719.5, -612.5, -304, 0]],
  6321: [[-227.5, -117.5, -55, 0], null, [-137.5, -27.5, -188, 0]],
  8030: [[-128.5, -147.5, -228, 0], null, [-259.5, -491.5, -165, 0]],
  8134: [[-134.5, 20.5, 46, 0], null, [358.5, 8.5, 26, 0]],
};

/** Deterministic 32-bit FNV-1a string hash (for unmeasured seeds/axes). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Span of hashed offsets for unmeasured seeds (pattern differs from TD; statistics match). */
export const NOISE_SEED_SPAN = 1000;

/** Seed → per-channel offset [x, y, z, w]: measured values first, the channel-1
 *  rule second, a hash for whatever is still unknown (w defaults to 0). */
export function noiseSeedOffset(seed: number, c = 0): [number, number, number, number] {
  const row = TD_NOISE_SEED[String(seed)];
  let known = row?.[c] ?? null;
  const c0 = row?.[0] ?? null;
  if (!known && c === 1 && c0) known = [c0[0] * 2 - 0.5, c0[1] * 2 - 0.5, c0[2] != null ? c0[2] * 2 : null, (c0[3] ?? 0) * 2];
  const h = hash32(`td-noise:${seed}:${c}`);
  const hx = [h & 1023, (h >>> 10) & 1023, (h >>> 20) & 1023].map((x) => (x / 1023 - 0.5) * NOISE_SEED_SPAN);
  return [0, 1, 2, 3].map((i) => (known && known[i] != null ? (known[i] as number) : i < 3 ? hx[i] : 0)) as [number, number, number, number];
}

type M4 = number[]; // row-major 4×4

const m4 = (rows: number[][]): M4 => rows.flat();
export function m4mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
    o[r * 4 + c] = s;
  }
  return o;
}
const m4t = (x: number, y: number, z: number): M4 => m4([[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]);
const m4s = (x: number, y: number, z: number): M4 => m4([[x, 0, 0, 0], [0, y, 0, 0], [0, 0, z, 0], [0, 0, 0, 1]]);
function m4rot(rxDeg: number, ryDeg: number, rzDeg: number): M4 {
  const d = Math.PI / 180;
  const [a, b] = [Math.cos(rxDeg * d), Math.sin(rxDeg * d)];
  const [c, s] = [Math.cos(ryDeg * d), Math.sin(ryDeg * d)];
  const [e, f] = [Math.cos(rzDeg * d), Math.sin(rzDeg * d)];
  const Rx = m4([[1, 0, 0, 0], [0, a, -b, 0], [0, b, a, 0], [0, 0, 0, 1]]);
  const Ry = m4([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]);
  const Rz = m4([[e, -f, 0, 0], [f, e, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  return m4mul(Rx, m4mul(Ry, Rz)); // Euler order XYZ
}

export interface NoiseXformParams {
  tx?: number; ty?: number; tz?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
  px?: number; py?: number; pz?: number;
  xord?: string;
}

/**
 * Noise transform page (measured): applied to P/period, then the seed offset
 * is added per channel. Translate SUBTRACTS and is NOT divided by period;
 * rotate/scale are forward and pivot about P = −0.5 + pivot. The order of
 * period vs rotate/scale and the z pivot are inferred. Returns the row-major
 * 4×4 without the seed offset (callers add noiseSeedOffset per channel).
 */
export function noiseXform(p: NoiseXformParams, period: number): M4 {
  const o = [-0.5 + (p.px ?? 0), -0.5 + (p.py ?? 0), -0.5 + (p.pz ?? 0)];
  const Po = m4t(o[0], o[1], o[2]), Pi = m4t(-o[0], -o[1], -o[2]);
  const parts: Record<string, M4> = {
    s: m4mul(Po, m4mul(m4s(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1), Pi)),
    r: m4mul(Po, m4mul(m4rot(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0), Pi)),
    t: m4t(-(p.tx ?? 0), -(p.ty ?? 0), -(p.tz ?? 0)),
  };
  const k = 1 / Math.max(period, 1e-6);
  let M = m4s(k, k, k);
  for (const ch of (p.xord || 'srt').split('')) if (parts[ch]) M = m4mul(parts[ch], M);
  return M;
}

/** Approximations of TD's CPU noise types (not reproducible pixel-for-pixel):
 *  a base function is mapped through 33-point quantile tables onto the value
 *  distribution TD produces at harmon 0; k scales the lattice to match the
 *  correlation length; rule = octave weighting (1 gain^j normalised,
 *  2 rough^j, 3 flat). Multi-octave combination and exp are NOT matched. */
export const NOISE_CPU = {
  sparse: { k: 1.4, rule: 2, base: 'perlin', q: 'sparse' },
  harmonic: { k: 1.4, rule: 3, base: 'perlin', q: 'sparse' },
  hermite: { k: 1.2, rule: 1, base: 'perlin', q: 'hermite' },
  alligator: { k: 1.7, rule: 1, base: 'cell', q: 'alligator' },
} as const;

export const NOISE_Q: Record<'perlin3' | 'cell' | 'sparse' | 'hermite' | 'alligator', readonly number[]> = {
  perlin3: [-0.9494, -0.4958, -0.4221, -0.3666, -0.3228, -0.2865, -0.2543, -0.2242, -0.1955, -0.1681, -0.1418, -0.1161, -0.0913, -0.0671, -0.0442, -0.0216, 0.0002, 0.0219, 0.0444, 0.0677, 0.0915, 0.1162, 0.1416, 0.1678, 0.1956, 0.2238, 0.2542, 0.2863, 0.3219, 0.3659, 0.4218, 0.4959, 0.9600],
  cell: [0.0000, 0.0027, 0.0063, 0.0106, 0.0154, 0.0207, 0.0266, 0.0331, 0.0403, 0.0479, 0.0563, 0.0651, 0.0747, 0.0849, 0.0961, 0.1077, 0.1205, 0.1345, 0.1495, 0.1661, 0.1841, 0.2039, 0.2256, 0.2500, 0.2771, 0.3085, 0.3442, 0.3860, 0.4367, 0.4994, 0.5838, 0.7102, 0.9999],
  sparse: [-1.9689, -0.8471, -0.6764, -0.5792, -0.5034, -0.4391, -0.3814, -0.3295, -0.2815, -0.2374, -0.1988, -0.1661, -0.1394, -0.1153, -0.0919, -0.0701, -0.0499, -0.0317, -0.0150, -0.0001, 0.0134, 0.0293, 0.0464, 0.0642, 0.0830, 0.1026, 0.1254, 0.1540, 0.1929, 0.2480, 0.3354, 0.4838, 0.9201],
  hermite: [-0.9263, -0.5521, -0.4842, -0.4349, -0.3878, -0.3496, -0.3151, -0.2781, -0.2485, -0.2178, -0.1886, -0.1610, -0.1357, -0.1111, -0.0888, -0.0641, -0.0394, -0.0151, 0.0084, 0.0310, 0.0544, 0.0810, 0.1101, 0.1416, 0.1741, 0.2089, 0.2466, 0.2856, 0.3279, 0.3751, 0.4367, 0.5098, 0.8883],
  alligator: [0.0000, 0.0000, 0.0000, 0.0000, 0.0008, 0.0022, 0.0041, 0.0063, 0.0091, 0.0122, 0.0156, 0.0196, 0.0240, 0.0289, 0.0343, 0.0404, 0.0468, 0.0538, 0.0617, 0.0705, 0.0805, 0.0920, 0.1047, 0.1188, 0.1340, 0.1510, 0.1702, 0.1949, 0.2281, 0.2746, 0.3572, 0.4936, 0.9520],
};

// -------- noise lookup tables (third-party; see file header) --------

/** Ken Perlin, Improved Noise reference implementation (2002): permutation[256]. */
export const PERM: readonly number[] = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23,
  190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74,
  165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161,
  1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5,
  202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153,
  101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12,
  191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236,
  205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];

/** 3D gradients: Perlin's 12 cube-edge midpoints, padded to 16 by Gustavson. */
export const GRAD3: readonly (readonly [number, number, number])[] = [[0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0], [1, 0, -1], [-1, 0, -1], [0, -1, 1], [0, 1, 1]];

/** 4D gradients: Gustavson's 32 tesseract-edge midpoints. */
export const GRAD4: readonly (readonly [number, number, number, number])[] = [[0, 1, 1, 1], [0, 1, 1, -1], [0, 1, -1, 1], [0, 1, -1, -1], [0, -1, 1, 1], [0, -1, 1, -1], [0, -1, -1, 1], [0, -1, -1, -1],
  [1, 0, 1, 1], [1, 0, 1, -1], [1, 0, -1, 1], [1, 0, -1, -1], [-1, 0, 1, 1], [-1, 0, 1, -1], [-1, 0, -1, 1], [-1, 0, -1, -1],
  [1, 1, 0, 1], [1, 1, 0, -1], [1, -1, 0, 1], [1, -1, 0, -1], [-1, 1, 0, 1], [-1, 1, 0, -1], [-1, -1, 0, 1], [-1, -1, 0, -1],
  [1, 1, 1, 0], [1, 1, -1, 0], [1, -1, 1, 0], [1, -1, -1, 0], [-1, 1, 1, 0], [-1, 1, -1, 0], [-1, -1, 1, 0], [-1, -1, -1, 0]];

/** Gustavson's 3D/4D simplex traversal table (64 entries indexed by six pairwise comparisons). */
export const SIMPLEX4: readonly (readonly [number, number, number, number])[] = [[0, 64, 128, 192], [0, 64, 192, 128], [0, 0, 0, 0], [0, 128, 192, 64], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [64, 128, 192, 0],
  [0, 128, 64, 192], [0, 0, 0, 0], [0, 192, 64, 128], [0, 192, 128, 64], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [64, 192, 128, 0],
  [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
  [64, 128, 0, 192], [0, 0, 0, 0], [64, 192, 0, 128], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [128, 192, 0, 64], [128, 192, 64, 0],
  [64, 0, 128, 192], [64, 0, 192, 128], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [128, 0, 192, 64], [0, 0, 0, 0], [128, 64, 192, 0],
  [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
  [128, 0, 64, 192], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [192, 0, 64, 128], [192, 0, 128, 64], [0, 0, 0, 0], [192, 64, 128, 0],
  [128, 64, 0, 192], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [192, 64, 0, 128], [0, 0, 0, 0], [192, 128, 0, 64], [192, 128, 64, 0]];

/**
 * Gradient component as TD's table-texture version reads it: the 8-bit texel
 * (g·64 + 64) / 255 · 4 − 1, i.e. −1, 1/255 and 257/255 — not exactly −1/0/1.
 * The shaders and the CPU references reproduce this on purpose.
 */
export const gradByte = (g: number): number => ((g * 64 + 64) / 255) * 4 - 1;
