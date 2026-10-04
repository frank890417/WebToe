/**
 * Feedback TOP — TouchDesigner's Target TOP semantics, on a recording GPU
 * double (no real backend needed): the output is the target's result from the
 * previous cook step, and the input passes through until the target has one.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, type GpuFacade, type NodeInst } from '@webtoe/core';
import { registerAllOps } from '@webtoe/ops';

beforeAll(() => registerAllOps());

type Tex = { node: string; frame: number };

/** Records one handle per node per frame; previousFrame = last frame's handle. */
function recordingGpu(engine: Engine): GpuFacade {
  const cur = new Map<string, Tex>();
  const prev = new Map<string, Tex>();
  let frame = -1;
  const gpu = {
    name: 'webgl2',
    setTime() {
      frame = engine.time.frame;
      prev.clear();
      for (const [k, v] of cur) prev.set(k, v);
      cur.clear();
    },
    registerShader() {},
    runPass(node: NodeInst) {
      const t = { node: node.name, frame };
      cur.set(node.id, t);
      return t;
    },
    previousFrame(node: NodeInst) { return prev.get(node.id) ?? null; },
    uploadMedia(node: NodeInst) { return { node: node.name, frame }; },
    clearCanvas() {}, blitToCanvas() {}, readPixels: () => new Uint8ClampedArray(4),
    renderScene(node: NodeInst) { return { node: node.name, frame }; },
    releaseNode() {}, dispose() {},
  };
  return gpu as unknown as GpuFacade;
}

describe('feedback TOP (Target TOP semantics)', () => {
  it('passes its input through first, then returns the target’s previous step', () => {
    const e = new Engine();
    e.gpu = recordingGpu(e);
    const seed = e.graph.create('top:constant', undefined, 'seed');
    const fb = e.graph.create('top:feedback', undefined, 'fb');
    const lvl = e.graph.create('top:level', undefined, 'lvl');
    fb.params.get('top')!.value = 'lvl';
    e.graph.connect(seed, fb, 0);
    e.graph.connect(fb, lvl, 0);
    e.liveRoots.add(lvl);

    e.frame(0);
    const step0 = (fb.output as { tex: Tex }).tex;
    expect(step0.node).toBe('seed'); // target has not rendered yet → input

    e.frame(1 / 60);
    const step1 = (fb.output as { tex: Tex }).tex;
    expect(step1).toEqual({ node: 'lvl', frame: 1 }); // lvl's result from the previous step
    expect(fb.error).toBeNull();
  });

  it('flags a missing target and still passes the input through', () => {
    const e = new Engine();
    e.gpu = recordingGpu(e);
    const seed = e.graph.create('top:constant', undefined, 'seed');
    const fb = e.graph.create('top:feedback', undefined, 'fb');
    fb.params.get('top')!.value = 'nowhere';
    e.graph.connect(seed, fb, 0);
    e.liveRoots.add(fb);
    e.frame(0);
    expect((fb.output as { tex: Tex }).tex.node).toBe('seed');
    expect(fb.error).toMatch(/not found/);
  });
});
