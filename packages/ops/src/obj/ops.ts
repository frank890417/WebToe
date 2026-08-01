/** Object COMPs (geo/cam/light/ambient) and the Render TOP — scene assembly. */
import type {
  CookCtx, MaterialSpec, NodeInst, OpSpec, SceneDraw, SceneLight, SceneObject,
} from '@webtoe/core';
import { mat4 } from '@webtoe/core';

const DEFAULT_RES: [number, number] = [1280, 720];

const xformPage = (page: string) => [
  { key: 'tx', type: 'float', default: 0, min: -10, max: 10, page },
  { key: 'ty', type: 'float', default: 0, min: -10, max: 10, page },
  { key: 'tz', type: 'float', default: 0, min: -10, max: 10, page },
  { key: 'rx', type: 'float', default: 0, min: -360, max: 360, page },
  { key: 'ry', type: 'float', default: 0, min: -360, max: 360, page },
  { key: 'rz', type: 'float', default: 0, min: -360, max: 360, page },
  { key: 'sx', type: 'float', default: 1, min: -4, max: 4, page },
  { key: 'sy', type: 'float', default: 1, min: -4, max: 4, page },
  { key: 'sz', type: 'float', default: 1, min: -4, max: 4, page },
  { key: 'px', type: 'float', default: 0, min: -5, max: 5, page },
  { key: 'py', type: 'float', default: 0, min: -5, max: 5, page },
  { key: 'pz', type: 'float', default: 0, min: -5, max: 5, page },
] as const;

function modelFrom(ctx: CookCtx): Float32Array {
  return mat4.compose(
    [ctx.paramNum('tx'), ctx.paramNum('ty'), ctx.paramNum('tz')],
    [ctx.paramNum('rx'), ctx.paramNum('ry'), ctx.paramNum('rz')],
    [ctx.paramNum('sx'), ctx.paramNum('sy'), ctx.paramNum('sz')],
    [ctx.paramNum('px'), ctx.paramNum('py'), ctx.paramNum('pz')],
  );
}

const DEFAULT_MAT: MaterialSpec = { shading: 'lit', color: [0.75, 0.75, 0.78, 1], roughness: 0.6, metallic: 0 };

/** Resolve a node-parameter path TD-style: relative to the node's network
 *  (its parent), with './x' explicitly reaching inside a container node. */
function resolveParamPath(ctx: CookCtx, path: string): NodeInst | null {
  if (!path) return null;
  if (path.startsWith('./')) return ctx.engine.graph.resolve(path.slice(2), ctx.node);
  return ctx.engine.graph.resolve(path, ctx.node.parent ?? ctx.node);
}

/** TD-style name pattern: `geo* ^geo7` (wildcards, ^ excludes). */
export function matchTdPattern(name: string, pattern: string): boolean {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const toRe = (p: string) =>
    new RegExp(`^${p.replace(/[.+^${}()|\\[\]]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  let included = false;
  for (const t of tokens) {
    if (t.startsWith('^')) {
      if (toRe(t.slice(1)).test(name)) return false;
    } else if (toRe(t).test(name)) {
      included = true;
    }
  }
  return included;
}

export const objOps: OpSpec[] = [
  {
    type: 'comp:geo',
    family: 'COMP',
    label: 'geometry',
    inputs: { min: 0, max: 8 },
    isContainer: true,
    params: [
      ...xformPage('xform').map((p) => ({ ...p })),
      { key: 'material', label: 'material (MAT path)', type: 'string', default: '', page: 'render' },
      { key: 'render', type: 'toggle', default: true, page: 'render' },
      { key: 'instancing', type: 'toggle', default: false, page: 'instance' },
      { key: 'instanceop', label: 'instance op (SOP points or CHOP channels)', type: 'string', default: '', page: 'instance' },
      // CHOP-driven instancing: TD names the channel per transform component.
      // This is how most TouchDesigner particle/point-cloud work is built.
      { key: 'instancetx', label: 'tx channel', type: 'string', default: 'tx', page: 'instance' },
      { key: 'instancety', label: 'ty channel', type: 'string', default: 'ty', page: 'instance' },
      { key: 'instancetz', label: 'tz channel', type: 'string', default: 'tz', page: 'instance' },
      { key: 'instancesx', label: 'sx channel', type: 'string', default: '', page: 'instance' },
      { key: 'instancesy', label: 'sy channel', type: 'string', default: '', page: 'instance' },
      { key: 'instancesz', label: 'sz channel', type: 'string', default: '', page: 'instance' },
      { key: 'instancer', label: 'r channel', type: 'string', default: '', page: 'instance' },
      { key: 'instanceg', label: 'g channel', type: 'string', default: '', page: 'instance' },
      { key: 'instanceb', label: 'b channel', type: 'string', default: '', page: 'instance' },
      { key: 'instancea', label: 'a channel', type: 'string', default: '', page: 'instance' },
    ],
    cook(ctx) {
      // geometry = out-tunnel SOP child, else display-flagged, else first SOP child
      const kids = ctx.node.children ? [...ctx.node.children.values()] : [];
      const sopKids = kids.filter((k) => k.type.startsWith('sop:'));
      const target = sopKids.find((k) => k.type === 'sop:out')
        ?? sopKids.find((k) => k.flags.display)
        ?? sopKids[sopKids.length - 1];
      const out = target ? ctx.engine.cook(target) : null;
      let geo = out && out.kind === 'sop' ? out.geo : null;
      // A Geo COMP whose SOP contents are empty renders nothing — except when
      // it is instancing, where TouchDesigner still draws one copy of the base
      // per instance. Point-sprite particle rigs routinely leave the base empty
      // (the visible dot comes from the material), so fall back to a single
      // point rather than dropping the whole instanced draw.
      if ((!geo || !geo.P.length) && ctx.paramBool('instancing')) {
        geo = { P: Float32Array.of(0, 0, 0), renderPoints: true, version: 0 };
      }
      if (!geo) return null;

      let material = DEFAULT_MAT;
      const m = resolveParamPath(ctx, ctx.paramStr('material'));
      if (m) {
        const mo = ctx.engine.cook(m);
        if (mo && mo.kind === 'mat') material = mo.mat;
      }

      let instances: SceneObject['instances'];
      if (ctx.paramBool('instancing')) {
        const src = resolveParamPath(ctx, ctx.paramStr('instanceop'));
        const so = src ? ctx.engine.cook(src) : null;
        if (so && so.kind === 'sop' && so.geo.P.length) {
          // instance one copy per point of a SOP
          instances = { count: so.geo.P.length / 3, translate: so.geo.P, color: so.geo.Cd };
        } else if (so && so.kind === 'chop' && so.channels.length) {
          // instance one copy per CHOP sample, transforms read from named
          // channels (TD's `instancetx` etc.). Missing channel = 0 / opaque
          // white, matching TD's behaviour for an unassigned component.
          const chan = (name: string) => (name
            ? so.channels.find((c) => c.name === name)?.data ?? null
            : null);
          // TD holds a channel's last sample when it is shorter than the
          // instance count — that is what lets a single-sample channel drive
          // every instance (very common for a shared scale or tint).
          const at = (d: Float32Array | null, i: number, fallback: number) =>
            (d && d.length ? d[Math.min(i, d.length - 1)] : fallback);

          const tx = chan(ctx.paramStr('instancetx'));
          const ty = chan(ctx.paramStr('instancety'));
          const tz = chan(ctx.paramStr('instancetz'));
          const count = Math.max(tx?.length ?? 0, ty?.length ?? 0, tz?.length ?? 0);
          if (count > 0) {
            const translate = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
              translate[i * 3] = at(tx, i, 0);
              translate[i * 3 + 1] = at(ty, i, 0);
              translate[i * 3 + 2] = at(tz, i, 0);
            }

            const cr = chan(ctx.paramStr('instancer'));
            const cg = chan(ctx.paramStr('instanceg'));
            const cb = chan(ctx.paramStr('instanceb'));
            const ca = chan(ctx.paramStr('instancea'));
            let color: Float32Array | undefined;
            if (cr || cg || cb || ca) {
              color = new Float32Array(count * 4);
              for (let i = 0; i < count; i++) {
                color[i * 4] = at(cr, i, 1);
                color[i * 4 + 1] = at(cg, i, 1);
                color[i * 4 + 2] = at(cb, i, 1);
                color[i * 4 + 3] = at(ca, i, 1);
              }
            }

            const sx = chan(ctx.paramStr('instancesx'));
            const sy = chan(ctx.paramStr('instancesy'));
            const sz = chan(ctx.paramStr('instancesz'));
            let scale: Float32Array | undefined;
            if (sx || sy || sz) {
              scale = new Float32Array(count * 3);
              for (let i = 0; i < count; i++) {
                scale[i * 3] = at(sx, i, 1);
                scale[i * 3 + 1] = at(sy, i, 1);
                scale[i * 3 + 2] = at(sz, i, 1);
              }
            }
            instances = { count, translate, color, scale };
          }
        }
      }

      const obj: SceneObject = {
        role: 'geo',
        model: modelFrom(ctx),
        geo,
        geoKey: ctx.engine.graph.pathOf(ctx.node),
        material,
        instances,
      };
      return { kind: 'obj', obj };
    },
  },

  {
    type: 'comp:cam',
    family: 'COMP',
    label: 'camera',
    inputs: { min: 0, max: 0 },
    params: [
      ...xformPage('xform').map((p) => ({ ...p })),
      { key: 'lookat', label: 'look at (path)', type: 'string', default: '', page: 'view' },
      { key: 'projection', type: 'menu', default: 'perspective', menu: ['perspective', 'orthographic'], page: 'view' },
      { key: 'fov', label: 'vertical fov°', type: 'float', default: 45, min: 1, max: 170, page: 'view' },
      { key: 'orthowidth', type: 'float', default: 2, min: 0.01, max: 100, page: 'view' },
      { key: 'near', type: 'float', default: 0.01, min: 0.0001, max: 10, page: 'view' },
      { key: 'far', type: 'float', default: 500, min: 1, max: 10000, page: 'view' },
    ],
    cook(ctx) {
      const model = modelFrom(ctx);
      const eye: [number, number, number] = [model[12], model[13], model[14]];
      let view: Float32Array;
      const lookPath = ctx.paramStr('lookat');
      const target = lookPath ? ctx.engine.graph.resolve(lookPath, ctx.node) : null;
      if (target) {
        const to = ctx.engine.cook(target);
        const tm = to && to.kind === 'obj' ? to.obj.model : null;
        const tp: [number, number, number] = tm ? [tm[12], tm[13], tm[14]] : [0, 0, 0];
        view = mat4.lookAt(eye, tp);
      } else {
        view = mat4.invertRigid(model);
      }
      const obj: SceneObject = {
        role: 'camera',
        model,
        camera: { view, proj: mat4.identity() }, // proj finalized by the render TOP (aspect)
      };
      (obj as SceneObject & { camParams?: unknown }).camParams = {
        fov: ctx.paramNum('fov'),
        near: ctx.paramNum('near'),
        far: ctx.paramNum('far'),
        ortho: ctx.paramStr('projection') === 'orthographic',
        orthoWidth: ctx.paramNum('orthowidth'),
      };
      return { kind: 'obj', obj };
    },
  },

  {
    type: 'comp:light',
    family: 'COMP',
    label: 'light',
    inputs: { min: 0, max: 0 },
    params: [
      ...xformPage('xform').map((p) => ({ ...p })),
      { key: 'lighttype', type: 'menu', default: 'point', menu: ['point', 'distant'], page: 'light' },
      { key: 'color', type: 'color', default: [1, 1, 1, 1], page: 'light' },
      { key: 'dimmer', type: 'float', default: 1, min: 0, max: 4, page: 'light' },
    ],
    cook(ctx) {
      const model = modelFrom(ctx);
      const c = ctx.param('color') as [number, number, number, number];
      const light: SceneLight = {
        kind: ctx.paramStr('lighttype') === 'distant' ? 'directional' : 'point',
        color: [c[0], c[1], c[2]],
        intensity: ctx.paramNum('dimmer'),
        position: [model[12], model[13], model[14]],
        direction: [-model[8], -model[9], -model[10]], // -Z axis
      };
      return { kind: 'obj', obj: { role: 'light', model, light } };
    },
  },

  {
    type: 'comp:ambientlight',
    family: 'COMP',
    label: 'ambient light',
    inputs: { min: 0, max: 0 },
    params: [
      { key: 'color', type: 'color', default: [1, 1, 1, 1] },
      { key: 'dimmer', type: 'float', default: 0.2, min: 0, max: 2 },
    ],
    cook(ctx) {
      const c = ctx.param('color') as [number, number, number, number];
      const light: SceneLight = {
        kind: 'ambient',
        color: [c[0], c[1], c[2]],
        intensity: ctx.paramNum('dimmer'),
        position: [0, 0, 0],
        direction: [0, 0, -1],
      };
      return { kind: 'obj', obj: { role: 'light', model: mat4.identity(), light } };
    },
  },

  {
    type: 'top:render',
    family: 'TOP',
    label: 'render',
    inputs: { min: 0, max: 0 },
    alwaysCook: true,
    backends: ['webgl2'],
    params: [
      { key: 'camera', label: 'camera (path)', type: 'string', default: '' },
      { key: 'geometry', label: 'geometry (pattern)', type: 'string', default: '*' },
      { key: 'lights', label: 'lights (pattern)', type: 'string', default: '*' },
      { key: 'bgcolor', type: 'color', default: [0, 0, 0, 1] },
      { key: 'resmode', label: 'resolution', type: 'menu', default: 'custom', menu: ['input', 'custom'], page: 'common' },
      { key: 'resw', label: 'width', type: 'int', default: DEFAULT_RES[0], min: 1, max: 4096, page: 'common' },
      { key: 'resh', label: 'height', type: 'int', default: DEFAULT_RES[1], min: 1, max: 4096, page: 'common' },
    ],
    cook(ctx) {
      if (!ctx.gpu) {
        ctx.node.error = 'no GPU backend';
        return null;
      }
      const siblings = ctx.node.parent ? [...ctx.node.parent.children!.values()] : [];
      const cookObj = (n: NodeInst): SceneObject | null => {
        const o = ctx.engine.cook(n);
        return o && o.kind === 'obj' ? o.obj : null;
      };

      // camera
      const camPath = ctx.paramStr('camera');
      const camNode = camPath
        ? ctx.engine.graph.resolve(camPath, ctx.node)
        : siblings.find((s) => s.type === 'comp:cam');
      const camObj = camNode ? cookObj(camNode) : null;
      if (!camObj?.camera) {
        ctx.node.error = 'render: no camera found';
        return null;
      }
      const w = ctx.paramNum('resw'), h = ctx.paramNum('resh');
      const cp = (camObj as SceneObject & { camParams?: { fov: number; near: number; far: number; ortho: boolean; orthoWidth: number } }).camParams
        ?? { fov: 45, near: 0.01, far: 500, ortho: false, orthoWidth: 2 };
      const proj = cp.ortho
        ? mat4.orthographic(cp.orthoWidth, w / h, cp.near, cp.far)
        : mat4.perspective(cp.fov, w / h, cp.near, cp.far);

      // geometry
      const geoPattern = ctx.paramStr('geometry') || '*';
      const draws: SceneDraw[] = [];
      for (const s of siblings) {
        if (s.type !== 'comp:geo' || !matchTdPattern(s.name, geoPattern)) continue;
        const o = cookObj(s);
        if (!o?.geo || !ctx.engine.param(s, 'render')) continue;
        draws.push({
          geo: o.geo, geoKey: o.geoKey ?? s.name, model: o.model,
          material: o.material ?? DEFAULT_MAT, instances: o.instances,
        });
      }

      // lights
      const lightPattern = ctx.paramStr('lights') || '*';
      const lights: SceneLight[] = [];
      for (const s of siblings) {
        if ((s.type === 'comp:light' || s.type === 'comp:ambientlight') && matchTdPattern(s.name, lightPattern)) {
          const o = cookObj(s);
          if (o?.light) lights.push(o.light);
        }
      }
      if (!lights.length) {
        // headlight fallback so unlit scenes are never black
        lights.push({
          kind: 'directional', color: [1, 1, 1], intensity: 1,
          position: [0, 0, 0],
          direction: [-camObj.model[8], -camObj.model[9], -camObj.model[10]],
        });
        lights.push({ kind: 'ambient', color: [1, 1, 1], intensity: 0.15, position: [0, 0, 0], direction: [0, 0, -1] });
      }

      try {
        const tex = ctx.gpu.renderScene(ctx.node, {
          camera: { view: camObj.camera.view, proj },
          lights,
          draws,
          output: { width: w, height: h },
          clear: ctx.param('bgcolor') as [number, number, number, number],
        });
        return { kind: 'top', tex };
      } catch (e) {
        ctx.node.error = (e as Error).message;
        return null;
      }
    },
  },
];
