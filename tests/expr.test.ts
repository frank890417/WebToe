import { describe, expect, it } from 'vitest';
import { compileExpr, translateTdExpr, zeroNodeRef, zeroScope, setExternal, setExternals, type ExprScope, type NodeRef } from '@webtoe/core';

function refWith(channels: number, pars: Record<string, number | string> = {}): NodeRef {
  return new Proxy({ name: 'n', path: '/n' } as NodeRef, {
    get: (t, prop) => {
      if (prop === 'name' || prop === 'path') return t[prop as 'name'];
      if (prop === 'par') return new Proxy({}, { get: (_p, k) => pars[String(k)] ?? 0 });
      if (typeof prop === 'symbol') return undefined;
      return channels;
    },
  });
}

const scope = (over: Partial<ExprScope> = {}): ExprScope => ({
  time: { seconds: 2, frame: 120, delta: 1 / 60, fps: 60 },
  me: zeroNodeRef(),
  op: () => refWith(0.5),
  parent: () => refWith(0, { tx: 3, label: 'hi' }),
  ...over,
});

describe('expression evaluator', () => {
  it('evaluates math with time scope', () => {
    expect(compileExpr('time.seconds * 0.5')(scope())).toBe(1);
    expect(compileExpr('sin(0)')(scope())).toBe(0);
    expect(compileExpr('clamp(5, 0, 2)')(scope())).toBe(2);
    expect(compileExpr('floor(time.frame / 100)')(scope())).toBe(1);
  });

  it('reads channels through op()', () => {
    const v = compileExpr("op('lfo1')['chan1'] * 2")(scope());
    expect(v).toBe(1);
    const byIndex = compileExpr("op('lfo1')[0] + 1")(scope());
    expect(byIndex).toBe(1.5);
  });

  it('rand is deterministic', () => {
    const a = compileExpr('rand(42)')(scope());
    const b = compileExpr('rand(42)')(scope());
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('throws on syntax errors at compile time', () => {
    expect(() => compileExpr('1 +')).toThrow();
  });
});

describe('TD Python translation', () => {
  it('translates the supported idioms', () => {
    expect(translateTdExpr('absTime.seconds*0.2')).toEqual({ ok: true, expr: 'time.seconds*0.2' });
    expect(translateTdExpr('me.time.frame + 1')).toEqual({ ok: true, expr: 'time.frame + 1' });
    expect(translateTdExpr('math.sin(absTime.seconds)*math.pi')).toEqual({
      ok: true,
      expr: 'sin(time.seconds)*PI',
    });
    const t = translateTdExpr("op('constant1')['width'] / 2");
    expect(t.ok).toBe(true);
  });

  it('translates the v2 idioms: par access, parent(), ternary, boolean ops', () => {
    expect(translateTdExpr("op('base1').par.tx")).toEqual({ ok: true, expr: "op('base1').par.tx" });
    expect(translateTdExpr('parent().par.Speed * 2')).toEqual({ ok: true, expr: 'parent().par.Speed * 2' });
    expect(translateTdExpr('me.par.tx + parent(2).par.ty').ok).toBe(true);
    expect(translateTdExpr('1 if absTime.seconds > 2 else 0'))
      .toEqual({ ok: true, expr: '((time.seconds > 2) ? (1) : (0))' });
    expect(translateTdExpr('True and not False').ok).toBe(true);
    expect(translateTdExpr('mod.math.sin(absTime.seconds)')).toEqual({ ok: true, expr: 'sin(time.seconds)' });
    expect(translateTdExpr('int(absTime.seconds)')).toEqual({ ok: true, expr: 'trunc(time.seconds)' });
  });

  it('evaluates par access through the scope', () => {
    expect(compileExpr('parent().par.tx * 2')(scope())).toBe(6);
    expect(compileExpr("parent().par.label + '!'")(scope())).toBe('hi!');
  });

  it('refuses what it cannot faithfully translate', () => {
    expect(translateTdExpr('[x for x in range(3)]').ok).toBe(false);
    expect(translateTdExpr('1 if me.digits else 0').ok).toBe(false);
    expect(translateTdExpr('absTime.frame // 2').ok).toBe(false); // python floor-div
    expect(translateTdExpr("str(me.name)").ok).toBe(false);
    expect(translateTdExpr("f'scripts/{me.name}.py'").ok).toBe(false);
    expect(translateTdExpr('1 if a else 2 if b else 3').ok).toBe(false); // nested conditional
    expect(translateTdExpr('').ok).toBe(false);
  });
});

describe('ext() external control', () => {
  it('reads values set by a host, falls back when unset', () => {
    expect(compileExpr("ext('missing', 0.7)")(zeroScope())).toBe(0.7);
    expect(compileExpr("ext('missing')")(zeroScope())).toBe(0);
    setExternal('hue', 205);
    setExternals({ energy: 0.5, turb: 0.1 });
    expect(compileExpr("ext('hue')")(zeroScope())).toBe(205);
    expect(compileExpr("ext('energy', 9) + ext('turb')")(zeroScope())).toBeCloseTo(0.6);
  });
});
