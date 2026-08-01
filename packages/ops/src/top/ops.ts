import type {
  CookCtx, OpOutput, OpSpec, ParamSpec, TextureHandle, TextureOut,
} from '@webtoe/core';
import * as glsl from './glsl';
import * as wgsl from './wgsl';

const F = 'TOP' as const;
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
    params: [
      { key: 'period', type: 'float', default: 0.35, min: 0.01, max: 4 },
      { key: 'harmonics', type: 'int', default: 3, min: 1, max: 8 },
      { key: 'offsetx', type: 'float', default: 0, min: -4, max: 4 },
      { key: 'offsety', type: 'float', default: 0, min: -4, max: 4 },
      { key: 'speed', type: 'float', default: 0.25, min: -4, max: 4 },
      { key: 'exponent', type: 'float', default: 1, min: 0.1, max: 8 },
      { key: 'mono', type: 'toggle', default: true },
      ...resParams('custom'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.noiseGlsl, wgsl: wgsl.noiseWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const { w, h } = resolution(ctx, null);
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_period: ctx.paramNum('period'),
          u_harmonics: ctx.paramNum('harmonics'),
          u_offset: [ctx.paramNum('offsetx'), ctx.paramNum('offsety')],
          u_speed: ctx.paramNum('speed'),
          u_exponent: ctx.paramNum('exponent'),
          u_mono: ctx.paramBool('mono') ? 1 : 0,
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
    params: [
      { key: 'type', type: 'menu', default: 'linear', menu: ['linear', 'radial', 'circular'] },
      { key: 'phase', type: 'float', default: 0, min: 0, max: 1 },
      { key: 'colora', type: 'color', default: [0, 0, 0, 1] },
      { key: 'colorb', type: 'color', default: [1, 1, 1, 1] },
      { key: 'dat', label: 'keys DAT (pos r g b a)', type: 'string', default: '' },
      ...resParams('custom'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.rampGlsl, wgsl: wgsl.rampWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const { w, h } = resolution(ctx, null);

      // TouchDesigner keeps a ramp's real gradient in a keys DAT with
      // `pos r g b a` rows; the colour params are only the first key. Reading
      // it is the difference between a grey wash and the artwork's palette.
      const pos = new Array(8).fill(0);
      const cr = new Array(8).fill(0), cg = new Array(8).fill(0);
      const cb = new Array(8).fill(0), ca = new Array(8).fill(1);
      let stops = 0;
      const datPath = ctx.paramStr('dat');
      if (datPath) {
        const dat = ctx.engine.graph.resolve(datPath, ctx.node.parent ?? ctx.node);
        const text = dat?.text ?? '';
        if (text) {
          const rows = text.trim().split('\n').map((r) => r.split('\t'));
          const body = rows.length && /pos/i.test(rows[0][0] ?? '') ? rows.slice(1) : rows;
          for (const r of body) {
            if (stops >= 8 || r.length < 5) continue;
            const v = r.map(Number);
            if (v.some((x) => !Number.isFinite(x))) continue;
            pos[stops] = v[0];
            cr[stops] = v[1]; cg[stops] = v[2]; cb[stops] = v[3]; ca[stops] = v[4];
            stops++;
          }
        }
      }

      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_type: ctx.menuIndex('type'),
          u_phase: ctx.paramNum('phase'),
          u_colora: ctx.param('colora') as number[],
          u_colorb: ctx.param('colorb') as number[],
          u_stopCount: stops,
          u_stopPos: pos,
          u_stopR: cr, u_stopG: cg, u_stopB: cb, u_stopA: ca,
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
    params: [
      { key: 'brightness', type: 'float', default: 1, min: 0, max: 4 },
      { key: 'contrast', type: 'float', default: 1, min: 0, max: 4 },
      { key: 'gamma', type: 'float', default: 1, min: 0.1, max: 4 },
      { key: 'opacity', type: 'float', default: 1, min: 0, max: 1 },
      { key: 'invert', type: 'toggle', default: false },
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
          u_brightness: ctx.paramNum('brightness'),
          u_contrast: ctx.paramNum('contrast'),
          u_gamma: ctx.paramNum('gamma'),
          u_opacity: ctx.paramNum('opacity'),
          u_invert: ctx.paramBool('invert') ? 1 : 0,
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
      { key: 'rweight', type: 'float', default: 0.299, min: 0, max: 1 },
      { key: 'gweight', type: 'float', default: 0.587, min: 0, max: 1 },
      { key: 'bweight', type: 'float', default: 0.114, min: 0, max: 1 },
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
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: { u_weights: [ctx.paramNum('rweight'), ctx.paramNum('gweight'), ctx.paramNum('bweight')] },
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
    params: [
      { key: 'size', type: 'float', default: 5, min: 0, max: 15 },
      { key: 'passes', type: 'int', default: 1, min: 1, max: 4 },
      { key: 'direction', type: 'menu', default: 'both', menu: ['both', 'horizontal', 'vertical'] },
      ...resParams('input'),
    ],
    backends: ['webgl2', 'webgpu'],
    shaders: { glsl: glsl.blurGlsl, wgsl: wgsl.blurWgsl },
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      ensureShader(ctx, this);
      const input = asTop(ctx.inputs[0]);
      if (!input) return placeholder(ctx, [0.2, 0.2, 0.4, 1]);
      const { w, h } = resolution(ctx, input.tex);
      const size = ctx.paramNum('size');
      const passes = Math.max(1, Math.round(ctx.paramNum('passes')));
      const dir = ctx.paramStr('direction');
      let cur = input.tex;
      const run = (d: [number, number], slot: string) => {
        cur = ctx.gpu!.runPass(ctx.node, {
          shaderId: this.type,
          uniforms: { u_dir: d, u_size: size },
          inputs: [cur],
          output: { width: w, height: h },
        }, slot);
      };
      for (let p = 0; p < passes; p++) {
        const last = p === passes - 1;
        if (dir === 'both') {
          run([1, 0], `h${p}`);
          run([0, 1], last ? 'main' : `v${p}`);
        } else if (dir === 'horizontal') {
          run([1, 0], last ? 'main' : `h${p}`);
        } else {
          run([0, 1], last ? 'main' : `v${p}`);
        }
      }
      return { kind: 'top', tex: cur };
    },
  },

  {
    type: 'top:composite',
    family: F,
    label: 'composite',
    inputs: { min: 1, max: 4 },
    inputLabels: ['top layer (input 0 composites over the rest)', 'layer 2', 'layer 3', 'base layer'],
    params: [
      {
        key: 'operation', type: 'menu', default: 'over',
        menu: ['over', 'add', 'multiply', 'screen', 'subtract', 'difference'],
      },
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
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: { u_op: ctx.menuIndex('operation'), u_count: texes.length },
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
    params: [
      { key: 'strength', type: 'float', default: 4, min: 0, max: 20 },
      { key: 'edgecolor', type: 'color', default: [1, 1, 1, 1] },
      { key: 'compinput', type: 'toggle', default: false },
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
      const tex = ctx.gpu!.runPass(ctx.node, {
        shaderId: this.type,
        uniforms: {
          u_strength: ctx.paramNum('strength'),
          u_edgecolor: ctx.param('edgecolor') as number[],
          u_compinput: ctx.paramBool('compinput') ? 1 : 0,
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
    params: [],
    backends: ['webgl2', 'webgpu'],
    cook(ctx) {
      if (!requireGpu(ctx)) return null;
      const src = ctx.node.inputs[0];
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
