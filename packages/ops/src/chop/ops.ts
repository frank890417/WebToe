import type { OpSpec, ChannelSet, Channel, CookCtx, NodeInst } from '@webtoe/core';
import { channels, asChop, CONTROL_RATE } from './data';
import { kernels, type LfoShape } from './kernels';

const F = 'CHOP' as const;

/** Resolve a node-parameter path TD-style (relative to the node's network). */
function resolveParamPath(ctx: CookCtx, path: string): NodeInst | null {
  if (!path) return null;
  if (path.startsWith('./')) return ctx.engine.graph.resolve(path.slice(2), ctx.node);
  return ctx.engine.graph.resolve(path, ctx.node.parent ?? ctx.node);
}

export const chopOps: OpSpec[] = [
  {
    /**
     * SOP to CHOP — one sample per point, positions as `tx`/`ty`/`tz`
     * (plus `r`/`g`/`b`/`a` when the geometry carries colour).
     *
     * This is the bridge that lets geometry drive instancing: a SOP builds the
     * shape, this turns its points into channels, and a Geo COMP instances
     * across them. Referenced by path (TD's `sop` parameter), not wired.
     */
    type: 'chop:sopto',
    family: F,
    label: 'sop to',
    inputs: { min: 0, max: 1 },
    alwaysCook: true,
    params: [
      { key: 'sop', label: 'sop (path)', type: 'string', default: '' },
    ],
    cook(ctx) {
      // explicit path first, then a wired input (TD allows either)
      const src = resolveParamPath(ctx, ctx.paramStr('sop'));
      const out = src ? ctx.engine.cook(src) : ctx.inputs[0];
      const geo = out && out.kind === 'sop' ? out.geo : null;
      const n = geo ? geo.P.length / 3 : 0;
      if (!geo || !n) return { kind: 'chop', rate: CONTROL_RATE, channels: [] };

      const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        tx[i] = geo.P[i * 3];
        ty[i] = geo.P[i * 3 + 1];
        tz[i] = geo.P[i * 3 + 2];
      }
      const chans: Channel[] = [
        { name: 'tx', data: tx }, { name: 'ty', data: ty }, { name: 'tz', data: tz },
      ];
      if (geo.Cd && geo.Cd.length >= n * 4) {
        const r = new Float32Array(n), g = new Float32Array(n);
        const b = new Float32Array(n), a = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          r[i] = geo.Cd[i * 4]; g[i] = geo.Cd[i * 4 + 1];
          b[i] = geo.Cd[i * 4 + 2]; a[i] = geo.Cd[i * 4 + 3];
        }
        chans.push({ name: 'r', data: r }, { name: 'g', data: g },
          { name: 'b', data: b }, { name: 'a', data: a });
      }
      return { kind: 'chop', rate: CONTROL_RATE, channels: chans };
    },
  },

  {
    type: 'chop:constant',
    family: F,
    label: 'constant',
    inputs: { min: 0, max: 0 },
    params: [
      { key: 'name0', type: 'string', default: 'chan1' },
      { key: 'value0', type: 'float', default: 0, min: -10, max: 10 },
      { key: 'name1', type: 'string', default: '' },
      { key: 'value1', type: 'float', default: 0, min: -10, max: 10 },
      { key: 'name2', type: 'string', default: '' },
      { key: 'value2', type: 'float', default: 0, min: -10, max: 10 },
      { key: 'name3', type: 'string', default: '' },
      { key: 'value3', type: 'float', default: 0, min: -10, max: 10 },
    ],
    cook(ctx) {
      const out: [string, number][] = [];
      for (let i = 0; i < 4; i++) {
        const name = ctx.paramStr(`name${i}`).trim();
        if (name) out.push([name, ctx.paramNum(`value${i}`)]);
      }
      return channels(out);
    },
  },

  {
    type: 'chop:lfo',
    family: F,
    label: 'lfo',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [
      { key: 'wave', type: 'menu', default: 'sin', menu: ['sin', 'tri', 'square', 'saw', 'pulse'] },
      { key: 'frequency', type: 'float', default: 1, min: 0, max: 20 },
      { key: 'amplitude', type: 'float', default: 1, min: -5, max: 5 },
      { key: 'offset', type: 'float', default: 0, min: -5, max: 5 },
      { key: 'phase', type: 'float', default: 0, min: 0, max: 1 },
    ],
    cook(ctx) {
      // integrate phase so live frequency changes don't jump (state survives frames)
      const st = ctx.node.state as { phase?: number };
      const prev = st.phase ?? ctx.paramNum('phase');
      const phase = prev + ctx.paramNum('frequency') * ctx.time.delta;
      st.phase = phase - Math.floor(phase);
      const v = kernels().lfo(ctx.paramStr('wave') as LfoShape, st.phase);
      return channels([['chan1', v * ctx.paramNum('amplitude') + ctx.paramNum('offset')]]);
    },
  },

  {
    type: 'chop:noise',
    family: F,
    label: 'noise',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [
      { key: 'period', type: 'float', default: 1, min: 0.01, max: 20 },
      { key: 'harmonics', type: 'int', default: 3, min: 1, max: 8 },
      { key: 'amplitude', type: 'float', default: 1, min: -5, max: 5 },
      { key: 'offset', type: 'float', default: 0, min: -5, max: 5 },
      { key: 'seed', type: 'float', default: 1, min: 0, max: 100 },
    ],
    cook(ctx) {
      const t = ctx.time.seconds / Math.max(1e-4, ctx.paramNum('period'));
      const v = kernels().fbm1(t, ctx.paramNum('harmonics'), ctx.paramNum('seed'));
      return channels([['chan1', v * ctx.paramNum('amplitude') + ctx.paramNum('offset')]]);
    },
  },

  {
    type: 'chop:math',
    family: F,
    label: 'math',
    inputs: { min: 1, max: 4 },
    inputLabels: ['chop 1', 'chop 2', 'chop 3', 'chop 4'],
    params: [
      { key: 'preop', label: 'channel pre op', type: 'menu', default: 'off', page: 'op',
        menu: ['off', 'negate', 'positive', 'square', 'sqrt'] },
      { key: 'chanop', label: 'combine channels', type: 'menu', default: 'off', page: 'op',
        menu: ['off', 'add', 'subtract', 'multiply', 'divide', 'average', 'minimum', 'maximum'] },
      { key: 'combine', label: 'combine chops', type: 'menu', default: 'add', page: 'op',
        menu: ['add', 'subtract', 'multiply', 'divide', 'average', 'minimum', 'maximum'] },
      { key: 'postop', label: 'channel post op', type: 'menu', default: 'off', page: 'op',
        menu: ['off', 'negate', 'positive', 'square', 'sqrt'] },
      { key: 'preadd', label: 'pre-add', type: 'float', default: 0, min: -10, max: 10, page: 'mult-add' },
      { key: 'gain', label: 'multiply', type: 'float', default: 1, min: -10, max: 10, page: 'mult-add' },
      { key: 'postadd', label: 'post-add', type: 'float', default: 0, min: -10, max: 10, page: 'mult-add' },
      { key: 'fromrange1', label: 'from range low', type: 'float', default: 0, min: -10, max: 10, page: 'range' },
      { key: 'fromrange2', label: 'from range high', type: 'float', default: 1, min: -10, max: 10, page: 'range' },
      { key: 'torange1', label: 'to range low', type: 'float', default: 0, min: -10, max: 10, page: 'range' },
      { key: 'torange2', label: 'to range high', type: 'float', default: 1, min: -10, max: 10, page: 'range' },
    ],
    cook(ctx) {
      const ins = ctx.inputs.map(asChop).filter((c): c is ChannelSet => !!c);
      if (!ins.length) return channels([]);
      const unary = (op: string, v: number): number => {
        switch (op) {
          case 'negate': return -v;
          case 'positive': return Math.abs(v);
          case 'square': return v * v;
          case 'sqrt': return Math.sqrt(Math.max(0, v));
          default: return v;
        }
      };
      const binary = (op: string, a: number, b: number): number => {
        switch (op) {
          case 'add': case 'average': return a + b;
          case 'subtract': return a - b;
          case 'multiply': return a * b;
          case 'divide': return b === 0 ? 0 : a / b;
          case 'minimum': return Math.min(a, b);
          case 'maximum': return Math.max(a, b);
          default: return a;
        }
      };
      const preop = ctx.paramStr('preop');
      const chanop = ctx.paramStr('chanop');
      const combine = ctx.paramStr('combine');
      const postop = ctx.paramStr('postop');

      // 1) channel pre op, 2) combine channels within each chop
      const staged = ins.map((cs) => {
        const vals = cs.channels.map((ch) => unary(preop, ch.data[ch.data.length - 1] ?? 0));
        if (chanop !== 'off' && vals.length > 1) {
          let v = vals[0];
          for (let k = 1; k < vals.length; k++) v = binary(chanop, v, vals[k]);
          if (chanop === 'average') v /= vals.length;
          return { names: [cs.channels[0]?.name ?? 'chan1'], vals: [v] };
        }
        return { names: cs.channels.map((c) => c.name), vals };
      });

      // 3) combine chops channel-wise, 4) post op, 5) mult-add, 6) range remap
      const nch = Math.max(...staged.map((s) => s.vals.length));
      const preadd = ctx.paramNum('preadd');
      const gain = ctx.paramNum('gain');
      const postadd = ctx.paramNum('postadd');
      const f1 = ctx.paramNum('fromrange1'), f2 = ctx.paramNum('fromrange2');
      const t1 = ctx.paramNum('torange1'), t2 = ctx.paramNum('torange2');
      const identityRange = f1 === t1 && f2 === t2;
      const out: [string, number][] = [];
      for (let i = 0; i < nch; i++) {
        const vals = staged.filter((s) => i < s.vals.length).map((s) => s.vals[i]);
        let v = vals[0] ?? 0;
        for (let k = 1; k < vals.length; k++) v = binary(combine, v, vals[k]);
        if (combine === 'average' && vals.length > 0) v /= vals.length;
        v = unary(postop, v);
        v = (v + preadd) * gain + postadd;
        if (!identityRange && f2 !== f1) v = ((v - f1) / (f2 - f1)) * (t2 - t1) + t1;
        out.push([staged.find((s) => i < s.names.length)?.names[i] ?? `chan${i + 1}`, v]);
      }
      return channels(out);
    },
  },

  {
    type: 'chop:lag',
    family: F,
    label: 'lag',
    inputs: { min: 1, max: 1 },
    alwaysCook: true,
    params: [
      { key: 'lagup', type: 'float', default: 0.2, min: 0, max: 5 },
      { key: 'lagdown', type: 'float', default: 0.2, min: 0, max: 5 },
    ],
    cook(ctx) {
      const input = asChop(ctx.inputs[0]);
      if (!input) return channels([]);
      const st = ctx.node.state as { lag?: Map<string, number> };
      st.lag ??= new Map();
      const lagup = ctx.paramNum('lagup');
      const lagdown = ctx.paramNum('lagdown');
      const out: [string, number][] = input.channels.map((ch) => {
        const target = ch.data[ch.data.length - 1] ?? 0;
        const cur = st.lag!.get(ch.name) ?? target;
        const v = kernels().lagStep(cur, target, lagup, lagdown, ctx.time.delta);
        st.lag!.set(ch.name, v);
        return [ch.name, v];
      });
      return channels(out, input.rate);
    },
  },

  {
    type: 'chop:merge',
    family: F,
    label: 'merge',
    inputs: { min: 1, max: 4 },
    params: [],
    cook(ctx) {
      const out: Channel[] = [];
      for (const cs of ctx.inputs.map(asChop)) {
        if (cs) out.push(...cs.channels.map((c) => ({ name: c.name, data: c.data })));
      }
      return { kind: 'chop', rate: CONTROL_RATE, channels: out };
    },
  },

  {
    type: 'chop:select',
    family: F,
    label: 'select',
    inputs: { min: 1, max: 1 },
    params: [{ key: 'channames', type: 'string', default: '*' }],
    cook(ctx) {
      const input = asChop(ctx.inputs[0]);
      if (!input) return channels([]);
      const patterns = ctx.paramStr('channames').trim().split(/\s+/).filter(Boolean);
      const match = (name: string) =>
        patterns.some((p) => new RegExp(`^${p.replace(/[.+^${}()|\\[\]]/g, '\\$&').replace(/\*/g, '.*')}$`).test(name));
      return { kind: 'chop', rate: input.rate, channels: input.channels.filter((c) => match(c.name)) };
    },
  },

  {
    type: 'chop:mousein',
    family: F,
    label: 'mouse in',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [],
    cook(ctx) {
      const m = ctx.io.mouse;
      return channels([
        ['tx', m.x],
        ['ty', m.y],
        ['lmb', m.down ? 1 : 0],
      ]);
    },
  },

  {
    type: 'chop:switch',
    family: F,
    label: 'switch',
    inputs: { min: 1, max: 4 },
    params: [{ key: 'index', type: 'int', default: 0, min: 0, max: 3 }],
    cook(ctx) {
      const i = Math.max(0, Math.min(ctx.inputs.length - 1, Math.round(ctx.paramNum('index'))));
      return asChop(ctx.inputs[i]) ?? asChop(ctx.inputs.find((x) => x && x.kind === 'chop') ?? null);
    },
  },

  {
    type: 'chop:speed',
    family: F,
    label: 'speed',
    inputs: { min: 1, max: 1 },
    alwaysCook: true,
    params: [{ key: 'rate', type: 'float', default: 1, min: -10, max: 10 }],
    cook(ctx) {
      // integrate input channels over time (TD speed CHOP first-order behavior)
      const input = asChop(ctx.inputs[0]);
      if (!input) return channels([]);
      const st = ctx.node.state as { acc?: Map<string, number> };
      st.acc ??= new Map();
      const rate = ctx.paramNum('rate');
      const out: [string, number][] = input.channels.map((ch) => {
        const v = ch.data[ch.data.length - 1] ?? 0;
        const acc = (st.acc!.get(ch.name) ?? 0) + v * rate * ctx.time.delta;
        st.acc!.set(ch.name, acc);
        return [ch.name, acc];
      });
      return channels(out, input.rate);
    },
  },

  {
    type: 'chop:par',
    family: F,
    label: 'parameter',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [
      { key: 'oppath', type: 'string', default: '..' },
      { key: 'parnames', type: 'string', default: '*' },
    ],
    cook(ctx) {
      const target = ctx.engine.graph.resolve(ctx.paramStr('oppath'), ctx.node);
      if (!target) return channels([]);
      const patterns = ctx.paramStr('parnames').trim().split(/\s+/).filter(Boolean);
      const match = (name: string) => patterns.some((p) =>
        new RegExp(`^${p.replace(/[.+^${}()|\\[\]]/g, '\\$&').replace(/\*/g, '.*')}$`).test(name));
      const out: [string, number][] = [];
      for (const [key] of target.params) {
        if (!match(key)) continue;
        const v = ctx.engine.param(target, key);
        const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
        if (Number.isFinite(n)) out.push([key, n]);
      }
      return channels(out);
    },
  },

  {
    type: 'chop:in',
    family: F,
    label: 'in',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [{ key: 'index', type: 'int', default: 0, min: 0, max: 7 }],
    cook(ctx) {
      const parent = ctx.node.parent;
      const ext = parent?.inputs[Math.max(0, Math.round(ctx.paramNum('index')))];
      if (!ext) return channels([]);
      return asChop(ctx.engine.cook(ext)) ?? channels([]);
    },
  },

  {
    type: 'chop:out',
    family: F,
    label: 'out',
    inputs: { min: 1, max: 1 },
    params: [],
    cook(ctx) {
      return asChop(ctx.inputs[0]);
    },
  },
];
