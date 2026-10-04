// Draw a real WebToe network as static SVG, straight from a bundled
// .webtoe.json: node positions, families, wires, the display flag, and the
// expression references (`op('lfo1')['chan1']` → a dashed line from the CHOP
// to the node whose parameter reads it). The homepage illustration is the
// example itself, not a picture of one.

import { esc, attr } from './md.mjs';
import { FAMILY_COLORS } from './config.mjs';

const W = 132, H = 46, PAD = 28;

/**
 * @param {any} project parsed .webtoe.json
 * @param {{ id: string, label: string, flow?: boolean }} opts
 * @returns {string} <svg>
 */
export function networkSvg(project, { id, label, flow = true }) {
  const nodes = project.root.nodes;
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const xs = nodes.map((n) => n.pos[0]), ys = nodes.map((n) => n.pos[1]);
  const x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD;
  const vw = Math.max(...xs) + W + PAD - x0, vh = Math.max(...ys) + H + PAD - y0;
  const nIn = (name) => Math.max(1, ...(project.root.wires ?? []).filter((w) => w.to.split(':')[0] === name)
    .map((w) => Number(w.to.split(':')[1]) + 1));
  const inletY = (name, k) => { const n = nIn(name); return H / 2 + (k - (n - 1) / 2) * 9; };
  const f = (v) => Math.round(v * 10) / 10;

  const wires = (project.root.wires ?? []).map((w) => {
    const [a] = w.from.split(':');
    const [b, k] = w.to.split(':');
    const s = byName.get(a), t = byName.get(b);
    if (!s || !t) return '';
    const sx = s.pos[0] + W, sy = s.pos[1] + H / 2, tx = t.pos[0], ty = t.pos[1] + inletY(b, Number(k));
    const dx = Math.max(28, (tx - sx) * 0.5);
    const d = `M${f(sx)} ${f(sy)}C${f(sx + dx)} ${f(sy)} ${f(tx - dx)} ${f(ty)} ${f(tx)} ${f(ty)}`;
    return `<path class="w" d="${d}"/>${flow ? `<path class="wf" d="${d}"/>` : ''}`;
  }).join('');

  // expression references: CHOP → the node that reads it in a parameter
  const refs = [];
  for (const n of nodes) {
    for (const [par, p] of Object.entries(n.params ?? {})) {
      if (p?.mode !== 'expr' || typeof p.expr !== 'string') continue;
      for (const m of p.expr.matchAll(/op\('([^']+)'\)/g)) {
        const s = byName.get(m[1]);
        if (s && s !== n) refs.push({ s, t: n, par, expr: p.expr });
      }
    }
  }
  const refPaths = refs.map(({ s, t, par, expr }) => {
    const sx = s.pos[0] + W, sy = s.pos[1] + H / 2;
    const tx = t.pos[0] + W / 2, ty = t.pos[1] + H;
    const d = `M${f(sx)} ${f(sy)}C${f(sx + 70)} ${f(sy)} ${f(tx)} ${f(ty + 70)} ${f(tx)} ${f(ty)}`;
    return `<path class="x" d="${d}"><title>${esc(`${t.name}.${par} = ${expr}`)}</title></path>`;
  }).join('');

  const boxes = nodes.map((n) => {
    const [x, y] = n.pos;
    const color = FAMILY_COLORS[n.family] ?? FAMILY_COLORS.COMP;
    const typ = n.type.split(':')[1];
    const ins = Array.from({ length: (project.root.wires ?? []).some((w) => w.to.startsWith(n.name + ':')) ? nIn(n.name) : 0 },
      (_, k) => `<circle class="io" cx="${x}" cy="${f(y + inletY(n.name, k))}" r="3"/>`).join('');
    const disp = n.flags?.display ? `<circle class="flag on" cx="${x + W - 10}" cy="${y + H - 10}" r="3.6"/>` : '';
    const expr = Object.values(n.params ?? {}).some((p) => p?.mode === 'expr') ? `<text class="fx" x="${x + W - 9}" y="${y + 15}" text-anchor="end">ƒ</text>` : '';
    return `<g class="n" data-family="${n.family}"><rect class="box" x="${x}" y="${y}" width="${W}" height="${H}" rx="6"/>` +
      `<rect x="${x}" y="${y}" width="4" height="${H}" rx="2" fill="${color}"/>` +
      `<text class="nm" x="${x + 12}" y="${y + 19}">${esc(n.name)}</text>` +
      `<text class="ty" x="${x + 12}" y="${y + 35}">${esc(n.family)} · ${esc(typ)}</text>` +
      `${expr}${ins}<circle class="io" cx="${x + W}" cy="${y + H / 2}" r="3"/>${disp}</g>`;
  }).join('');

  return `<svg class="net" id="${attr(id)}" viewBox="${f(x0)} ${f(y0)} ${f(vw)} ${f(vh)}" role="img" aria-labelledby="${attr(id)}-t" preserveAspectRatio="xMidYMid meet">` +
    `<title id="${attr(id)}-t">${esc(label)}</title>` +
    `<g class="wires">${wires}</g><g class="refs">${refPaths}</g><g class="nodes">${boxes}</g></svg>`;
}

/** Plain-text facts about a project (node/wire/expression counts), counted recursively. */
export function projectStats(project) {
  let nodes = 0, wires = 0, exprs = 0;
  const families = {};
  const walk = (list, ws) => {
    wires += (ws ?? []).length;
    for (const n of list) {
      nodes++;
      families[n.family] = (families[n.family] ?? 0) + 1;
      for (const p of Object.values(n.params ?? {})) if (p?.mode === 'expr') exprs++;
      if (n.children) walk(n.children, n.wires);
    }
  };
  walk(project.root.nodes, project.root.wires);
  return { nodes, wires, exprs, families };
}
