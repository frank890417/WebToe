/**
 * The zero-step `.toe` path, end to end.
 *
 * What this proves: a raw binary `.toe` POSTed to the local bridge comes back
 * as importer-ready files and builds the same graph as the committed
 * expansion — i.e. the user really does only have to drop the file.
 *
 * The expansion half needs a TouchDesigner install and auto-skips without one
 * (same policy as toe-binary-local.test.ts). The protocol half runs everywhere.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphFromJSON } from '@webtoe/core';
import { registerAllOps } from '@webtoe/ops';
import { toedirLoader, type ImportFile } from '@webtoe/io';
import { collectImportFiles } from './helpers';
import { createBridgeServer } from '../packages/bridge/index.mjs';
import { findToeexpand } from '../packages/bridge/expand.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOE = join(HERE, 'fixtures', 'tiny.toe');
const toeexpand = findToeexpand();

let base = '';
let server: ReturnType<typeof createBridgeServer>;

beforeAll(async () => {
  registerAllOps();
  server = createBridgeServer();
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((res) => server.close(() => res())));

describe('webtoe-bridge protocol', () => {
  it('identifies itself so the app can tell it apart from any other localhost server', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.service).toBe('webtoe-bridge');
    expect(j.ok).toBe(true);
    // toeexpand may legitimately be absent (CI) — the field must still exist
    expect(Object.hasOwn(j, 'toeexpand')).toBe(true);
  });

  it('answers CORS preflight with the private-network header a hosted page needs', async () => {
    const r = await fetch(`${base}/expand`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects anything that is not a TouchDesigner container', async () => {
    const r = await fetch(`${base}/expand?name=evil.sh`, { method: 'POST', body: 'rm -rf /' });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });

  it('reports a real failure instead of returning an empty graph', async () => {
    const r = await fetch(`${base}/expand?name=notreally.toe`, { method: 'POST', body: 'not a toe file' });
    expect(r.ok).toBe(false);
    const j = await r.json();
    expect(j.ok).toBe(false);
    expect(typeof j.error).toBe('string');
  });
});

describe('webtoe-bridge token gate (non-loopback deployments)', () => {
  let tbase = '';
  let tserver: ReturnType<typeof createBridgeServer>;

  beforeAll(async () => {
    tserver = createBridgeServer({ token: 'sesame' });
    await new Promise<void>((res) => tserver.listen(0, '127.0.0.1', res));
    tbase = `http://127.0.0.1:${(tserver.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((res) => tserver.close(() => res())));

  it('advertises tokenRequired on /health without leaking the token', async () => {
    const j = await (await fetch(`${tbase}/health`)).json();
    expect(j.tokenRequired).toBe(true);
    expect(JSON.stringify(j)).not.toContain('sesame');
  });

  it('rejects /expand without or with a wrong bearer, accepts the right one', async () => {
    const noAuth = await fetch(`${tbase}/expand?name=a.toe`, { method: 'POST', body: 'x' });
    expect(noAuth.status).toBe(401);
    const wrong = await fetch(`${tbase}/expand?name=a.toe`, {
      method: 'POST', body: 'x', headers: { Authorization: 'Bearer nope' },
    });
    expect(wrong.status).toBe(401);
    // right token passes the gate — a garbage body then fails at expansion,
    // proving the request got past auth (any non-401 status)
    const right = await fetch(`${tbase}/expand?name=a.toe`, {
      method: 'POST', body: 'x', headers: { Authorization: 'Bearer sesame' },
    });
    expect(right.status).not.toBe(401);
  });
});

describe.skipIf(!toeexpand)('webtoe-bridge expansion (requires local TouchDesigner)', () => {
  it('turns a dropped binary .toe into the same graph as the committed expansion', async () => {
    const r = await fetch(`${base}/expand?name=tiny.toe`, {
      method: 'POST',
      body: readFileSync(TOE),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { ok: boolean; files: { path: string; text?: string; b64?: string }[] };
    expect(j.ok).toBe(true);

    // rebuild exactly what the browser client does with the response
    const files: ImportFile[] = j.files.map((f) => ({
      path: f.path,
      text: async () => f.text ?? '',
      bytes: async () => (f.b64 !== undefined
        ? new Uint8Array(Buffer.from(f.b64, 'base64'))
        : new TextEncoder().encode(f.text ?? '')),
    }));

    expect(toedirLoader.canLoad(files)).toBe(true);
    const fresh = await toedirLoader.load(files);
    const committed = await toedirLoader.load(collectImportFiles(join(HERE, 'fixtures', 'tiny.expanded')));
    expect(fresh.json).toEqual(committed.json);
    expect(fresh.report).toEqual(committed.report);

    const g = graphFromJSON(fresh.json);
    expect(g.resolve('/project1/noise1', g.root)?.type).toBe('top:noise');
  });

  it('expands a project whose filename is not English', async () => {
    // toeexpand reads paths as Latin-1 and refuses anything else, so the bridge
    // stages under an ASCII name. Without that, every non-English project fails.
    const r = await fetch(`${base}/expand?name=${encodeURIComponent('250330 表演用檔案.toe')}`, {
      method: 'POST',
      body: readFileSync(TOE),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { ok: boolean; files: { path: string }[] };
    expect(j.ok).toBe(true);
    expect(j.files.some((f) => f.path.endsWith('.n'))).toBe(true);
  });
});
