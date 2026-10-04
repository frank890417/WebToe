/**
 * `npx webtoe` serves the built site: the homepage at /, the editor at /app/
 * (and opens it there), legacy /WebToe/ URLs redirected, directories
 * normalised to a trailing slash, and nothing outside the dist directory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeServer, editorPath } from '../packages/bridge/index.mjs';

let dir = '';
let base = '';
let server: ReturnType<typeof createBridgeServer>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webtoe-site-'));
  mkdirSync(join(dir, 'app'));
  mkdirSync(join(dir, 'docs', 'operators'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), 'HOME');
  writeFileSync(join(dir, '404.html'), 'NOT FOUND PAGE');
  writeFileSync(join(dir, 'app', 'index.html'), 'EDITOR');
  writeFileSync(join(dir, 'docs', 'operators', 'index.html'), 'OPS');
  server = createBridgeServer({ appDist: dir });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (p: string) => fetch(base + p, { redirect: 'manual' });

describe('bridge serving the site', () => {
  it('serves the homepage at / and the editor at /app/', async () => {
    expect(await (await get('/')).text()).toBe('HOME');
    expect(await (await get('/app/')).text()).toBe('EDITOR');
    expect(await (await get('/docs/operators/')).text()).toBe('OPS');
  });

  it('adds the trailing slash to directories, keeping the query', async () => {
    const r = await get('/app?project=a.json');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/app/?project=a.json');
  });

  it('redirects the legacy /WebToe/ prefix to the editor', async () => {
    const r = await get('/WebToe/?bridge=http://x');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/app/?bridge=http://x');
    expect((await get('/WebToe')).headers.get('location')).toBe('/app/');
  });

  it('answers unknown paths with the site 404 page', async () => {
    const r = await get('/no/such/page');
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('NOT FOUND PAGE');
  });

  it('never serves files outside the dist directory', async () => {
    for (const p of ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd']) {
      const r = await get(p);
      expect([400, 403, 404]).toContain(r.status);
    }
  });

  it('opens the editor at /app/ for current builds and at / for old flat ones', () => {
    expect(editorPath(dir)).toBe('/app/');
    const flat = mkdtempSync(join(tmpdir(), 'webtoe-flat-'));
    writeFileSync(join(flat, 'index.html'), 'OLD EDITOR');
    expect(editorPath(flat)).toBe('/');
    rmSync(flat, { recursive: true, force: true });
  });
});
