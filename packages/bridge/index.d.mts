/** Types for index.mjs — the bridge is plain Node ESM (no build step). */
import type { Server } from 'node:http';

export const DEFAULT_PORT: number;

export function createBridgeServer(opts?: {
  /** directory holding the built web app; auto-detected from a checkout */
  appDist?: string | null;
  /** explicit toeexpand path; auto-discovered otherwise */
  toeexpand?: string | null;
}): Server;
