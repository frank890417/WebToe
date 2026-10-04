// Build the static site (homepage + docs + SEO files) in memory.
//
//   import { buildSite, validateSite } from './tools/site/build.mjs';
//   const { files, warnings } = buildSite();      // Map<path, string|Buffer>
//   const errors = validateSite(files);             // broken links, missing anchors
//
// tools/build-site.mjs writes the result into apps/web/dist next to the editor
// (dist/app/, built by vite). Nothing here is committed output: the site is
// rebuilt on every `npm run build`, so it cannot drift from its sources.
// Inputs:
//   tools/site/home/page.mjs + en.mjs / zh.mjs   homepage structure + strings
//   site/docs/<lang>/*.md                        docs (tools/site/docs.mjs: order)
//   site/assets/                                 css, js, fonts, screenshots, og.png
//   packages/ops/src                             operator inventory (ops.mjs)
//   apps/web/public                              examples, wasm, bridge.py (compat copies at /)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pageCtx, esc, FAVICON } from './chrome.mjs';
import { SITE, REPO, OAV, BUNDLE_FALLBACK } from './config.mjs';
import { renderHome, SHOT_NAMES } from './home/page.mjs';
import { loadDocs, renderDocPage, DOC_GROUPS, DOC_SLUGS, docKey } from './docs.mjs';
import { scanOps, opCounts } from './ops.mjs';
import { networkSvg } from './network-svg.mjs';
import en from './home/en.mjs';
import zh from './home/zh.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TABLES = { en, zh };
const PLACEHOLDER = /\{\{TOE_[A-Z0-9_]+\}\}/g;

/** Both string tables must have the same shape: same keys, same array lengths. */
export function shapeDiff(a, b, at = '') {
  const out = [];
  const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  if (kind(a) !== kind(b)) return [`${at || '(root)'}: ${kind(a)} vs ${kind(b)}`];
  if (kind(a) === 'array') {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) out.push(...shapeDiff(a[i], b[i], `${at}[${i}]`));
  } else if (kind(a) === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${at}.${k}: missing in en`);
      else if (!(k in b)) out.push(`${at}.${k}: missing in zh`);
      else out.push(...shapeDiff(a[k], b[k], `${at}.${k}`));
    }
  }
  return out;
}

/** Replace {name} tokens (not {{…}}) in every string of a table. Unknown names throw. */
export function fill(table, vars) {
  const walk = (v, at) => {
    if (typeof v === 'string') {
      return v.replace(/(?<!\{)\{([A-Za-z]\w*)\}(?!\})/g, (m, k) => {
        if (!(k in vars)) throw new Error(`unknown token {${k}} at ${at}`);
        return String(vars[k]);
      });
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${at}[${i}]`));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, `${at}.${k}`)]));
    return v;
  };
  return walk(table, '');
}

/** Size of the built editor bundle, or the recorded fallback when it has not been built. */
export function measureBundle(root = ROOT) {
  const dir = path.join(root, 'apps/web/dist/app/assets');
  if (!fs.existsSync(dir)) return { ...BUNDLE_FALLBACK, measured: false };
  let raw = 0, gz = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const buf = fs.readFileSync(path.join(dir, f));
    raw += buf.length;
    gz += zlib.gzipSync(buf, { level: 9 }).length;
  }
  if (!raw) return { ...BUNDLE_FALLBACK, measured: false };
  return { kb: Math.round(raw / 1000), gzipKb: Math.round(gz / 1000), measured: true };
}

function readTree(dir, prefix, into) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readTree(p, `${prefix}${e.name}/`, into);
    else into.set(prefix + e.name, fs.readFileSync(p));
  }
}

const hash8 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);

/** The operator table as Markdown, for llms-full.txt. */
function opsMarkdown(ops, counts) {
  return ['| Family | Ops | Operators |', '|---|--:|---|',
    ...ops.map((f) => `| ${f.family} | ${f.ops.length} | ${f.ops.map((o) => o.label).join(', ')} |`),
    `| Total | ${counts.total} | |`].join('\n');
}

function sitemap() {
  const keys = ['', 'docs/', ...DOC_SLUGS.map(docKey)];
  const alt = (k) => ['en', 'zh-Hant', 'x-default'].map((hl) =>
    `    <xhtml:link rel="alternate" hreflang="${hl}" href="${hl === 'zh-Hant' ? SITE + 'zh/' + k : SITE + k}"/>`).join('\n');
  const urls = keys.flatMap((k) => [SITE + k, SITE + 'zh/' + k].map((loc) => `  <url>\n    <loc>${loc}</loc>\n${alt(k)}\n  </url>`));
  urls.splice(2, 0, `  <url>\n    <loc>${SITE}app/</loc>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

function robots() {
  return `User-agent: *
Allow: /

# A short guide for language models: ${SITE}llms.txt
# Every doc in one file:            ${SITE}llms-full.txt
Sitemap: ${SITE}sitemap.xml
`;
}

function llmsTxt(docs, counts) {
  return `# WebToe

> A web-native, node-based dataflow engine and editor for real-time visuals. Operators of six families (TOP image, CHOP channel, SOP geometry, MAT material, COMP container/3D object, DAT text/table) are wired into networks and cooked by a pull-based, per-frame memoized engine on WebGL2 or WebGPU; every parameter can be a JavaScript expression (time, me, op(), parent(), ext(), a math library). It imports TouchDesigner .toe/.tox projects: supported operators run, the rest become stubs that keep names, wires, parameters and code. TypeScript, MIT, zero runtime dependencies. Independent project, not affiliated with Derivative Inc.

Site: ${SITE} (English) · ${SITE}zh/ (繁體中文, Traditional Chinese)
Editor: ${SITE}app/ (load a project with ?project=<url>; examples at ${SITE}app/examples/)
Repository: ${REPO}
Author: Che-Yu Wu 吳哲宇 (https://cheyuwu.com)

## Facts

- ${counts.total} operator types: ${['TOP', 'CHOP', 'SOP', 'MAT', 'COMP', 'DAT'].map((f) => `${f} ${counts[f] ?? 0}`).join(', ')} (counted from packages/ops/src at build time).
- Measured TouchDesigner coverage on a private corpus of 60 real projects (28,698 nodes, 2022–2026): 32.3% → 47.1% → 62.3% of nodes runnable across two evolution cycles. Only aggregates are published.
- Imported Python is never executed; it is translated to WebToe expressions when faithful (absTime.seconds*0.2 → time.seconds*0.2) and kept inert otherwise.
- External control: a host page posts {type:'webtoe:ext', values:{name:number}} (read in expressions as ext('name')) or {type:'webtoe:load', url} to the editor's window.

## Docs

${DOC_SLUGS.map((s) => `- [${docs.en[s].title}](${SITE}${docKey(s)}): ${docs.en[s].description}`).join('\n')}
- [Full text](${SITE}llms-full.txt): every doc above in one file.

## Optional

- [Architecture source document](${REPO}/blob/main/docs/ARCHITECTURE.md)
- [Roadmap with measured results](${REPO}/blob/main/docs/ROADMAP.md)
- [open-audiovisual](${OAV}): sister project, a web-native framework for audiovisual performance that can perform a WebToe patch as a world.
`;
}

function llmsFull(docs, ops, counts) {
  const head = `# WebToe — full documentation for language models

> Every page of the WebToe docs in one file, generated by tools/site/build.mjs from site/docs/en/.
> The short index is ${SITE}llms.txt. Site: ${SITE} · 繁體中文: ${SITE}zh/
> Repository: ${REPO} (MIT)
`;
  const body = ['index', ...DOC_SLUGS].map((s) => {
    const d = docs.en[s];
    const md = d.body
      .replace(/^<!--\s*OPS-TABLE\s*-->$/m, opsMarkdown(ops, counts))
      .replace(/^<!--\s*OPS-TOTAL\s*-->$/m, '')
      .trim();
    return `\n\n---\n\n<!-- source: ${d.source} · ${SITE}${docKey(s)} -->\n\n# ${d.title}\n\n> ${d.description}\n\n${md}`;
  }).join('');
  return head + body + '\n';
}

function notFound(t) {
  // served by GitHub Pages at any missing path → root-absolute links only
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · WebToe</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b0b0c">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body class="page-404">
<main id="main" class="nf">
  <p class="eyebrow">404</p>
  <h1>Nothing is wired to this address.</h1>
  <p class="lede">The page may have moved. The editor now lives at <a href="/app/">/app/</a>; links that carried <code>?project=</code> on the site root are forwarded there automatically.</p>
  <p class="ctas"><a class="btn btn-primary" href="/app/">${esc(t.ui.openEditor)}<span aria-hidden="true">→</span></a> <a class="btn" href="/">Home</a> <a class="btn" href="/docs/">Docs</a> <a class="btn" href="/zh/">中文</a></p>
</main>
</body>
</html>
`;
}

/**
 * Build everything in memory.
 * @param {{ root?: string, bundle?: {kb: number, gzipKb: number} }} [opts]
 */
export function buildSite({ root = ROOT, bundle } = {}) {
  const diff = shapeDiff(en, zh);
  if (diff.length) throw new Error('string tables differ in shape (tools/site/home/en.mjs vs zh.mjs):\n  ' + diff.join('\n  '));
  const { docs, errors } = loadDocs(root);
  if (errors.length) throw new Error('docs sources:\n  ' + errors.join('\n  '));

  const files = new Map();
  const warnings = [];

  // assets, with content-hash stamps for the two files that change between deploys
  readTree(path.join(root, 'site/assets'), 'assets/', files);
  for (const n of SHOT_NAMES) for (const w of [800, 1600]) {
    if (!files.has(`assets/shots/${n}-${w}.webp`)) warnings.push(`missing screenshot assets/shots/${n}-${w}.webp (run npm run site:shots)`);
  }
  if (!files.has('assets/og.png')) warnings.push('missing assets/og.png (run npm run site:og)');
  const stamps = {};
  for (const p of ['assets/site.css', 'assets/site.js']) if (files.has(p)) stamps[p] = hash8(files.get(p));
  const stamp = (href) => {
    const key = Object.keys(stamps).find((k) => href.endsWith(k));
    return key ? `${href}?v=${stamps[key]}` : href;
  };

  const ops = scanOps(root);
  const counts = opCounts(ops);
  const size = bundle ?? measureBundle(root);
  const lfo = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/examples/03-lfo-garden.webtoe.json'), 'utf8'));

  for (const locale of ['en', 'zh']) {
    const home = pageCtx('', locale);
    const vars = { bundleKb: size.kb, bundleGz: size.gzipKb, ...counts, root: home.asset('').replace(/^\.\/$/, '') };
    const t = fill(TABLES[locale], vars);
    const net = networkSvg(lfo, { id: `net-${locale}`, label: t.hero.netCaption.replace(/<[^>]+>/g, '') });
    const docTitles = Object.fromEntries(DOC_SLUGS.map((s) => [s, docs[locale][s]]));
    files.set(home.path + 'index.html', renderHome(t, home, { net, docs: docTitles, stamp, vars }));

    for (const slug of ['index', ...DOC_SLUGS]) {
      const c = pageCtx(docKey(slug), locale);
      const tt = fill(TABLES[locale], { ...vars, root: c.asset('') });
      files.set(c.path + 'index.html', renderDocPage(tt, c, docs[locale], docs[locale][slug], { ops, counts }, stamp));
    }
  }

  // the editor's static files, also kept at the root for links that predate /app/
  for (const sub of ['examples', 'wasm']) readTree(path.join(root, 'apps/web/public', sub), `${sub}/`, files);
  files.set('bridge.py', fs.readFileSync(path.join(root, 'apps/web/public/bridge.py')));

  files.set('404.html', notFound(en));
  files.set('robots.txt', robots());
  files.set('sitemap.xml', sitemap());
  files.set('llms.txt', llmsTxt(docs, counts));
  files.set('llms-full.txt', llmsFull(docs, ops, counts));
  files.set('.nojekyll', '');

  const placeholders = new Set();
  for (const [p, v] of files) if (typeof v === 'string' && p.endsWith('.html')) for (const m of v.matchAll(PLACEHOLDER)) placeholders.add(m[0]);
  if (placeholders.size) warnings.push(`unfilled placeholders: ${[...placeholders].sort().join(' ')}`);

  return { files, warnings, placeholders: [...placeholders].sort(), counts, bundle: size };
}

const LOCAL_REF = /\s(?:href|src|srcset)="([^"]+)"/g;

/**
 * Every local link and asset resolves to a built file (or to the editor's own
 * files under app/), and every #anchor has a target. Returns error strings.
 * @param {Map<string, string|Buffer>} files
 */
export function validateSite(files, root = ROOT) {
  const errors = [];
  const publicDir = path.join(root, 'apps/web/public');
  const ids = new Map();
  const idsOf = (p) => {
    if (!ids.has(p)) {
      const v = files.get(p);
      ids.set(p, new Set(typeof v === 'string' ? [...v.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]) : []));
    }
    return ids.get(p);
  };
  const exists = (p) => {
    if (files.has(p)) return true;
    if (p === 'app/index.html') return true;                   // built by vite
    if (p.startsWith('app/')) return fs.existsSync(path.join(publicDir, p.slice(4)));
    return false;
  };

  for (const [page, html] of files) {
    if (!page.endsWith('.html') || typeof html !== 'string') continue;
    const dir = path.posix.dirname(page);
    const refs = [];
    for (const m of html.matchAll(LOCAL_REF)) {
      if (m[0].includes('srcset=')) refs.push(...m[1].split(',').map((s) => s.trim().split(/\s+/)[0]));
      else refs.push(m[1]);
    }
    for (const raw of refs) {
      const ref = raw.replace(/&amp;/g, '&');
      if (/^(https?:|data:|mailto:)/.test(ref)) continue;
      if (ref.startsWith('#')) {
        if (ref.length > 1 && !idsOf(page).has(decodeURIComponent(ref.slice(1)))) errors.push(`${page}: ${ref} has no target`);
        continue;
      }
      const [pathPart, query = ''] = ref.split('#')[0].split('?');
      const hashPart = ref.includes('#') ? ref.slice(ref.indexOf('#') + 1) : '';
      let target = ref.startsWith('/') ? pathPart.slice(1) : path.posix.normalize(path.posix.join(dir, pathPart));
      if (target === '.' || target === '') target = '';
      if (target.startsWith('..')) { errors.push(`${page}: ${ref} escapes the site root`); continue; }
      const file = target === '' || target.endsWith('/') || pathPart.endsWith('/') ? path.posix.join(target, 'index.html') : target;
      if (!exists(file)) { errors.push(`${page}: ${ref} → ${file} missing`); continue; }
      if (hashPart && files.has(file) && !idsOf(file).has(decodeURIComponent(hashPart))) errors.push(`${page}: ${ref} → #${hashPart} missing in ${file}`);
      const proj = new URLSearchParams(query).get('project');
      if (proj && !/^https?:/.test(proj) && !fs.existsSync(path.join(publicDir, proj))) errors.push(`${page}: ${ref} → project ${proj} missing in apps/web/public`);
    }
  }
  return errors;
}

export { DOC_GROUPS, DOC_SLUGS, loadDocs, scanOps, opCounts };
