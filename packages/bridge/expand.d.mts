/** Types for expand.mjs — the bridge is plain Node ESM (no build step). */

export interface ExpandedFile {
  path: string;
  /** present when the file is clean UTF-8 */
  text?: string;
  /** present when the file is framed/binary (see @webtoe/io tdContainer) */
  b64?: string;
}

export interface ExpandResult {
  name: string;
  files: ExpandedFile[];
  skipped: { path: string; reason: string; size: number }[];
  bytes: number;
  toeexpand: string;
  ms: number;
}

export const MAX_FILE_BYTES: number;
export const MAX_TOTAL_BYTES: number;
export const MAX_BINARY_BYTES: number;

export function findToeexpand(explicit?: string | null): string | null;
export function toeexpandBuild(toolPath: string): string | null;
export function expandToe(
  src: string,
  opts?: { toeexpand?: string | null; timeoutMs?: number },
): Promise<ExpandResult>;
