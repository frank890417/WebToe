/** Types for build.mjs — the site generator is plain Node ESM (no build step). */

export type SiteFiles = Map<string, string | Uint8Array>;

export const ROOT: string;
export const TABLES: { en: Record<string, unknown>; zh: Record<string, unknown> };
export const DOC_GROUPS: { key: string; pages: string[] }[];
export const DOC_SLUGS: string[];

export function shapeDiff(a: unknown, b: unknown, at?: string): string[];
export function fill<T>(table: T, vars: Record<string, string | number>): T;
export function measureBundle(root?: string): { kb: number; gzipKb: number; measured: boolean };

export function buildSite(opts?: { root?: string; bundle?: { kb: number; gzipKb: number } }): {
  files: SiteFiles;
  warnings: string[];
  placeholders: string[];
  counts: Record<string, number> & { total: number };
  bundle: { kb: number; gzipKb: number; measured?: boolean };
};

export function validateSite(files: SiteFiles, root?: string): string[];

export interface DocSource { slug: string; lang: string; title: string; description: string; body: string; source: string }
export function loadDocs(root: string): { docs: Record<string, Record<string, DocSource>>; errors: string[] };

export interface OpFamily { family: string; ops: { type: string; label: string }[] }
export function scanOps(root: string): OpFamily[];
export function opCounts(families: OpFamily[]): Record<string, number> & { total: number };
