#!/usr/bin/env node
/**
 * webtoe-bridge — the local service that makes `.toe` a first-class drop target.
 *
 *   npx webtoe            # serve the app + bridge, open a browser
 *   npx webtoe-bridge     # bridge only (for the hosted app at github.io)
 *
 * Why this exists: a `.toe` is a proprietary compressed container (re-verified
 * 2026-08-01, docs/RESEARCH.md §1) — no browser can decode it. The official
 * escape hatch is `toeexpand`, which ships with every TouchDesigner install.
 * This bridge runs that tool on the user's own machine so the browser side is
 * a plain drag-and-drop: no terminal, no folder shuffling, no manual step.
 *
 * It ships **zero** Derivative code and no runtime dependencies. It binds to
 * loopback only and does exactly two things: report health, and expand a file
 * it was handed. Parsing lives in `@webtoe/io`, not here.
 */
import { createReadStream, existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandToe, findToeexpand, toeexpandBuild } from './expand.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 9881;
const VERSION = '0.1.0';
/** Largest container we will accept in one request (real projects hit ~100 MB). */
const MAX_UPLOAD = 512 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

/** The built web app, when the bridge runs from a checkout. */
function findAppDist(explicit) {
  const candidates = [explicit, join(HERE, '../../apps/web/dist'), join(HERE, 'public')].filter(Boolean);
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? null;
}

/**
 * CORS that also satisfies Private Network Access: a page on https://…github.io
 * reaching http://127.0.0.1 needs the extra header on the preflight, or Chrome
 * refuses the request. Loopback binding is what keeps this safe.
 */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

/** Buffer the request body to a temp file so a 100 MB project never lives twice in RAM. */
function receiveToFile(req, name) {
  return new Promise((ok, fail) => {
    const dir = mkdtempSync(join(tmpdir(), 'webtoe-upload-'));
    const path = join(dir, name);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) { req.destroy(); fail(new Error('upload too large')); return; }
      chunks.push(c);
    });
    req.on('error', fail);
    req.on('end', () => {
      try { writeFileSync(path, Buffer.concat(chunks)); ok({ dir, path, size }); }
      catch (e) { fail(e); }
    });
  });
}

function serveStatic(res, distDir, urlPath) {
  // strip the app's base path, then contain the result inside distDir
  const rel = urlPath.replace(/^\/WebToe\/?/, '') || 'index.html';
  const target = normalize(join(distDir, rel));
  if (!target.startsWith(resolve(distDir))) { res.writeHead(403); res.end('forbidden'); return; }
  const file = existsSync(target) && statSync(target).isDirectory() ? join(target, 'index.html') : target;
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

export function createBridgeServer({ appDist = null, toeexpand = null, token = null, maxConcurrent = 3 } = {}) {
  const dist = findAppDist(appDist);
  // Serialize heavy work: each expand runs a native child process; on a shared
  // (tunneled/LAN) bridge, unbounded parallel uploads would be a free DoS.
  let activeExpands = 0;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

    if (url.pathname === '/health') {
      const tool = findToeexpand(toeexpand);
      sendJson(res, 200, {
        ok: true, service: 'webtoe-bridge', version: VERSION,
        toeexpand: tool, tdBuild: tool ? toeexpandBuild(tool) : null,
        app: !!dist, tokenRequired: !!token,
      });
      return;
    }

    if (url.pathname === '/expand' && req.method === 'POST') {
      // Optional bearer gate — what makes exposing the bridge beyond loopback
      // (Tailscale / a tunnel) sane. Health stays open so the app can explain
      // "bridge found, token needed" instead of showing a dead endpoint.
      if (token) {
        const auth = req.headers.authorization ?? '';
        if (auth !== `Bearer ${token}`) {
          sendJson(res, 401, { ok: false, error: 'this bridge requires a token — open the app with ?bridgeToken=<token> once' });
          return;
        }
      }
      if (activeExpands >= maxConcurrent) {
        sendJson(res, 429, { ok: false, error: 'bridge is busy — try again in a moment' });
        return;
      }
      const raw = url.searchParams.get('name') ?? 'project.toe';
      const name = raw.split(/[/\\]/).pop().replace(/[^\w.\-@ ()一-鿿]/g, '_');
      if (!/\.(toe|tox)$/i.test(name)) { sendJson(res, 400, { ok: false, error: 'name must end in .toe or .tox' }); return; }
      let staged = null;
      activeExpands++;
      try {
        staged = await receiveToFile(req, name);
        const out = await expandToe(staged.path, { toeexpand });
        sendJson(res, 200, { ok: true, ...out });
      } catch (e) {
        sendJson(res, e?.code === 'NO_TOEEXPAND' ? 501 : 500, { ok: false, error: e.message, code: e?.code ?? null });
      } finally {
        activeExpands--;
        if (staged) rmSync(staged.dir, { recursive: true, force: true });
      }
      return;
    }

    if (req.method === 'GET' && dist) {
      if (url.pathname === '/') { res.writeHead(302, { Location: '/WebToe/' }); res.end(); return; }
      serveStatic(res, dist, url.pathname);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });
}

/** Best-effort browser launch; failure is cosmetic, the URL is already printed. */
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  import('node:child_process')
    .then(({ spawn }) => spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref())
    .catch(() => {});
}

/** npm installs the bin as a symlink (`.bin/webtoe → ../webtoe/index.mjs`), and
 *  path.resolve is lexical — it never follows links. realpathSync does, so the
 *  same file answers as main whether launched directly or through the shim. */
function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain() || process.env.WEBTOE_FORCE_MAIN === '1') {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const port = Number(flag('--port') ?? process.env.WEBTOE_BRIDGE_PORT ?? DEFAULT_PORT);
  const host = flag('--host') ?? process.env.WEBTOE_HOST ?? '127.0.0.1';
  const token = flag('--token') ?? process.env.WEBTOE_TOKEN ?? null;
  const shouldOpen = !args.includes('--no-open');
  const loopback = /^(127\.0\.0\.1|localhost|::1)$/.test(host);

  const server = createBridgeServer({ appDist: flag('--app'), toeexpand: flag('--toeexpand'), token });
  server.listen(port, host, async () => {
    const tool = findToeexpand(flag('--toeexpand'));
    const dist = findAppDist(flag('--app'));
    console.log(`webtoe ${VERSION} → http://${loopback ? '127.0.0.1' : host}:${port}`);
    console.log(tool ? `  toeexpand: ${tool}` : '  toeexpand: NOT FOUND — install TouchDesigner, or pass --toeexpand <path>');
    console.log(dist ? '  serving the app — drop a .toe on the page and it opens' : '  bridge only — use it from https://webtoe.openaudiovisual.com/');
    if (!loopback && !token) {
      console.log('  ⚠️  bound beyond loopback with NO --token: anyone who can reach this port can run');
      console.log('     your toeexpand on files they upload. Set --token (see docs/PUBLISH.md §deploy).');
    }
    if (shouldOpen && dist && loopback) openBrowser(`http://127.0.0.1:${port}/WebToe/`);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `port ${port} is busy — another bridge is probably already running` : e.message);
    process.exit(1);
  });
}
