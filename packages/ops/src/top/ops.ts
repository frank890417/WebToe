import type {
  CookCtx, OpOutput, OpSpec, ParamSpec, TextureHandle, TextureOut,
} from '@webtoe/core';
import * as glsl from './glsl';
import * as wgsl from './wgsl';
import {
  BLUR_TYPES, COMP_OPS, NOISE_TYPES, RAMP_KC, RAMP_KP, RAMP_MAX_KEYS,
  compOverlay, hash32, noiseCoord, noiseSeedOffset, noiseXform, parseRampDat, rampKeys,
} from './tdmath';

const F = 'TOP' as const;

/** TD channel-selector menu (Monochrome rgb/alpha, Edge select) — order = shader code. */
const TD_CHANNELS = ['luminance', 'red', 'green', 'blue', 'alpha', 'rgbaverage', 'average', 'rgbmax', 'max', 'zero', 'one'];
/** TD extend tokens → shader codes shared by Ramp. */
const EXTEND_CODE: Record<string, number> = { hold: 0, zero: 1, repeat: 2, mirror: 3, black: 4 };
const RAMP_TYPES = ['horizontal', 'vertical', 'radial', 'circular'];
const DEFAULT_RES: [number, number] = [1280, 720];

function asTop(o: OpOutput | undefined): TextureOut | null {
  return o && o.kind === 'top' ? o : null;
}

function resParams(defaultMode: 'input' | 'custom'): ParamSpec[] {
  return [
    { key: 'resmode', label: 'resolution', type: 'menu', default: defaultMode, menu: ['input', 'custom'], page: 'common' },
    { key: 'resw', label: 'width', type: 'int', default: DEFAULT_RES[0], min: 1, max: 4096, page: 'common' },
    { key: 'resh', label: 'height', type: 'int', default: DEFAULT_RES[1], min: 1, max: 4096, page: 'common' },
  ];
}

function resolution(ctx: CookCtx, firstInput: TextureHandle | null): { w: number; h: number } {
  if (ctx.paramStr('resmode') === 'custom') {
    return { w: ctx.paramNum('resw'), h: ctx.paramNum('resh') };
  }
  if (firstInput) return { w: firstInput.width, h: firstInput.height };
  return { w: DEFAULT_RES[0], h: DEFAULT_RES[1] };
}

/** A colour param as exactly four numbers (missing channels from `d`). */
function color4(v: unknown, d: [number, number, number, number]): number[] {
  const a = Array.isArray(v) ? v : [];
  return d.map((x, i) => (typeof a[i] === 'number' && Number.isFinite(a[i]) ? a[i] : x));
}

function ensureShader(ctx: CookCtx, spec: OpSpec): void {
  ctx.gpu!.registerShader(spec.type, spec.shaders ?? {});
}

/** Visible "no signal" output so a missing input reads as such, not as black. */
function placeholder(ctx: CookCtx, tint: [number, number, number, number]): TextureOut {
  ctx.gpu!.registerShader('top:placeholder', { glsl: glsl.placeholderGlsl, wgsl: wgsl.placeholderWgsl });
  const { w, h } = resolution(ctx, null);
  const tex = ctx.gpu!.runPass(ctx.node, {
    shaderId: 'top:placeholder',
    uniforms: { u_tint: tint },
    inputs: [],
    output: { width: w, height: h },
  });
  return { kind: 'top', tex };
}

function requireGpu(ctx: CookCtx): boolean {
  if (!ctx.gpu) {
    ctx.node.error = 'no GPU backend';
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------

export const topOps: OpSpec[] = [
  {
    type: 'top:constant',
    family: F,
    label: 'constant',
    inputs: { min: 0, max: 0 },
    params: [{ key: 'color', type: 'color', default: [1, 1, 1, 1] }, ...resParams('custom')],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.constantGlsl, wgsl: wgsl.constantWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const { w, h } = resolution(ctx, null);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: { u_color: ctx.param('color') as number[] },
        inputs: [],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:noise',
    family: F,
    label: 'noise',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    // TouchDesigner-faithful Noise TOP (docs/TD-PARITY.md "Fidelity"). Defaults
    // are TD's; `harmonics` is TD's `harmon` (extra octaves: octaves = harmonics + 1).
    // `speed` is a WebToe extra (tz += time·speed); TD imports set it to 0.
    params: [
      { key: 'type', type: 'menu', default: 'simplex3d', menu: [...NOISE_TYPES] },
      { key: 'seed', type: 'float', default: 1, min: 0, max: 100 },
      { key: 'period', type: 'float', default: 1, min: 0, max: 8 },
      { key: 'harmonics', label: 'harmonics (extra octaves)', type: 'int', default: 2, min: 0, max: 15 },
      { key: 'spread', type: 'float', default: 2, min: 0, max: 4 },
      { key: 'gain', type: 'float', default: 0.7, min: 0, max: 1 },
      { key: 'rough', label: 'roughness (sparse only)', type: 'float', default: 0.5, min: 0, max: 1 },
      { key: 'exponent', type: 'float', default: 1, min: 0.1, max: 8 },
      { key: 'amp', label: 'amplitude', type: 'float', default: 0.5, min: 0, max: 4 },
      { key: 'offset', type: 'float', default: 0.5, min: -2, max: 2 },
      { key: 'mono', type: 'toggle', default: true },
      { key: 'aspectcorrect', label: 'aspect correct', type: 'toggle', default: true },
      { key: 'alpha', type: 'menu', default: 'one', menu: ['one', 'zero', 'random'] },
      { key: 'speed', label: 'speed (tz per second)', type: 'float', default: 0.25, min: -4, max: 4 },
      ...['tx', 'ty', 'tz'].map((key): ParamSpec => ({ key, type: 'float', default: 0, min: -4, max: 4, page: 'transform' })),
      ...['rx', 'ry', 'rz'].map((key): ParamSpec => ({ key, type: 'float', default: 0, min: -180, max: 180, page: 'transform' })),
      ...['sx', 'sy', 'sz'].map((key): ParamSpec => ({ key, type: 'float', default: 1, min: -4, max: 4, page: 'transform' })),
      ...['px', 'py', 'pz'].map((key): ParamSpec => ({ key, type: 'float', default: 0, min: -4, max: 4, page: 'transform' })),
      { key: 'xord', label: 'transform order', type: 'menu', default: 'srt', menu: ['srt', 'str', 'rst', 'rts', 'tsr', 'trs'], page: 'transform' },
      { key: 't4d', label: '4D translate', type: 'float', default: 0, min: -4, max: 4, page: 'transform' },
      { key: 's4d', label: '4D scale', type: 'float', default: 1, min: -4, max: 4, page: 'transform' },
      ...resParams('custom'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.noiseGlsl, wgsl: wgsl.noiseWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const { w, h } = resolution(ctx, null);
      const n = (k: string) => ctx.paramNum(k);
      const typeStr = ctx.paramStr('type');
      const type = typeStr === 'randomgpu' ? NOISE_TYPES.indexOf('random') : NOISE_TYPES.indexOf(typeStr as never);
      const period = Math.max(1e-6, n('period'));
      const ps = noiseCoord(w, h, ctx.paramBool('aspectcorrect'));
      const M = noiseXform({
        tx: n('tx'), ty: n('ty'), tz: n('tz') + ctx.time.seconds * n('speed'),
        rx: n('rx'), ry: n('ry'), rz: n('rz'), sx: n('sx'), sy: n('sy'), sz: n('sz'),
        px: n('px'), py: n('py'), pz: n('pz'), xord: ctx.paramStr('xord'),
      }, period);
      const seed = n('seed'), w4 = n('t4d') * n('s4d');
      const seeds = [0, 1, 2, 3].map((c) => { const o = noiseSeedOffset(seed, c); return [o[0], o[1], o[2], w4 + o[3]]; });
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_type: type < 0 ? NOISE_TYPES.indexOf('simplex3d') : type,
          u_m0: M.slice(0, 4), u_m1: M.slice(4, 8), u_m2: M.slice(8, 12),
          u_seed0: seeds[0], u_seed1: seeds[1], u_seed2: seeds[2], u_seed3: seeds[3],
          u_ps: ps,
          u_amp: n('amp'),
          u_offset: n('offset'),
          u_gain: n('gain'),
          u_lac: n('spread'),
          u_exp: n('exponent'),
          u_oct: Math.max(1, Math.min(16, Math.round(n('harmonics')) + 1)),
          u_rough: n('rough'),
          u_mono: ctx.paramBool('mono') ? 1 : 0,
          u_alpha: { zero: 0, one: 1, random: 2 }[ctx.paramStr('alpha')] ?? 1,
          u_tiny: period < 1e-5 ? 1 : 0,
          u_seedr: (hash32(`td-random:${seed}`) % 100003) / 7,
        },
        inputs: [],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:ramp',
    family: F,
    label: 'ramp',
    inputs: { min: 0, max: 0 },
    // TouchDesigner-faithful ramp (docs/TD-PARITY.md "Fidelity"): TD's key
    // wrap, phase/period per type, extend modes, interpolation, fit aspect.
    params: [
      { key: 'type', type: 'menu', default: 'horizontal', menu: RAMP_TYPES },
      { key: 'phase', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'period', type: 'float', default: 1, min: 0.01, max: 4 },
      { key: 'positionx', label: 'position x (radial/circular centre)', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'positiony', label: 'position y', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'colora', type: 'color', default: [0, 0, 0, 1] },
      { key: 'colorb', type: 'color', default: [1, 1, 1, 1] },
      { key: 'dat', label: 'keys DAT (pos r g b a)', type: 'string', default: '' },
      { key: 'extendleft', type: 'menu', default: 'repeat', menu: ['hold', 'zero', 'repeat', 'mirror', 'black'] },
      { key: 'extendright', type: 'menu', default: 'sameasleft', menu: ['sameasleft', 'hold', 'zero', 'repeat', 'mirror', 'black'] },
      { key: 'interp', label: 'interpolate keys', type: 'menu', default: 'linear', menu: ['step', 'linear', 'easeineaseout', 'hermite'] },
      { key: 'tension', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'fitaspect', type: 'menu', default: 'fithorz', menu: ['fithorz', 'fitvert', 'fitbest', 'fitoutside', 'fill'] },
      { key: 'premultrgbbyalpha', label: 'premultiply rgb by alpha', type: 'toggle', default: true },
      ...resParams('custom'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.rampGlsl, wgsl: wgsl.rampWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const { w, h } = resolution(ctx, null);

      // TouchDesigner keeps a ramp's real gradient in a keys DAT with
      // `pos r g b a` rows; the colour params stand in when there is none.
      let raw: number[][] = [];
      const datPath = ctx.paramStr('dat');
      if (datPath) {
        const dat = ctx.engine.graph.resolve(datPath, ctx.node.parent ?? ctx.node);
        if (dat?.text) raw = parseRampDat(dat.text);
      }
      if (!raw.length) {
        const a = ctx.param('colora') as number[], b = ctx.param('colorb') as number[];
        raw = [[0, ...a], [1, ...b]];
      }
      const keys = rampKeys(raw);
      if (keys.length > RAMP_MAX_KEYS) ctx.node.error = `ramp: ${keys.length} keys, only ${RAMP_MAX_KEYS} used`;
      const n = Math.min(RAMP_MAX_KEYS, keys.length);
      const uniforms: Record<string, number | number[]> = {};
      for (let i = 0; i < RAMP_MAX_KEYS; i++) {
        const k = keys[Math.min(i, n - 1)];
        uniforms[RAMP_KC[i]] = [k[1], k[2], k[3], k[4]];
      }
      for (let j = 0; j < RAMP_KP.length; j++) {
        uniforms[RAMP_KP[j]] = [0, 1, 2, 3].map((q) => keys[Math.min(j * 4 + q, n - 1)][0]);
      }

      // legacy WebToe value 'linear' = horizontal
      const typeStr = ctx.paramStr('type');
      const type = typeStr === 'linear' ? 0 : Math.max(0, RAMP_TYPES.indexOf(typeStr));
      const extl = EXTEND_CODE[ctx.paramStr('extendleft')] ?? 2;
      const er = ctx.paramStr('extendright');
      const extr = er === 'sameasleft' ? extl : EXTEND_CODE[er] ?? extl;
      const asp = w / h, fa = ctx.paramStr('fitaspect');
      const aspect = fa === 'fill' ? [1, 1]
        : fa === 'fithorz' || (fa === 'fitbest' && asp < 1) || (fa === 'fitoutside' && asp >= 1) ? [1, 1 / asp]
          : [asp, 1];

      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          ...uniforms,
          u_type: type,
          u_phase: ctx.paramNum('phase'),
          u_repeat: 1 / Math.max(1e-6, ctx.paramNum('period')),
          u_pos: [ctx.paramNum('positionx'), ctx.paramNum('positiony')],
          u_aspect: aspect,
          u_extl: extl,
          u_extr: extr,
          u_interp: Math.max(0, ctx.menuIndex('interp')),
          u_tension: ctx.paramNum('tension'),
          u_n: n,
          u_premul: ctx.paramBool('premultrgbbyalpha') ? 1 : 0,
        },
        inputs: [],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:rectangle',
    family: F,
    label: 'rectangle',
    inputs: { min: 0, max: 0 },
    params: [
      { key: 'sizex', type: 'float', default: 0.4, min: 0, max: 2 },
      { key: 'sizey', type: 'float', default: 0.4, min: 0, max: 2 },
      { key: 'centerx', type: 'float', default: 0.5, min: -1, max: 2 },
      { key: 'centery', type: 'float', default: 0.5, min: -1, max: 2 },
      { key: 'color', type: 'color', default: [1, 1, 1, 1] },
      { key: 'bgcolor', type: 'color', default: [0, 0, 0, 0] },
      { key: 'softness', type: 'float', default: 0.002, min: 0, max: 0.5 },
      ...resParams('custom'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.rectangleGlsl, wgsl: wgsl.rectangleWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const { w, h } = resolution(ctx, null);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_size: [ctx.paramNum('sizex'), ctx.paramNum('sizey')],
          u_center: [ctx.paramNum('centerx'), ctx.paramNum('centery')],
          u_color: ctx.param('color') as number[],
          u_bgcolor: ctx.param('bgcolor') as number[],
          u_softness: ctx.paramNum('softness'),
        },
        inputs: [],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:transform',
    family: F,
    label: 'transform',
    inputs: { min: 1, max: 1 },
    params: [
      { key: 'tx', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'ty', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'rotate', type: 'float', default: 0, min: -360, max: 360 },
      { key: 'sx', type: 'float', default: 1, min: -4, max: 4 },
      { key: 'sy', type: 'float', default: 1, min: -4, max: 4 },
      { key: 'pivotx', type: 'float', default: 0.5, min: 0, max: 1 },
      { key: 'pivoty', type: 'float', default: 0.5, min: 0, max: 1 },
      { key: 'extend', type: 'menu', default: 'hold', menu: ['hold', 'cycle', 'mirror', 'zero'] },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.transformGlsl, wgsl: wgsl.transformWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.4, 0.3, 0.1, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_translate: [ctx.paramNum('tx'), ctx.paramNum('ty')],
          u_rotate: ctx.paramNum('rotate'),
          u_scale: [ctx.paramNum('sx'), ctx.paramNum('sy')],
          u_pivot: [ctx.paramNum('pivotx'), ctx.paramNum('pivoty')],
          u_extend: ctx.menuIndex('extend'),
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:level',
    family: F,
    label: 'level',
    inputs: { min: 1, max: 1 },
    // TouchDesigner page order (docs/TD-PARITY.md "Fidelity"); keys of the
    // first page keep their WebToe names (brightness = TD brightness1, gamma = gamma1)
    params: [
      { key: 'invert', type: 'float', default: 0, min: 0, max: 1, page: 'pre' },
      { key: 'blacklevel', type: 'float', default: 0, min: 0, max: 1, page: 'pre' },
      { key: 'brightness', label: 'brightness1', type: 'float', default: 1, min: 0, max: 4, page: 'pre' },
      { key: 'gamma', label: 'gamma1', type: 'float', default: 1, min: 0.1, max: 4, page: 'pre' },
      { key: 'contrast', type: 'float', default: 1, min: 0, max: 4, page: 'pre' },
      { key: 'inlow', type: 'float', default: 0, min: 0, max: 1, page: 'range' },
      { key: 'inhigh', type: 'float', default: 1, min: 0, max: 1, page: 'range' },
      { key: 'outlow', type: 'float', default: 0, min: 0, max: 1, page: 'range' },
      { key: 'outhigh', type: 'float', default: 1, min: 0, max: 1, page: 'range' },
      { key: 'low', label: 'low rgba', type: 'color', default: [0, 0, 0, 0], page: 'rgba' },
      { key: 'high', label: 'high rgba', type: 'color', default: [1, 1, 1, 1], page: 'rgba' },
      { key: 'gamma2', type: 'float', default: 1, min: 0.1, max: 4, page: 'post' },
      { key: 'brightness2', type: 'float', default: 1, min: 0, max: 4, page: 'post' },
      { key: 'clamp', type: 'toggle', default: false, page: 'post' },
      { key: 'clamplow2', label: 'clamp low', type: 'float', default: 0, min: 0, max: 1, page: 'post' },
      { key: 'clamphigh2', label: 'clamp high', type: 'float', default: 1, min: 0, max: 1, page: 'post' },
      { key: 'premultrgbbyalpha', label: 'premultiply rgb by alpha', type: 'toggle', default: false, page: 'post' },
      { key: 'opacity', type: 'float', default: 1, min: 0, max: 1, page: 'post' },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.levelGlsl, wgsl: wgsl.levelWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.1, 0.3, 0.4, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_pre: [ctx.paramNum('invert'), ctx.paramNum('blacklevel'), ctx.paramNum('brightness'), ctx.paramNum('gamma')],
          u_contrast: ctx.paramNum('contrast'),
          u_range: [ctx.paramNum('inlow'), ctx.paramNum('inhigh'), ctx.paramNum('outlow'), ctx.paramNum('outhigh')],
          u_low: color4(ctx.param('low'), [0, 0, 0, 0]),
          u_high: color4(ctx.param('high'), [1, 1, 1, 1]),
          u_post: [ctx.paramNum('gamma2'), ctx.paramNum('brightness2'), ctx.paramBool('clamp') ? 1 : 0, ctx.paramBool('premultrgbbyalpha') ? 1 : 0],
          u_clamp2: [ctx.paramNum('clamplow2'), ctx.paramNum('clamphigh2')],
          u_opacity: ctx.paramNum('opacity'),
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:monochrome',
    family: F,
    label: 'monochrome',
    inputs: { min: 1, max: 1 },
    params: [
      { key: 'rgb', type: 'menu', default: 'luminance', menu: [...TD_CHANNELS, 'custom'] },
      { key: 'alpha', type: 'menu', default: 'alpha', menu: [...TD_CHANNELS, 'custom'] },
      { key: 'clamp', type: 'toggle', default: true },
      { key: 'rweight', label: 'custom r weight', type: 'float', default: 0.2126, min: 0, max: 1 },
      { key: 'gweight', label: 'custom g weight', type: 'float', default: 0.7152, min: 0, max: 1 },
      { key: 'bweight', label: 'custom b weight', type: 'float', default: 0.0722, min: 0, max: 1 },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.monochromeGlsl, wgsl: wgsl.monochromeWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.3, 0.3, 0.3, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const sel = (k: string, d: number) => { const i = ctx.menuIndex(k); return i < 0 ? d : i; };
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_rgb: sel('rgb', 0),
          u_alpha: sel('alpha', 4),
          u_clamp: ctx.paramBool('clamp') ? 1 : 0,
          u_weights: [ctx.paramNum('rweight'), ctx.paramNum('gweight'), ctx.paramNum('bweight')],
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:hsvadjust',
    family: F,
    label: 'hsv adjust',
    inputs: { min: 1, max: 1 },
    params: [
      { key: 'hueoffset', type: 'float', default: 0, min: 0, max: 1 },
      { key: 'satmult', type: 'float', default: 1, min: 0, max: 4 },
      { key: 'valmult', type: 'float', default: 1, min: 0, max: 4 },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.hsvadjustGlsl, wgsl: wgsl.hsvadjustWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.4, 0.1, 0.4, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_hueoffset: ctx.paramNum('hueoffset'),
          u_satmult: ctx.paramNum('satmult'),
          u_valmult: ctx.paramNum('valmult'),
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:blur',
    family: F,
    label: 'blur',
    inputs: { min: 1, max: 1 },
    // TouchDesigner-faithful generated kernel (docs/TD-PARITY.md "Fidelity"):
    // `size` is the full kernel width in taps (TD), not a radius. TD's three
    // extend modes all render as hold, which is what clamp-to-edge gives.
    params: [
      { key: 'type', type: 'menu', default: 'catmull', menu: [...BLUR_TYPES] },
      { key: 'size', label: 'size (taps)', type: 'float', default: 7, min: 0, max: 128 },
      { key: 'preshrink', type: 'int', default: 1, min: 1, max: 16 },
      { key: 'offsetx', label: 'sample step x (px)', type: 'float', default: 1, min: 0, max: 8 },
      { key: 'offsety', label: 'sample step y (px)', type: 'float', default: 1, min: 0, max: 8 },
      { key: 'filterscalex', label: 'filter scale x', type: 'float', default: 1, min: 0, max: 4 },
      { key: 'filterscaley', label: 'filter scale y', type: 'float', default: 1, min: 0, max: 4 },
      // WebToe extras (not in TD): repeat the separable pass, restrict to one axis
      { key: 'passes', type: 'int', default: 1, min: 1, max: 4 },
      { key: 'direction', type: 'menu', default: 'both', menu: ['both', 'horizontal', 'vertical'] },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.blurGlsl, wgsl: wgsl.blurWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      ctx.gpu!.registerShader('top:resample', { glsl: glsl.resampleGlsl, wgsl: wgsl.resampleWgsl });
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.2, 0.2, 0.4, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const size = ctx.paramNum('size');
      const type = Math.max(0, ctx.menuIndex('type'));
      const dir = ctx.paramStr('direction');
      const Sx = dir === 'vertical' ? 0 : Math.min(4096, Math.max(0, Math.round(size * ctx.paramNum('filterscalex'))));
      const Sy = dir === 'horizontal' ? 0 : Math.min(4096, Math.max(0, Math.round(size * ctx.paramNum('filterscaley'))));
      const stepX = ctx.paramNum('offsetx'), stepY = ctx.paramNum('offsety');
      const passes = Math.max(1, Math.round(ctx.paramNum('passes')));
      const ps = Math.max(1, Math.round(ctx.paramNum('preshrink')) || 1);

      // ① preshrink: ONE bilinear tap per small-image pixel (not repeated halving)
      const sw = ps > 1 ? Math.max(1, Math.round(input.tex.width / ps)) : input.tex.width;
      const shh = ps > 1 ? Math.max(1, Math.round(input.tex.height / ps)) : input.tex.height;
      type Step = { shader: string; uniforms: Record<string, number | number[]>; w: number; h: number };
      const plan: Step[] = [];
      if (ps > 1) plan.push({ shader: 'top:resample', uniforms: {}, w: sw, h: shh });
      // ② horizontal then vertical on the (small) image
      for (let p = 0; p < passes; p++) {
        if (Sx > 1 && stepX !== 0) plan.push({ shader: this.type, uniforms: { u_dir: [1, 0], u_taps: Sx, u_step: stepX, u_type: type }, w: sw, h: shh });
        if (Sy > 1 && stepY !== 0) plan.push({ shader: this.type, uniforms: { u_dir: [0, 1], u_taps: Sy, u_step: stepY, u_type: type }, w: sw, h: shh });
      }
      // ③ bilinear back to the output size (skipped when the last pass already is)
      const last = plan[plan.length - 1];
      if (!last || last.w !== w || last.h !== h) plan.push({ shader: 'top:resample', uniforms: {}, w, h });
      let cur = input.tex;
      plan.forEach((s, i) => {
        cur = ctx.gpu!.runPass(ctx.node, {
          shaderId: s.shader,
          uniforms: s.uniforms,
          inputs: [cur],
          output: { width: s.w, height: s.h },
        }, i === plan.length - 1 ? 'main' : `p${i}`);
      });
      return { kind: 'top', tex: cur };
    },
  },

  {
    type: 'top:composite',
    family: F,
    label: 'composite',
    inputs: { min: 1, max: 4 },
    inputLabels: ['top layer (input 0 composites over the rest)', 'layer 2', 'layer 3', 'base layer'],
    // TouchDesigner-faithful (docs/TD-PARITY.md "Fidelity"): all 46 TD operations,
    // premultiplied, left fold with input 0 on top. WebToe keeps 'over' as its
    // default; TD's default 'multiply' is filled in by the importer.
    params: [
      { key: 'operation', type: 'menu', default: 'over', menu: [...COMP_OPS] },
      { key: 'swaporder', label: 'swap order', type: 'toggle', default: false },
      { key: 'tx', label: 'translate x (input 0)', type: 'float', default: 0, min: -1, max: 1, page: 'transform' },
      { key: 'ty', label: 'translate y', type: 'float', default: 0, min: -1, max: 1, page: 'transform' },
      { key: 'rotate', type: 'float', default: 0, min: -360, max: 360, page: 'transform' },
      { key: 'sx', type: 'float', default: 1, min: -4, max: 4, page: 'transform' },
      { key: 'sy', type: 'float', default: 1, min: -4, max: 4, page: 'transform' },
      { key: 'extend', label: 'overlay extend', type: 'menu', default: 'zero', menu: ['zero', 'hold', 'repeat', 'mirror'], page: 'transform' },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.compositeGlsl, wgsl: wgsl.compositeWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const texes = ctx.inputs.map(asTop).filter((t): t is TextureOut => !!t).map((t) => t.tex);
      if (!texes.length) return placeholder(ctx, [0.4, 0.2, 0.2, 1]);
      const { w, h } = resolution(ctx, texes[0]);
      const xf = { tx: ctx.paramNum('tx'), ty: ctx.paramNum('ty'), rotate: ctx.paramNum('rotate'), sx: ctx.paramNum('sx'), sy: ctx.paramNum('sy') };
      const identity = xf.tx === 0 && xf.ty === 0 && xf.rotate === 0 && xf.sx === 1 && xf.sy === 1;
      const ov = compOverlay(w, h, xf);
      const op = ctx.menuIndex('operation');
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_op: op < 0 ? COMP_OPS.indexOf('over') : op,
          u_count: Math.min(4, texes.length),
          u_swap: ctx.paramBool('swaporder') ? 1 : 0,
          u_ext: Math.max(0, ctx.menuIndex('extend')),
          u_xf: ov.xf,
          u_ovc: [ov.center[0], ov.center[1], ov.asp, identity ? 1 : 0],
        },
        inputs: texes.slice(0, 4),
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:displace',
    family: F,
    label: 'displace',
    inputs: { min: 2, max: 2 },
    inputLabels: ['source image', 'displacement map (rg channels shift uv)'],
    params: [
      { key: 'weight', type: 'float', default: 0.1, min: -1, max: 1 },
      { key: 'offsetx', type: 'float', default: 0, min: -1, max: 1 },
      { key: 'offsety', type: 'float', default: 0, min: -1, max: 1 },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.displaceGlsl, wgsl: wgsl.displaceWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const src = asTop(ctx.inputs[0]);
      const map = asTop(ctx.inputs[1]);
      if (!src || !map) return placeholder(ctx, [0.2, 0.4, 0.2, 1]);
      const { w, h } = resolution(ctx, src.tex);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_weight: ctx.paramNum('weight'),
          u_offset: [ctx.paramNum('offsetx'), ctx.paramNum('offsety')],
        },
        inputs: [src.tex, map.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    /**
     * Lookup TOP — remaps an image through a ramp: the source's brightness
     * becomes a horizontal coordinate into the second input. This is how a
     * monochrome render becomes a colour-graded one in TouchDesigner, and it
     * is what gives most point-cloud pieces their palette.
     */
    type: 'top:lookup',
    family: F,
    label: 'lookup',
    inputs: { min: 2, max: 2 },
    inputLabels: ['source image', 'lookup ramp (sampled across its width)'],
    params: [
      { key: 'source', type: 'menu', default: 'luminance', menu: ['luminance', 'red', 'alpha'] },
      { key: 'offset', type: 'float', default: 0, min: -1, max: 1 },
      ...resParams('input'),
    ],
    backends: ['webgl2'],
    shaders: { glsl: glsl.lookupGlsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const src = asTop(ctx.inputs[0]);
      const ramp = asTop(ctx.inputs[1]);
      if (!src || !ramp) return placeholder(ctx, [0.2, 0.2, 0.4, 1]);
      const { w, h } = resolution(ctx, src.tex);
      const mode = ctx.paramStr('source');
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_offset: ctx.paramNum('offset'),
          u_source: mode === 'red' ? 1 : mode === 'alpha' ? 2 : 0,
        },
        inputs: [src.tex, ramp.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:edge',
    family: F,
    label: 'edge',
    inputs: { min: 1, max: 1 },
    // TouchDesigner-faithful Sobel edge (docs/TD-PARITY.md "Fidelity"):
    // e = clamp(√(1−bl)·√strength·|∇|/√offset − bl); TD's strength default is 1
    params: [
      { key: 'strength', type: 'float', default: 1, min: 0, max: 50 },
      { key: 'offsetx', label: 'sample step x (px)', type: 'float', default: 1, min: 0.1, max: 16 },
      { key: 'offsety', label: 'sample step y (px)', type: 'float', default: 1, min: 0.1, max: 16 },
      { key: 'blacklevel', type: 'float', default: 0, min: 0, max: 1 },
      { key: 'select', type: 'menu', default: 'luminance', menu: TD_CHANNELS.slice(0, 9) },
      { key: 'edgecolor', type: 'color', default: [1, 1, 1, 1] },
      { key: 'premultrgbbyalpha', label: 'premultiply edge colour', type: 'toggle', default: true },
      { key: 'alphaoutput', type: 'menu', default: 'edge', menu: ['edge', 'one', 'zero'] },
      { key: 'compinput', label: 'composite edge over input', type: 'toggle', default: false },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.edgeGlsl, wgsl: wgsl.edgeWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.4, 0.4, 0.2, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const col = color4(ctx.param('edgecolor'), [1, 1, 1, 1]);
      const k = ctx.paramBool('premultrgbbyalpha') ? col[3] : 1;
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_strength: ctx.paramNum('strength'),
          u_edgecolor: [col[0] * k, col[1] * k, col[2] * k, col[3]],
          u_compinput: ctx.paramBool('compinput') ? 1 : 0,
          u_offset: [ctx.paramNum('offsetx'), ctx.paramNum('offsety')],
          u_blacklevel: ctx.paramNum('blacklevel'),
          u_select: Math.max(0, ctx.menuIndex('select')),
          u_alphamode: Math.max(0, ctx.menuIndex('alphaoutput')),
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:feedback',
    family: F,
    label: 'feedback',
    inputs: { min: 1, max: 1 },
    lazyInputs: true,
    alwaysCook: true,
    // `top` = TouchDesigner's Target TOP: the output is that TOP's result from
    // the previous cook step; until it has rendered (first step, reset) the
    // input passes through. Empty `top` keeps WebToe's original wiring, where
    // the input itself closes the loop.
    params: [{ key: 'top', type: 'string', default: '' }],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      const src = ctx.node.inputs[0];
      const targetPath = ctx.paramStr('top');
      if (targetPath) {
        const target = ctx.engine.graph.resolve(targetPath, ctx.node);
        if (!target) ctx.node.error = `feedback: target '${targetPath}' not found`;
        const prevTarget = target ? ctx.gpu!.previousFrame(target) : null;
        if (prevTarget) return { kind: 'top', tex: prevTarget };
        return src ? asTop(ctx.engine.cook(src)) : null;
      }
      if (!src) return null;
      const prev = ctx.gpu!.previousFrame(src);
      if (prev) return { kind: 'top', tex: prev };
      // first frame: emit transparent black so downstream chains start clean
      ctx.gpu!.registerShader('top:feedback:seed', { glsl: glsl.constantGlsl, wgsl: wgsl.constantWgsl });
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: 'top:feedback:seed',
        uniforms: { u_color: [0, 0, 0, 0] },
        inputs: [],
        output: { width: DEFAULT_RES[0], height: DEFAULT_RES[1] },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:null',
    family: F,
    label: 'null',
    inputs: { min: 1, max: 1 },
    params: [],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      return asTop(ctx.inputs[0]);
    },
  },

  {
    type: 'top:in',
    family: F,
    label: 'in',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [{ key: 'index', type: 'int', default: 0, min: 0, max: 7 }],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      // tunnel: pull the parent COMP's wired external input
      const parent = ctx.node.parent;
      const ext = parent?.inputs[Math.max(0, Math.round(ctx.paramNum('index')))];
      if (!ext) return null;
      return asTop(ctx.engine.cook(ext));
    },
  },

  {
    type: 'top:out',
    family: F,
    label: 'out',
    inputs: { min: 1, max: 1 },
    params: [],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      return asTop(ctx.inputs[0]);
    },
  },

  {
    type: 'top:switch',
    family: F,
    label: 'switch',
    inputs: { min: 1, max: 4 },
    params: [{ key: 'index', type: 'int', default: 0, min: 0, max: 3 }],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      const i = Math.max(0, Math.min(ctx.inputs.length - 1, Math.round(ctx.paramNum('index'))));
      return asTop(ctx.inputs[i]) ?? asTop(ctx.inputs.find((x) => x && x.kind === 'top'));
    },
  },

  {
    type: 'top:select',
    family: F,
    label: 'select',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [{ key: 'top', type: 'string', default: '' }],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      const path = ctx.paramStr('top');
      if (!path) return placeholder(ctx, [0.3, 0.3, 0.15, 1]);
      const target = ctx.engine.graph.resolve(path, ctx.node);
      if (!target) {
        ctx.node.error = `select: '${path}' not found`;
        return placeholder(ctx, [0.45, 0.2, 0.1, 1]);
      }
      return asTop(ctx.engine.cook(target));
    },
  },

  {
    type: 'top:math',
    family: F,
    label: 'math',
    inputs: { min: 1, max: 4 },
    inputLabels: ['operand 1', 'operand 2', 'operand 3', 'operand 4'],
    params: [
      {
        key: 'combine', type: 'menu', default: 'add',
        menu: ['add', 'subtract', 'multiply', 'average', 'max', 'min', 'power'],
      },
      { key: 'gain', type: 'float', default: 1, min: -4, max: 4 },
      { key: 'offset', type: 'float', default: 0, min: -1, max: 1 },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.mathGlsl, wgsl: wgsl.mathWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const texes = ctx.inputs.map(asTop).filter((t): t is TextureOut => !!t).map((t) => t.tex);
      if (!texes.length) return placeholder(ctx, [0.35, 0.3, 0.1, 1]);
      const { w, h } = resolution(ctx, texes[0]);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_op: ctx.menuIndex('combine'),
          u_count: texes.length,
          u_gain: ctx.paramNum('gain'),
          u_offset: ctx.paramNum('offset'),
        },
        inputs: texes.slice(0, 4),
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:reorder',
    family: F,
    label: 'reorder',
    inputs: { min: 1, max: 1 },
    params: [
      { key: 'outr', type: 'menu', default: 'r', menu: ['r', 'g', 'b', 'a', 'zero', 'one'] },
      { key: 'outg', type: 'menu', default: 'g', menu: ['r', 'g', 'b', 'a', 'zero', 'one'] },
      { key: 'outb', type: 'menu', default: 'b', menu: ['r', 'g', 'b', 'a', 'zero', 'one'] },
      { key: 'outa', type: 'menu', default: 'a', menu: ['r', 'g', 'b', 'a', 'zero', 'one'] },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.reorderGlsl, wgsl: wgsl.reorderWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.25, 0.35, 0.2, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_sel: [ctx.menuIndex('outr'), ctx.menuIndex('outg'), ctx.menuIndex('outb'), ctx.menuIndex('outa')],
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:flip',
    family: F,
    label: 'flip',
    inputs: { min: 1, max: 1 },
    params: [
      { key: 'flipx', type: 'toggle', default: false },
      { key: 'flipy', type: 'toggle', default: false },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.flipGlsl, wgsl: wgsl.flipWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.2, 0.25, 0.35, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_flipx: ctx.paramBool('flipx') ? 1 : 0,
          u_flipy: ctx.paramBool('flipy') ? 1 : 0,
        },
        inputs: [input.tex],
        output: { width: w, height: h },
      });
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:imagein',
    family: F,
    label: 'image in',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [{ key: 'file', type: 'string', default: '' }],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      const url = ctx.paramStr('file');
      const st = ctx.node.state as {
        url?: string; img?: HTMLImageElement; ready?: boolean; tex?: TextureHandle; uploaded?: string;
      };
      if (!url) return placeholder(ctx, [0.25, 0.25, 0.3, 1]);
      if (st.url !== url) {
        st.url = url;
        st.ready = false;
        st.uploaded = undefined;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { st.ready = true; };
        img.onerror = () => { ctx.node.error = `image failed to load: ${url}`; };
        img.src = url;
        st.img = img;
      }
      if (!st.ready || !st.img) return placeholder(ctx, [0.25, 0.25, 0.3, 1]);
      if (st.uploaded !== url) {
        st.tex = ctx.gpu!.uploadMedia(ctx.node, st.img);
        st.uploaded = url;
      }
      return st.tex ? { kind: 'top', tex: st.tex } : null;
    },
  },

  {
    type: 'top:videoin',
    family: F,
    label: 'video in',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [{ key: 'file', type: 'string', default: '' }],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      const url = ctx.paramStr('file');
      const st = ctx.node.state as { url?: string; video?: HTMLVideoElement };
      if (!url) return placeholder(ctx, [0.3, 0.25, 0.25, 1]);
      if (st.url !== url) {
        st.url = url;
        st.video?.pause();
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.src = url;
        void v.play().catch(() => { ctx.node.error = `video failed to play: ${url}`; });
        st.video = v;
      }
      const v = st.video;
      if (!v || v.readyState < 2) return placeholder(ctx, [0.3, 0.25, 0.25, 1]);
      const tex = ctx.gpu!.uploadMedia(ctx.node, v);
      return { kind: 'top', tex };
    },
  },

  {
    type: 'top:camerain',
    family: F,
    label: 'camera in',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    params: [],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      const st = ctx.node.state as { video?: HTMLVideoElement; requested?: boolean; denied?: boolean };
      if (st.denied) return placeholder(ctx, [0.45, 0.15, 0.15, 1]);
      if (!st.requested) {
        st.requested = true;
        navigator.mediaDevices?.getUserMedia({ video: true })
          .then((stream) => {
            const v = document.createElement('video');
            v.muted = true;
            v.playsInline = true;
            v.srcObject = stream;
            void v.play();
            st.video = v;
          })
          .catch(() => {
            st.denied = true;
            ctx.node.error = 'camera unavailable or permission denied';
          });
      }
      const v = st.video;
      if (!v || v.readyState < 2) return placeholder(ctx, [0.2, 0.3, 0.35, 1]);
      const tex = ctx.gpu!.uploadMedia(ctx.node, v);
      return { kind: 'top', tex };
    },
  },
];
