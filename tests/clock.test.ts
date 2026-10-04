/**
 * Fixed-rate cook clock (TouchDesigner's time model) — determinism, display
 * independence, resync, and the catch-up cost model.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { CookClock, Engine, type ChannelSet } from '@webtoe/core';
import { registerAllOps } from '@webtoe/ops';

beforeAll(() => registerAllOps());

const chan = (e: Engine, name: string) => {
  const n = [...e.graph.byId.values()].find((x) => x.name === name)!;
  return (n.output as ChannelSet).channels[0].data[0];
};

/** lfo → lag → speed: every node carries state across steps */
function statefulRig(): Engine {
  const e = new Engine();
  const lfo = e.graph.create('chop:lfo', undefined, 'lfo');
  lfo.params.get('frequency')!.value = 1.3;
  const lag = e.graph.create('chop:lag', undefined, 'lag');
  lag.params.get('lagup')!.value = 0.3;
  lag.params.get('lagdown')!.value = 0.7;
  const sp = e.graph.create('chop:speed', undefined, 'sp');
  e.graph.connect(lfo, lag, 0);
  e.graph.connect(lag, sp, 0);
  e.liveRoots.add(sp);
  return e;
}

describe('cook clock', () => {
  it('state is identical whether a frame runs 1, 7 or 24 steps', () => {
    const results = [1, 7, 24].map((per) => {
      const e = statefulRig();
      for (let k = 0; k <= 240; k += per) e.advanceTo(k / 60);
      e.advanceTo(240 / 60);
      return [chan(e, 'lfo'), chan(e, 'lag'), chan(e, 'sp'), e.time.seconds];
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0][3]).toBeCloseTo(4, 9);
  });

  it('a 120 Hz display cooks a 60 Hz project 60 times a second', () => {
    const e = statefulRig();
    let steps = 0;
    for (let i = 0; i <= 120; i++) steps += e.frame(i / 120);
    expect(steps).toBe(61); // steps 0..60
    expect(e.time.delta).toBeCloseTo(1 / 60, 12);
  });

  it('per-step constants follow the cook rate, not the display', () => {
    const run = (displayHz: number) => {
      const e = statefulRig();
      for (let i = 0; i <= displayHz * 2; i++) e.frame(i / displayHz);
      return chan(e, 'sp');
    };
    expect(run(144)).toBeCloseTo(run(60), 6);
  });

  it('skips ahead instead of replaying after a long stall (hidden tab)', () => {
    const e = statefulRig();
    e.frame(0);
    const ran = e.frame(10);
    expect(ran).toBe(1);
    expect(e.skippedSteps).toBe(599);
    expect(e.time.seconds).toBeCloseTo(10, 9);
  });

  it('does not spiral when steps cost more than the cook rate allows', () => {
    const c = new CookClock({ rate: 60 });
    let now = 0;
    c.setAnchor(0);
    let worst = 0;
    for (let f = 0; f < 120; f++) {
      const plan = c.plan(now);
      const n = c.execute(plan, () => {});
      const frameLen = 0.004 + n * 0.05; // 50 ms per step: unsustainable at 60 Hz
      worst = Math.max(worst, frameLen);
      now += frameLen;
    }
    expect(worst).toBeLessThan(0.12); // never 24 steps × 50 ms
    expect(c.skipped).toBeGreaterThan(0); // fell behind → resynced, did not replay
  });

  it('catches up a hiccup within a few vsync-bound frames, without skipping', () => {
    const c = new CookClock({ rate: 60 });
    c.setAnchor(0);
    let now = 0;
    for (let f = 0; f < 30; f++) { c.execute(c.plan(now), () => {}); now += 1 / 60; }
    now += 0.2; // a 200 ms hiccup: 12 steps behind
    let frames = 0;
    for (; frames < 20; frames++) {
      const plan = c.plan(now);
      c.execute(plan, () => {});
      if (c.targetAt(now) - c.step <= 0) break;
      now += 1 / 60; // vsync-bound: frame length does not grow with steps (cheap steps)
    }
    expect(frames).toBeLessThan(10);
    expect(c.skipped).toBe(0);
  });

  it('changing the cook rate keeps time continuous', () => {
    const e = statefulRig();
    for (let i = 0; i <= 60; i++) e.frame(i / 60);
    const before = e.time.seconds;
    e.cookRate = 30;
    e.frame(1 + 1 / 30);
    expect(e.time.seconds).toBeGreaterThan(before);
    expect(e.time.seconds).toBeCloseTo(1 + 1 / 30, 9);
    expect(e.time.delta).toBeCloseTo(1 / 30, 12);
  });
});
