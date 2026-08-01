/**
 * TouchDesigner `.toe.dir` importer — the first ProjectLoader adapter.
 *
 * Input: the text expansion produced by the user's own TD install via the
 * official `toeexpand` CLI (format undocumented; grammar empirically verified,
 * see docs/RESEARCH.md §2.1). Output: GraphJSON + an honest ImportReport.
 *
 * Mapping philosophy: translate what WebToe can faithfully run; everything
 * else becomes a family-colored stub that preserves name/wires/layout, and
 * untranslatable Python expressions are kept inert as `tdExpr`.
 */
import {
  translateTdExpr,
  type Family, type GraphJSON, type ImportReport, type NodeJSON,
  type ParamValueJSON, type WireJSON,
} from '@webtoe/core';
import { decodeTdSidecar } from './tdContainer';

export interface ImportFile {
  /** path relative to the expansion root, e.g. "project1/noise1.n" */
  path: string;
  text(): Promise<string>;
  /** Raw bytes, when the source can supply them. `.n`/`.parm` are plain text,
   *  but `.text`/`.table` sidecars are framed binary (see tdContainer.ts) and
   *  can only be read correctly from bytes. Optional so hand-authored and
   *  fixture sources keep working unchanged. */
  bytes?(): Promise<Uint8Array>;
}

export interface ProjectLoader {
  name: string;
  canLoad(files: ImportFile[]): boolean;
  load(files: ImportFile[]): Promise<{ json: GraphJSON; report: ImportReport }>;
}

// ---------------------------------------------------------------- tables

/** TD `FAMILY:type` → WebToe op type. Conservative: only confident mappings. */
const TYPE_MAP: Record<string, string> = {
  'TOP:noise': 'top:noise',
  'TOP:level': 'top:level',
  'TOP:blur': 'top:blur',
  'TOP:transform': 'top:transform',
  'TOP:ramp': 'top:ramp',
  'TOP:constant': 'top:constant',
  'TOP:rectangle': 'top:rectangle',
  'TOP:composite': 'top:composite',
  'TOP:comp': 'top:composite',
  'TOP:over': 'top:composite',
  'TOP:add': 'top:composite',
  'TOP:multiply': 'top:composite',
  'TOP:displace': 'top:displace',
  'TOP:edge': 'top:edge',
  'TOP:feedback': 'top:feedback',
  'TOP:moviefilein': 'top:imagein',
  'TOP:videodevin': 'top:camerain',
  'TOP:null': 'top:null',
  'TOP:out': 'top:out',
  'TOP:in': 'top:in',
  'TOP:switch': 'top:switch',
  'TOP:select': 'top:select',
  'TOP:math': 'top:math',
  'TOP:reorder': 'top:reorder',
  'TOP:flip': 'top:flip',
  'CHOP:in': 'chop:in',
  'CHOP:out': 'chop:out',
  'CHOP:switch': 'chop:switch',
  'CHOP:speed': 'chop:speed',
  'CHOP:par': 'chop:par',
  'CHOP:lfo': 'chop:lfo',
  'CHOP:noise': 'chop:noise',
  'CHOP:math': 'chop:math',
  'CHOP:lag': 'chop:lag',
  'CHOP:constant': 'chop:constant',
  'CHOP:mousein': 'chop:mousein',
  'CHOP:merge': 'chop:merge',
  'CHOP:select': 'chop:select',
  'CHOP:null': 'chop:merge', // passthrough approximation
  // ---- POP family (TD 2025 GPU point operators).
  // POPs and SOPs are both point/primitive geometry, so the ones with a
  // faithful counterpart run on WebToe's SOP implementations. Attribute-only
  // and analysis POPs pass geometry through rather than breaking the chain;
  // genuine dynamics (particle, forces) stay stubs — see docs/TD-PARITY.md.
  'POP:circle': 'sop:circle',
  'POP:line': 'sop:line',
  'POP:rectangle': 'sop:rectangle',
  'POP:sphere': 'sop:sphere',
  'POP:tube': 'sop:tube',
  'POP:grid': 'sop:grid',
  'POP:box': 'sop:box',
  'POP:torus': 'sop:torus',
  'POP:merge': 'sop:merge',
  'POP:transform': 'sop:transform',
  'POP:noise': 'sop:noise',
  'POP:copy': 'sop:copy',
  'POP:skin': 'sop:skin',
  'POP:point': 'sop:point',
  'POP:switch': 'sop:switch',
  'POP:null': 'sop:null',
  'POP:in': 'sop:in',
  'POP:out': 'sop:out',
  'POP:normal': 'sop:facet',      // recomputes normals
  // passthrough approximations: they modify attributes, not topology
  'POP:attribute': 'sop:null',
  'POP:convert': 'sop:null',
  'POP:mathcombine': 'sop:null',
  'POP:connectivity': 'sop:null',
  'POP:linemetrics': 'sop:null',
  'COMP:container': 'comp:container',
  'COMP:base': 'comp:container',
  'COMP:null': 'comp:container',
  'COMP:geo': 'comp:geo',
  'COMP:cam': 'comp:cam',
  'COMP:light': 'comp:light',
  'COMP:ambient': 'comp:ambientlight',
  'TOP:render': 'top:render',
  'SOP:line': 'sop:line',
  'SOP:circle': 'sop:circle',
  'SOP:rectangle': 'sop:rectangle',
  'SOP:grid': 'sop:grid',
  'SOP:sphere': 'sop:sphere',
  'SOP:box': 'sop:box',
  'SOP:tube': 'sop:tube',
  'SOP:torus': 'sop:torus',
  'SOP:merge': 'sop:merge',
  'SOP:transform': 'sop:transform',
  'SOP:noise': 'sop:noise',
  'SOP:copy': 'sop:copy',
  'SOP:skin': 'sop:skin',
  'SOP:add': 'sop:add',
  'SOP:point': 'sop:point',
  'SOP:facet': 'sop:facet',
  'SOP:switch': 'sop:switch',
  'SOP:null': 'sop:null',
  'SOP:in': 'sop:in',
  'SOP:out': 'sop:out',
  'MAT:constant': 'mat:constant',
  'MAT:line': 'mat:line',
  'MAT:pointsprite': 'mat:pointsprite',
  'MAT:wireframe': 'mat:wireframe',
  'MAT:phong': 'mat:lit',
  'MAT:pbr': 'mat:lit',
  'MAT:switch': 'mat:switch',
  'MAT:null': 'mat:null',
  'MAT:out': 'mat:null',
  'DAT:text': 'dat:text',
  'DAT:table': 'dat:table',
  'DAT:select': 'dat:select',
  'DAT:null': 'dat:null',
  'DAT:in': 'dat:in',
  'DAT:out': 'dat:out',
};

/** implied parameter presets for collapsed type mappings */
const TYPE_PRESETS: Record<string, Record<string, string>> = {
  'TOP:over': { operation: 'over' },
  'TOP:add': { operation: 'add' },
  'TOP:multiply': { operation: 'multiply' },
};

type ParamRule =
  | { to: string }
  | { to: string; menu: Record<string, string> }
  | { toColor: string; channel: number };

/** shared object-COMP transform page (TD tokens are 1:1 with ours) */
const XFORM_RULES: Record<string, ParamRule> = Object.fromEntries(
  ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz', 'px', 'py', 'pz'].map((k) => [k, { to: k }]),
);

/** TD parm token → WebToe param, per mapped TD type. Unlisted parms are
 *  ignored (counted in the report). */
const PARAM_MAP: Record<string, Record<string, ParamRule>> = {
  'TOP:noise': {
    period: { to: 'period' },
    harmon: { to: 'harmonics' },
    exp: { to: 'exponent' },
    mono: { to: 'mono' },
  },
  'TOP:level': {
    brightness1: { to: 'brightness' },
    gamma1: { to: 'gamma' },
    contrast: { to: 'contrast' },
    opacity: { to: 'opacity' },
    invert: { to: 'invert' },
  },
  'TOP:blur': { size: { to: 'size' } },
  'TOP:transform': {
    tx: { to: 'tx' },
    ty: { to: 'ty' },
    rotate: { to: 'rotate' },
    sx: { to: 'sx' },
    sy: { to: 'sy' },
    px: { to: 'pivotx' },
    py: { to: 'pivoty' },
    extend: { to: 'extend', menu: { hold: 'hold', zero: 'zero', repeat: 'cycle', mirror: 'mirror' } },
  },
  'TOP:ramp': {
    type: { to: 'type', menu: { horz: 'linear', vert: 'linear', radial: 'radial', circular: 'circular' } },
    phase: { to: 'phase' },
  },
  'TOP:constant': {
    colorr: { toColor: 'color', channel: 0 },
    colorg: { toColor: 'color', channel: 1 },
    colorb: { toColor: 'color', channel: 2 },
    alpha: { toColor: 'color', channel: 3 },
  },
  'TOP:composite': { operand: { to: 'operation' } },
  'TOP:comp': { operand: { to: 'operation' } },
  'TOP:displace': {
    weight1: { to: 'weight' },
    offsetweight1: { to: 'weight' },
  },
  'TOP:edge': { strength: { to: 'strength' } },
  'TOP:moviefilein': { file: { to: 'file' } },
  'CHOP:lfo': {
    type: { to: 'wave', menu: { sin: 'sin', square: 'square', tri: 'tri', triangle: 'tri', ramp: 'saw', saw: 'saw', pulse: 'pulse' } },
    frequency: { to: 'frequency' },
    amp: { to: 'amplitude' },
    offset: { to: 'offset' },
    phase: { to: 'phase' },
  },
  'CHOP:noise': {
    period: { to: 'period' },
    harmon: { to: 'harmonics' },
    amp: { to: 'amplitude' },
    seed: { to: 'seed' },
  },
  'CHOP:math': {
    chopop: { to: 'combine', menu: { add: 'add', sub: 'subtract', mult: 'multiply', divide: 'divide', average: 'average', min: 'minimum', max: 'maximum' } },
    chanop: { to: 'chanop', menu: { off: 'off', add: 'add', sub: 'subtract', mult: 'multiply', divide: 'divide', average: 'average', min: 'minimum', max: 'maximum' } },
    preop: { to: 'preop', menu: { off: 'off', negate: 'negate', positive: 'positive', square: 'square', sqrt: 'sqrt' } },
    postop: { to: 'postop', menu: { off: 'off', negate: 'negate', positive: 'positive', square: 'square', sqrt: 'sqrt' } },
    gain: { to: 'gain' },
    preoff: { to: 'preadd' },
    postoff: { to: 'postadd' },
    fromrange1: { to: 'fromrange1' },
    fromrange2: { to: 'fromrange2' },
    torange1: { to: 'torange1' },
    torange2: { to: 'torange2' },
  },
  'CHOP:lag': { lag1: { to: 'lagup' }, lag2: { to: 'lagdown' } },
  'CHOP:select': { channames: { to: 'channames' } },
  'TOP:switch': { index: { to: 'index' } },
  'TOP:select': { top: { to: 'top' } },
  'TOP:flip': { flipx: { to: 'flipx' }, flipy: { to: 'flipy' } },
  'CHOP:switch': { index: { to: 'index' } },
  'CHOP:par': { op: { to: 'oppath' }, pars: { to: 'parnames' } },
  'DAT:select': { dat: { to: 'dat' } },
  'COMP:geo': {
    ...XFORM_RULES,
    material: { to: 'material' },
    render: { to: 'render' },
    instancing: { to: 'instancing' },
    instanceop: { to: 'instanceop' },
    // CHOP-driven instancing: TD stores the channel name per component
    instancetx: { to: 'instancetx' },
    instancety: { to: 'instancety' },
    instancetz: { to: 'instancetz' },
    instancer: { to: 'instancer' },
    instanceg: { to: 'instanceg' },
    instanceb: { to: 'instanceb' },
    instancea: { to: 'instancea' },
  },
  'COMP:cam': {
    ...XFORM_RULES,
    lookat: { to: 'lookat' },
    vertfov: { to: 'fov' },
    near: { to: 'near' },
    far: { to: 'far' },
    orthowidth: { to: 'orthowidth' },
  },
  'COMP:light': {
    ...XFORM_RULES,
    lighttype: { to: 'lighttype', menu: { point: 'point', distant: 'distant', cone: 'point' } },
    dimmer: { to: 'dimmer' },
    lightcolorr: { toColor: 'color', channel: 0 },
    lightcolorg: { toColor: 'color', channel: 1 },
    lightcolorb: { toColor: 'color', channel: 2 },
  },
  'COMP:ambient': {
    dimmer: { to: 'dimmer' },
    lightcolorr: { toColor: 'color', channel: 0 },
    lightcolorg: { toColor: 'color', channel: 1 },
    lightcolorb: { toColor: 'color', channel: 2 },
  },
  'TOP:render': {
    camera: { to: 'camera' },
    geometry: { to: 'geometry' },
    lights: { to: 'lights' },
    resolutionw: { to: 'resw' },
    resolutionh: { to: 'resh' },
    bgcolorr: { toColor: 'bgcolor', channel: 0 },
    bgcolorg: { toColor: 'bgcolor', channel: 1 },
    bgcolorb: { toColor: 'bgcolor', channel: 2 },
    bgcolora: { toColor: 'bgcolor', channel: 3 },
  },
  'SOP:circle': {
    radx: { to: 'radius' },
    divs: { to: 'divisions' },
    orient: { to: 'plane', menu: { xy: 'xy', zx: 'zx', yz: 'yz' } },
  },
  'SOP:sphere': { radx: { to: 'radius' }, rows: { to: 'rows' }, cols: { to: 'cols' } },
  'SOP:grid': { rows: { to: 'rows' }, cols: { to: 'cols' }, sizex: { to: 'sizex' }, sizey: { to: 'sizey' } },
  'SOP:box': { sizex: { to: 'sizex' }, sizey: { to: 'sizey' }, sizez: { to: 'sizez' } },
  'SOP:tube': { rad1: { to: 'rad1' }, rad2: { to: 'rad2' }, height: { to: 'height' }, rows: { to: 'rows' }, cols: { to: 'cols' } },
  'SOP:torus': { rad1: { to: 'rad1' }, rad2: { to: 'rad2' }, rows: { to: 'rows' }, cols: { to: 'cols' } },
  'SOP:line': {
    p1x: { to: 'p1x' }, p1y: { to: 'p1y' }, p1z: { to: 'p1z' },
    p2x: { to: 'p2x' }, p2y: { to: 'p2y' }, p2z: { to: 'p2z' },
    points: { to: 'points' },
  },
  'SOP:noise': { amp: { to: 'amount' }, period: { to: 'period' } },
  'SOP:transform': {
    tx: { to: 'tx' }, ty: { to: 'ty' }, tz: { to: 'tz' },
    rx: { to: 'rx' }, ry: { to: 'ry' }, rz: { to: 'rz' },
    sx: { to: 'sx' }, sy: { to: 'sy' }, sz: { to: 'sz' },
  },
  'SOP:switch': { index: { to: 'index' } },
  'MAT:line': {
    widthnear: { to: 'width' },
    linenearcolorr: { toColor: 'color', channel: 0 },
    linenearcolorg: { toColor: 'color', channel: 1 },
    linenearcolorb: { toColor: 'color', channel: 2 },
    linenearcolora: { toColor: 'color', channel: 3 },
  },
  'MAT:pointsprite': { pointsize: { to: 'pointsize' } },
  'MAT:constant': {
    colorr: { toColor: 'color', channel: 0 },
    colorg: { toColor: 'color', channel: 1 },
    colorb: { toColor: 'color', channel: 2 },
    alpha: { toColor: 'color', channel: 3 },
  },
  'MAT:pbr': {
    basecolorr: { toColor: 'basecolor', channel: 0 },
    basecolorg: { toColor: 'basecolor', channel: 1 },
    basecolorb: { toColor: 'basecolor', channel: 2 },
    metallic: { to: 'metallic' },
    roughness: { to: 'roughness' },
  },
  'MAT:phong': {
    diffr: { toColor: 'basecolor', channel: 0 },
    diffg: { toColor: 'basecolor', channel: 1 },
    diffb: { toColor: 'basecolor', channel: 2 },
  },
};


const STUB_FOR: Record<string, string> = {
  TOP: 'top:stub',
  CHOP: 'chop:stub',
  SOP: 'sop:stub',
  // POPs are TD 2025's GPU point/particle family. They carry geometry exactly
  // like SOPs do, so an unmapped POP degrades to a SOP stub — that keeps the
  // geometry chain connected instead of severing it at a COMP stub.
  POP: 'sop:stub',
  MAT: 'mat:stub',
  COMP: 'comp:stub',
  DAT: 'dat:stub',
};

const POS_SCALE = 1.0;

// ---------------------------------------------------------------- parsing

interface RawNode {
  name: string;
  tdType: string; // FAMILY:type
  family: string;
  tile: { x: number; y: number };
  comment?: string;
  inputs: { index: number; source: string }[];
  parms: Map<string, { mode: number; rest: string }>;
  text?: string;
  children?: Map<string, RawNode>;
}

function parseNodeFile(text: string): Omit<RawNode, 'name' | 'parms'> {
  const lines = text.split('\n');
  let tdType = '';
  let family = '';
  const tile = { x: 0, y: 0 };
  let comment: string | undefined;
  const inputs: { index: number; source: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    const head = L.match(/^([A-Z]+):(\S+)/);
    if (head && !tdType) {
      family = head[1];
      tdType = `${head[1]}:${head[2]}`;
    } else if (L.startsWith('tile ')) {
      const [x, y] = L.slice(5).trim().split(/\s+/).map(Number);
      tile.x = x || 0;
      tile.y = y || 0;
    } else if (L.startsWith('comment ')) {
      comment = L.slice(8).replace(/^"|"$/g, '');
    } else if (L === 'inputs') {
      i++; // '{'
      while (++i < lines.length && !lines[i].includes('}')) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 2) inputs.push({ index: Number(parts[0]), source: parts.slice(1).join(' ') });
      }
    }
  }
  return { tdType, family, tile, comment, inputs };
}

function parseParmFile(text: string): Map<string, { mode: number; rest: string }> {
  const out = new Map<string, { mode: number; rest: string }>();
  for (const raw of text.split('\n')) {
    const L = raw.replace(/^﻿/, '').trim();
    if (!L || L === '?') continue;
    const m = L.match(/^(\S+)\s+(\d+)\s+(.*)$/);
    if (m) out.set(m[1], { mode: Number(m[2]), rest: m[3].replace(/^﻿/, '') });
  }
  return out;
}

// ---------------------------------------------------------------- loader

export const toedirLoader: ProjectLoader = {
  name: 'TouchDesigner toeexpand directory',

  canLoad(files) {
    return files.some((f) => f.path.endsWith('.n') || f.path === '.build');
  },

  async load(files) {
    const report: ImportReport = {
      nodesTotal: 0, nodesMapped: 0, nodesStubbed: 0,
      exprTranslated: 0, exprDisabled: 0, notes: [],
    };
    const unknownTypes = new Map<string, number>();
    let unmappedParms = 0;
    let skippedWires = 0;

    // index files by normalized path
    const byPath = new Map<string, ImportFile>();
    for (const f of files) byPath.set(f.path.replace(/\\/g, '/'), f);

    // collect nodes: every "<dir>/<name>.n"
    const root = new Map<string, RawNode>();
    const networkOf = (dir: string): Map<string, RawNode> | null => {
      if (!dir) return root;
      let cur: Map<string, RawNode> | null = root;
      for (const seg of dir.split('/')) {
        const parent: RawNode | undefined = cur?.get(seg);
        if (!parent) return null; // parent .n not seen (yet) — second pass resolves
        parent.children ??= new Map();
        cur = parent.children;
      }
      return cur;
    };

    const nFiles = [...byPath.keys()].filter((p) => p.endsWith('.n')).sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
    );
    for (const path of nFiles) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const name = path.slice(dir ? dir.length + 1 : 0, -2);
      if (name.startsWith('.')) continue;
      const net = networkOf(dir);
      if (!net) {
        report.notes.push(`orphan network path skipped: ${path}`);
        continue;
      }
      const base = parseNodeFile(await byPath.get(path)!.text());
      if (!base.tdType) continue;
      const node: RawNode = { name, parms: new Map(), ...base };
      const parmFile = byPath.get(`${dir ? dir + '/' : ''}${name}.parm`);
      if (parmFile) node.parms = parseParmFile(await parmFile.text());
      const textFile = byPath.get(`${dir ? dir + '/' : ''}${name}.text`);
      if (textFile) node.text = await readSidecar(textFile) ?? undefined;
      if (node.text === undefined) {
        // table DATs store their rows in a .table sidecar, TSV once unframed
        const tableFile = byPath.get(`${dir ? dir + '/' : ''}${name}.table`);
        if (tableFile) node.text = await readSidecar(tableFile) ?? undefined;
      }
      net.set(name, node);
    }

    // convert RawNode tree → NodeJSON tree
    const convertNet = (nodes: Map<string, RawNode>): { nodes: NodeJSON[]; wires: WireJSON[] } => {
      const out: NodeJSON[] = [];
      const wires: WireJSON[] = [];
      const xs = [...nodes.values()].map((n) => n.tile.x);
      const ys = [...nodes.values()].map((n) => -n.tile.y);
      const ox = xs.length ? Math.min(...xs) : 0;
      const oy = ys.length ? Math.min(...ys) : 0;

      for (const raw of nodes.values()) {
        report.nodesTotal++;
        const mapped = TYPE_MAP[raw.tdType];
        const family = (raw.family in STUB_FOR ? raw.family : 'COMP') as string;
        const type = mapped ?? STUB_FOR[family];
        if (mapped) report.nodesMapped++;
        else {
          report.nodesStubbed++;
          unknownTypes.set(raw.tdType, (unknownTypes.get(raw.tdType) ?? 0) + 1);
        }

        const nj: NodeJSON = {
          name: raw.name,
          type,
          family: (['TOP', 'CHOP', 'DAT', 'SOP', 'MAT'].includes(family) ? family : 'COMP') as Family,
          pos: [(raw.tile.x - ox) * POS_SCALE + 40, (-raw.tile.y - oy) * POS_SCALE + 40],
        };
        if (!mapped) nj.foreignType = raw.tdType;
        if (raw.text !== undefined) nj.text = raw.text;

        // params
        const params: Record<string, ParamValueJSON> = {};
        for (const [k, v] of Object.entries(TYPE_PRESETS[raw.tdType] ?? {})) {
          params[k] = { mode: 'const', value: v };
        }
        if (type === 'top:in' || type === 'chop:in' || type === 'sop:in') {
          const digits = raw.name.match(/^in(\d+)$/);
          if (digits) params.index = { mode: 'const', value: Number(digits[1]) - 1 };
        }
        const rules = PARAM_MAP[raw.tdType] ?? {};
        const colorAcc: Record<string, number[]> = {};
        for (const [tdKey, { mode, rest }] of raw.parms) {
          const rule = rules[tdKey];
          if (!rule) {
            unmappedParms++;
            continue;
          }
          // mode is a bitfield: bit 0 = expression active ("<default> <expr>"),
          // bit 4 = string-with-default-expression component (empirically decoded
          // from production files: 17=16|1, 49=32|16|1, 273=256|16|1, 48=32|16, …)
          if (mode & 1) {
            // "<default> <python expression>"
            const sp = rest.indexOf(' ');
            const def = sp >= 0 ? rest.slice(0, sp) : rest;
            const py = sp >= 0 ? rest.slice(sp + 1) : '';
            const t = translateTdExpr(py);
            const defVal = Number.isFinite(Number(def)) ? Number(def) : def;
            if ('to' in rule) {
              if (t.ok) {
                report.exprTranslated++;
                params[rule.to] = { mode: 'expr', value: defVal, expr: t.expr };
              } else {
                report.exprDisabled++;
                params[rule.to] = { mode: 'disabled-expr', value: defVal, tdExpr: py };
              }
            }
            continue;
          }
          // constant modes (bit 4 set = "quoted-string default-expr", else plain value)
          let value: string | number = rest;
          if (mode & 16) {
            const q = rest.match(/^"([^"]*)"/);
            value = q ? q[1] : rest.split(/\s+/)[0];
          } else {
            let first = rest.trim();
            // string constants may be stored quoted (e.g. channames 0 "tx ty")
            const q = first.match(/^"([^"]*)"$/);
            if (q) first = q[1];
            value = first !== '' && Number.isFinite(Number(first)) ? Number(first) : first;
          }
          if ('toColor' in rule) {
            colorAcc[rule.toColor] ??= [1, 1, 1, 1];
            colorAcc[rule.toColor][rule.channel] = Number(value) || 0;
          } else if ('menu' in rule) {
            const mappedVal = rule.menu[String(value)];
            if (mappedVal !== undefined) params[rule.to] = { mode: 'const', value: mappedVal };
            else unmappedParms++;
          } else {
            params[rule.to] = { mode: 'const', value };
          }
        }
        for (const [key, col] of Object.entries(colorAcc)) {
          params[key] = { mode: 'const', value: col };
        }
        if (Object.keys(params).length) nj.params = params;

        // children
        if (raw.children?.size) {
          const sub = convertNet(raw.children);
          nj.children = sub.nodes;
          if (sub.wires.length) nj.wires = sub.wires;
          if (nj.type.endsWith(':stub')) nj.type = 'comp:stub';
        }
        out.push(nj);

        // wires (same-network only in v1)
        for (const inp of raw.inputs) {
          const src = inp.source.replace(/^\.\//, '');
          if (src.includes('/')) {
            skippedWires++;
            continue;
          }
          if (nodes.has(src)) wires.push({ from: `${src}:0`, to: `${raw.name}:${inp.index}` });
          else skippedWires++;
        }
      }
      return { nodes: out, wires };
    };

    const rootNet = convertNet(root);
    if (unknownTypes.size) {
      const top = [...unknownTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([t, c]) => `${t}×${c}`).join(', ');
      report.notes.push(`stubbed op types: ${top}${unknownTypes.size > 12 ? ', …' : ''}`);
    }
    if (skippedWires) report.notes.push(`${skippedWires} cross-network or unresolved wires skipped (v1 limitation)`);
    if (unmappedParms) report.notes.push(`${unmappedParms} parameters had no mapping and were left at defaults`);

    return {
      json: { app: 'webtoe', version: 1, root: rootNet },
      report,
    };
  },
};

/**
 * Read a DAT body sidecar. Prefers raw bytes so the TouchDesigner frame can be
 * removed; falls back to `text()` for sources that only offer text (fixtures,
 * hand-authored expansions), where the old NUL guard still applies.
 */
async function readSidecar(file: ImportFile): Promise<string | null> {
  if (file.bytes) return decodeTdSidecar(await file.bytes())?.text ?? null;
  const t = await file.text();
  return t.includes('\0') ? null : t;
}

/** Browser helper: turn a webkitdirectory FileList into ImportFiles,
 *  stripping the top-level "<name>.toe.dir/" segment. */
export function importFilesFromFileList(list: FileList | File[]): ImportFile[] {
  const files = [...list] as (File & { webkitRelativePath?: string })[];
  return files.map((f) => {
    let p = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const segs = p.split('/');
    if (segs.length > 1) p = segs.slice(1).join('/');
    return {
      path: p,
      text: () => f.text(),
      bytes: async () => new Uint8Array(await f.arrayBuffer()),
    };
  });
}
