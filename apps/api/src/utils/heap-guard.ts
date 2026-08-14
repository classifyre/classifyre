import v8 from 'v8';

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
 * The threshold is derived from the ceiling V8 *actually* enforces in this
 * process, not from what the launcher asked for. Those are not the same number:
 * Electron silently clamps `--max-old-space-size` to ~4 GB under
 * ELECTRON_RUN_AS_NODE, so the desktop app requesting 6144 MB ran with a real
 * ceiling of 4192 MB while this guard was configured for 5222 MB — above the
 * ceiling, so it could never fire and the process aborted instead of shedding.
 * Reading the limit at runtime is also what makes one number correct across
 * every machine, OS, container memory limit and future distribution, with no
 * per-host tuning.
 *
 * UNDER_PRESSURE_MAX_HEAP_USED_BYTES still overrides it (the Helm chart sets it
 * explicitly to 85% of `api.maxOldSpaceSizeMb`), but an override at or above
 * the real ceiling is clamped rather than honoured: such a value is always a
 * misconfiguration, and honouring it means no backpressure at all.
 */

/** Fraction of the real V8 ceiling at which ingestion starts shedding. */
export const HEAP_GUARD_FRACTION = 0.8;

/** Ceiling V8 enforces in *this* process, whatever the launcher requested. */
export function v8HeapLimitBytes(): number {
  return v8.getHeapStatistics().heap_size_limit;
}

export function heapUsedBytes(): number {
  return process.memoryUsage().heapUsed;
}

export type HeapGuardConfig = {
  thresholdBytes: number;
  limitBytes: number;
  source: 'env' | 'derived' | 'env-clamped';
};

/**
 * Resolves the shed threshold for this process.
 *
 * `limitBytes` is injectable so tests can assert the clamping behaviour without
 * depending on the heap size of the machine running them.
 */
export function resolveHeapGuard(
  env: NodeJS.ProcessEnv = process.env,
  limitBytes: number = v8HeapLimitBytes(),
): HeapGuardConfig {
  const derived = Math.floor(limitBytes * HEAP_GUARD_FRACTION);
  const raw = env.UNDER_PRESSURE_MAX_HEAP_USED_BYTES;

  if (raw === undefined || raw.trim() === '') {
    return { thresholdBytes: derived, limitBytes, source: 'derived' };
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { thresholdBytes: derived, limitBytes, source: 'derived' };
  }

  // An override that sits at or above the ceiling can never fire. Keep the
  // derived value and report the clamp so the boot log can flag the config.
  if (parsed >= limitBytes) {
    return { thresholdBytes: derived, limitBytes, source: 'env-clamped' };
  }

  return { thresholdBytes: parsed, limitBytes, source: 'env' };
}

export function heapGuardThresholdBytes(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveHeapGuard(env).thresholdBytes;
}

/**
 * @returns the current heap usage when it is over the resolved threshold, or
 * null when there is still headroom.
 */
export function heapOverThreshold(
  env: NodeJS.ProcessEnv = process.env,
): { usedBytes: number; thresholdBytes: number } | null {
  const { thresholdBytes } = resolveHeapGuard(env);
  const usedBytes = heapUsedBytes();
  return usedBytes > thresholdBytes ? { usedBytes, thresholdBytes } : null;
}
