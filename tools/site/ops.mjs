// The operator inventory, read from the engine's own source so the docs and
// the homepage can never disagree with what the registry ships.
//
// Op specs in packages/ops/src are plain object literals:
//   { type: 'top:noise', family: F, label: 'noise', … }
// We scan for `type: '<family>:<name>'` and take the first `label:` that
// follows it inside the same spec. Family stubs (`<family>:stub`) are the
// importer's placeholders, not operators, and are left out.

import fs from 'node:fs';
import path from 'node:path';

export const FAMILY_ORDER = ['TOP', 'CHOP', 'SOP', 'MAT', 'COMP', 'DAT'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * @param {string} root repository root
 * @returns {{ family: string, ops: { type: string, label: string }[] }[]}
 */
export function scanOps(root) {
  const found = new Map();
  for (const file of walk(path.join(root, 'packages/ops/src')).sort()) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /\btype:\s*'((top|chop|sop|mat|comp|dat|pop):([a-z0-9_]+))'/g;
    const hits = [...src.matchAll(re)];
    hits.forEach((m, k) => {
      if (m[3] === 'stub') return;
      const end = k + 1 < hits.length ? hits[k + 1].index : src.length;
      const window = src.slice(m.index, end);
      const label = window.match(/\blabel:\s*'([^']+)'/)?.[1] ?? m[3];
      if (!found.has(m[1])) found.set(m[1], { type: m[1], label });
    });
  }
  const byFamily = new Map(FAMILY_ORDER.map((f) => [f, []]));
  for (const op of found.values()) {
    const fam = op.type.split(':')[0].toUpperCase();
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(op);
  }
  return [...byFamily].filter(([, ops]) => ops.length)
    .map(([family, ops]) => ({ family, ops: ops.sort((a, b) => a.label.localeCompare(b.label)) }));
}

/** { TOP: 28, …, total: 81 } */
export function opCounts(families) {
  const counts = Object.fromEntries(families.map((f) => [f.family, f.ops.length]));
  counts.total = families.reduce((n, f) => n + f.ops.length, 0);
  return counts;
}
