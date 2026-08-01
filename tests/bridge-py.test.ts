/**
 * bridge.py protocol parity — the Python edition must be indistinguishable
 * from the Node bridge to the app's client (`packages/io/src/bridge.ts`).
 *
 * bridge.py exists for TouchDesigner users without Node: every TD install
 * ships a Python interpreter, so the single stdlib-only file is the
 * zero-extra-install path. It is served from the hosted app at /WebToe/bridge.py.
 *
 * Auto-skips when no python3 is on PATH (the file itself targets 3.8+ and,
 * on user machines, TD's bundled 3.11 — verified by hand 2026-08-01).
 * Expansion behavior with a real toeexpand is covered by the Node-bridge
 * suite; here we pin the wire protocol: /health shape, CORS/PNA preflight,
 * input validation, and the token gate.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'apps', 'web', 'public', 'bridge.py');
const hasPython = spawnSync('python3', ['--version']).status === 0;

const PORT = 9300 + (process.pid % 500);
const TPORT = PORT + 1;
let procs: ChildProcess[] = [];

async function waitHealthy(port: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`python bridge on :${port} never became healthy`);
}

describe.skipIf(!hasPython)('bridge.py protocol parity (python edition)', () => {
  beforeAll(async () => {
    procs = [
      spawn('python3', [SCRIPT, '--port', String(PORT)], { stdio: 'ignore' }),
      spawn('python3', [SCRIPT, '--port', String(TPORT), '--token', 'sesame'], { stdio: 'ignore' }),
    ];
    await Promise.all([waitHealthy(PORT), waitHealthy(TPORT)]);
  }, 20_000);

  afterAll(() => { for (const p of procs) p.kill(); });

  it('answers /health with the exact shape the client checks', async () => {
    const j = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    expect(j.service).toBe('webtoe-bridge'); // the client's identity check
    expect(j.ok).toBe(true);
    expect(Object.hasOwn(j, 'toeexpand')).toBe(true);
    expect(Object.hasOwn(j, 'tdBuild')).toBe(true);
    expect(j.tokenRequired).toBe(false);
  });

  it('carries the private-network CORS headers a hosted HTTPS page needs', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/expand`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('rejects non-TouchDesigner names like the Node bridge', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/expand?name=evil.sh`, { method: 'POST', body: 'x' });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });

  it('enforces the same bearer-token gate', async () => {
    const health = await (await fetch(`http://127.0.0.1:${TPORT}/health`)).json();
    expect(health.tokenRequired).toBe(true);
    expect(JSON.stringify(health)).not.toContain('sesame');

    const noAuth = await fetch(`http://127.0.0.1:${TPORT}/expand?name=a.toe`, { method: 'POST', body: 'x' });
    expect(noAuth.status).toBe(401);
    const right = await fetch(`http://127.0.0.1:${TPORT}/expand?name=a.toe`, {
      method: 'POST', body: 'x', headers: { Authorization: 'Bearer sesame' },
    });
    expect(right.status).not.toBe(401); // past the gate; garbage body fails later, honestly
  });
});
