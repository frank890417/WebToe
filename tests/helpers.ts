import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ImportFile } from '@webtoe/io';

/** Recursively wrap an on-disk expansion directory as importer input. */
export function collectImportFiles(root: string): ImportFile[] {
  const out: ImportFile[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else {
        out.push({
          path: relative(root, p).replace(/\\/g, '/'),
          text: async () => readFileSync(p, 'latin1'),
          // sidecars must be read as bytes — real `.text`/`.table` are framed
          bytes: async () => new Uint8Array(readFileSync(p)),
        });
      }
    }
  };
  walk(root);
  return out;
}
