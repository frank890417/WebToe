/**
 * CPU reference implementations of the TouchDesigner-faithful TOP formulas
 * (double precision, line-for-line with the shaders in packages/ops/src/top).
 * Ported from the CPU references (`ref.js`) of the author's production web port — the
 * same mirrors that were checked against TouchDesigner outputs there.
 * Used by top-fidelity*.test.ts and td-golden.test.ts.
 *
 * Images are Float32Array/Float64Array RGBA, row 0 = bottom row (TD/GL order).
 */
import {
  COMP_COLOR_B, COMP_COLOR_Y, COMP_LUMDIFF_A, GRAD3, GRAD4, NOISE_CPU, NOISE_Q, PERM, SIMPLEX4,
  blurKernel, clamp, type BlurType, type CompOp,
} from '../packages/ops/src/top/tdmath';

type RGBA = [number, number, number, number];

// ---------------------------------------------------------------- Level

export interface LevelParams {
  invert?: number; blacklevel?: number; brightness1?: number; gamma1?: number; contrast?: number;
  inlow?: number; inhigh?: number; outlow?: number; outhigh?: number;
  low?: RGBA; high?: RGBA; gamma2?: number; brightness2?: number;
  clamp?: boolean; clamplow2?: number; clamphigh2?: number; premultrgbbyalpha?: boolean; opacity?: number;
  /** clamp the input and after brightness1 (TD automatic mode on 8-bit input; WebToe always) */
  clampinput?: boolean;
}

export function levelRef(rgba: readonly number[], p: LevelParams = {}): RGBA {
  const cin = p.clampinput ?? true;
  const inv = p.invert ?? 0, bl = p.blacklevel ?? 0, b1 = p.brightness1 ?? 1, g1 = p.gamma1 ?? 1, ct = p.contrast ?? 1;
  const il = p.inlow ?? 0, ih = p.inhigh ?? 1, ol = p.outlow ?? 0, oh = p.outhigh ?? 1;
  const g2 = p.gamma2 ?? 1, b2 = p.brightness2 ?? 1, op = p.opacity ?? 1;
  const lo = p.low ?? [0, 0, 0, 0], hi = p.high ?? [1, 1, 1, 1];
  const gam = (x: number, g: number) => (g === 1 ? x : Math.pow(Math.max(x, 0), 1 / g));
  const out: RGBA = [0, 0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let x = rgba[c];
    if (cin) x = clamp(x, 0, 1);
    x = x + inv * (1 - 2 * x);
    x = bl >= 1 ? 0 : (x - bl) / (1 - bl);
    x = x * b1;
    if (cin) x = clamp(x, 0, 1);
    x = gam(x, g1);
    x = (x - 0.5) * ct + 0.5;
    x = (x - il) / (ih === il ? 1 : ih - il);
    x = ol + x * (oh - ol);
    x = lo[c] + x * (hi[c] - lo[c]);
    x = gam(x, g2);
    x = x * b2;
    out[c] = x;
  }
  const al = lo[3] + rgba[3] * (hi[3] - lo[3]);
  if (p.clamp) for (let c = 0; c < 3; c++) out[c] = clamp(out[c], p.clamplow2 ?? 0, p.clamphigh2 ?? 1);
  if (p.premultrgbbyalpha) for (let c = 0; c < 3; c++) out[c] *= al;
  for (let c = 0; c < 3; c++) out[c] *= op;
  out[3] = al * op;
  return out;
}

// ---------------------------------------------------------------- channels / sampling

export const CHAN: Record<string, (c: readonly number[]) => number> = {
  luminance: (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2],
  red: (c) => c[0], green: (c) => c[1], blue: (c) => c[2], alpha: (c) => c[3],
  rgbaverage: (c) => (c[0] + c[1] + c[2]) / 3, average: (c) => (c[0] + c[1] + c[2] + c[3]) / 4,
  rgbmax: (c) => Math.max(c[0], c[1], c[2]), max: (c) => Math.max(c[0], c[1], c[2], c[3]),
  zero: () => 0, one: () => 1,
};

/** Pixel with clamped (hold) coordinates. */
export function px(img: ArrayLike<number>, W: number, H: number, x: number, y: number): RGBA {
  x = clamp(x, 0, W - 1); y = clamp(y, 0, H - 1);
  const o = (y * W + x) * 4;
  return [img[o], img[o + 1], img[o + 2], img[o + 3]];
}

/** Bilinear sample in pixel coordinates (pixel i centre = i), hold at edges. */
export function bilinearAt(img: ArrayLike<number>, W: number, H: number, fx: number, fy: number): RGBA {
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const a = px(img, W, H, x0, y0), b = px(img, W, H, x0 + 1, y0), c = px(img, W, H, x0, y0 + 1), d = px(img, W, H, x0 + 1, y0 + 1);
  return [0, 1, 2, 3].map((i) => (1 - ty) * ((1 - tx) * a[i] + tx * b[i]) + ty * ((1 - tx) * c[i] + tx * d[i])) as RGBA;
}

// ---------------------------------------------------------------- Edge

export interface EdgeParams {
  strength?: number; select?: string; blacklevel?: number; offsetx?: number; offsety?: number;
  edgecolor?: RGBA; premultrgbbyalpha?: boolean; compinput?: boolean;
}

export function edgeRef(img: ArrayLike<number>, W: number, H: number, p: EdgeParams = {}): Float64Array {
  const ch = CHAN[p.select ?? 'luminance'] ?? CHAN.luminance, out = new Float64Array(W * H * 4);
  const ox = p.offsetx ?? 1, oy = p.offsety ?? ox, bl = p.blacklevel ?? 0, k = Math.sqrt(Math.max(0, 1 - bl));
  const col = p.edgecolor ?? [1, 1, 1, 1], pm = (p.premultrgbbyalpha ?? true) ? col[3] : 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const T = (dx: number, dy: number) => ch(bilinearAt(img, W, H, x + dx * ox, y + dy * oy));
    const gx = (T(1, -1) + 2 * T(1, 0) + T(1, 1)) - (T(-1, -1) + 2 * T(-1, 0) + T(-1, 1));
    const gy = (T(-1, 1) + 2 * T(0, 1) + T(1, 1)) - (T(-1, -1) + 2 * T(0, -1) + T(1, -1));
    const g = Math.sqrt(Math.max(0, p.strength ?? 1) * (gx * gx / Math.max(Math.abs(ox), 1e-3) + gy * gy / Math.max(Math.abs(oy), 1e-3)));
    const e = clamp(g * k - bl, 0, 1);
    let c: RGBA = [e * col[0] * pm, e * col[1] * pm, e * col[2] * pm, e * col[3]];
    if (p.compinput) c = compRef('over', c, px(img, W, H, x, y));
    out.set(c, (y * W + x) * 4);
  }
  return out;
}

// ---------------------------------------------------------------- Composite

const l3 = (c: readonly number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const t709 = (c: readonly number[]) => clamp((0.2125 * c[0] + 0.7154 * c[1] + 0.0721 * c[2] - 0.45) / 0.1, 0, 1);
const V3 = (f: (i: number) => number): [number, number, number] => [f(0), f(1), f(2)];

/** Hocevar RGB↔HSV (same form as the shaders). */
export function rgbToHsv([r, g, b]: readonly number[]): [number, number, number] {
  const K = [0, -1 / 3, 2 / 3, -1];
  const p = g < b ? [b, g, K[3], K[2]] : [g, b, K[0], K[1]];
  const q = r < p[0] ? [p[0], p[1], p[3], r] : [r, p[1], p[2], p[0]];
  const d = q[0] - Math.min(q[3], q[1]), e = 1e-10;
  return [Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e)), d / (q[0] + e), q[0]];
}
export function hsvToRgb([h, s, v]: readonly number[]): [number, number, number] {
  return [1, 2 / 3, 1 / 3].map((k) => { const x = h + k, p = Math.abs((x - Math.floor(x)) * 6 - 3); return v * (1 + (clamp(p - 1, 0, 1) - 1) * s); }) as [number, number, number];
}

/** One composite step, A = upper layer (first input), B = lower; premultiplied RGBA. */
export function compRef(op: CompOp, A: readonly number[], B: readonly number[]): RGBA {
  const ca = clamp(A[3], 0, 1), cb = clamp(B[3], 0, 1);
  const X = [A[0], A[1], A[2]], Y = V3((i) => (B[3] !== 0 ? clamp(B[i] / B[3], 0, 1) : 0));
  const mixB = (f: readonly number[]): RGBA => [...V3((i) => X[i] * (1 - B[3]) + f[i] * B[3]), A[3]];
  const all = (f: (i: number) => number): RGBA => [f(0), f(1), f(2), f(3)];
  const op1 = (f: readonly number[]): RGBA => [f[0], f[1], f[2], 1];
  switch (op) {
    case 'add': return all((i) => A[i] + B[i]);
    case 'subtract': return all((i) => A[i] - B[i]);
    case 'multiply': return all((i) => A[i] * B[i]);
    case 'screen': return all((i) => A[i] + B[i] - A[i] * B[i]);
    case 'average': return all((i) => (A[i] + B[i]) * 0.5);
    case 'maximum': return all((i) => Math.max(A[i], B[i]));
    case 'minimum': return all((i) => Math.min(A[i], B[i]));
    case 'over': return all((i) => A[i] + B[i] * (1 - ca));
    case 'under': return all((i) => B[i] + A[i] * (1 - cb));
    case 'atop': return [...V3((i) => A[i] * B[3] + B[i] * (1 - ca)), B[3]];
    case 'inside': return all((i) => A[i] * cb);
    case 'outside': return all((i) => A[i] * (1 - cb));
    case 'xor': return all((i) => A[i] * (1 - cb) + B[i] * (1 - ca));
    case 'difference': return op1(V3((i) => Math.abs(A[i] - B[i])));
    case 'negate': return op1(V3((i) => 1 - Math.abs(1 - A[i] - B[i])));
    case 'exclude': return op1(V3((i) => A[i] + B[i] - 2 * A[i] * B[i]));
    case 'dodge': return op1(V3((i) => A[i] / (1 - B[i])));
    case 'brightest': return (l3(A) > l3(B) ? [...A] : [...B]) as RGBA;
    case 'dimmest': return (l3(A) < l3(B) ? [...A] : [...B]) as RGBA;
    case 'insideluminance': return all((i) => A[i] * clamp(l3(B), 0, 1));
    case 'outsideluminance': return all((i) => A[i] * (1 - clamp(l3(B), 0, 1)));
    case 'stencilluminance': return [X[0], X[1], X[2], clamp(l3(B), 0, 1)];
    case 'subtractive': return [...V3((i) => A[i] - B[i] * B[3]), A[3] + B[3]];
    case 'overlay': { const t = t709(X); const r = mixB(V3((i) => 2 * X[i] * Y[i] + (1 - 2 * (1 - X[i]) * (1 - Y[i]) - 2 * X[i] * Y[i]) * t)); return [r[0], r[1], r[2], 1]; }
    case 'hardlight': { const t = t709(Y); return mixB(V3((i) => 2 * X[i] * Y[i] + (1 - 2 * (1 - X[i]) * (1 - Y[i]) - 2 * X[i] * Y[i]) * t)); }
    case 'softlight': return mixB(V3((i) => (1 - 2 * Y[i]) * X[i] * X[i] + 2 * X[i] * Y[i]));
    case 'darkercolor': return mixB(l3(X) < l3(Y) ? X : Y);
    case 'lightercolor': return mixB(l3(X) > l3(Y) ? X : Y);
    case 'burnlinear': return mixB(V3((i) => clamp(X[i] + Y[i] - 1, 0, 1)));
    case 'linearlight': return mixB(V3((i) => X[i] + 2 * Y[i] - 1));
    case 'pinlight': return mixB(V3((i) => (Y[i] < 0.5 ? Math.min(X[i], 2 * Y[i]) : Math.max(X[i], 2 * Y[i] - 1))));
    case 'hardmix': return mixB(V3((i) => (X[i] + Y[i] >= 1 ? 1 : 0)));
    case 'vividlight': return mixB(V3((i) => clamp(Y[i] < 0.5 ? 1 - (1 - X[i]) / (2 * Y[i]) : X[i] / (2 * (1 - Y[i])), 0, 1)));
    case 'inverse': return mixB(V3((i) => Y[i] / (1 - X[i])));
    case 'glow': return mixB(V3((i) => (Y[i] * Y[i]) / (1 - X[i])));
    case 'reflect': return mixB(V3((i) => (X[i] * X[i]) / (1 - Y[i])));
    case 'heat': return mixB(V3((i) => 1 - ((1 - Y[i]) * (1 - Y[i])) / X[i]));
    case 'color': case 'burncolor': {
      const y = COMP_COLOR_Y[0] * X[0] + COMP_COLOR_Y[1] * X[1] + COMP_COLOR_Y[2] * X[2];
      return mixB(V3((i) => y + COMP_COLOR_B[i][0] * Y[0] + COMP_COLOR_B[i][1] * Y[1] + COMP_COLOR_B[i][2] * Y[2]));
    }
    case 'hue': { const a = rgbToHsv(X); return mixB(hsvToRgb([rgbToHsv(Y)[0], a[1], a[2]])); }
    case 'chromadifference': { const a = rgbToHsv(X), h = a[0] - rgbToHsv(B)[0]; return op1(hsvToRgb([h - Math.floor(h), a[1], a[2]])); }
    case 'luminancedifference': { const d = Math.abs(l3(A) - l3(B)); return op1(V3((i) => d + COMP_LUMDIFF_A[i][0] * A[0] + COMP_LUMDIFF_A[i][1] * A[1] + COMP_LUMDIFF_A[i][2] * A[2])); }
    case 'divide': return all((i) => A[i] / (B[i] === 0 ? 1 : B[i]));
    case 'freeze': return op1(V3((i) => 1 - ((1 - A[i]) * (1 - A[i])) / B[i]));
    case 'yfilm': return op1(V3((i) => 2 * A[i] - (A[i] * A[i]) / (1 - B[i])));
    case 'zfilm': return op1(V3((i) => 4 * A[i] - 9 * B[i] + 6 * (1 - Math.abs(1 - A[i] - B[i]))));
  }
}

// ---------------------------------------------------------------- Ramp

export function rampRef(t: number, keys: readonly (readonly number[])[], o: { interp?: string; extendleft?: string; extendright?: string; tension?: number } = {}): RGBA {
  const interp = o.interp ?? 'linear', tension = o.tension ?? 0;
  const color = (tt: number): RGBA => {
    let k0 = 0;
    for (let i = 1; i < keys.length; i++) if (keys[i][0] <= tt) k0 = i;
    const last = keys.length - 1, k1 = Math.min(k0 + 1, last), span = keys[k1][0] - keys[k0][0];
    let f = tt - keys[k0][0];
    if (span > 0) f /= span;
    const c0 = keys[k0].slice(1), c1 = keys[k1].slice(1);
    if (interp === 'step') return c0 as RGBA;
    if (interp === 'hermite') {
      const cp = keys[Math.max(k0 - 1, 0)].slice(1), cn = keys[Math.min(k0 + 2, last)].slice(1), f2 = f * f, f3 = f2 * f;
      return c0.map((_, j) => {
        const m0 = (1 - tension) * 0.5 * (c1[j] - cp[j]), m1 = (1 - tension) * 0.5 * (cn[j] - c0[j]);
        return (2 * f3 - 3 * f2 + 1) * c0[j] + (f3 - 2 * f2 + f) * m0 + (f3 - f2) * m1 + (3 * f2 - 2 * f3) * c1[j];
      }) as RGBA;
    }
    if (interp === 'easeineaseout') f = 0.5 - 0.5 * Math.cos(Math.PI * clamp(f, 0, 1));
    return c0.map((v, j) => v + (c1[j] - v) * f) as RGBA;
  };
  const fold = (tt: number, m: string) => {
    if (m === 'repeat') return tt - Math.floor(tt);
    if (m === 'mirror') { const x = Math.abs(tt) % 2; return x > 1 ? 2 - x : x; }
    return clamp(tt, 0, 1);
  };
  const outside = (tt: number, m: string): RGBA => (m === 'zero' ? [0, 0, 0, 0] : m === 'black' ? [0, 0, 0, 1] : color(fold(tt, m)));
  const eL = o.extendleft ?? 'repeat', eR = (o.extendright ?? 'sameasleft') === 'sameasleft' ? eL : o.extendright!;
  if (t < 0) return outside(t, eL);
  if (t > 1) return outside(t, eR);
  return color(t);
}

/** Ramp parameter t at pixel-centre UV (u, v). */
export function rampCoord(type: string, u: number, v: number, o: { phase?: number; period?: number; aspect?: [number, number]; position?: [number, number] } = {}): number {
  const phase = o.phase ?? 0, period = o.period ?? 1, aspect = o.aspect ?? [1, 1], pos = o.position ?? [0, 0];
  let t: number;
  if (type === 'vertical') t = v;
  else if (type === 'horizontal') t = u;
  else {
    const x = (u - 0.5 - pos[0]) * aspect[0], y = (v - 0.5 - pos[1]) * aspect[1];
    if (type === 'radial') { t = Math.atan2(y, x) / 6.2831853; if (t < 0) t += 1; } else t = 2 * Math.hypot(x, y);
  }
  return type === 'horizontal' || type === 'vertical' ? (t - phase) / period : t / period - phase;
}

// ---------------------------------------------------------------- Blur

function lerpAt(get: (i: number) => number, n: number, c: number): number {
  const i0 = Math.floor(c), t = c - i0;
  const a = get(clamp(i0, 0, n - 1)), b = get(clamp(i0 + 1, 0, n - 1));
  return a + (b - a) * t;
}
/** Resample a single-channel image to w×h with one bilinear tap per target pixel centre. */
export function resample(img: ArrayLike<number>, W: number, H: number, w: number, h: number): Float64Array {
  const tmp = new Float64Array(w * H), out = new Float64Array(w * h);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) tmp[y * w + x] = lerpAt((i) => img[y * W + i], W, ((x + 0.5) * W) / w - 0.5);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out[y * w + x] = lerpAt((j) => tmp[j * w + x], H, ((y + 0.5) * H) / h - 0.5);
  return out;
}
function blurPass(img: Float64Array, w: number, h: number, S: number, type: BlurType, step: number, dirX: boolean): Float64Array {
  const { x: xs, w: ws } = blurKernel(S, type), out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = 0; i < ws.length; i++) {
      const d = xs[i] * step;
      s += ws[i] * (dirX ? lerpAt((k) => img[y * w + k], w, x + d) : lerpAt((k) => img[k * w + x], h, y + d));
    }
    out[y * w + x] = s;
  }
  return out;
}

export interface BlurParams { type?: BlurType; size?: number; preshrink?: number; offsetx?: number; offsety?: number; filterscalex?: number; filterscaley?: number }

/** Blur TOP on one channel: optional one-tap bilinear preshrink → horizontal then vertical kernel → bilinear back up. */
export function blurRef(img: ArrayLike<number>, W: number, H: number, p: BlurParams = {}): Float64Array {
  const ps = Math.max(1, Math.round(p.preshrink ?? 1)), type = p.type ?? 'catmull', size = p.size ?? 7;
  const w = ps > 1 ? Math.max(1, Math.round(W / ps)) : W, h = ps > 1 ? Math.max(1, Math.round(H / ps)) : H;
  let cur = ps > 1 ? resample(img, W, H, w, h) : Float64Array.from(img);
  const Sx = Math.round(size * (p.filterscalex ?? 1)), Sy = Math.round(size * (p.filterscaley ?? 1));
  const stx = p.offsetx ?? 1, sty = p.offsety ?? 1;
  if (Sx > 1 && stx !== 0) cur = blurPass(cur, w, h, Sx, type, stx, true);
  if (Sy > 1 && sty !== 0) cur = blurPass(cur, w, h, Sy, type, sty, false);
  return ps > 1 ? resample(cur, w, h, W, H) : cur;
}

// ---------------------------------------------------------------- Noise (Gustavson table version)

const ONE = 1 / 256, ONEHALF = 0.5 / 256;

/** Gustavson's 256×256 permutation texture (RGBA8): texel (x=j, y=i) = PERM[(j + PERM[i]) & 255], RGB = grad3·64+64, A = value. */
export function permTextureData(): Uint8Array {
  const d = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < 256; i++) for (let j = 0; j < 256; j++) {
    const o = (i * 256 + j) * 4, v = PERM[(j + PERM[i]) & 255], g = GRAD3[v & 15];
    d[o] = g[0] * 64 + 64; d[o + 1] = g[1] * 64 + 64; d[o + 2] = g[2] * 64 + 64; d[o + 3] = v;
  }
  return d;
}
/** Gustavson's 4D gradient texture: RGBA = grad4[value & 31]·64+64. */
export function gradTextureData(): Uint8Array {
  const d = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < 256; i++) for (let j = 0; j < 256; j++) {
    const o = (i * 256 + j) * 4, v = PERM[(j + PERM[i]) & 255], g = GRAD4[v & 31];
    d[o] = g[0] * 64 + 64; d[o + 1] = g[1] * 64 + 64; d[o + 2] = g[2] * 64 + 64; d[o + 3] = g[3] * 64 + 64;
  }
  return d;
}
let TEX: { perm: Uint8Array; grad: Uint8Array; simp: Uint8Array } | null = null;
const tex = () => (TEX ??= { perm: permTextureData(), grad: gradTextureData(), simp: Uint8Array.from(SIMPLEX4.flat()) });
/** NEAREST + REPEAT texture fetch of channel k at (u, v), as unorm. */
export const t2 = (T: Uint8Array, u: number, v: number, k: number) => {
  const x = ((Math.floor(u * 256) % 256) + 256) % 256, y = ((Math.floor(v * 256) % 256) + 256) % 256;
  return T[(y * 256 + x) * 4 + k] / 255;
};
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function perlin2Ref(x: number, y: number): number {
  const { perm } = tex();
  const Pi = [ONE * Math.floor(x) + ONEHALF, ONE * Math.floor(y) + ONEHALF], fx = x - Math.floor(x), fy = y - Math.floor(y);
  const g = (ox: number, oy: number) => [t2(perm, Pi[0] + ox * ONE, Pi[1] + oy * ONE, 0) * 4 - 1, t2(perm, Pi[0] + ox * ONE, Pi[1] + oy * ONE, 1) * 4 - 1];
  const d = (G: number[], a: number, b: number) => G[0] * a + G[1] * b;
  const n00 = d(g(0, 0), fx, fy), n10 = d(g(1, 0), fx - 1, fy), n01 = d(g(0, 1), fx, fy - 1), n11 = d(g(1, 1), fx - 1, fy - 1);
  const u = fade(fx), v = fade(fy);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}
export function perlin3Ref(x: number, y: number, z: number): number {
  const { perm } = tex(), P = [x, y, z], Pi = P.map((q) => ONE * Math.floor(q) + ONEHALF), Pf = P.map((q) => q - Math.floor(q));
  const n: Record<string, number> = {};
  for (const ox of [0, 1]) for (const oy of [0, 1]) {
    const pm = t2(perm, Pi[0] + ox * ONE, Pi[1] + oy * ONE, 3);
    for (const oz of [0, 1]) {
      const g = [0, 1, 2].map((k) => t2(perm, pm, Pi[2] + oz * ONE, k) * 4 - 1);
      n[`${ox}${oy}${oz}`] = g[0] * (Pf[0] - ox) + g[1] * (Pf[1] - oy) + g[2] * (Pf[2] - oz);
    }
  }
  const [fx, fy, fz] = Pf.map(fade);
  const y0 = lerp(lerp(n['000'], n['100'], fx), lerp(n['010'], n['110'], fx), fy);
  const y1 = lerp(lerp(n['001'], n['101'], fx), lerp(n['011'], n['111'], fx), fy);
  return lerp(y0, y1, fz);
}
export function perlin4Ref(x: number, y: number, z: number, w: number): number {
  const { perm, grad } = tex(), P = [x, y, z, w], Pi = P.map((q) => ONE * Math.floor(q) + ONEHALF), Pf = P.map((q) => q - Math.floor(q));
  const pxy = (a: number, b: number) => t2(perm, Pi[0] + a * ONE, Pi[1] + b * ONE, 3), pzw = (a: number, b: number) => t2(perm, Pi[2] + a * ONE, Pi[3] + b * ONE, 3);
  const n = (a: number, b: number, c: number, d: number) => {
    const u = pxy(a, b), v = pzw(c, d), o = [a, b, c, d];
    return [0, 1, 2, 3].reduce((s, k) => s + (t2(grad, u, v, k) * 4 - 1) * (Pf[k] - o[k]), 0);
  };
  const [fx, fy, fz, fw] = Pf.map(fade);
  const X = (b: number, c: number, d: number) => lerp(n(0, b, c, d), n(1, b, c, d), fx);
  const Y = (c: number, d: number) => lerp(X(0, c, d), X(1, c, d), fy);
  const Z = (d: number) => lerp(Y(0, d), Y(1, d), fz);
  return lerp(Z(0), Z(1), fw);
}
export function simplex2Ref(x: number, y: number): number {
  const { perm } = tex(), F2 = 0.366025403784, G2 = 0.211324865405;
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
  const Pi = [i * ONE + ONEHALF, j * ONE + ONEHALF], f0 = [x - (i - t), y - (j - t)], o1 = f0[0] > f0[1] ? [1, 0] : [0, 1];
  const corner = (f: number[], o: number[]) => {
    const g0 = t2(perm, Pi[0] + o[0] * ONE, Pi[1] + o[1] * ONE, 0) * 4 - 1, g1 = t2(perm, Pi[0] + o[0] * ONE, Pi[1] + o[1] * ONE, 1) * 4 - 1;
    let q = 0.5 - f[0] * f[0] - f[1] * f[1];
    if (q < 0) return 0;
    q *= q;
    return q * q * (g0 * f[0] + g1 * f[1]);
  };
  return 70 * (corner(f0, [0, 0]) + corner([f0[0] - o1[0] + G2, f0[1] - o1[1] + G2], o1) + corner([f0[0] - 1 + 2 * G2, f0[1] - 1 + 2 * G2], [1, 1]));
}
/** 3D/4D simplex sharing Gustavson's 64-entry traversal table. */
export function simplexNRef(P: number[]): number {
  const { perm, grad, simp } = tex(), D = P.length, F = D === 3 ? 0.333333333333 : 0.309016994375, G = D === 3 ? 0.166666666667 : 0.138196601125;
  const s = P.reduce((a, b) => a + b, 0) * F, I = P.map((q) => Math.floor(q + s)), t = I.reduce((a, b) => a + b, 0) * G;
  const Pi = I.map((q) => q * ONE + ONEHALF), f0 = P.map((q, k) => q - (I[k] - t));
  let si = (f0[0] > f0[1] ? 0.5078125 : 0.0078125) + (f0[0] > f0[2] ? 0.25 : 0) + (f0[1] > f0[2] ? 0.125 : 0);
  if (D === 4) si += (f0[0] > f0[3] ? 0.0625 : 0) + (f0[1] > f0[3] ? 0.03125 : 0) + (f0[2] > f0[3] ? 0.015625 : 0);
  const idx = ((Math.floor(si * 64) % 64) + 64) % 64, off = [0, 1, 2, 3].map((k) => simp[idx * 4 + k] / 255);
  const th = D === 3 ? [0.375, 0.125] : [0.625, 0.375, 0.125];
  const corner = (f: number[], o: number[]) => {
    let g: number[];
    if (D === 3) {
      const pm = t2(perm, Pi[0] + o[0] * ONE, Pi[1] + o[1] * ONE, 3);
      g = [0, 1, 2].map((k) => t2(perm, pm, Pi[2] + o[2] * ONE, k) * 4 - 1);
    } else {
      const a = t2(perm, Pi[0] + o[0] * ONE, Pi[1] + o[1] * ONE, 3), b = t2(perm, Pi[2] + o[2] * ONE, Pi[3] + o[3] * ONE, 3);
      g = [0, 1, 2, 3].map((k) => t2(grad, a, b, k) * 4 - 1);
    }
    let q = 0.6 - f.reduce((a, v) => a + v * v, 0);
    if (q < 0) return 0;
    q *= q;
    return q * q * f.reduce((a, v, k) => a + v * g[k], 0);
  };
  let sum = corner(f0, new Array(D).fill(0));
  th.forEach((h, m) => { const o = off.slice(0, D).map((v) => (v >= h ? 1 : 0)); sum += corner(f0.map((v, k) => v - o[k] + (m + 1) * G), o); });
  sum += corner(f0.map((v) => v - 1 + D * G), new Array(D).fill(1));
  return (D === 3 ? 32 : 27) * sum;
}

export const BASIS_REF: Record<string, (t: number[]) => number> = {
  perlin2d: (t) => perlin2Ref(t[0], t[1]), perlin3d: (t) => perlin3Ref(t[0], t[1], t[2]), perlin4d: (t) => perlin4Ref(t[0], t[1], t[2], t[3]),
  simplex2d: (t) => simplex2Ref(t[0], t[1]), simplex3d: (t) => simplexNRef(t.slice(0, 3)), simplex4d: (t) => simplexNRef(t),
};

export interface NoiseChainParams { harmon?: number; spread?: number; gain?: number; exp?: number; amp?: number; offset?: number }

/**
 * One channel of the Noise TOP's GPU types: P = 4·uv·ps − 2 → M (row-major
 * noiseXform) + seed offset → octaves Σ basis(t·spread^j)·gain^j → ×amp →
 * sign·|n|^exp → + offset.
 */
export function noiseGpuRef(type: string, u: number, v: number, M: readonly number[], ps: readonly number[], seed: readonly number[], w4: number, p: NoiseChainParams = {}): number {
  const Px = 4 * u * ps[0] - 2, Py = 4 * v * ps[1] - 2, B = BASIS_REF[type];
  let t = [M[0] * Px + M[1] * Py + M[3] + seed[0], M[4] * Px + M[5] * Py + M[7] + seed[1], M[8] * Px + M[9] * Py + M[11] + seed[2], w4 + seed[3]];
  let n = 0, a = 1;
  for (let j = 0; j <= Math.round(p.harmon ?? 2); j++) { n += B(t) * a; t = t.map((q) => q * (p.spread ?? 2)); a *= p.gain ?? 0.7; }
  n *= p.amp ?? 0.5;
  return Math.sign(n) * Math.abs(n) ** (p.exp ?? 1) + (p.offset ?? 0.5);
}

/** Hoskins "hash without sine" hash13 variant (MIT, see THIRD_PARTY_NOTICES.md). */
export function h31(x: number, y: number, z: number): number {
  const fr = (q: number) => q - Math.floor(q);
  let a = fr(x * 0.1031), b = fr(y * 0.1030), c = fr(z * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fr((a + b) * c);
}

/** CPU-type approximation, one channel (statistics only). */
export function noiseCpuRef(type: keyof typeof NOISE_CPU, u: number, v: number, M: readonly number[], ps: readonly number[], seed: readonly number[], p: NoiseChainParams & { rough?: number } = {}): number {
  const C = NOISE_CPU[type], qs = C.base === 'cell' ? NOISE_Q.cell : NOISE_Q.perlin3, qt = NOISE_Q[C.q];
  const qmap = (val: number) => {
    if (val <= qs[0]) return qt[0];
    for (let i = 1; i < qs.length; i++) if (val <= qs[i]) return qt[i - 1] + ((qt[i] - qt[i - 1]) * (val - qs[i - 1])) / Math.max(qs[i] - qs[i - 1], 1e-6);
    return qt[qt.length - 1];
  };
  const cell = (x: number, y: number, z: number) => {
    const c = [Math.floor(x), Math.floor(y), Math.floor(z)], f = [x - c[0], y - c[1], z - c[2]];
    let F1 = 9, F2 = 9, r = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cc = [c[0] + dx, c[1] + dy, c[2] + dz];
      const q = [dx + h31(cc[0], cc[1], cc[2]) - f[0], dy + h31(cc[0] + 17.1, cc[1] + 17.1, cc[2] + 17.1) - f[1], dz + h31(cc[0] + 31.7, cc[1] + 31.7, cc[2] + 31.7) - f[2]];
      const d = Math.hypot(q[0], q[1], q[2]);
      if (d < F1) { F2 = F1; F1 = d; r = h31(cc[0] + 5.3, cc[1] + 5.3, cc[2] + 5.3); } else F2 = Math.min(F2, d);
    }
    return r * clamp((F2 - F1) / 0.5, 0, 1);
  };
  const Px = 4 * u * ps[0] - 2, Py = 4 * v * ps[1] - 2;
  let t = [M[0] * Px + M[1] * Py + M[3] + seed[0], M[4] * Px + M[5] * Py + M[7] + seed[1], M[8] * Px + M[9] * Py + M[11] + seed[2]];
  const g = C.rule === 2 ? p.rough ?? 0.5 : C.rule === 3 ? 1 : p.gain ?? 0.7;
  let n = 0, a = 1, ws = 0;
  for (let j = 0; j <= Math.round(p.harmon ?? 2); j++) {
    const q = t.map((x) => x / C.k), b = C.base === 'cell' ? cell(q[0], q[1], q[2]) : perlin3Ref(q[0], q[1], q[2]);
    n += qmap(b) * a; ws += a; t = t.map((x) => x * (p.spread ?? 2)); a *= g;
  }
  if (C.rule === 1) n /= ws;
  n *= p.amp ?? 0.5;
  return Math.sign(n) * Math.abs(n) ** (p.exp ?? 1) + (p.offset ?? 0.5);
}
