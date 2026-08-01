#!/usr/bin/env node
/**
 * toe-convert — convert a TouchDesigner .toe/.tox into a .webtoe.json project
 * using the USER'S OWN TouchDesigner installation's `toeexpand` CLI.
 *
 *   node toe-convert.mjs project.toe [-o out.webtoe.json] [--toeexpand /path/to/toeexpand]
 *
 * WebToe never bundles Derivative binaries: this script locates toeexpand in
 * your local TD install (macOS app bundle or Windows bin folder), runs it in
 * a temp dir, and parses the resulting text expansion.
 *
 * Note: the parsing/mapping tables here are a small standalone port of
 * packages/io/src/toedir.ts — keep them in sync when editing either.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, globSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('-'));
const outIdx = args.indexOf('-o');
const teIdx = args.indexOf('--toeexpand');
if (!input) {
  console.error('usage: node toe-convert.mjs project.toe [-o out.webtoe.json] [--toeexpand path]');
  process.exit(1);
}

function findToeexpand() {
  if (teIdx >= 0 && args[teIdx + 1]) return args[teIdx + 1];
  const candidates = [
    ...globSync('/Applications/TouchDesigner*.app/Contents/MacOS/toeexpand').sort().reverse(),
    ...globSync('C:/Program Files/Derivative/TouchDesigner*/bin/toeexpand.exe').sort().reverse(),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    console.error('toeexpand not found — install TouchDesigner or pass --toeexpand <path>');
    process.exit(1);
  }
  return found;
}

// ---- minimal parser (sync port of packages/io/src/toedir.ts) ----

const TYPE_MAP = {
  'TOP:noise': 'top:noise', 'TOP:level': 'top:level', 'TOP:blur': 'top:blur',
  'TOP:transform': 'top:transform', 'TOP:ramp': 'top:ramp', 'TOP:constant': 'top:constant',
  'TOP:rectangle': 'top:rectangle', 'TOP:composite': 'top:composite', 'TOP:comp': 'top:composite', 'TOP:over': 'top:composite',
  'TOP:add': 'top:composite', 'TOP:multiply': 'top:composite', 'TOP:displace': 'top:displace',
  'TOP:edge': 'top:edge', 'TOP:feedback': 'top:feedback', 'TOP:moviefilein': 'top:imagein',
  'TOP:videodevin': 'top:camerain', 'TOP:null': 'top:null', 'TOP:out': 'top:out',
  'TOP:in': 'top:in', 'CHOP:in': 'chop:in', 'CHOP:out': 'chop:out',
  'CHOP:lfo': 'chop:lfo', 'CHOP:noise': 'chop:noise', 'CHOP:math': 'chop:math',
  'CHOP:lag': 'chop:lag', 'CHOP:constant': 'chop:constant', 'CHOP:mousein': 'chop:mousein',
  'CHOP:merge': 'chop:merge', 'CHOP:select': 'chop:select', 'CHOP:switch': 'chop:switch', 'CHOP:speed': 'chop:speed', 'CHOP:par': 'chop:par',
  'TOP:switch': 'top:switch', 'TOP:select': 'top:select', 'TOP:math': 'top:math', 'TOP:reorder': 'top:reorder', 'TOP:flip': 'top:flip',
  'DAT:table': 'dat:table', 'DAT:select': 'dat:select', 'DAT:null': 'dat:null', 'DAT:in': 'dat:in', 'DAT:out': 'dat:out', 'COMP:null': 'comp:container',
  'COMP:geo': 'comp:geo', 'COMP:cam': 'comp:cam', 'COMP:light': 'comp:light', 'COMP:ambient': 'comp:ambientlight', 'TOP:render': 'top:render',
  'SOP:line': 'sop:line', 'SOP:circle': 'sop:circle', 'SOP:rectangle': 'sop:rectangle', 'SOP:grid': 'sop:grid', 'SOP:sphere': 'sop:sphere',
  'SOP:box': 'sop:box', 'SOP:tube': 'sop:tube', 'SOP:torus': 'sop:torus', 'SOP:merge': 'sop:merge', 'SOP:transform': 'sop:transform',
  'SOP:noise': 'sop:noise', 'SOP:copy': 'sop:copy', 'SOP:skin': 'sop:skin', 'SOP:add': 'sop:add', 'SOP:point': 'sop:point',
  'SOP:facet': 'sop:facet', 'SOP:switch': 'sop:switch', 'SOP:null': 'sop:null', 'SOP:in': 'sop:in', 'SOP:out': 'sop:out',
  'MAT:constant': 'mat:constant', 'MAT:line': 'mat:line', 'MAT:pointsprite': 'mat:pointsprite', 'MAT:wireframe': 'mat:wireframe',
  'MAT:phong': 'mat:lit', 'MAT:pbr': 'mat:lit', 'MAT:switch': 'mat:switch', 'MAT:null': 'mat:null', 'MAT:out': 'mat:null',
  'COMP:container': 'comp:container', 'COMP:base': 'comp:container', 'DAT:text': 'dat:text',
};
const STUB_FOR = { TOP: 'top:stub', CHOP: 'chop:stub', DAT: 'dat:stub', SOP: 'sop:stub', MAT: 'mat:stub' };

function parseNodeFile(text) {
  const lines = text.split('\n');
  const node = { tdType: '', family: '', tile: { x: 0, y: 0 }, inputs: [] };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    const head = L.match(/^([A-Z]+):(\S+)/);
    if (head && !node.tdType) {
      node.family = head[1];
      node.tdType = `${head[1]}:${head[2]}`;
    } else if (L.startsWith('tile ')) {
      const [x, y] = L.slice(5).trim().split(/\s+/).map(Number);
      node.tile = { x: x || 0, y: y || 0 };
    } else if (L === 'inputs') {
      i++;
      while (++i < lines.length && !lines[i].includes('}')) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 2) node.inputs.push({ index: Number(parts[0]), source: parts.slice(1).join(' ') });
      }
    }
  }
  return node;
}

function readNetwork(dir) {
  const entries = readdirSync(dir);
  const nodes = [];
  const wires = [];
  const names = new Set(entries.filter((e) => e.endsWith('.n')).map((e) => e.slice(0, -2)));
  for (const e of entries) {
    if (!e.endsWith('.n') || e.startsWith('.')) continue;
    const name = e.slice(0, -2);
    const raw = parseNodeFile(readFileSync(join(dir, e), 'latin1'));
    if (!raw.tdType) continue;
    const mapped = TYPE_MAP[raw.tdType];
    const nj = {
      name,
      type: mapped ?? STUB_FOR[raw.family] ?? 'comp:stub',
      family: ['TOP', 'CHOP', 'DAT', 'SOP', 'MAT'].includes(raw.family) ? raw.family : 'COMP',
      pos: [raw.tile.x, -raw.tile.y],
    };
    if (!mapped) nj.foreignType = raw.tdType;
    const textPath = join(dir, `${name}.text`);
    if (existsSync(textPath)) nj.text = readFileSync(textPath, 'latin1');
    const childDir = join(dir, name);
    if (existsSync(childDir) && statSync(childDir).isDirectory()) {
      const sub = readNetwork(childDir);
      nj.children = sub.nodes;
      if (sub.wires.length) nj.wires = sub.wires;
      if (nj.type.endsWith(':stub')) nj.type = 'comp:stub';
    }
    nodes.push(nj);
    for (const inp of raw.inputs) {
      const src = inp.source.replace(/^\.\//, '');
      if (!src.includes('/') && names.has(src)) wires.push({ from: `${src}:0`, to: `${name}:${inp.index}` });
    }
  }
  // normalize positions
  if (nodes.length) {
    const ox = Math.min(...nodes.map((n) => n.pos[0]));
    const oy = Math.min(...nodes.map((n) => n.pos[1]));
    for (const n of nodes) n.pos = [n.pos[0] - ox + 40, n.pos[1] - oy + 40];
  }
  return { nodes, wires };
}

// ---- run ----

const toeexpand = findToeexpand();
const work = mkdtempSync(join(tmpdir(), 'webtoe-'));
try {
  // ASCII-only staging name: toeexpand reads paths as Latin-1 and fails on any
  // non-English filename. The disk name has no effect on the expansion.
  const copy = join(work, `input${basename(input).toLowerCase().endsWith('.tox') ? '.tox' : '.toe'}`);
  cpSync(input, copy);
  try {
    execFileSync(toeexpand, [copy], { cwd: work, stdio: 'pipe' });
  } catch {
    // toeexpand exits nonzero even on success — trust the output instead
  }
  const dir = `${copy}.dir`;
  if (!existsSync(dir)) throw new Error('toeexpand produced no .dir output');
  const root = readNetwork(dir);
  const json = { app: 'webtoe', version: 1, root, meta: { importedFrom: basename(input) } };
  const out = outIdx >= 0 && args[outIdx + 1]
    ? args[outIdx + 1]
    : basename(input).replace(/\.(toe|tox)$/i, '') + '.webtoe.json';
  writeFileSync(out, JSON.stringify(json, null, 1));
  const count = (ns) => ns.reduce((a, n) => a + 1 + (n.children ? count(n.children) : 0), 0);
  console.log(`wrote ${out} — ${count(root.nodes)} nodes (parameters/expressions: import the .toe.dir in the WebToe app for the full translation)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
