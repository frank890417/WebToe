/**
 * TouchDesigner golden-data comparison. The goldens are NOT in the repo: they
 * are produced on a machine with TouchDesigner by tools/td-golden/capture.py
 * and pointed to with TD_GOLDEN_DIR. Without it the whole suite is skipped.
 *
 *   TD_GOLDEN_DIR=/path/to/golden npx vitest run tests/td-golden.test.ts
 *
 * Each job compares TD's float32 output with the CPU reference of the same
 * formula (top-fidelity-ref.ts) on TD's own float32 input. Tolerances follow
 * what the production-port research measured (docs/TD-PARITY.md "Fidelity"). TD's float
 * inputs are not clamped by Level's automatic mode, so the Level reference
 * runs with clampinput off here (WebToe's 8-bit pipeline always clamps).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { noiseCoord, noiseSeedOffset, noiseXform, rampKeys, type BlurType, type CompOp } from '../packages/ops/src/top/tdmath';
import { blurRef, compRef, edgeRef, levelRef, noiseGpuRef, rampCoord, rampRef } from './top-fidelity-ref';

const DIR = process.env.TD_GOLDEN_DIR ?? '';
const MANIFEST = DIR ? join(DIR, 'manifest.json') : '';
const run = DIR && existsSync(MANIFEST) ? describe : describe.skip;

interface Job { id: string; op: string; params: Record<string, number | string>; inputs: string[]; file: string; size: [number, number]; errors: string[] }
interface Manifest { td: { build: string }; inputs: Record<string, { file: string; size: [number, number] }>; jobs: Job[]; ramp_keys?: number[][] }

/** Minimal .npy reader: little-endian float32 or float16, C order. */
function readNpy(file: string): { shape: number[]; data: Float32Array } {
  const buf = readFileSync(file);
  if (buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY') throw new Error(`not an .npy file: ${file}`);
  const major = buf[6], hlen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8), off = major === 1 ? 10 : 12;
  const header = buf.toString('latin1', off, off + hlen);
  const f2 = /'descr':\s*'<f2'/.test(header);
  if ((!f2 && !/'descr':\s*'<f4'/.test(header)) || /'fortran_order':\s*True/.test(header)) throw new Error(`need <f4/<f2 C-order: ${header}`);
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)![1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const n = shape.reduce((a, b) => a * b, 1), start = off + hlen, data = new Float32Array(n);
  const half = (h: number) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return s * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15)); };
  for (let i = 0; i < n; i++) data[i] = f2 ? half(buf.readUInt16LE(start + 2 * i)) : buf.readFloatLE(start + 4 * i);
  return { shape, data };
}

const pctl = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const num = (v: unknown, d: number) => (v == null ? d : Number(v));

run('TouchDesigner golden data (TD_GOLDEN_DIR)', () => {
  // read lazily: describe.skip still collects this body when no goldens are present
  let M = null as unknown as Manifest;
  beforeAll(() => { M = JSON.parse(readFileSync(MANIFEST, 'utf8')); });
  const input = (name: string) => readNpy(join(DIR, M.inputs[name].file));
  const jobs = (op: string) => M.jobs.filter((j) => j.op === op && !j.errors.length);

  it('manifest loads; jobs with parameters TD rejected are listed, not compared', () => {
    const skipped = M.jobs.filter((j) => j.errors.length).map((j) => `${j.id}: ${j.errors.join('; ')}`);
    console.info(`[td-golden] TD ${M.td.build}, ${M.jobs.length} jobs`);
    if (skipped.length) console.warn(`[td-golden] skipped jobs:\n  ${skipped.join('\n  ')}`);
    expect(M.jobs.length).toBeGreaterThan(0);
  });

  it('Level (≤ 1e-3, measured tolerance)', () => {
    const src = input('ramp'), [W] = M.inputs.ramp.size, bad: string[] = [];
    for (const j of jobs('level')) {
      const out = readNpy(join(DIR, j.file)), p = j.params;
      let worst = 0;
      for (let x = 0; x < W; x++) {
        const px = [0, 1, 2, 3].map((k) => src.data[x * 4 + k]);
        const r = levelRef(px, {
          clampinput: false, invert: num(p.invert, 0), blacklevel: num(p.blacklevel, 0), brightness1: num(p.brightness1, 1), gamma1: num(p.gamma1, 1),
          contrast: num(p.contrast, 1), inlow: num(p.inlow, 0), inhigh: num(p.inhigh, 1), outlow: num(p.outlow, 0), outhigh: num(p.outhigh, 1),
          low: [num(p.lowr, 0), num(p.lowg, 0), num(p.lowb, 0), num(p.lowa, 0)], high: [num(p.highr, 1), num(p.highg, 1), num(p.highb, 1), num(p.higha, 1)],
          gamma2: num(p.gamma2, 1), brightness2: num(p.brightness2, 1), opacity: num(p.opacity, 1),
        });
        for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(r[k] - out.data[x * 4 + k]));
      }
      if (worst > 1e-3) bad.push(`${j.id} ${JSON.stringify(p)}: ${worst.toExponential(2)}`);
    }
    expect(bad).toEqual([]);
  });

  it('Edge (≤ 1e-5; measured ≤ 1.2e-7)', () => {
    const src = input('smooth'), [W, H] = M.inputs.smooth.size, bad: string[] = [];
    for (const j of jobs('edge')) {
      const p = j.params, out = readNpy(join(DIR, j.file));
      const r = edgeRef(src.data, W, H, {
        strength: num(p.strength, 1), offsetx: num(p.offset1, 1), offsety: num(p.offset2, num(p.offset1, 1)), blacklevel: num(p.blacklevel, 0),
        select: (p.select as string) ?? 'luminance', compinput: p.combineinput === 'compedge',
        edgecolor: [num(p.edgecolorr, 1), num(p.edgecolorg, 1), num(p.edgecolorb, 1), num(p.edgecolora, 1)],
      });
      let worst = 0;
      for (let i = 0; i < r.length; i++) worst = Math.max(worst, Math.abs(r[i] - out.data[i]));
      if (worst > 1e-5) bad.push(`${j.id} ${JSON.stringify(p)}: ${worst.toExponential(2)}`);
    }
    expect(bad).toEqual([]);
  });

  it('Ramp (median ≤ 1e-5; TD antialias only touches seams: > 1e-2 on ≤ 2% of pixels; antialias 1 exact)', () => {
    const keys = rampKeys(M.ramp_keys ?? []), bad: string[] = [];
    for (const j of jobs('ramp')) {
      const out = readNpy(join(DIR, j.file)), [W, H] = j.size, p = j.params, errs: number[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = rampCoord(String(p.type ?? 'horizontal'), (x + 0.5) / W, (y + 0.5) / H, { phase: num(p.phase, 0), period: num(p.period, 1), aspect: [1, H / W], position: [num(p.position1, 0), num(p.position2, 0)] });
        const c = rampRef(t, keys, { interp: (p.interpnotches as string) ?? 'linear', extendleft: (p.extendleft as string) ?? 'repeat', extendright: (p.extendright as string) ?? 'sameasleft' });
        const pm = [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]], o = (y * W + x) * 4;
        errs.push(Math.max(...pm.map((v, k) => Math.abs(v - out.data[o + k]))));
      }
      const med = pctl(errs, 0.5), big = errs.filter((e) => e > 1e-2).length / errs.length, mx = Math.max(...errs);
      const ok = num(p.antialias, 4) === 1 ? mx <= 1e-5 : med <= 1e-5 && big <= 0.02;
      if (!ok) bad.push(`${j.id} ${JSON.stringify(p)}: median ${med.toExponential(1)}, >1e-2 ${(big * 100).toFixed(2)}%, max ${mx.toExponential(1)}`);
    }
    expect(bad).toEqual([]);
  });

  it('Blur (≤ 1e-5; measured ≤ 7.5e-7, preshrink that does not divide the size differs ≤ 0.4%)', () => {
    const src = input('smooth'), [W, H] = M.inputs.smooth.size, bad: string[] = [];
    const ch0 = Float64Array.from({ length: W * H }, (_, i) => src.data[i * 4]);
    for (const j of jobs('blur')) {
      const p = j.params, out = readNpy(join(DIR, j.file));
      const r = blurRef(ch0, W, H, { type: (p.type as BlurType) ?? 'catmull', size: num(p.size, 7), preshrink: num(p.preshrink, 1), offsetx: num(p.offsetx, 1), offsety: num(p.offsety, 1), filterscalex: num(p.filterscalex, 1), filterscaley: num(p.filterscaley, 1) });
      let worst = 0;
      for (let i = 0; i < W * H; i++) worst = Math.max(worst, Math.abs(r[i] - out.data[i * 4]));
      const ps = num(p.preshrink, 1), tol = ps > 1 && (W % ps || H % ps) ? 4e-3 : 1e-5;
      if (worst > tol) bad.push(`${j.id} ${JSON.stringify(p)}: ${worst.toExponential(2)} (tol ${tol})`);
    }
    expect(bad).toEqual([]);
  });

  it('Noise GPU types (perlin max ≤ 5e-4; simplex 99.9% ≤ 5e-3 — double reference vs TD float32)', () => {
    const bad: string[] = [];
    for (const j of jobs('noise')) {
      const p = j.params, out = readNpy(join(DIR, j.file)), [W, H] = j.size, C = out.shape.length === 3 ? out.shape[2] : 1;
      const type = String(p.type ?? 'simplex3d'), period = num(p.period, 1), seed = num(p.seed, 1);
      const M4 = noiseXform({ tx: num(p.tx, 0), ty: num(p.ty, 0), tz: num(p.tz, 0), rx: num(p.rx, 0), ry: num(p.ry, 0), rz: num(p.rz, 0), sx: num(p.sx, 1), sy: num(p.sy, 1), sz: num(p.sz, 1) }, period);
      const ps = noiseCoord(W, H, num(p.aspectcorrect, 1) !== 0), mono = num(p.mono, 1) !== 0;
      for (let c = 0; c < (mono ? 1 : 3); c++) {
        const off = noiseSeedOffset(seed, c), errs: number[] = [];
        for (let y = 1; y < H; y += 3) for (let x = 2; x < W; x += 3) {
          const ref = noiseGpuRef(type, (x + 0.5) / W, (y + 0.5) / H, M4, ps, off, num(p.t4d, 0) * num(p.s4d, 1),
            { harmon: num(p.harmon, 2), spread: num(p.spread, 2), gain: num(p.gain, 0.7), exp: num(p.exp, 1), amp: num(p.amp, 0.5), offset: num(p.offset, 0.5) });
          errs.push(Math.abs(ref - out.data[(y * W + x) * C + c]));
        }
        const mx = Math.max(...errs), p999 = pctl(errs, 0.999);
        const ok = type.startsWith('perlin') ? mx <= 5e-4 : p999 <= 5e-3 && mx <= 2e-2;
        if (!ok) bad.push(`${j.id} ch${c} ${JSON.stringify(p)}: max ${mx.toExponential(2)}, 99.9% ${p999.toExponential(2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Composite, all operands (relative ≤ 1e-4 where finite)', () => {
    const A = input('compa'), B = input('compb'), bad: string[] = [];
    for (const j of jobs('composite')) {
      const out = readNpy(join(DIR, j.file)), op = j.params.operand as CompOp;
      let worst = 0;
      for (let i = 0; i < A.data.length / 4; i++) {
        const r = compRef(op, Array.from(A.data.slice(i * 4, i * 4 + 4)), Array.from(B.data.slice(i * 4, i * 4 + 4)));
        for (let k = 0; k < 4; k++) {
          const tv = out.data[i * 4 + k];
          if (!Number.isFinite(tv) || !Number.isFinite(r[k]) || Math.abs(r[k]) >= 1e3) continue;
          worst = Math.max(worst, Math.abs(r[k] - tv) / Math.max(1, Math.abs(r[k])));
        }
      }
      if (worst > 1e-4) bad.push(`${op}: ${worst.toExponential(2)}`);
    }
    expect(bad).toEqual([]);
  });
});
