/**
 * Importer side of the TOP fidelity work: TD parameter tokens land on the
 * WebToe params with TD semantics, and TD defaults that differ from WebToe's
 * are filled in when the .parm file is silent (TD never stores defaults).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { graphFromJSON, type Graph } from '@webtoe/core';
import { registerAllOps } from '@webtoe/ops';
import { toedirLoader, type ImportFile } from '@webtoe/io';

beforeAll(() => registerAllOps());

/** Synthetic expansion (authored for this test; grammar per docs/RESEARCH.md §2.1). */
function expansion(nodes: Record<string, { type: string; parm?: string; inputs?: string[] }>): ImportFile[] {
  const files: Record<string, string> = { '.build': 'version 099\nbuild 2025.00000\n' };
  let x = 0;
  for (const [name, n] of Object.entries(nodes)) {
    const ins = n.inputs?.length ? `inputs\n{\n${n.inputs.map((s, i) => `${i} \t${s}`).join('\n')}\n}\n` : '';
    files[`${name}.n`] = `${n.type}\ntile ${(x += 200)} 0 130 90\n${ins}end\n`;
    if (n.parm) files[`${name}.parm`] = `?\n${n.parm.trim()}\n?\n`;
  }
  return Object.entries(files).map(([path, content]) => ({ path, text: async () => content }));
}

async function load(nodes: Parameters<typeof expansion>[0]): Promise<Graph> {
  const { json } = await toedirLoader.load(expansion(nodes));
  return graphFromJSON(json);
}
const par = (g: Graph, name: string, key: string) => g.resolve(`/${name}`, g.root)?.params.get(key)?.value;

describe('TD → WebToe parameter import (fidelity TOPs)', () => {
  it('Ramp: vertical stays vertical (used to import as horizontal); phase, period, extend, interp', async () => {
    const g = await load({
      r1: { type: 'TOP:ramp', parm: 'type 0 vert\nphase 0 0.25\nperiod 0 2\nextendleft 0 hold\ninterpnotches 0 hermite\nposition1 0 0.1' },
      r2: { type: 'TOP:ramp', parm: 'type 0 horizontal' },
    });
    expect(par(g, 'r1', 'type')).toBe('vertical');
    expect(par(g, 'r1', 'phase')).toBe(0.25);
    expect(par(g, 'r1', 'period')).toBe(2);
    expect(par(g, 'r1', 'extendleft')).toBe('hold');
    expect(par(g, 'r1', 'interp')).toBe('hermite');
    expect(par(g, 'r1', 'positionx')).toBe(0.1);
    expect(par(g, 'r2', 'type')).toBe('horizontal');
  });

  it('Level: black level, range, per-channel low/high with the right unset defaults', async () => {
    const g = await load({ l1: { type: 'TOP:level', parm: 'blacklevel 0 0.1\ninhigh 0 0.8\nlowr 0 0.2\nhighg 0 0.5\ngamma2 0 1.5\nclamp 0 1' } });
    expect(par(g, 'l1', 'blacklevel')).toBe(0.1);
    expect(par(g, 'l1', 'inhigh')).toBe(0.8);
    expect(par(g, 'l1', 'low')).toEqual([0.2, 0, 0, 0]);      // unset low channels default to 0
    expect(par(g, 'l1', 'high')).toEqual([1, 0.5, 1, 1]);     // unset high channels default to 1
    expect(par(g, 'l1', 'gamma2')).toBe(1.5);
    expect(par(g, 'l1', 'clamp')).toBe(1);
  });

  it('Edge: offset, black level, select, edge colour, compedge', async () => {
    const g = await load({ e1: { type: 'TOP:edge', parm: 'strength 0 0.648\noffset1 0 1.8\noffset2 0 1.8\nblacklevel 0 0.015\nselect 0 rgbmax\nedgecolorg 0 0.5\ncombineinput 0 compedge' } });
    expect(par(g, 'e1', 'strength')).toBe(0.648);
    expect(par(g, 'e1', 'offsetx')).toBe(1.8);
    expect(par(g, 'e1', 'offsety')).toBe(1.8);
    expect(par(g, 'e1', 'blacklevel')).toBe(0.015);
    expect(par(g, 'e1', 'select')).toBe('rgbmax');
    expect(par(g, 'e1', 'edgecolor')).toEqual([1, 0.5, 1, 1]);
    expect(par(g, 'e1', 'compinput')).toBe(true);
  });

  it('Blur: size stays the full TD width; type, preshrink, sample step, filter scale', async () => {
    const g = await load({ b1: { type: 'TOP:blur', parm: 'size 0 32\ntype 0 gaussian\npreshrink 0 4\noffsetx 0 2\nfilterscaley 0 0.5' } });
    expect(par(g, 'b1', 'size')).toBe(32);
    expect(par(g, 'b1', 'type')).toBe('gaussian');
    expect(par(g, 'b1', 'preshrink')).toBe(4);
    expect(par(g, 'b1', 'offsetx')).toBe(2);
    expect(par(g, 'b1', 'filterscaley')).toBe(0.5);
  });

  it('Noise: harmon is TD harmon (octaves = harmon + 1), TD noise is static, transform page and type map', async () => {
    const g = await load({
      n1: { type: 'TOP:noise', parm: 'type 0 perlin2d\nharmon 0 0\nperiod 0 1.06\noffset 0 -0.2\ntx 0 0.3\nrz 0 30\nseed 0 7\nspread 0 2.5' },
      n2: { type: 'TOP:noise', parm: 'type 0 randomgpu' },
      n3: { type: 'TOP:noise' },
    });
    expect(par(g, 'n1', 'type')).toBe('perlin2d');
    expect(par(g, 'n1', 'harmonics')).toBe(0);
    expect(par(g, 'n1', 'offset')).toBe(-0.2);
    expect(par(g, 'n1', 'tx')).toBe(0.3);
    expect(par(g, 'n1', 'rz')).toBe(30);
    expect(par(g, 'n1', 'seed')).toBe(7);
    expect(par(g, 'n1', 'spread')).toBe(2.5);
    expect(par(g, 'n2', 'type')).toBe('random');
    // a silent .parm means TD defaults: WebToe's defaults are TD's, except the speed extra which is off
    expect(par(g, 'n3', 'speed')).toBe(0);
    expect(par(g, 'n3', 'harmonics')).toBe(2);
    expect(par(g, 'n3', 'period')).toBe(1);
  });

  it('Composite: TD default operand is multiply; all TD operands; single-purpose TOPs; transform page', async () => {
    const g = await load({
      c1: { type: 'TOP:composite' },
      c2: { type: 'TOP:composite', parm: 'operand 0 overlay\nswaporder 0 1\ntx 0 0.25\nr 0 45\nsx 0 2' },
      s1: { type: 'TOP:subtract' },
      o1: { type: 'TOP:over', parm: 'extend 0 hold' },
      x1: { type: 'TOP:composite', parm: 'operand 0 notarealop' },
    });
    expect(par(g, 'c1', 'operation')).toBe('multiply');
    expect(par(g, 'c2', 'operation')).toBe('overlay');
    expect(par(g, 'c2', 'swaporder')).toBe(1);
    expect(par(g, 'c2', 'tx')).toBe(0.25);
    expect(par(g, 'c2', 'rotate')).toBe(45);
    expect(par(g, 'c2', 'sx')).toBe(2);
    expect(g.resolve('/s1', g.root)?.type).toBe('top:composite');
    expect(par(g, 's1', 'operation')).toBe('subtract');
    expect(par(g, 'o1', 'operation')).toBe('over');
    expect(par(g, 'o1', 'extend')).toBe('hold');
    expect(par(g, 'x1', 'operation')).toBe('multiply');   // unknown token → TD default
  });

  it('Monochrome is mapped (was a stub) with its rgb/alpha menus', async () => {
    const g = await load({ m1: { type: 'TOP:monochrome', parm: 'rgb 0 rgbmax\nalpha 0 one' } });
    expect(g.resolve('/m1', g.root)?.type).toBe('top:monochrome');
    expect(par(g, 'm1', 'rgb')).toBe('rgbmax');
    expect(par(g, 'm1', 'alpha')).toBe('one');
  });
});
