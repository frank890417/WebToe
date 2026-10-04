/**
 * Fixed-rate cook clock — TouchDesigner's time model.
 *
 * TouchDesigner advances state (feedback, integrators, lag, particles) once per
 * *cook step* at the project's cook rate, and per-step constants (a feedback
 * fade, a rotation per frame) are tuned against that step, not against the
 * display. So the engine cooks on a fixed grid: step k is at k / rate seconds
 * after the anchor, the display shows the latest step, and a 120 Hz display
 * cooks a 60 Hz project 60 times a second — half the work, the same result.
 *
 * State depends only on the anchor and the inputs of steps 0..k, never on how
 * many steps a given display frame ran (1, 7 or 24 per frame give identical
 * state — tested).
 *
 * Catch-up without a death spiral: a frame costs about r + n·c (r = fixed
 * per-frame cost such as compositing, c = cost per step, much of it GPU time
 * the CPU cannot see but the frame length shows). r and c are fitted by least
 * squares over the last 16 frames. If c·rate fits in the budget, a lagging
 * frame catches up as many steps as fit in `frameCapSec`; if it cannot keep
 * up, it runs one step per frame; more than `resyncSec` behind (a hidden tab,
 * a long stall), it skips ahead instead of replaying.
 *
 * Ported from the cook clock of the author's production web port of two
 * TouchDesigner shows (fixed-step core and
 * cost model; show anchoring and start-up replay are not needed here).
 */

export interface CookPlan {
  /** first and last step to run this frame, inclusive (to < from = nothing) */
  from: number;
  to: number;
  /** steps the clock is behind before this frame */
  behind: number;
  /** most steps this frame may run (cost model) */
  maxSteps: number;
  /** steps skipped by a resync this frame */
  skipped?: number;
}

export interface CookClockOptions {
  /** cook rate in Hz (TouchDesigner's default is 60) */
  rate?: number;
  /** behind by more than this many seconds → skip ahead */
  resyncSec?: number;
  /** longest frame allowed while catching up */
  frameCapSec?: number;
  /** c·rate at or below this = the machine can keep up */
  sustainFrac?: number;
}

const EPS = 1e-9;

export class CookClock {
  readonly rate: number;
  readonly dt: number;
  /** total steps skipped by resyncs, and the latest one */
  skipped = 0;
  lastSkip: { n: number; at: number } | null = null;

  private anchor: number | null = null;
  private done = -1;
  private readonly resyncSteps: number;
  private readonly frameCapSec: number;
  private readonly sustainFrac: number;

  // cost model
  private lastPlanSec: number | null = null;
  private doneAtPlan = -1;
  private readonly hist: { n: number; d: number }[] = [];
  private costC = 0;
  private costR = 0;
  private rKnown = 0;
  private varN = 0;
  private lastD = 0;

  constructor({ rate = 60, resyncSec = 1, frameCapSec = 0.1, sustainFrac = 0.95 }: CookClockOptions = {}) {
    if (!(rate > 0)) throw new RangeError('cook rate must be positive');
    this.rate = rate;
    this.dt = 1 / rate;
    this.resyncSteps = Math.max(5, Math.round(resyncSec * rate));
    this.frameCapSec = frameCapSec;
    this.sustainFrac = sustainFrac;
  }

  get anchored(): boolean { return this.anchor !== null; }
  /** the last step run */
  get step(): number { return this.done; }
  /** fitted cost per step and per frame, in seconds */
  get stepCost(): number { return this.costC; }
  get frameCost(): number { return this.costR; }

  /** Start the grid: step `doneStep + 1` is the next to run. */
  setAnchor(sec: number, doneStep = -1): void {
    this.anchor = sec;
    this.done = doneStep;
    this.lastPlanSec = null;
    this.doneAtPlan = doneStep;
    this.hist.length = 0;
    this.costC = this.costR = this.rKnown = this.varN = this.lastD = 0;
  }

  /** The step that should have run by `nowSec` (−1 before the anchor). */
  targetAt(nowSec: number): number {
    return this.anchor === null ? -1 : Math.floor((nowSec - this.anchor) * this.rate + EPS);
  }

  /** Which steps to run this frame. Call once per display frame. */
  plan(nowSec: number): CookPlan {
    const target = this.targetAt(nowSec);
    // measure the previous frame: n steps ran in d seconds
    let cInst = 0;
    if (this.lastPlanSec === null || nowSec - this.lastPlanSec > 0.004) {
      const ran = this.done - this.doneAtPlan;
      const d = this.lastPlanSec === null ? 0 : nowSec - this.lastPlanSec;
      if (this.lastPlanSec !== null && d > 0 && ran >= 0) {
        this.hist.push({ n: ran, d });
        if (this.hist.length > 16) this.hist.shift();
        this.lastD = d;
        this.fitCost();
        if (ran > 0) cInst = Math.max(0, (d - this.costR) / ran);
      }
      this.lastPlanSec = nowSec;
      this.doneAtPlan = this.done;
    }

    const behind = target - this.done;
    if (behind <= 0) return { from: this.done + 1, to: this.done, behind: 0, maxSteps: 0 };
    if (behind > this.resyncSteps) {
      // too far behind (hidden tab, stall): skip ahead, keep the state
      const n = behind - 1;
      this.skipped += n;
      this.lastSkip = { n, at: target };
      this.done = target - 1;
      this.doneAtPlan = this.done;
      return { from: target, to: target, behind: 1, maxSteps: 1, skipped: n };
    }
    // c = max(fit, last frame's own estimate): brake at once when the GPU gets busy
    const c = Math.max(this.costC, cInst);
    const maxSteps = c <= 0 ? Infinity
      : c * this.rate <= this.sustainFrac ? Math.max(1, Math.floor((this.frameCapSec - this.costR) / c))
      : this.varN < 1e-9 && behind >= 2 && this.lastD < this.frameCapSec / 2 ? 2 : 1;
    return { from: this.done + 1, to: target, behind, maxSteps };
  }

  /**
   * Run a plan: consecutive steps from `plan.from`, at most `maxSteps`; the
   * rest is caught up on later frames (only a resync ever drops steps).
   * `step(k, last)` must cook step k — `last` is the one the display shows.
   * Returns the number of steps run.
   */
  execute(plan: CookPlan, step: (k: number, last: boolean) => void): number {
    if (plan.to < plan.from) return 0;
    const to = Math.min(plan.to, plan.from + Math.max(1, plan.maxSteps) - 1);
    for (let k = plan.from; k <= to; k++) {
      step(k, k === to);
      this.commit(k);
    }
    return to - plan.from + 1;
  }

  private commit(k: number): void {
    if (k !== this.done + 1) throw new Error(`cook clock: step ${k} out of order (done ${this.done})`);
    this.done = k;
  }

  /** Every step through `nowSec`, no cost cap, no resync (offline / seek). */
  planAll(nowSec: number): CookPlan {
    const target = this.targetAt(nowSec);
    return { from: this.done + 1, to: target, behind: Math.max(0, target - this.done), maxSteps: Infinity };
  }

  /** Seconds since the anchor at step k. */
  secondsAt(k: number): number { return k / this.rate; }

  private fitCost(): void {
    const N = this.hist.length;
    if (!N) return;
    let sn = 0, sd = 0, snn = 0, snd = 0, dMin = Infinity;
    for (const h of this.hist) { sn += h.n; sd += h.d; snn += h.n * h.n; snd += h.n * h.d; dMin = Math.min(dMin, h.d); }
    this.varN = snn - (sn * sn) / N;
    let c = 0, r = this.rKnown;
    if (this.varN > 1e-9) { c = (snd - (sn * sd) / N) / this.varN; r = (sd - c * sn) / N; }
    if (this.varN > 1e-9 && c <= 0) {
      // Frames did not get longer when they ran more steps (vsync-bound with
      // headroom): steps are cheap. The pessimistic fallback below would charge
      // the whole frame to the steps and never catch up when the cook rate
      // equals the display rate. A wrong guess is braked next frame (cInst).
      c = 0;
      r = sd / N;
    } else if (!(this.varN > 1e-9) || c <= 0) {
      r = Math.min(this.rKnown, dMin);
      c = sn > 0 ? Math.max(0, (sd / N - r) / (sn / N)) : 0;
    }
    r = Math.max(0, Math.min(r, dMin));
    if (this.varN > 1e-9) this.rKnown = r;
    this.costC = c;
    this.costR = r;
  }
}
