import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, type ChannelSet } from '@webtoe/core';
import { registerAllOps, sample } from '@webtoe/ops';

beforeAll(() => registerAllOps());

function liveCook(e: Engine, node: Parameters<Engine['cook']>[0], frames: number[]): ChannelSet {
  e.liveRoots.add(node);
  for (const t of frames) e.frame(t);
  const out = node.output;
  if (!out || out.kind !== 'chop') throw new Error('expected chop output');
  return out;
}

describe('engine + CHOP cooking', () => {
  it('constant → math(add) combines channel-wise with post math', () => {
    const e = new Engine();
    const c1 = e.graph.create('chop:constant');
    c1.params.get('value0')!.value = 2;
    const c2 = e.graph.create('chop:constant');
    c2.params.get('value0')!.value = 3;
    const m = e.graph.create('chop:math');
    m.params.get('gain')!.value = 2;
    e.graph.connect(c1, m, 0);
    e.graph.connect(c2, m, 1);
    const out = liveCook(e, m, [0]);
    expect(sample(out, 'chan1')).toBe(10); // (2+3)*gain2
  });

  it('lfo sin reaches +amplitude at quarter phase', () => {
    const e = new Engine();
    const lfo = e.graph.create('chop:lfo');
    lfo.params.get('amplitude')!.value = 3;
    const out = liveCook(e, lfo, [0, 0.25]);
    expect(sample(out, 'chan1')).toBeCloseTo(3, 1);
  });

  it('lag converges toward its input over time', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant');
    c.params.get('value0')!.value = 1;
    const lag = e.graph.create('chop:lag');
    e.graph.connect(c, lag, 0);
    e.liveRoots.add(lag);
    e.frame(0);
    // lag state initializes at target on first sight; force a step change
    c.params.get('value0')!.value = 5;
    e.frame(0.016);
    const after1 = sample(lag.output as ChannelSet, 'chan1');
    for (let i = 2; i < 200; i++) e.frame(i * 0.016);
    const settled = sample(lag.output as ChannelSet, 'chan1');
    expect(after1).toBeGreaterThan(1);
    expect(after1).toBeLessThan(5);
    expect(settled).toBeCloseTo(5, 1);
  });

  it('expression params pull other nodes via op()', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant', undefined, 'driver');
    c.params.get('value0')!.value = 0.5;
    const lfo = e.graph.create('chop:lfo');
    lfo.params.set('amplitude', { mode: 'expr', value: 1, expr: "op('driver')['chan1'] * 4" });
    const out = liveCook(e, lfo, [0, 0.25]);
    expect(sample(out, 'chan1')).toBeCloseTo(2, 1); // sin(quarter)=1 × amp 2
  });

  it('select filters channels by wildcard', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant');
    c.params.get('name0')!.value = 'tx';
    c.params.get('name1')!.value = 'ty';
    c.params.get('value1')!.value = 9;
    c.params.get('name2')!.value = 'other';
    const s = e.graph.create('chop:select');
    s.params.get('channames')!.value = 't*';
    e.graph.connect(c, s, 0);
    const out = liveCook(e, s, [0]);
    expect(out.channels.map((ch) => ch.name)).toEqual(['tx', 'ty']);
    expect(sample(out, 'ty')).toBe(9);
  });

  it('cycle guard flags instead of hanging', () => {
    const e = new Engine();
    const a = e.graph.create('chop:math');
    const b = e.graph.create('chop:math');
    e.graph.connect(a, b, 0);
    e.graph.connect(b, a, 0);
    e.liveRoots.add(b);
    e.frame(0);
    expect(a.error ?? b.error).toMatch(/cycle/);
  });

  it('mousein reflects engine io state', () => {
    const e = new Engine();
    e.io.mouse = { x: 0.25, y: 0.75, down: true };
    const m = e.graph.create('chop:mousein');
    const out = liveCook(e, m, [0]);
    expect(sample(out, 'tx')).toBe(0.25);
    expect(sample(out, 'ty')).toBe(0.75);
    expect(sample(out, 'lmb')).toBe(1);
  });

  it('math full pipeline: pre op → combine channels → combine chops → post op → mult-add → range', () => {
    const e = new Engine();
    const a = e.graph.create('chop:constant'); // channels: x=-3, y=4
    a.params.get('name0')!.value = 'x';
    a.params.get('value0')!.value = -3;
    a.params.get('name1')!.value = 'y';
    a.params.get('value1')!.value = 4;
    const b = e.graph.create('chop:constant');
    b.params.get('value0')!.value = 2;
    const m = e.graph.create('chop:math');
    e.graph.connect(a, m, 0);
    e.graph.connect(b, m, 1);
    m.params.get('preop')!.value = 'positive';   // |−3|=3, |4|=4, |2|=2
    m.params.get('chanop')!.value = 'add';       // a → 7 ; b → 2
    m.params.get('combine')!.value = 'multiply'; // 7 × 2 = 14
    m.params.get('postop')!.value = 'square';    // 196
    m.params.get('preadd')!.value = 4;           // 200
    m.params.get('gain')!.value = 0.5;           // 100
    m.params.get('postadd')!.value = -90;        // 10
    m.params.get('fromrange1')!.value = 0;
    m.params.get('fromrange2')!.value = 10;      // remap 0..10 → 0..1 ⇒ 1
    const out = liveCook(e, m, [0]);
    expect(out.channels.length).toBe(1);
    expect(sample(out, 'x')).toBeCloseTo(1, 6);
  });

  it('chop:switch picks the indexed input (expression-drivable)', () => {
    const e = new Engine();
    const a = e.graph.create('chop:constant');
    a.params.get('value0')!.value = 1;
    const b = e.graph.create('chop:constant');
    b.params.get('value0')!.value = 2;
    const sw = e.graph.create('chop:switch');
    e.graph.connect(a, sw, 0);
    e.graph.connect(b, sw, 1);
    sw.params.get('index')!.value = 1;
    const out = liveCook(e, sw, [0]);
    expect(sample(out, 'chan1')).toBe(2);
  });

  it('chop:speed integrates its input over time', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant');
    c.params.get('value0')!.value = 2;
    const sp = e.graph.create('chop:speed');
    e.graph.connect(c, sp, 0);
    e.liveRoots.add(sp);
    e.frame(0);
    for (let i = 1; i <= 60; i++) e.frame(i / 60);
    const v = sample(sp.output as ChannelSet, 'chan1');
    expect(v).toBeGreaterThan(1.5); // ≈ 2/s integrated over ~1s
    expect(v).toBeLessThan(2.5);
  });

  it('lag follows TD semantics: the lag time covers 90% of a step', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant');
    c.params.get('value0')!.value = 0;
    const lag = e.graph.create('chop:lag');
    lag.params.get('lagup')!.value = 0.5;
    lag.params.get('lagdown')!.value = 0.5;
    e.graph.connect(c, lag, 0);
    e.liveRoots.add(lag);
    e.frame(0);
    c.params.get('value0')!.value = 1;
    for (let i = 1; i <= 30; i++) e.frame(i / 60); // 0.5 s at 60 Hz
    expect(sample(lag.output as ChannelSet, 'chan1')).toBeCloseTo(0.9, 3);
  });

  it('speed outputs the accumulation before this step (step 0 = 0)', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant');
    c.params.get('value0')!.value = 6;
    const sp = e.graph.create('chop:speed');
    e.graph.connect(c, sp, 0);
    e.liveRoots.add(sp);
    e.frame(0);
    expect(sample(sp.output as ChannelSet, 'chan1')).toBe(0);
    const dt0 = e.time.delta; // this step's input lands on the next cook
    e.frame(1 / 60);
    expect(sample(sp.output as ChannelSet, 'chan1')).toBeCloseTo(6 * dt0, 9);
  });

  it('chop:par reads another node’s parameters as channels', () => {
    const e = new Engine();
    const lfo = e.graph.create('chop:lfo', undefined, 'wob');
    lfo.params.get('frequency')!.value = 3.5;
    const par = e.graph.create('chop:par');
    par.params.get('oppath')!.value = 'wob';
    par.params.get('parnames')!.value = 'freq* amp*';
    const out = liveCook(e, par, [0]);
    expect(sample(out, 'frequency')).toBe(3.5);
    expect(sample(out, 'amplitude')).toBe(1);
    expect(out.channels.length).toBe(2);
  });

  it('dat passthrough chain: table → select → null', () => {
    const e = new Engine();
    const table = e.graph.create('dat:table');
    table.text = 'a\tb\n1\t2';
    const sel = e.graph.create('dat:select');
    sel.params.get('dat')!.value = 'table1';
    const nul = e.graph.create('dat:null');
    e.graph.connect(sel, nul, 0);
    e.liveRoots.add(nul);
    e.frame(0);
    expect(nul.output).toMatchObject({ kind: 'dat', text: 'a\tb\n1\t2' });
  });

  it('bypass passes input through untouched', () => {
    const e = new Engine();
    const c = e.graph.create('chop:constant');
    c.params.get('value0')!.value = 7;
    const m = e.graph.create('chop:math');
    m.params.get('postadd')!.value = 100;
    m.flags.bypass = true;
    e.graph.connect(c, m, 0);
    const out = liveCook(e, m, [0]);
    expect(sample(out, 'chan1')).toBe(7);
  });
});
