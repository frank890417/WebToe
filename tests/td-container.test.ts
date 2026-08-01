/**
 * TouchDesigner sidecar framing — the container around `.text` / `.table`.
 *
 * These frames are why real projects imported with empty or garbled DAT bodies
 * before 2026-08-01: the committed fixture is hand-authored plain text, so the
 * fixture layer could never see the problem. Byte layouts below are transcribed
 * from genuine `toeexpand` output (docs/RESEARCH.md §2.2).
 */
import { describe, expect, it } from 'vitest';
import { decodeTdSidecar, isFramedSidecar } from '@webtoe/io';

/** Build a frame the way TouchDesigner writes one. */
function frame(tag: '1' | '2', rows: number, cols: number, values: string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [tag.charCodeAt(0), 0x0a, 0x2a];
  const push32 = (n: number) => parts.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  push32(1); push32(rows); push32(cols); push32(0);
  for (const v of values) {
    const b = enc.encode(v);
    push32(2); push32(b.length);
    parts.push(...b);
  }
  return new Uint8Array(parts);
}

describe('td sidecar container', () => {
  it('recognises the two framed tags and nothing else', () => {
    expect(isFramedSidecar(frame('2', 1, 1, ['x']))).toBe(true);
    expect(isFramedSidecar(frame('1', 1, 1, ['x']))).toBe(true);
    expect(isFramedSidecar(new TextEncoder().encode('plain old text file\n'))).toBe(false);
  });

  it('unwraps a framed text DAT to exactly its payload', () => {
    const body = 'def onValueChange(panelValue, prev):\n\tppar = parent().par\n';
    expect(decodeTdSidecar(frame('2', 1, 1, [body]))).toEqual({ kind: 'text', text: body });
  });

  it('unwraps a framed table DAT into rows and TSV', () => {
    const cells = ['name', 'index', 'Drywet', '0'];
    const out = decodeTdSidecar(frame('1', 2, 2, cells));
    expect(out).toEqual({
      kind: 'table',
      rows: [['name', 'index'], ['Drywet', '0']],
      text: 'name\tindex\nDrywet\t0',
    });
  });

  it('passes unframed text through unchanged (hand-authored expansions)', () => {
    const t = 'hello\nworld\n';
    expect(decodeTdSidecar(new TextEncoder().encode(t))).toEqual({ kind: 'text', text: t });
  });

  it('returns null for genuinely binary payloads rather than mojibake', () => {
    // a .lod-style file: not framed, full of NULs
    expect(decodeTdSidecar(new Uint8Array([4, 7, 0, 0, 0, 89, 46, 98]))).toBeNull();
  });

  it('refuses an implausible header instead of allocating a giant grid', () => {
    const bad = frame('1', 5_000_000, 5_000_000, []);
    expect(decodeTdSidecar(bad)).toBeNull();
  });

  it('stops cleanly when a frame is truncated mid-value', () => {
    const full = frame('1', 2, 2, ['a', 'b', 'c', 'd']);
    const cut = full.subarray(0, full.length - 6);
    const out = decodeTdSidecar(cut);
    // the complete first row survives; the torn one is dropped, not invented
    expect(out?.kind).toBe('table');
    expect((out as { rows: string[][] }).rows[0]).toEqual(['a', 'b']);
  });

  it('renders non-string cells as empty instead of guessing', () => {
    const f = frame('1', 1, 2, ['keep', 'x']);
    f[19 + 3] = 7; // first cell type 2 → 7 (a baked, non-string cell)
    const out = decodeTdSidecar(f) as { rows: string[][] };
    expect(out.rows[0]).toEqual(['', 'x']);
  });
});
