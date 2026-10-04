#!/usr/bin/env node
// build-site — the homepage, the docs and the SEO files, next to the editor.
//
//   node tools/build-site.mjs            # write into apps/web/dist (keeps dist/app/)
//   node tools/build-site.mjs --check    # build in memory, validate links/anchors/sources, write nothing
//   node tools/build-site.mjs --out DIR  # write somewhere else
//
// `npm run build` runs vite first (editor → apps/web/dist/app/, base /app/),
// then this, so the deployed dist has /, /zh/, /docs/…, /app/ and the root
// compatibility copies (/bridge.py, /examples/, /wasm/). Everything in DIR
// except app/ is replaced on each run.

import fs from 'node:fs';
import path from 'node:path';
import { buildSite, validateSite, ROOT } from './site/build.mjs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const OUT = path.resolve(outArg ?? path.join(ROOT, 'apps/web/dist'));

let built;
try {
  built = buildSite();
} catch (e) {
  console.error('✗ site build failed:\n' + e.message);
  process.exit(1);
}
const { files, warnings, counts, bundle } = built;
const errors = validateSite(files);

for (const w of warnings) console.warn('⚠ ' + w);
if (errors.length) {
  console.error(`✗ ${errors.length} broken reference(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}

const pages = [...files.keys()].filter((p) => p.endsWith('.html'));
const summary = `${pages.length} pages · ${counts.total} operators · editor bundle ${bundle.kb} KB (${bundle.gzipKb} KB gzip${bundle.measured ? '' : ', fallback — editor not built'})`;

if (check) {
  console.log(`✅ site ok: ${summary}`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
for (const e of fs.readdirSync(OUT)) if (e !== 'app') fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
for (const [rel, content] of files) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
if (!fs.existsSync(path.join(OUT, 'app', 'index.html'))) console.warn('⚠ no app/index.html in the output — run the vite build first (npm run build does both)');
console.log(`wrote ${files.size} files to ${path.relative(process.cwd(), OUT) || '.'}: ${summary}`);
