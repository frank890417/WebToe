import { Graph } from './graph';
import { NodeInst } from './node';
import { getOp, hasOp } from './registry';
import type { GraphJSON, NodeJSON, ParamValueJSON, WireJSON } from './types';

export const FORMAT_VERSION = 1;

/** Forward migrations; loading any version ≤ FORMAT_VERSION always works. */
const migrations: ((json: GraphJSON) => GraphJSON)[] = [
  // index 0 migrates version 1 → 2 when the time comes
];

export function graphToJSON(graph: Graph, meta?: Record<string, unknown>): GraphJSON {
  const { nodes, wires } = networkToJSON(graph, graph.root);
  const merged = { ...graph.meta, ...(meta ?? {}) };
  return { app: 'webtoe', version: FORMAT_VERSION, root: { nodes, wires }, ...(Object.keys(merged).length ? { meta: merged } : {}) };
}

function networkToJSON(graph: Graph, container: NodeInst): { nodes: NodeJSON[]; wires: WireJSON[] } {
  const children = graph.childrenOf(container);
  const nodes: NodeJSON[] = [];
  const wires: WireJSON[] = [];
  for (const n of children) {
    const spec = getOp(n.type);
    const params: Record<string, ParamValueJSON> = {};
    for (const [k, pv] of n.params) {
      const ps = spec.params.find((p) => p.key === k);
      const isDefault =
        pv.mode === 'const' && ps && JSON.stringify(pv.value) === JSON.stringify(ps.default);
      if (!isDefault) {
        params[k] = { mode: pv.mode, value: pv.value };
        if (pv.expr !== undefined) params[k].expr = pv.expr;
        if (pv.tdExpr !== undefined) params[k].tdExpr = pv.tdExpr;
      }
    }
    const j: NodeJSON = { name: n.name, type: n.type, family: spec.family, pos: [n.pos.x, n.pos.y] };
    if (n.flags.display || n.flags.bypass) {
      j.flags = {};
      if (n.flags.display) j.flags.display = true;
      if (n.flags.bypass) j.flags.bypass = true;
    }
    if (Object.keys(params).length) j.params = params;
    if (n.foreignType) j.foreignType = n.foreignType;
    if (n.text !== undefined) j.text = n.text;
    if (n.children) {
      const sub = networkToJSON(graph, n);
      if (sub.nodes.length) j.children = sub.nodes;
      if (sub.wires.length) j.wires = sub.wires;
    }
    nodes.push(j);
    n.inputs.forEach((src, idx) => {
      if (src && src.parent === container) wires.push({ from: `${src.name}:0`, to: `${n.name}:${idx}` });
    });
  }
  return { nodes, wires };
}

export class LoadError extends Error {}

function stubTypeFor(family?: import('./types').Family): string {
  switch (family) {
    case 'TOP': return 'top:stub';
    case 'CHOP': return 'chop:stub';
    case 'DAT': return 'dat:stub';
    case 'SOP': return 'sop:stub';
    case 'MAT': return 'mat:stub';
    default: return 'comp:stub';
  }
}

export function graphFromJSON(raw: unknown): Graph {
  let json = validateEnvelope(raw);
  for (let v = json.version; v < FORMAT_VERSION; v++) {
    const mig = migrations[v - 1];
    if (!mig) throw new LoadError(`no migration from format version ${v}`);
    json = mig(json);
  }
  const graph = new Graph();
  if (json.meta && typeof json.meta === 'object') graph.meta = { ...json.meta };
  buildNetwork(graph, graph.root, json.root.nodes ?? [], json.root.wires ?? []);
  return graph;
}

function validateEnvelope(raw: unknown): GraphJSON {
  if (typeof raw !== 'object' || raw === null) throw new LoadError('not an object');
  const j = raw as Partial<GraphJSON>;
  if (j.app !== 'webtoe') throw new LoadError('not a webtoe project (missing app tag)');
  if (typeof j.version !== 'number' || j.version < 1) throw new LoadError('bad version');
  if (j.version > FORMAT_VERSION) throw new LoadError(`file version ${j.version} is newer than this build (${FORMAT_VERSION})`);
  if (!j.root || !Array.isArray(j.root.nodes)) throw new LoadError('missing root.nodes');
  return j as GraphJSON;
}

function buildNetwork(graph: Graph, container: NodeInst, nodes: NodeJSON[], wires: WireJSON[]): void {
  const made = new Map<string, NodeInst>();
  for (const nj of nodes) {
    const type = hasOp(nj.type) ? nj.type : stubTypeFor(nj.family);
    const node = graph.create(type, container, nj.name);
    if (node.name !== nj.name) {
      // name collision should not happen in a well-formed file; keep deterministic
      graph.rename(node, nj.name);
    }
    node.pos.x = nj.pos?.[0] ?? 0;
    node.pos.y = nj.pos?.[1] ?? 0;
    if (nj.flags?.display) node.flags.display = true;
    if (nj.flags?.bypass) node.flags.bypass = true;
    if (nj.foreignType) node.foreignType = nj.foreignType;
    if (type.endsWith(':stub') && !node.foreignType) node.foreignType = nj.type;
    if (nj.text !== undefined) node.text = nj.text;
    if (nj.params) {
      for (const [k, pv] of Object.entries(nj.params)) {
        node.params.set(k, {
          mode: pv.mode ?? 'const',
          value: pv.value,
          ...(pv.expr !== undefined ? { expr: pv.expr } : {}),
          ...(pv.tdExpr !== undefined ? { tdExpr: pv.tdExpr } : {}),
        });
      }
    }
    made.set(node.name, node);
    if (nj.children && node.children) buildNetwork(graph, node, nj.children, nj.wires ?? []);
  }
  for (const w of wires) {
    const [fromName] = w.from.split(':');
    const [toName, toIdxStr] = w.to.split(':');
    const src = made.get(fromName);
    const dst = made.get(toName);
    if (!src || !dst) continue;
    try {
      graph.connect(src, dst, Number(toIdxStr) || 0);
    } catch {
      // tolerate bad wires in files (e.g. family mismatch after stubbing)
    }
  }
}
