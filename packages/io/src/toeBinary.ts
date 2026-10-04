/**
 * Native `.toe` / `.tox` container decoder — no TouchDesigner install, no bridge.
 *
 * ⚠️ RESEARCH USE ONLY. This decoder exists to study interoperability with
 * project files you own. It is not affiliated with or endorsed by Derivative
 * Inc.; the container format is theirs and may change in any TouchDesigner
 * release. The `toeexpand` bridge path stays the reference and the fallback.
 *
 * Format (full spec with provenance: docs/TOE-FORMAT.md):
 *
 *   file = SEGMENT+                                    (all integers big-endian)
 *   kind "10": "10" | u32 payloadLen | u32 rawLen | payload
 *   kind "12": "12" | u32 chunks | u32 8 | u32 payloadLen₀ | u32 rawLen₀ | payload₀
 *              { u32 payloadLenᵢ | u32 rawLenᵢ | payloadᵢ }   (header raw, 8 bytes)
 *              — large archives, split into chunks of ≤ 128 MiB of output
 *   payload = TEA-ECB(zlib stream), padded to 8 bytes; payloadLen counts the
 *             padding, rawLen is the inflated size.
 *   TEA     = standard Tiny Encryption Algorithm: 32 rounds, delta 0x9E3779B9,
 *             128-bit key, little-endian word pairs, 8-byte blocks.
 *   inflate(payload…) = archive records (a record may straddle chunks):
 *     0x34 file : [tag][u8 nameLen][u32 contentLen][name\0][content]
 *     0x36 push : [tag][0x34][u8 nameLen][name\0]     enter subdirectory
 *     0x35 pop  : [tag]                               leave subdirectory
 *   A file record named "TRAILER!!!" closes the archive.
 *
 * Rules that matter in practice:
 *   1. The directory stack persists across segments. Resetting it per segment
 *      silently flattens large projects.
 *   2. Every chunk is checked: its inflated size must equal rawLen, and the
 *      next segment must start where the lengths say. If a segment's fields do
 *      not check out (an unknown variant), it is recovered without them: the
 *      zlib streams are walked by their Adler-32 trailers on the TEA block grid
 *      and chance "1?\0" matches in the ciphertext are rejected.
 *
 * Platform-neutral: Uint8Array in, Uint8Array out. Inflate defaults to the web
 * platform's DecompressionStream (browsers, Node ≥ 18); Node callers may pass a
 * faster zlib-backed one. TEA runs in a 700-byte WASM kernel when WebAssembly is
 * available (~7× the JS speed) and in JS otherwise.
 */
import type { ImportFile } from './toedir';
import { TEA_WASM_BASE64 } from './teaWasm';

/** The 128-bit TEA key of the container format (little-endian u32 words). */
export const TOE_TEA_KEY: Readonly<Uint32Array> = Uint32Array.of(
  0x9241fa3a, 0x59f32012, 0xc612aa09, 0xa98123d4,
);
const DELTA = 0x9e3779b9;
const TAG_FILE = 0x34, TAG_PUSH = 0x36, TAG_POP = 0x35;
const TRAILER = 'TRAILER!!!';

export type Inflate = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array;
export type TeaDecrypt = (data: Uint8Array) => Uint8Array;

export interface ToeDecodeOptions {
  /** zlib inflate that tolerates trailing bytes after the stream end. */
  inflate?: Inflate;
  /** In-place TEA decryption over whole 8-byte blocks. Default: WASM, else JS. */
  teaDecrypt?: TeaDecrypt;
  /** Progress in bytes of the container consumed. */
  onProgress?: (bytesDone: number, bytesTotal: number) => void;
}

export interface ToeDecodeResult {
  /** relative path → content, the same file set `toeexpand` writes. */
  files: Map<string, Uint8Array>;
  segments: number;
  /** segment kinds present, e.g. ["10", "12"] */
  kinds: string[];
  /** segments whose length fields did not check out and were recovered by
   *  walking their zlib streams (0 on every file seen so far) */
  recovered: number;
  tea: 'wasm' | 'js' | 'custom';
  ms: number;
}

/** Cheap sniff: the file opens with a segment kind "1?" (no decryption). */
export function isToeContainer(bytes: Uint8Array): boolean {
  return bytes.length > 10 && bytes[0] === 0x31 && bytes[1] >= 0x30 && bytes[1] <= 0x39;
}

// ---------------------------------------------------------------- TEA

/** Reference TEA decryption (in place, whole blocks only). */
export function teaDecryptJS(u8: Uint8Array, k: ArrayLike<number> = TOE_TEA_KEY): Uint8Array {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const whole = u8.length - (u8.length % 8);
  const k0 = k[0] >>> 0, k1 = k[1] >>> 0, k2 = k[2] >>> 0, k3 = k[3] >>> 0;
  for (let off = 0; off < whole; off += 8) {
    let v0 = dv.getUint32(off, true);
    let v1 = dv.getUint32(off + 4, true);
    let sum = (DELTA * 32) >>> 0;
    for (let r = 0; r < 32; r++) {
      v1 = (v1 - ((((v0 << 4) + k2) >>> 0) ^ ((v0 + sum) >>> 0) ^ (((v0 >>> 5) + k3) >>> 0))) >>> 0;
      v0 = (v0 - ((((v1 << 4) + k0) >>> 0) ^ ((v1 + sum) >>> 0) ^ (((v1 >>> 5) + k1) >>> 0))) >>> 0;
      sum = (sum - DELTA) >>> 0;
    }
    dv.setUint32(off, v0, true);
    dv.setUint32(off + 4, v1, true);
  }
  return u8;
}

/** Inverse of teaDecryptJS — used by tests to build synthetic containers. */
export function teaEncryptJS(u8: Uint8Array, k: ArrayLike<number> = TOE_TEA_KEY): Uint8Array {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const whole = u8.length - (u8.length % 8);
  const k0 = k[0] >>> 0, k1 = k[1] >>> 0, k2 = k[2] >>> 0, k3 = k[3] >>> 0;
  for (let off = 0; off < whole; off += 8) {
    let v0 = dv.getUint32(off, true);
    let v1 = dv.getUint32(off + 4, true);
    let sum = 0;
    for (let r = 0; r < 32; r++) {
      sum = (sum + DELTA) >>> 0;
      v0 = (v0 + ((((v1 << 4) + k0) >>> 0) ^ ((v1 + sum) >>> 0) ^ (((v1 >>> 5) + k1) >>> 0))) >>> 0;
      v1 = (v1 + ((((v0 << 4) + k2) >>> 0) ^ ((v0 + sum) >>> 0) ^ (((v0 >>> 5) + k3) >>> 0))) >>> 0;
    }
    dv.setUint32(off, v0, true);
    dv.setUint32(off + 4, v1, true);
  }
  return u8;
}

interface TeaKernel {
  memory: WebAssembly.Memory;
  ensureCapacity(bytes: number): number;
  teaDecrypt(ptr: number, len: number, k0: number, k1: number, k2: number, k3: number): number;
}
let kernel: TeaKernel | null | undefined;

function loadKernel(): TeaKernel | null {
  if (kernel !== undefined) return kernel;
  try {
    const bin = Uint8Array.from(atob(TEA_WASM_BASE64), (c) => c.charCodeAt(0));
    // < 4 KB, so synchronous compilation is allowed on the browser main thread
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bin), {
      env: { abort: () => { throw new Error('tea.wasm abort'); } },
    });
    kernel = inst.exports as unknown as TeaKernel;
  } catch {
    kernel = null;
  }
  return kernel;
}

/** TEA decryption through the WASM kernel; null when WebAssembly is unavailable. */
export function teaDecryptWasm(u8: Uint8Array, k: ArrayLike<number> = TOE_TEA_KEY): Uint8Array | null {
  const kn = loadKernel();
  if (!kn) return null;
  const base = kn.ensureCapacity(u8.length);
  const mem = new Uint8Array(kn.memory.buffer, base, u8.length);
  mem.set(u8);
  kn.teaDecrypt(base, u8.length, k[0] | 0, k[1] | 0, k[2] | 0, k[3] | 0);
  u8.set(new Uint8Array(kn.memory.buffer, base, u8.length));
  return u8;
}

// ---------------------------------------------------------------- inflate

/**
 * zlib inflate on the web platform. The TEA padding leaves up to 7 bytes after
 * the zlib stream, which DecompressionStream reports as an error after it has
 * produced the full output — so output followed by an error is accepted, and
 * completeness is judged by the record parser, not by the stream.
 */
export async function inflateWeb(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch (err) {
    if (!total) throw err;
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ---------------------------------------------------------------- integrity

/** zlib's Adler-32 over `u8`. */
export function adler32(u8: Uint8Array): number {
  let a = 1, b = 0, i = 0;
  const n = u8.length;
  while (i < n) {
    const end = Math.min(i + 5552, n); // largest run before the sums can overflow 2^53
    for (; i < end; i++) { a += u8[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Where the zlib stream inside `plain` ends, given its inflated output `blob`:
 * the offset just past its big-endian Adler-32 trailer. `accept(end)` vets each
 * occurrence of the checksum bytes (the next segment must start where the
 * block-padded stream ends), so a chance match inside the compressed data is
 * skipped. Returns -1 when the stream is truncated.
 */
function streamEnd(plain: Uint8Array, blob: Uint8Array, accept: (end: number) => boolean): number {
  const ad = adler32(blob);
  const b0 = ad >>> 24, b1 = (ad >>> 16) & 255, b2 = (ad >>> 8) & 255, b3 = ad & 255;
  for (let at = 2; at + 4 <= plain.length; at++) {
    if (plain[at] === b0 && plain[at + 1] === b1 && plain[at + 2] === b2 && plain[at + 3] === b3
      && accept(at + 4)) return at + 4;
  }
  return -1;
}

/** A valid zlib header (RFC 1950): deflate, window ≤ 32K, FCHECK passes. */
function isZlibHeader(b0: number, b1: number): boolean {
  return (b0 & 0x0f) === 8 && (b0 >> 4) <= 7 && ((b0 << 8) | b1) % 31 === 0;
}

/**
 * Lazily decrypted view of the file from `from` on, on that offset's TEA
 * block grid. ECB blocks are independent, so decrypting piecewise (in whole
 * blocks) equals decrypting at once; the final < 8 bytes at EOF stay raw.
 */
function gridPlaintext(bytes: Uint8Array, from: number, decrypt: TeaDecrypt) {
  const max = bytes.length - from;
  let buf = new Uint8Array(0);
  let filled = 0;
  return {
    ensure(upto: number): Uint8Array {
      let want = Math.min(max, upto);
      if (want < max) want = Math.min(max, (want + 7) & ~7);
      if (want > filled) {
        if (want > buf.length) {
          const grown = new Uint8Array(Math.min(max, Math.max(want, buf.length * 2)));
          grown.set(buf.subarray(0, filled));
          buf = grown;
        }
        buf.set(decrypt(bytes.slice(from + filled, from + want)), filled);
        filled = want;
      }
      return buf.subarray(0, filled);
    },
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---------------------------------------------------------------- records

const utf8 = new TextDecoder('utf-8');

interface Parsed { entries: [string, Uint8Array][]; stack: string[]; closed: boolean }

/**
 * Parse one segment's archive records. Returns null unless the blob is a
 * well-formed record list that ends exactly at the end of the blob (and has
 * nothing after a TRAILER!!! record).
 */
function parseSegment(blob: Uint8Array, stackIn: readonly string[]): Parsed | null {
  const stack = [...stackIn];
  const entries: [string, Uint8Array][] = [];
  const N = blob.length;
  let i = 0;
  let closed = false;
  while (i < N) {
    if (closed) return null; // records after the trailer: not a segment boundary
    const tag = blob[i];
    if (tag === TAG_FILE) {
      if (i + 6 > N) return null;
      const nameLen = blob[i + 1];
      const len = ((blob[i + 2] << 24) | (blob[i + 3] << 16) | (blob[i + 4] << 8) | blob[i + 5]) >>> 0;
      i += 6;
      if (nameLen < 1 || i + nameLen + len > N || blob[i + nameLen - 1] !== 0) return null;
      const name = utf8.decode(blob.subarray(i, i + nameLen - 1));
      i += nameLen;
      const content = blob.subarray(i, i + len);
      i += len;
      if (name === TRAILER) closed = true;
      else entries.push([stack.length ? `${stack.join('/')}/${name}` : name, content]);
    } else if (tag === TAG_PUSH) {
      if (i + 3 > N) return null;
      const nameLen = blob[i + 2];
      i += 3;
      if (nameLen < 1 || i + nameLen > N || blob[i + nameLen - 1] !== 0) return null;
      stack.push(utf8.decode(blob.subarray(i, i + nameLen - 1)));
      i += nameLen;
    } else if (tag === TAG_POP) {
      if (!stack.length) return null;
      stack.pop();
      i += 1;
    } else {
      return null;
    }
  }
  return { entries, stack, closed };
}

// ---------------------------------------------------------------- decode

/** Decode a whole `.toe`/`.tox` into the file set `toeexpand` would write. */
export async function decodeToeContainer(
  bytes: Uint8Array, opts: ToeDecodeOptions = {},
): Promise<ToeDecodeResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!isToeContainer(bytes)) throw new Error('not a TouchDesigner container (no segment magic)');

  let tea: ToeDecodeResult['tea'] = 'custom';
  let decrypt = opts.teaDecrypt;
  if (!decrypt) {
    if (loadKernel()) { tea = 'wasm'; decrypt = (u) => teaDecryptWasm(u)!; }
    else { tea = 'js'; decrypt = (u) => teaDecryptJS(u); }
  }
  const inflate = opts.inflate ?? inflateWeb;

  const len = bytes.length;
  const be32 = (p: number) => ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
  const isSegmentAt = (p: number) => p + 2 <= len && bytes[p] === 0x31 && bytes[p + 1] >= 0x30 && bytes[p + 1] <= 0x39;

  type Segment = { blob: Uint8Array; next: number };

  /** Read a segment by its length fields (kinds "10", "12"); null if they do not check out. */
  const framed = async (o: number): Promise<Segment | null> => {
    const kind = bytes[o + 1] - 0x30;
    const chunks: { at: number; clen: number; ulen: number }[] = [];
    let next: number;
    if (kind === 0) {
      if (o + 10 > len) return null;
      chunks.push({ at: o + 10, clen: be32(o + 2), ulen: be32(o + 6) });
      next = o + 10 + chunks[0].clen;
    } else if (kind === 2) {
      if (o + 18 > len) return null;
      const count = be32(o + 2);
      if (count < 1 || count > 65536) return null;
      let at = o + 18, clen = be32(o + 10), ulen = be32(o + 14);
      for (let i = 0; i < count; i++) {
        chunks.push({ at, clen, ulen });
        at += clen;
        if (i < count - 1) {
          if (at + 8 > len) return null;
          clen = be32(at); ulen = be32(at + 4); at += 8;
        }
      }
      next = at;
    } else {
      return null;
    }
    if (next > len || (next < len && !isSegmentAt(next))) return null;
    const outs: Uint8Array[] = [];
    for (const c of chunks) {
      if (c.clen < 2 || c.at + c.clen > len) return null;
      let blob: Uint8Array;
      try { blob = await inflate(decrypt(bytes.slice(c.at, c.at + c.clen))); } catch { return null; }
      if (blob.length !== c.ulen) return null;
      outs.push(blob);
    }
    return { blob: concat(outs), next };
  };

  // ---- recovery path: no trust in the length fields
  let starts: number[] | null = null;
  const isMagicAt = (p: number) => isSegmentAt(p) && p + 3 <= len && bytes[p + 2] === 0x00;
  const nextStart = (after: number) => {
    starts ??= (() => { const s: number[] = []; for (let p = 1; p + 3 <= len; p++) if (isMagicAt(p)) s.push(p); return s; })();
    let lo = 0, hi = starts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] <= after) lo = m + 1; else hi = m; }
    return lo < starts.length ? starts[lo] : len;
  };
  /** Header length: known kinds first, else the first that opens a zlib stream. */
  const headerLength = (o: number): number => {
    const kind = bytes[o + 1] - 0x30;
    const known = kind === 0 ? 10 : kind === 2 ? 18 : 0;
    const opens = (h: number) => {
      if (o + h + 8 > len) return false;
      const b = decrypt(bytes.slice(o + h, o + h + 8));
      return isZlibHeader(b[0], b[1]);
    };
    if (known && opens(known)) return known;
    for (let h = 8; h <= 64; h += 2) if (opens(h)) return h;
    throw new Error(`segment at byte ${o}: unknown container segment kind "1${kind}"`);
  };
  /**
   * Walk a segment's chain of zlib streams on one TEA block grid without its
   * length fields: each stream ends where its Adler-32 trailer is followed, at
   * the next block boundary, by EOF, a segment start, or another chunk.
   */
  const recover = async (o: number): Promise<Segment> => {
    const from = o + headerLength(o);
    const plain = gridPlaintext(bytes, from, decrypt);
    const outputs: Uint8Array[] = [];
    let pos = 0;
    for (;;) {
      const chunkAt = pos;
      const vet = (end: number) => {
        const n = from + chunkAt + ((end + 7) & ~7);
        if (n >= len || isSegmentAt(n)) return true;
        const view = plain.ensure(n - from + 10);
        return n - from + 10 <= view.length && isZlibHeader(view[n - from + 8], view[n - from + 9]);
      };
      // read window: up to the next candidate start, then doubling
      let win = Math.max(64, nextStart(from + pos) - from - pos);
      let found = -1;
      let blob: Uint8Array | null = null;
      for (;;) {
        const view = plain.ensure(pos + win);
        const data = view.subarray(pos, pos + Math.min(win, view.length - pos));
        try {
          blob = await inflate(data);
          found = streamEnd(data, blob, vet);
        } catch {
          found = -1;
        }
        if (found >= 0 || from + pos + data.length >= len) break;
        win = Math.max(win * 2, nextStart(from + pos + data.length) - from - pos);
      }
      if (found < 0 || !blob) throw new Error(`segment at byte ${o}: no complete zlib stream at +${pos}`);
      outputs.push(blob);
      const n = from + pos + ((found + 7) & ~7);
      if (n >= len || isSegmentAt(n)) return { blob: concat(outputs), next: n };
      pos = n - from + 8; // skip the raw chunk header
    }
  };

  const files = new Map<string, Uint8Array>();
  const kinds = new Set<string>();
  let stack: string[] = [];
  let segments = 0;
  let recovered = 0;
  let o = 0;
  let closed = false;

  while (o < len && !closed) {
    if (!isSegmentAt(o)) throw new Error(`segment ${segments + 1}: no segment magic at byte ${o}`);
    kinds.add(String.fromCharCode(bytes[o], bytes[o + 1]));
    let seg = await framed(o);
    if (!seg) { seg = await recover(o); recovered++; }
    const parsed = parseSegment(seg.blob, stack);
    if (!parsed) throw new Error(`segment ${segments + 1} (byte ${o}): records do not parse`);
    segments++;
    stack = parsed.stack;
    closed = parsed.closed;
    for (const [path, content] of parsed.entries) files.set(uniquePath(files, path), content);
    opts.onProgress?.(Math.min(seg.next, len), len);
    o = seg.next;
  }

  if (!files.size) throw new Error('decoded no files — unexpected container layout');
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { files, segments, kinds: [...kinds], recovered, tea, ms: Math.round(t1 - t0) };
}

/**
 * Duplicate names inside one directory (TouchDesigner allows them across
 * internal tables) get toeexpand's numbered suffix.
 */
function uniquePath(files: Map<string, Uint8Array>, path: string): string {
  if (!files.has(path)) return path;
  let n = 2;
  while (files.has(`${path}.${n}`)) n++;
  return `${path}.${n}`;
}

/**
 * Structural sanity check on a decoded file set. Returns null when it looks
 * like a TouchDesigner expansion, else a human-readable reason — callers then
 * fall back to the bridge instead of importing a wrong graph.
 */
export function assessToeExpansion(paths: readonly string[]): string | null {
  if (!paths.includes('.build')) return 'no .build record';
  if (!paths.some((p) => p.endsWith('.n'))) return 'no node (.n) records';
  return null;
}

/** Wrap a decoded file set as importer-ready files (what toedirLoader consumes). */
export function toImportFiles(files: Map<string, Uint8Array>): ImportFile[] {
  return [...files].map(([path, content]) => ({
    path,
    text: async () => utf8.decode(content),
    bytes: async () => content,
  }));
}
