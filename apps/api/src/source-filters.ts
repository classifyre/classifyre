import { AssetType, Prisma, RunnerStatus } from '@prisma/client';

/**
 * The sources people connect: everything but the built-in source of shared
 * datasets, which every workspace has and nothing ever scans. Counts of "your
 * sources" go through this.
 */
export const CONNECTED_SOURCES = {
  type: { not: AssetType.SHARED_DATASET },
} satisfies Prisma.SourceWhereInput;

/**
 * Sources with a scan in flight. Requesting a run claims the source as RUNNING,
 * also while the run itself still queues. PENDING on a source means it has no
 * run: never scanned, or its last run was deleted.
 */
export const SOURCES_IN_FLIGHT = {
  runnerStatus: RunnerStatus.RUNNING,
} satisfies Prisma.SourceWhereInput;
