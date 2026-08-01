/**
 * TouchDesigner sidecar container — the framing around `.text` and `.table`.
 *
 * Discovered 2026-08-01 by expanding real projects (the committed fixture is
 * hand-authored plain text, which is why this never surfaced before). In a
 * genuine `toeexpand` output the DAT bodies are **not** plain text:
 *
 * ```
 *   "1" | "2"   tag: 1 = table, 2 = text
 *   "\n*"       separator
 *   u32be × 4   1, rows, cols, 0      (text uses 1,1,1,1)
 *   values…     each: u32be type (2 = utf-8 string) + u32be length + bytes
 * ```
 *
 * A text sidecar carries exactly one value; a table carries `rows × cols` of
 * them in row-major order. Verified against two real projects: every declared
 * length matched the bytes remaining, with nothing left over.
 *
 * Anything that is not framed and holds no NUL is returned as-is — that keeps
 * hand-authored expansions (and the test fixture) working unchanged. Anything
 * else is genuinely binary (`.lod` MIDI state, baked `.data`) and returns null
 * rather than mojibake.
 */

export type TdSidecar =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][]; text: string };

const STRING_TYPE = 2;

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

const utf8 = new TextDecoder('utf-8');

/** `"1\n*"` / `"2\n*"` — the only two tags seen across the corpus. */
export function isFramedSidecar(bytes: Uint8Array): boolean {
  return bytes.length >= 19 && (bytes[0] === 0x31 || bytes[0] === 0x32)
    && bytes[1] === 0x0a && bytes[2] === 0x2a;
}

/**
 * Decode one sidecar. Returns null when the payload is binary data the graph
 * importer has no use for, so callers can skip it honestly instead of guessing.
 */
export function decodeTdSidecar(bytes: Uint8Array): TdSidecar | null {
  if (!isFramedSidecar(bytes)) {
    // unframed: plain text unless it actually contains binary
    if (bytes.includes(0)) return null;
    return { kind: 'text', text: utf8.decode(bytes) };
  }

  const table = bytes[0] === 0x31;
  const rows = u32(bytes, 7);
  const cols = u32(bytes, 11);
  let off = 19;

  const readValue = (): string | null => {
    if (off + 8 > bytes.length) return null;
    const type = u32(bytes, off);
    const len = u32(bytes, off + 4);
    off += 8;
    if (off + len > bytes.length) return null;
    const slice = bytes.subarray(off, off + len);
    off += len;
    // non-string cell types exist (baked ramp keys); represent as empty rather
    // than pretending their bytes are text
    return type === STRING_TYPE ? utf8.decode(slice) : '';
  };

  if (!table) {
    const text = readValue();
    return text === null ? null : { kind: 'text', text };
  }

  if (rows > 1e6 || cols > 1e4) return null; // implausible header → not ours
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const v = readValue();
      if (v === null) return grid.length ? finishTable(grid) : null;
      row.push(v);
    }
    grid.push(row);
  }
  return finishTable(grid);
}

/** Table DATs are TSV everywhere else in WebToe — keep one representation. */
function finishTable(rows: string[][]): TdSidecar {
  return { kind: 'table', rows, text: rows.map((r) => r.join('\t')).join('\n') };
}
