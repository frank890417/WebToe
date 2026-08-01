/**
 * Client for `webtoe-bridge` — the local service that expands a `.toe` with
 * the user's own TouchDesigner `toeexpand`.
 *
 * The browser cannot decode a `.toe` itself: the container is proprietary and
 * compressed (re-verified 2026-08-01 — docs/RESEARCH.md §1). Rather than make
 * the user run a CLI and shuffle folders, the app asks a loopback service to
 * do the one step only a TD install can do, and gets back the same text files
 * a `.toe.dir` drop would have produced. From `toedirLoader`'s point of view
 * nothing changed — this module only *sources* the files.
 *
 * Everything here degrades: no bridge → the caller falls back to the manual
 * path, and the app keeps working exactly as before.
 */
import type { ImportFile } from './toedir';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:9881';
const STORAGE_KEY = 'webtoe.bridgeUrl';
const TOKEN_KEY = 'webtoe.bridgeToken';

export interface BridgeInfo {
  url: string;
  version: string;
  /** Absolute path of the toeexpand the bridge found, or null if TD is missing. */
  toeexpand: string | null;
  tdBuild: string | null;
  /** Bridge is bound beyond loopback and expects `?bridgeToken=` (sent as a bearer). */
  tokenRequired: boolean;
}

export interface BridgeExpansion {
  name: string;
  files: ImportFile[];
  /** Binary sidecars and oversized files the bridge deliberately left out. */
  skipped: { path: string; reason: string; size: number }[];
  ms: number;
}

/** Explicit override wins, then a bridge serving this very page, then loopback. */
export function bridgeCandidates(): string[] {
  const out: string[] = [];
  try {
    const params = new URLSearchParams(location.search);
    // ?bridgeToken= pairs a shared (tunneled/LAN) bridge with its bearer —
    // saved once, sent on every /expand from then on.
    const tok = params.get('bridgeToken');
    if (tok) localStorage.setItem(TOKEN_KEY, tok);
    const q = params.get('bridge');
    if (q) out.push(q.replace(/\/$/, ''));
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) out.push(saved.replace(/\/$/, ''));
    // served by the bridge itself (npx webtoe) → same origin, no CORS at all
    if (/^https?:$/.test(location.protocol) && location.hostname.match(/^(127\.0\.0\.1|localhost|\[::1\])$/)) {
      out.push(location.origin);
    }
  } catch { /* non-browser context */ }
  out.push(DEFAULT_BRIDGE_URL);
  return [...new Set(out)];
}

export function rememberBridge(url: string): void {
  try { localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, '')); } catch { /* private mode */ }
}

async function health(url: string, timeoutMs: number): Promise<BridgeInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, { signal: ctl.signal, mode: 'cors' });
    if (!res.ok) return null;
    const j = await res.json() as {
      service?: string; version?: string; toeexpand?: string | null; tdBuild?: string | null; tokenRequired?: boolean;
    };
    if (j.service !== 'webtoe-bridge') return null;
    return {
      url, version: j.version ?? '?', toeexpand: j.toeexpand ?? null,
      tdBuild: j.tdBuild ?? null, tokenRequired: !!j.tokenRequired,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is a bridge listening? Probed in candidate order, first answer wins.
 * Deliberately short-timeout: this runs on the drop path and must not stall
 * the UI when nothing is listening.
 */
export async function probeBridge(timeoutMs = 700): Promise<BridgeInfo | null> {
  for (const url of bridgeCandidates()) {
    const info = await health(url, timeoutMs);
    if (info) { rememberBridge(url); return info; }
  }
  return null;
}

/** Base64 → bytes, for the framed `.text`/`.table` sidecars the bridge cannot
 *  send as JSON strings. */
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** POST the container, get the expansion back as importer-ready files. */
export async function expandViaBridge(file: File, info: BridgeInfo): Promise<BridgeExpansion> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  try {
    const tok = localStorage.getItem(TOKEN_KEY);
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* private mode */ }
  const res = await fetch(`${info.url}/expand?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    mode: 'cors',
    headers,
    body: file,
  });
  const body = await res.json().catch(() => null) as
    | {
      ok?: boolean; error?: string; name?: string; ms?: number;
      files?: { path: string; text?: string; b64?: string }[];
      skipped?: BridgeExpansion['skipped'];
    }
    | null;
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `bridge returned ${res.status}`);
  const encoder = new TextEncoder();
  return {
    name: body.name ?? file.name,
    ms: body.ms ?? 0,
    skipped: body.skipped ?? [],
    files: (body.files ?? []).map((f) => ({
      path: f.path,
      text: async () => f.text ?? '',
      bytes: async () => (f.b64 !== undefined ? fromBase64(f.b64) : encoder.encode(f.text ?? '')),
    })),
  };
}
