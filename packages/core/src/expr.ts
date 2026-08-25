/**
 * Parameter expressions. Grammar = a JS expression evaluated against a fixed,
 * explicit scope (time, me, op(), math whitelist). Compiled once per source
 * string. This is user-authored patch code — the same trust model as any
 * browser patching environment; it is NOT a security sandbox.
 *
 * Imported TouchDesigner (Python) expressions are never executed: they are
 * either translated to this grammar by `translateTdExpr` or kept inert.
 */

export type CompiledExpr = (scope: ExprScope) => unknown;

/** Resolved parameter access: `proxy.someparam` → current value (0 if unknown). */
export type ParIndexable = Record<string, number | string | boolean>;

/** Node reference inside expressions: channels by index/name, plus `.par`. */
export interface NodeRef {
  name: string;
  path: string;
  par: ParIndexable;
  [channel: string | number]: unknown;
}

export interface ExprScope {
  time: { seconds: number; frame: number; delta: number; fps: number };
  me: NodeRef;
  op: (path: string) => NodeRef;
  parent: (level?: number) => NodeRef;
  [k: string]: unknown;
}

/** op('x') result: index by channel name or number → sample value. */
export type ChannelIndexable = Record<string | number, number>;

// External control values — set by hosts that drive a patch from outside
// (postMessage bridges, show controllers like open-audiovisual, tests).
// Read in expressions as ext('name') or ext('name', fallback).
const EXT_STORE = new Map<string, number>();
export function setExternal(name: string, value: number): void { EXT_STORE.set(name, value); }
export function setExternals(values: Record<string, number>): void {
  for (const k of Object.keys(values)) EXT_STORE.set(k, values[k]);
}

const MATH_SCOPE: Record<string, unknown> = {
  ext: (name: string, fallback = 0) => (EXT_STORE.has(name) ? EXT_STORE.get(name)! : fallback),
  PI: Math.PI,
  abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt,
  exp: Math.exp, log: Math.log, sign: Math.sign,
  clamp: (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v)),
  fract: (v: number) => v - Math.floor(v),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  /** deterministic 0..1 hash of a seed */
  rand: (seed: number) => {
    const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  },
};

const SCOPE_KEYS = ['time', 'me', 'op', 'parent', ...Object.keys(MATH_SCOPE)];

const cache = new Map<string, CompiledExpr>();

export class ExprError extends Error {}

export function compileExpr(src: string): CompiledExpr {
  const hit = cache.get(src);
  if (hit) return hit;
  let fn: (...args: unknown[]) => unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function(...SCOPE_KEYS, `"use strict"; return (${src});`) as (...args: unknown[]) => unknown;
  } catch (e) {
    throw new ExprError(`syntax error in expression: ${(e as Error).message}`);
  }
  const compiled: CompiledExpr = (scope) => {
    const args = SCOPE_KEYS.map((k) => (k in scope ? scope[k] : MATH_SCOPE[k]));
    return fn(...args);
  };
  cache.set(src, compiled);
  return compiled;
}

export function makeChannelIndexable(get: (key: string | number) => number): ChannelIndexable {
  return new Proxy({} as ChannelIndexable, {
    get: (_t, prop) => {
      if (typeof prop === 'symbol') return undefined;
      const asNum = Number(prop);
      return get(Number.isNaN(asNum) ? prop : asNum);
    },
  });
}

// ---------------------------------------------------------------------------
// TouchDesigner Python → WebToe expression translation (import-time only)
// ---------------------------------------------------------------------------

export interface TdTranslation {
  ok: boolean;
  expr?: string;
}

/** Patterns that mark an expression as beyond the translatable subset. */
const TD_UNSUPPORTED = [
  /\bmod\(/, /\bme\.digits\b/, /\bme\.inputVal\b/, /\bme\.curPar\b/,
  /\blambda\b/, /\bfor\b/, /\bdef\b/, /\bstr\(/, /\blen\(/,
  /\btdu\./, /\bvar\(/, /\bext\./, /\bproject\./, /\bapp\./, /\bop\.\w/, /'''|"""/,
  /\bf['"]/, // f-strings
  /\.menuIndex\b/, /\.panel\b/, /\bis\b/, /\bin\b/,
  /\/\//, // Python floor-div: regex-rewriting operand boundaries is unsafe; leave disabled
];

const TD_REWRITES: [RegExp, string][] = [
  [/\bmod\.math\./g, ''], // TD's `mod.math.sin(...)` module-access form
  [/\babsTime\.seconds\b/g, 'time.seconds'],
  [/\babsTime\.frame\b/g, 'time.frame'],
  [/\bme\.time\.seconds\b/g, 'time.seconds'],
  [/\bme\.time\.frame\b/g, 'time.frame'],
  [/\bmath\.pi\b/g, 'PI'],
  [/\bmath\.([a-z][a-z0-9_]*)/g, '$1'],
  [/\bTrue\b/g, 'true'],
  [/\bFalse\b/g, 'false'],
  [/\bNone\b/g, 'null'],
  [/\bint\(/g, 'trunc('],
  [/\bfloat\(/g, '('],
  [/\band\b/g, '&&'],
  [/\bor\b/g, '||'],
  [/\bnot\s+/g, '!'],
];

/** Python conditional expression `A if C else B` → `((C) ? (A) : (B))`.
 *  Handles the common single-level form; nested conditionals stay untranslated. */
function rewriteTernary(src: string): string {
  const m = src.match(/^(.+?)\s+if\s+(.+?)\s+else\s+(.+)$/s);
  if (!m) return src;
  return `((${m[2]}) ? (${m[1]}) : (${m[3]}))`;
}

/** Attempt to translate a TD Python parameter expression into our grammar.
 *  Conservative: validates by compiling and dry-running against a zero scope. */
export function translateTdExpr(py: string): TdTranslation {
  const src = py.trim();
  if (!src) return { ok: false };
  for (const bad of TD_UNSUPPORTED) if (bad.test(src)) return { ok: false };
  let out = rewriteTernary(src);
  for (const [re, rep] of TD_REWRITES) out = out.replace(re, rep);
  if (/\bif\b|\belse\b/.test(out)) return { ok: false }; // nested/odd conditionals
  try {
    const compiled = compileExpr(out);
    const v = compiled(zeroScope());
    if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') return { ok: false };
    return { ok: true, expr: out };
  } catch {
    return { ok: false };
  }
}

/** Inert scope used to validate translations (and available to tests). */
export function zeroScope(): ExprScope {
  const ref = (): NodeRef => zeroNodeRef();
  return {
    time: { seconds: 0, frame: 0, delta: 1 / 60, fps: 60 },
    me: zeroNodeRef(),
    op: ref,
    parent: ref,
  };
}

export function zeroNodeRef(): NodeRef {
  return new Proxy({ name: 'x', path: '/x' } as NodeRef, {
    get: (t, prop) => {
      if (prop === 'name' || prop === 'path') return t[prop as 'name'];
      if (prop === 'par') return new Proxy({}, { get: () => 0 });
      if (typeof prop === 'symbol') return undefined;
      return 0;
    },
  });
}
