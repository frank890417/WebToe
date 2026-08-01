/**
 * Shared `.toe` expansion helper — the one place that knows how to turn a
 * TouchDesigner binary container into text.
 *
 * WebToe never bundles Derivative binaries. This module locates `toeexpand`
 * inside the *user's own* TouchDesigner install, runs it on a copy in a temp
 * directory, and hands back the expansion as plain text files. Everything
 * downstream (browser importer, CLI) parses those files with the single
 * parser in `@webtoe/io` — this file does no mapping of its own.
 *
 * Used by: packages/bridge/index.mjs (local service), packages/cli/toe-convert.mjs.
 */
import { execFile } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { globSync } from 'node:fs';

const execFileAsync = promisify(execFile);

/** Individual expansion files larger than this are reported, not returned. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Total budget for one expansion. */
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** Framed sidecars are small; anything binary above this is real payload data
 *  (baked ramps, MIDI state) that the graph importer has no use for. */
export const MAX_BINARY_BYTES = 1024 * 1024;

/**
 * Every place a TouchDesigner install puts `toeexpand`, newest build first.
 * Sorting is lexicographic on the version folder, which matches build order
 * for Derivative's `YYYY.NNNNN` scheme.
 */
export function findToeexpand(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (process.env.WEBTOE_TOEEXPAND && existsSync(process.env.WEBTOE_TOEEXPAND)) {
    return process.env.WEBTOE_TOEEXPAND;
  }
  const patterns = [
    '/Applications/TouchDesigner*.app/Contents/MacOS/toeexpand',
    '/Applications/TouchDesigner/TouchDesigner*.app/Contents/MacOS/toeexpand',
    `${process.env.HOME ?? ''}/Applications/TouchDesigner*.app/Contents/MacOS/toeexpand`,
    'C:/Program Files/Derivative/TouchDesigner*/bin/toeexpand.exe',
    'C:/Program Files (x86)/Derivative/TouchDesigner*/bin/toeexpand.exe',
  ];
  const hits = [];
  for (const p of patterns) {
    try { hits.push(...globSync(p)); } catch { /* pattern unsupported on this platform */ }
  }
  return hits.filter((h) => existsSync(h)).sort().reverse()[0] ?? null;
}

/**
 * Which TouchDesigner the tool came from, e.g. "TouchDesigner 2025.33070".
 *
 * Read from the install path, not from the tool: `toeexpand -b` still wants a
 * filename and just prints usage without one, so asking it costs a process
 * launch and returns nothing useful.
 */
export function toeexpandBuild(toolPath) {
  const m = toolPath.match(/TouchDesigner[ _]?([0-9]{4}\.[0-9]+)/i);
  return m ? `TouchDesigner ${m[1]}` : null;
}

function walk(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, root, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Expand one `.toe`/`.tox` into `{ files, skipped, ... }`.
 *
 * @param src absolute path to the container file
 * @param opts.toeexpand explicit tool path (else auto-discovered)
 * @param opts.timeoutMs hard stop for the child process
 * @returns files: `[{ path, text }]` with paths relative to the expansion root,
 *          exactly the shape `toedirLoader` expects.
 */
export async function expandToe(src, opts = {}) {
  const tool = findToeexpand(opts.toeexpand);
  if (!tool) {
    const err = new Error('toeexpand not found — install TouchDesigner, or set WEBTOE_TOEEXPAND');
    err.code = 'NO_TOEEXPAND';
    throw err;
  }
  const name = basename(src);
  if (!/\.(toe|tox)$/i.test(name)) {
    const err = new Error(`not a TouchDesigner container: ${name}`);
    err.code = 'BAD_INPUT';
    throw err;
  }

  const work = mkdtempSync(join(tmpdir(), 'webtoe-expand-'));
  const started = Date.now();
  try {
    // Stage under a plain-ASCII name. `toeexpand` reads the path as Latin-1 and
    // fails outright on anything else ("Error opening file: è¡¨æ¼”…"), which
    // would break every project whose filename is not English. The name on disk
    // has no effect on the expansion, so this costs nothing.
    const ext = name.toLowerCase().endsWith('.tox') ? '.tox' : '.toe';
    const staged = join(work, `input${ext}`);
    copyFileSync(src, staged);

    // toeexpand exits NON-ZERO on success — never branch on the exit code,
    // only on whether the output directory appeared (docs/HANDOFF.md §4).
    try {
      await execFileAsync(tool, [staged], { cwd: work, timeout: opts.timeoutMs ?? 180_000 });
    } catch (e) {
      if (e?.killed || e?.signal) throw new Error(`toeexpand timed out on ${name}`);
    }

    const outDir = `${staged}.dir`;
    if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
      const err = new Error(`toeexpand produced no expansion for ${name} — is the file a valid TouchDesigner project?`);
      err.code = 'EXPAND_FAILED';
      throw err;
    }

    const files = [];
    const skipped = [];
    let total = 0;
    for (const abs of walk(outDir, outDir, [])) {
      const rel = relative(outDir, abs).split(sep).join('/');
      const size = statSync(abs).size;
      if (size > MAX_FILE_BYTES) { skipped.push({ path: rel, reason: 'too large', size }); continue; }
      if (total + size > MAX_TOTAL_BYTES) { skipped.push({ path: rel, reason: 'budget exceeded', size }); continue; }
      const buf = readFileSync(abs);
      if (!buf.includes(0)) {
        files.push({ path: rel, text: buf.toString('utf8') });
      } else if (size <= MAX_BINARY_BYTES) {
        // Not text — but `.text`/`.table` DAT bodies live inside a framed
        // binary container, so these must reach the importer as bytes and be
        // unframed there (one decoder, in @webtoe/io). Genuinely binary files
        // fall out on the far side.
        files.push({ path: rel, b64: buf.toString('base64') });
      } else {
        skipped.push({ path: rel, reason: 'binary', size });
        continue;
      }
      total += size;
    }
    return { name, files, skipped, bytes: total, toeexpand: tool, ms: Date.now() - started };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
