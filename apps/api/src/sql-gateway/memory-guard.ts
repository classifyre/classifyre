/**
 * Whether the gateway has the memory for one more session.
 *
 * Every SQL session runs its own PGlite in a worker thread: about 150 MB idle
 * and about 400 MB while a BI tool syncs and queries (Metabase, measured
 * 2026-11-21, docs/prd/BIC-bi-client-compatibility.md M5). Session counts alone
 * do not bound that: two Metabase pools of four on a 3 GiB pod were killed by
 * the kernel, every session in it with them. A session the pod has no room
 * for is refused as busy (53300, which clients retry), the others live on.
 */

import { rssGuardBytes } from '../utils/heap-guard';

const MB = 1024 * 1024;

export interface SessionMemory {
  /** Resident bytes the pod may reach; 0 = no limit. */
  ceiling: number;
  /** What one more session is allowed for. */
  perSession: number;
}

export function sessionMemoryConfig(
  env: Record<string, string | undefined> = process.env,
): SessionMemory {
  // Unlike the API's under-pressure check (1 GB when unset), no guard set
  // means no ceiling here: refusing sessions on a guessed limit would make
  // the gateway unusable on a large pod nobody configured.
  const ceiling =
    Number(env.SQL_GATEWAY_MAX_RSS_BYTES) || rssGuardBytes(env) || 0;
  const perSession = (Number(env.SQL_GATEWAY_SESSION_MEMORY_MB) || 450) * MB;
  return { ceiling, perSession };
}

/** `starting`: sessions signed in whose PGlite is not resident yet. */
export function roomForSession(
  rss: number,
  starting: number,
  limits: SessionMemory,
): boolean {
  if (!limits.ceiling) return true;
  return rss + (starting + 1) * limits.perSession <= limits.ceiling;
}
