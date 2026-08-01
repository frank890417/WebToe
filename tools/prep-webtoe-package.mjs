#!/usr/bin/env node
/**
 * Stage the built web app inside the publishable `webtoe` package.
 *
 * `npx webtoe` must serve the editor from the npm tarball alone, so the
 * package carries `public/` (the bridge's findAppDist already looks there).
 * public/ is gitignored — it is a build artifact — but npm's `files`
 * whitelist includes it in the tarball regardless.
 *
 * Run via `npm run release:prep` (which builds first). PUBLISH.md is the
 * full checklist.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/web/dist');
const PUBLIC = join(ROOT, 'packages/bridge/public');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('apps/web/dist is missing — run `npm run build` first (release:prep does both)');
  process.exit(1);
}
rmSync(PUBLIC, { recursive: true, force: true });
cpSync(DIST, PUBLIC, { recursive: true });
console.log(`staged app → packages/bridge/public (ready for: npm publish -w packages/bridge --access public)`);
