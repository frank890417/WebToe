/** Types for index.mjs — the bridge is plain Node ESM (no build step). */
import type { Server } from 'node:http';

export const DEFAULT_PORT: number;

export function createBridgeServer(opts?: {
  /** directory holding the built web app; auto-detected from a checkout or the npm tarball's public/ */
  appDist?: string | null;
  /** explicit toeexpand path; auto-discovered otherwise */
  toeexpand?: string | null;
  /** when set, /expand requires `Authorization: Bearer <token>` (for non-loopback binds) */
  token?: string | null;
  /** parallel expand ceiling; excess requests get 429 (default 3) */
  maxConcurrent?: number;
}): Server;
