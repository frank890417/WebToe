import { Graph } from './graph';
import { NodeInst } from './node';
import { getOp, type CookCtx, type OpSpec } from './registry';
import {
  compileExpr, zeroNodeRef,
  type ExprScope, type CompiledExpr, type NodeRef, type ParIndexable,
} from './expr';
import type { GpuFacade } from './passes';
import { CookClock } from './clock';
import type { InputState, OpOutput, ParamVal, TimeContext } from './types';

/**
 * Pull-based cook engine. `frame()` runs the cook steps that are due on the
 * fixed-rate clock (TouchDesigner's time model, see clock.ts) and cooks the
 * live roots once per step; `cook(node)` memoizes per step, cooks wired inputs
 * first, and lets expressions pull other nodes (op('x')) with cycle protection.
 */
export class Engine {
  readonly graph = new Graph();
  gpu: GpuFacade | null = null;
  io: InputState = { mouse: { x: 0.5, y: 0.5, down: false } };
  time: TimeContext = { seconds: 0, frame: 0, delta: 1 / 60, fps: 60 };

  /** nodes the UI wants alive this frame (viewer, display flags, visible thumbs) */
  readonly liveRoots = new Set<NodeInst>();

  private clock = new CookClock({ rate: 60 });
  private lastNow: number | null = null;

  /** Cook rate in Hz (TouchDesigner's project cook rate; default 60). */
  get cookRate(): number { return this.clock.rate; }
  set cookRate(rate: number) {
    if (!(rate > 0) || rate === this.clock.rate) return;
    const next = new CookClock({ rate });
    // keep time continuous: the new grid resumes at the current seconds
    if (this.clock.anchored && this.lastNow !== null) {
      const k = Math.floor(this.time.seconds * rate + 1e-9);
      next.setAnchor(this.lastNow - this.time.seconds, k);
    }
    this.clock = next;
  }

  /** steps skipped by resyncs (hidden tab, stalls) — for diagnostics/HUD */
  get skippedSteps(): number { return this.clock.skipped; }
  /** fitted cost per cook step, seconds (CPU + the GPU time it stretches frames by) */
  get stepCost(): number { return this.clock.stepCost; }

  /**
   * Run the cook steps due at `now` (seconds, e.g. performance.now()/1000) and
   * return how many ran — 0 when the display is ahead of the cook rate (e.g. a
   * 120 Hz display on a 60 Hz project), in which case outputs are unchanged.
   */
  frame(now: number): number {
    if (this.lastNow !== null) {
      const d = Math.min(Math.max(now - this.lastNow, 1 / 250), 0.25);
      this.displayFps = this.displayFps * 0.95 + (1 / d) * 0.05;
    }
    this.lastNow = now;
    if (!this.clock.anchored) this.clock.setAnchor(now);
    const plan = this.clock.plan(now);
    return this.clock.execute(plan, (k) => this.step(k));
  }

  /**
   * Run *every* step due at `now` — no catch-up cap, no resync. For offline
   * work (tests, frame export, seeking) where each step must happen.
   */
  advanceTo(now: number): number {
    this.lastNow = now;
    if (!this.clock.anchored) this.clock.setAnchor(now);
    return this.clock.execute(this.clock.planAll(now), (k) => this.step(k));
  }

  /** display frames per second (smoothed) — what the HUD shows */
  private displayFps = 60;

  private step(k: number): void {
    this.time = {
      seconds: this.clock.secondsAt(k),
      frame: this.time.frame + 1,
      delta: this.clock.dt,
      fps: this.displayFps,
    };
    this.gpu?.setTime(this.time.seconds);
    for (const node of this.liveRoots) {
      if (this.graph.byId.has(node.id)) this.cook(node);
    }
  }

  cook(node: NodeInst): OpOutput {
    if (node.cookedFrame === this.time.frame) return node.output;
    if (node.cooking) {
      // dependency cycle — yield previous output, flag once
      node.error = 'cycle detected';
      return node.output;
    }
    node.cooking = true;
    node.error = null;
    try {
      const spec = getOp(node.type);
      if (node.flags.bypass) {
        const src = node.inputs[0];
        node.output = src ? this.cook(src) : null;
      } else {
        const inputs = spec.lazyInputs ? [] : node.inputs.map((n) => (n ? this.cook(n) : null));
        const ctx = this.makeCtx(node, spec, inputs);
        node.output = spec.cook(ctx);
      }
    } catch (e) {
      node.error = (e as Error).message;
      node.output = null;
    } finally {
      node.cooking = false;
      node.cookedFrame = this.time.frame;
    }
    return node.output;
  }

  private readonly paramEvalStack = new Set<string>();

  /** Resolve a param to its effective value (evaluating expressions). */
  param(node: NodeInst, key: string): ParamVal {
    const spec = getOp(node.type);
    const ps = spec.params.find((p) => p.key === key);
    const pv = node.params.get(key);
    const fallback = (ps?.default ?? 0) as ParamVal;
    if (!pv) return fallback;
    if (pv.mode !== 'expr' || !pv.expr) return pv.value;
    const stackKey = `${node.id}:${key}`;
    if (this.paramEvalStack.has(stackKey)) {
      node.error = `param ${key}: expression cycle`;
      return pv.value ?? fallback;
    }
    this.paramEvalStack.add(stackKey);
    try {
      const compiled = this.compiledFor(node, key, pv.expr);
      const out = compiled(this.scopeFor(node));
      if (typeof out === 'number' && Number.isFinite(out)) return out;
      if (typeof out === 'boolean' || typeof out === 'string') return out;
      if (Array.isArray(out) && out.every((v) => typeof v === 'number')) return out as number[];
      throw new Error(`expression returned ${typeof out}`);
    } catch (e) {
      node.error = `param ${key}: ${(e as Error).message}`;
      return pv.value ?? fallback;
    } finally {
      this.paramEvalStack.delete(stackKey);
    }
  }

  paramNum(node: NodeInst, key: string): number {
    const v = this.param(node, key);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private compiledFor(node: NodeInst, key: string, src: string): CompiledExpr {
    const cacheKey = `__expr:${key}`;
    const entry = node.state[cacheKey] as { src: string; fn: CompiledExpr } | undefined;
    if (entry && entry.src === src) return entry.fn;
    const fn = compileExpr(src);
    node.state[cacheKey] = { src, fn };
    return fn;
  }

  private scopeFor(node: NodeInst): ExprScope {
    return {
      time: this.time,
      me: this.nodeRef(node),
      op: (path: string) => {
        const target = this.graph.resolve(path, node);
        return target ? this.nodeRef(target, true) : zeroNodeRef();
      },
      parent: (level = 1) => {
        let cur: NodeInst | null = node;
        for (let i = 0; i < Math.max(1, level) && cur; i++) cur = cur.parent;
        return cur && cur !== this.graph.root ? this.nodeRef(cur) : zeroNodeRef();
      },
    };
  }

  /** Live node reference for expressions: `.par.key` resolves parameters,
   *  numeric/string props index the node's cooked CHOP channels. */
  private nodeRef(target: NodeInst, cookForChannels = false): NodeRef {
    const self = this;
    const par: ParIndexable = new Proxy({} as ParIndexable, {
      get: (_t, prop) => {
        if (typeof prop === 'symbol') return 0;
        const v = self.param(target, prop);
        return Array.isArray(v) ? v[0] ?? 0 : v;
      },
    });
    const base = { name: target.name, path: this.graph.pathOf(target), par };
    return new Proxy(base as unknown as NodeRef, {
      get: (t, prop) => {
        if (prop === 'name' || prop === 'path' || prop === 'par') {
          return (t as unknown as Record<string, unknown>)[prop as string];
        }
        if (typeof prop === 'symbol') return undefined;
        const out = cookForChannels ? self.cook(target) : target.output;
        if (out && out.kind === 'chop') {
          const key = Number.isNaN(Number(prop)) ? prop : Number(prop);
          const ch = typeof key === 'number'
            ? out.channels[key]
            : out.channels.find((c) => c.name === key);
          return ch && ch.data.length ? ch.data[ch.data.length - 1] : 0;
        }
        return 0;
      },
    });
  }

  private makeCtx(node: NodeInst, spec: OpSpec, inputs: OpOutput[]): CookCtx {
    const self = this;
    return {
      node,
      engine: self,
      time: self.time,
      io: self.io,
      gpu: self.gpu,
      inputs,
      param: (key) => self.param(node, key),
      paramNum: (key) => self.paramNum(node, key),
      paramStr: (key) => String(self.param(node, key)),
      paramBool: (key) => {
        const v = self.param(node, key);
        return typeof v === 'boolean' ? v : Number(v) !== 0;
      },
      menuIndex: (key) => {
        const ps = spec.params.find((p) => p.key === key);
        const v = String(self.param(node, key));
        return ps?.menu ? ps.menu.indexOf(v) : -1;
      },
    };
  }
}

