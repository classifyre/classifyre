/**
 * Live heap check for long-running ingestion work.
 *
 * `@fastify/under-pressure` (via CliBackpressureGuard) only samples on an
 * interval and only decides at request *entry*. That cannot stop the case that
 * actually crashed the desktop API: a bulk-ingest request that was admitted
 * while the heap looked fine and then allocated its way past the V8 ceiling
 * mid-handler. This reads `process.memoryUsage()` at the moment of the call, so
 * a batch is rejected before it starts building large in-memory structures.
 *
 * Opt-in only: the threshold comes from UNDER_PRESSURE_MAX_HEAP_USED_BYTES,
 * which the desktop process manager sets to 85% of the V8 old-space cap. When
 * the variable is unset (the default for server deployments, where heap limits
 * are enforced by the container instead) this is a no-op.
 */
export function heapUsedBytes(): number {
  return process.memoryUsage().heapUsed;
}

export function heapGuardThresholdBytes(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.UNDER_PRESSURE_MAX_HEAP_USED_BYTES;
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * @returns the current heap usage when it is over the configured threshold,
 * or null when the guard is disabled or there is still headroom.
 */
export function heapOverThreshold(
  env: NodeJS.ProcessEnv = process.env,
): { usedBytes: number; thresholdBytes: number } | null {
  const thresholdBytes = heapGuardThresholdBytes(env);
  if (thresholdBytes === null) return null;
  const usedBytes = heapUsedBytes();
  return usedBytes > thresholdBytes ? { usedBytes, thresholdBytes } : null;
}
