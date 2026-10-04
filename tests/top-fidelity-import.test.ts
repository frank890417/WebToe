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

  it('Monochrome is mapped (was a stub) with its rgb/alpha menus', async () => {
    const g = await load({ m1: { type: 'TOP:monochrome', parm: 'rgb 0 rgbmax\nalpha 0 one' } });
    expect(g.resolve('/m1', g.root)?.type).toBe('top:monochrome');
    expect(par(g, 'm1', 'rgb')).toBe('rgbmax');
    expect(par(g, 'm1', 'alpha')).toBe('one');
  });
});
