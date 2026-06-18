import { readFileSync } from 'node:fs';

/**
 * Read the container's effective memory limit in MB from cgroup v2, cgroup v1,
 * or /proc/meminfo (in that precedence order).  Mirrors the CLI's
 * `get_effective_memory_mb()` so both pods apply the same logic.
 */
function readCgroupMemoryMb(): { mb: number; source: string } {
  // cgroup v2 — kernel 4.5+, used by Docker ≥ 20.10 and K8s ≥ 1.25
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (raw !== 'max') {
      const bytes = parseInt(raw, 10);
      if (!isNaN(bytes) && bytes < 2 ** 50) {
        return { mb: Math.max(256, bytes >> 20), source: 'cgroup-v2' };
      }
    }
  } catch {
    /* not mounted */
  }

  // cgroup v1 — legacy Docker / older K8s nodes
  try {
    const bytes = parseInt(
      readFileSync(
        '/sys/fs/cgroup/memory/memory.limit_in_bytes',
        'utf8',
      ).trim(),
      10,
    );
    if (!isNaN(bytes) && bytes < 2 ** 50) {
      return { mb: Math.max(256, bytes >> 20), source: 'cgroup-v1' };
    }
  } catch {
    /* not mounted */
  }

  // /proc/meminfo — host total RAM (local dev / bare metal)
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const m = /MemTotal:\s+(\d+)\s+kB/.exec(meminfo);
    if (m?.[1]) {
      return { mb: Math.max(256, Math.floor(parseInt(m[1], 10) / 1024)), source: 'proc-meminfo' };
    }
  } catch {
    /* not available */
  }

  return { mb: 1024, source: 'default' };
}

export interface CorrelationBatchSizes {
  /** Findings fetched per cursor page inside rebuildAssetValues. */
  findingsPage: number;
  /** Rows per createMany call inside the value-rebuild transaction. */
  valueUpsertBatch: number;
  /** Staging / edge rows streamed per page in scoreAndLink + cluster rebuilds. */
  streamPage: number;
  /** Effective memory limit that the sizes were derived from (MB). */
  memoryMb: number;
  /** How the memory limit was detected (for diagnostics). */
  memorySource: string;
}

/**
 * Compute correlation batch sizes from the pod's actual memory limit.
 *
 * Each batch is sized to consume at most 0.5 % of available memory,
 * with hard lower and upper bounds so the engine stays usable even
 * on very small pods and doesn't over-fetch on large ones.
 *
 * Observed object sizes (V8 heap profiler):
 *  • Prisma Finding (with id + matchedContent + 3 small fields) ≈ 800 B
 *  • CorrelationPairStaging row (id + 2 UUIDs + JSONB) ≈ 1 000 B
 *
 * Helm defaults (classifyre/values.yaml):
 *  API limit  = 1 Gi → findingsPage = 5 000, streamPage = 2 000
 *  API request= 512 Mi → findingsPage = 3 355, streamPage = 2 000
 */
export function computeCorrelationBatchSizes(): CorrelationBatchSizes {
  const { mb: memoryMb, source: memorySource } = readCgroupMemoryMb();

  // 0.5 % of total memory budget per batch — conservative enough to leave
  // room for the V8 heap baseline (~150 MB for NestJS + Prisma) and for
  // other concurrent work on the same pod.
  const budgetBytes = memoryMb * 1024 * 1024 * 0.005;

  const findingsPage = Math.max(
    200,
    Math.min(5_000, Math.floor(budgetBytes / 800)),
  );

  const valueUpsertBatch = Math.max(
    100,
    Math.min(1_000, Math.floor(findingsPage / 2)),
  );

  const streamPage = Math.max(
    100,
    Math.min(2_000, Math.floor(budgetBytes / 1_000)),
  );

  return { findingsPage, valueUpsertBatch, streamPage, memoryMb, memorySource };
}
