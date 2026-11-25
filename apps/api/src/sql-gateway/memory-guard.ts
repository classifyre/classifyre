/**
 * Whether the gateway has the memory for one more session.
 *
 * Each SQL session holds one lightweight Node socket to the pod-local native
 * Postgres catalog sidecar plus Arrow streaming headroom (default 32 MB on the
 * gateway container; the sidecar carries its own container memory limit,
 * docs/prd/SG-sql-gateway-native-catalog.md §4.5). A session the pod has no
 * room for is refused as busy (53300, which clients retry), the others live on.
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
  const perSession = (Number(env.SQL_GATEWAY_SESSION_MEMORY_MB) || 32) * MB;
  return { ceiling, perSession };
}

/** `starting`: sessions signed in whose catalog connection is not ready yet. */
export function roomForSession(
  rss: number,
  starting: number,
  limits: SessionMemory,
): boolean {
  if (!limits.ceiling) return true;
  return rss + (starting + 1) * limits.perSession <= limits.ceiling;
}

/**
 * Whether a signed-in client gets its session now, after the sessions still
 * starting have settled, or not at all (53300).
 *
 * A session still starting is reserved at `perSession` (its peak under a BI
 * tool's sync); once started it is counted by what the pod really holds,
 * usually far less. Refusing a sign-in only because others are still starting
 * broke every BI dashboard: it opens its pool's sessions at once, and JDBC
 * pools do not retry 53300. Such a sign-in waits for them instead.
 */
export function admitSession(input: {
  rss: number;
  starting: number;
  live: number;
  maxSessions: number;
  limits: SessionMemory;
}): 'open' | 'wait' | 'busy' {
  if (input.live + input.starting >= input.maxSessions) return 'busy';
  if (roomForSession(input.rss, input.starting, input.limits)) return 'open';
  return input.starting > 0 ? 'wait' : 'busy';
}
