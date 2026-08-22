import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_NAMESPACE_ID } from '../namespace/namespace.constants';
import { PgBossService, type QueueDepth } from './pg-boss.service';
import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';
import {
  WorkerQueueRegistryService,
  type WorkerQueueRow,
  type WorkerQueueStatus,
} from './worker-queue-registry.service';

/** One worker process serving a queue. */
export interface WorkerQueueInstanceView {
  instanceId: string;
  status: WorkerQueueStatus;
  activeJobs: number;
  jobIds: string[];
  startedAt: string | null;
  elapsedMs: number | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
  heartbeatAt: string;
}

/** A queue, aggregated across every worker process that reports on it. */
export interface WorkerQueueView {
  queue: string;
  status: WorkerQueueStatus;
  paused: boolean;
  activeJobs: number;
  queuedCount: number;
  deferredCount: number;
  totalCount: number;
  runCount: number;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
  instances: WorkerQueueInstanceView[];
}

export interface WorkerOverview {
  /** Global concurrency slots shared by every namespace and queue. */
  concurrencyLimit: number;
  /** Seconds a batch may wait for a slot before failing; 0 means forever. */
  slotWaitTimeoutSeconds: number;
  queues: WorkerQueueView[];
}

/**
 * Ranked worst-first so an aggregated queue reports its most alarming reporter
 * rather than an average that hides it.
 */
const STATUS_RANK: Record<WorkerQueueStatus, number> = {
  failed: 4,
  running: 3,
  waiting_slot: 2,
  stale: 1,
  idle: 0,
};

/**
 * Read model behind the worker view in settings.
 *
 * Joins three sources that each know only part of the story: the worker
 * registry (what handlers are doing), pg-boss (how much work is waiting), and
 * the concurrency semaphore (how much may run at once).
 */
@Injectable()
export class WorkerQueuesService {
  private readonly logger = new Logger(WorkerQueuesService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly registry: WorkerQueueRegistryService,
    private readonly pgBoss: PgBossService,
    private readonly concurrency: NamespaceJobConcurrencyService,
  ) {}

  async overview(): Promise<WorkerOverview> {
    const namespaceId = this.requireNamespaceId();
    const [rows, depths, paused] = await Promise.all([
      this.registry.listRows(namespaceId),
      this.depths(),
      this.registry.listPaused(namespaceId),
    ]);

    const byQueue = new Map<string, WorkerQueueRow[]>();
    for (const row of rows) {
      const existing = byQueue.get(row.queue);
      if (existing) existing.push(row);
      else byQueue.set(row.queue, [row]);
    }
    // A queue with a backlog but no live worker still has to be visible —
    // that combination is the whole point of showing depth separately.
    for (const depth of depths) {
      if (!byQueue.has(depth.queue)) byQueue.set(depth.queue, []);
    }

    const depthByQueue = new Map(depths.map((d) => [d.queue, d]));
    const queues = [...byQueue.entries()]
      .map(([queue, queueRows]) =>
        this.aggregate(
          queue,
          queueRows,
          depthByQueue.get(queue),
          paused.has(queue),
        ),
      )
      .sort((a, b) => a.queue.localeCompare(b.queue));

    return {
      concurrencyLimit: this.concurrency.getLimit(),
      slotWaitTimeoutSeconds: Math.round(
        this.concurrency.getWaitTimeoutMs() / 1000,
      ),
      queues,
    };
  }

  async setPaused(queue: string, paused: boolean): Promise<WorkerQueueView> {
    const namespaceId = this.requireNamespaceId();
    if (!queue.trim()) throw new BadRequestException('queue is required');
    await this.registry.setPaused({ namespaceId, queue }, paused);
    const view = (await this.overview()).queues.find((q) => q.queue === queue);
    return (
      view ?? {
        queue,
        status: 'idle',
        paused,
        activeJobs: 0,
        queuedCount: 0,
        deferredCount: 0,
        totalCount: 0,
        runCount: 0,
        failureCount: 0,
        lastError: null,
        lastErrorAt: null,
        instances: [],
      }
    );
  }

  private aggregate(
    queue: string,
    rows: WorkerQueueRow[],
    depth: QueueDepth | undefined,
    paused: boolean,
  ): WorkerQueueView {
    const now = Date.now();
    const instances = rows.map((row) => ({
      instanceId: row.instanceId,
      status: row.status,
      activeJobs: row.activeJobs,
      jobIds: row.jobIds,
      startedAt: row.startedAt?.toISOString() ?? null,
      elapsedMs: row.startedAt ? now - row.startedAt.getTime() : null,
      lastFinishedAt: row.lastFinishedAt?.toISOString() ?? null,
      lastDurationMs: row.lastDurationMs,
      runCount: row.runCount,
      failureCount: row.failureCount,
      lastError: row.lastError,
      lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
      heartbeatAt: row.heartbeatAt.toISOString(),
    }));

    const status = instances.reduce<WorkerQueueStatus>(
      (worst, instance) =>
        STATUS_RANK[instance.status] > STATUS_RANK[worst]
          ? instance.status
          : worst,
      instances.length === 0 ? 'stale' : 'idle',
    );

    const mostRecentError = rows
      .filter((row) => row.lastErrorAt)
      .sort(
        (a, b) =>
          (b.lastErrorAt?.getTime() ?? 0) - (a.lastErrorAt?.getTime() ?? 0),
      )[0];

    return {
      queue,
      status,
      paused,
      activeJobs: sum(instances.map((i) => i.activeJobs)),
      queuedCount: depth?.queuedCount ?? 0,
      deferredCount: depth?.deferredCount ?? 0,
      totalCount: depth?.totalCount ?? 0,
      runCount: sum(instances.map((i) => i.runCount)),
      failureCount: sum(instances.map((i) => i.failureCount)),
      lastError: mostRecentError?.lastError ?? null,
      lastErrorAt: mostRecentError?.lastErrorAt?.toISOString() ?? null,
      instances,
    };
  }

  /**
   * pg-boss depth is best-effort: on an API-only pod the namespace's boss is
   * started lazily, and a namespace that has never enqueued anything has no
   * queues at all. Neither is a reason to fail the whole view.
   */
  private async depths(): Promise<QueueDepth[]> {
    try {
      return await this.pgBoss.queueDepths();
    } catch (error) {
      this.logger.warn(`Queue depth unavailable: ${String(error)}`);
      return [];
    }
  }

  private requireNamespaceId(): string {
    const namespaceId = this.cls.get<string>(CLS_NAMESPACE_ID);
    if (!namespaceId) {
      throw new BadRequestException(
        'Worker queues are only available inside a workspace context.',
      );
    }
    return namespaceId;
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
