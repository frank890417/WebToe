/**
 * Native `.toe` decoding (research use only — docs/TOE-FORMAT.md), CI-safe.
 *
 * 1. The committed binary fixture decodes byte-for-byte to the committed
 *    `toeexpand` expansion, through both inflaters (web platform and zlib),
 *    and imports to the identical graph.
 * 2. Synthetic containers built here exercise what small fixtures cannot:
 *    multi-segment archives with the directory stack carried across segments,
 *    a chance "10\0" planted in the ciphertext, and a kind-"12" segment whose
 *    archive spans two zlib chunks.
 *
 * Byte-exact comparison against the real `toeexpand` over a corpus of
 * production files runs outside CI (needs TouchDesigner and the files).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';
import { registerAllOps } from '@webtoe/ops';
import {
  TOE_TEA_KEY, assessToeExpansion, decodeToeContainer, isToeContainer, teaDecryptJS, teaDecryptWasm,
  toImportFiles, toedirLoader,
} from '@webtoe/io';
import { teaEncryptJS } from '../packages/io/src/toeBinary';
import { collectImportFiles } from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const zlibInflate = (u: Uint8Array) => zlib.inflateSync(u, { finishFlush: zlib.constants.Z_SYNC_FLUSH });

beforeAll(() => registerAllOps());

// ------------------------------------------------------------ container builder

type Rec = { push: string } | { pop: true } | { file: string; content: Uint8Array | string };
const enc = new TextEncoder();

function records(list: Rec[]): Uint8Array {
  const parts: number[] = [];
  for (const r of list) {
    if ('push' in r) {
      const n = enc.encode(r.push);
      parts.push(0x36, 0x34, n.length + 1, ...n, 0);
    } else if ('pop' in r) {
      parts.push(0x35);
    } else {
      const n = enc.encode(r.file);
      const c = typeof r.content === 'string' ? enc.encode(r.content) : r.content;
      parts.push(0x34, n.length + 1, (c.length >>> 24) & 255, (c.length >>> 16) & 255, (c.length >>> 8) & 255, c.length & 255, ...n, 0, ...c);
    }
  }
  return Uint8Array.from(parts);
}

const pad8 = (u: Uint8Array) => { const out = new Uint8Array((u.length + 7) & ~7); out.set(u); return out; };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((s, x) => s + x.length, 0)); let a = 0; for (const x of p) { o.set(x, a); a += x.length; } return o; };

const be32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

/** kind "10": "10" | payloadLen | rawLen | TEA(zlib) padded to 8. `bogus` writes junk lengths. */
function seg10(blob: Uint8Array, level = 6, bogus = false): Uint8Array {
  const z = pad8(new Uint8Array(zlib.deflateSync(blob, { level })));
  const head = bogus
    ? Uint8Array.of(0x31, 0x30, 0, 0, 1, 2, 3, 4, 5, 6)
    : cat(Uint8Array.of(0x31, 0x30), be32(z.length), be32(blob.length));
  return cat(head, teaEncryptJS(z));
}

/** kind "12": two zlib chunks on one TEA grid, an 8-byte raw chunk header between. */
function seg12(blob: Uint8Array, splitAt: number, bogus = false): Uint8Array {
  const r0 = blob.subarray(0, splitAt), r1 = blob.subarray(splitAt);
  const c0 = pad8(new Uint8Array(zlib.deflateSync(r0)));
  const c1 = pad8(new Uint8Array(zlib.deflateSync(r1)));
  const head = cat(Uint8Array.of(0x31, 0x32), be32(bogus ? 0 : 2), be32(8), be32(c0.length), be32(r0.length));
  const chunkHead = cat(be32(c1.length), be32(r1.length)); // raw, not encrypted
  return cat(head, teaEncryptJS(c0), chunkHead, teaEncryptJS(c1));
}

async function decodeAll(bytes: Uint8Array) {
  const web = await decodeToeContainer(bytes);
  const z = await decodeToeContainer(bytes, { inflate: zlibInflate });
  expect([...web.files.keys()]).toEqual([...z.files.keys()]);
  return web;
}


// ------------------------------------------------------------ tests

describe('native .toe decoding', () => {
  it('TEA: WASM kernel matches the JS reference and encryption round-trips', () => {
    const r = new Uint8Array(4099);
    for (let i = 0; i < r.length; i++) r[i] = (i * 2654435761) >>> 24;
    const js = teaDecryptJS(r.slice());
    const wasm = teaDecryptWasm(r.slice());
    expect(wasm).not.toBeNull();
    expect(Buffer.from(wasm!).equals(Buffer.from(js))).toBe(true);
    expect(Buffer.from(teaEncryptJS(js.slice())).equals(Buffer.from(r))).toBe(true);
    expect(Buffer.from(r.subarray(4096)).equals(Buffer.from(js.subarray(4096)))).toBe(true); // tail stays raw
    expect(TOE_TEA_KEY.length).toBe(4);
  });

  it('decodes the committed fixture byte-for-byte to the toeexpand expansion', async () => {
    const bytes = new Uint8Array(readFileSync(join(FIX, 'tiny.toe')));
    expect(isToeContainer(bytes)).toBe(true);
    const res = await decodeAll(bytes);
    const truth = await collectImportFiles(join(FIX, 'tiny.expanded'));
    expect([...res.files.keys()].sort()).toEqual(truth.map((f) => f.path).sort());
    for (const f of truth) {
      const mine = res.files.get(f.path)!;
      const want = await f.bytes!();
      expect(Buffer.from(mine).equals(Buffer.from(want)), f.path).toBe(true);
    }
    expect(res.segments).toBe(1);
    expect(assessToeExpansion([...res.files.keys()])).toBeNull();
  });

  it('imports the decoded fixture to the same graph as the expansion folder', async () => {
    const res = await decodeToeContainer(new Uint8Array(readFileSync(join(FIX, 'tiny.toe'))));
    const viaNative = await toedirLoader.load(toImportFiles(res.files));
    const viaFolder = await toedirLoader.load(await collectImportFiles(join(FIX, 'tiny.expanded')));
    expect(viaNative.json).toEqual(viaFolder.json);
    expect(viaNative.json.meta?.cookRate).toBe(60); // from .start: "cookrate 60"
    expect(viaNative.report).toEqual(viaFolder.report);
  });

  it('carries the directory stack across segments', async () => {
    const a = records([{ file: '.build', content: 'version 099' }, { push: 'project1' }, { file: 'noise1.n', content: 'TOP:noise' }]);
    const b = records([{ file: 'level1.n', content: 'TOP:level' }, { pop: true }, { file: 'TRAILER!!!', content: '' }]);
    const res = await decodeAll(cat(seg10(a), seg10(b)));
    expect([...res.files.keys()]).toEqual(['.build', 'project1/noise1.n', 'project1/level1.n']);
    expect(res.segments).toBe(2);
    expect(res.kinds).toEqual(['10']);
  });

  it('skips a chance "10\\0" inside the ciphertext', async () => {
    // A stored (level 0) deflate block copies content verbatim, so choosing the
    // plaintext of one TEA block chooses its ciphertext: plant "10\0" there.
    const content = new Uint8Array(64).fill(0x41);
    const head = records([{ file: '.build', content: 'v' }, { push: 'p' }]);
    const nameLen = 'blob.bin'.length + 1;
    // zlib stream: 2-byte header + 5-byte stored-block header, then the records
    const recStart = 2 + 5 + head.length + 6 + nameLen; // where `content` lands in the stream
    const blockAt = (recStart + 7) & ~7;                 // first whole TEA block inside it
    const cipher = Uint8Array.of(0x10, 0x31, 0x30, 0x00, 0x55, 0x66, 0x77, 0x88);
    content.set(teaDecryptJS(cipher.slice()), blockAt - recStart);
    const blob = cat(head, records([{ file: 'blob.bin', content }, { pop: true }]));
    const container = seg10(blob, 0, true); // junk length fields: force the recovery walk
    const planted = Buffer.from(container).indexOf(Buffer.from([0x31, 0x30, 0x00]), 1);
    expect(planted).toBeGreaterThan(10); // the chance match really is in the ciphertext
    const res = await decodeAll(cat(container, seg10(records([{ file: 'x.n', content: 'TOP:null' }, { file: 'TRAILER!!!', content: '' }]))));
    expect(res.recovered).toBe(1);
    expect(Buffer.from(res.files.get('p/blob.bin')!).equals(Buffer.from(content))).toBe(true);
    expect(res.files.has('x.n')).toBe(true);
  });

  it('decodes a kind-"12" segment whose archive spans two zlib chunks', async () => {
    const big = new Uint8Array(70_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
    const blob = records([
      { file: '.build', content: 'version 099' }, { push: 'project1' },
      { file: 'table1.table', content: big }, { file: 'noise1.n', content: 'TOP:noise' },
    ]);
    const tail = records([{ file: 'level1.n', content: 'TOP:level' }, { pop: true }, { file: 'TRAILER!!!', content: '' }]);
    const res = await decodeAll(cat(seg12(blob, 40_000), seg10(tail))); // split lands inside table1.table
    expect([...res.files.keys()]).toEqual(['.build', 'project1/table1.table', 'project1/noise1.n', 'project1/level1.n']);
    expect(Buffer.from(res.files.get('project1/table1.table')!).equals(Buffer.from(big))).toBe(true);
    expect(res.kinds).toEqual(['12', '10']);
    expect(res.recovered).toBe(0);
    // the recovery walk (length fields ignored) reaches the identical file set
    const rec = await decodeAll(cat(seg12(blob, 40_000, true), seg10(tail, 6, true)));
    expect(rec.recovered).toBe(2);
    expect([...rec.files]).toEqual([...res.files]);
  });

  it('rejects files that are not TouchDesigner containers', async () => {
    await expect(decodeToeContainer(enc.encode('{"app":"webtoe"}'))).rejects.toThrow(/not a TouchDesigner container/);
    expect(assessToeExpansion(['a.txt'])).toMatch(/\.build/);
  });
});
