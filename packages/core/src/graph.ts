import { NodeInst } from './node';
import { getOp, defaultParams } from './registry';

/** Network/graph structure: creation, naming, hierarchy, wiring, path resolution. */
export class Graph {
  readonly root: NodeInst;
  readonly byId = new Map<number, NodeInst>();
  /** project-level settings that travel with the file (e.g. cookRate) */
  meta: Record<string, unknown> = {};

  constructor() {
    this.root = new NodeInst('__root__', '/', null);
    this.root.children = new Map();
  }

  /** Create a node of registered `type` under `parent` (default root). */
  create(type: string, parent?: NodeInst, name?: string): NodeInst {
    const spec = getOp(type);
    const p = parent ?? this.root;
    if (!p.children) throw new Error(`parent ${p.name} is not a container`);
    const short = type.includes(':') ? type.split(':')[1] : type;
    const finalName = this.uniqueName(p, name ?? `${short}1`);
    const node = new NodeInst(type, finalName, p);
    node.params = defaultParams(spec);
    if (spec.isContainer) node.children = new Map();
    p.children.set(finalName, node);
    this.byId.set(node.id, node);
    return node;
  }

  delete(node: NodeInst): void {
    if (node === this.root) throw new Error('cannot delete root');
    // recurse children first
    if (node.children) for (const c of [...node.children.values()]) this.delete(c);
    // detach as input from siblings (and any node that references it)
    for (const n of this.byId.values()) {
      for (let i = 0; i < n.inputs.length; i++) if (n.inputs[i] === node) n.inputs[i] = null;
    }
    node.parent?.children?.delete(node.name);
    this.byId.delete(node.id);
  }

  rename(node: NodeInst, newName: string): void {
    const p = node.parent;
    if (!p?.children) throw new Error('cannot rename root');
    const clean = sanitizeName(newName);
    if (!clean) throw new Error('invalid name');
    if (clean === node.name) return;
    const unique = this.uniqueName(p, clean);
    p.children.delete(node.name);
    node.name = unique;
    p.children.set(unique, node);
  }

  /** Wire src's output into dst.inputs[index]. Same-family only, except across
   *  COMP boundaries (in/out tunnel children resolve the family at cook time). */
  connect(src: NodeInst, dst: NodeInst, index = 0): void {
    const sSpec = getOp(src.type);
    const dSpec = getOp(dst.type);
    const boundary = sSpec.family === 'COMP' || dSpec.family === 'COMP';
    if (!boundary && sSpec.family !== dSpec.family) {
      throw new Error(`family mismatch: ${sSpec.family} → ${dSpec.family}`);
    }
    if (src === dst) throw new Error('cannot wire node to itself');
    const cap = this.inputCapacity(dst);
    if (index < 0 || index >= cap) throw new Error(`input index ${index} out of range for ${dst.type}`);
    while (dst.inputs.length <= index) dst.inputs.push(null);
    dst.inputs[index] = src;
  }

  /** Effective wired-input capacity: containers expose one slot per in-tunnel
   *  child (min 1 so freshly created COMPs can be wired before adding tunnels). */
  inputCapacity(node: NodeInst): number {
    const spec = getOp(node.type);
    if (!spec.isContainer) return spec.inputs.max;
    const ins = node.children
      ? [...node.children.values()].filter((c) => c.type === 'top:in' || c.type === 'chop:in').length
      : 0;
    return Math.max(ins, 1);
  }

  disconnect(dst: NodeInst, index: number): void {
    if (index >= 0 && index < dst.inputs.length) dst.inputs[index] = null;
  }

  childrenOf(parent: NodeInst): NodeInst[] {
    return parent.children ? [...parent.children.values()] : [];
  }

  /** Resolve a path relative to `from`'s network (TD-style `op()` semantics):
   *  'noise1', './noise1', '../up/noise1', '/abs/path', 'comp/child'. */
  resolve(path: string, from: NodeInst): NodeInst | null {
    let cur: NodeInst | null;
    let parts: string[];
    if (path.startsWith('/')) {
      cur = this.root;
      parts = path.split('/').filter(Boolean);
    } else {
      cur = from.children ? from : from.parent; // relative to containing network
      parts = path.split('/').filter((s) => s !== '' && s !== '.');
    }
    for (const part of parts) {
      if (!cur) return null;
      if (part === '..') cur = cur.parent;
      else cur = cur.children?.get(part) ?? null;
    }
    return cur;
  }

  pathOf(node: NodeInst): string {
    if (node === this.root) return '/';
    const segs: string[] = [];
    let cur: NodeInst | null = node;
    while (cur && cur !== this.root) {
      segs.unshift(cur.name);
      cur = cur.parent;
    }
    return '/' + segs.join('/');
  }

  private uniqueName(parent: NodeInst, want: string): string {
    const base = sanitizeName(want) || 'node';
    if (!parent.children!.has(base)) return base;
    // strip trailing digits to get stem, then count up
    const stem = base.replace(/\d+$/, '') || 'node';
    let i = 1;
    while (parent.children!.has(`${stem}${i}`)) i++;
    return `${stem}${i}`;
  }
}

export function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
}
