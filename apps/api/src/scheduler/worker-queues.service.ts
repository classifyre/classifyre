import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_NAMESPACE_ID } from '../namespace/namespace.constants';
import { PgBossService, type QueueDepth } from './pg-boss.service';
import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';
import {
  WorkerQueueRegistryService,
  type WorkerQueueRow,
  type WorkerQueueStatus,
} from './worker-queue-registry.service';
import {
  isWorkspaceFeatureKey,
  WORKSPACE_FEATURE_LABELS,
  WORKSPACE_FEATURES_LOCATION,
} from '../maintenance/workspace-features.constants';

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
  /**
   * The workspace feature holding this queue paused (e.g. `duplicates` while
   * duplicate detection is off), or null. A held queue cannot be resumed from
   * the Workers tab; turning the feature back on releases it.
   */
  heldBy: string | null;
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
    const [rows, depths, holds] = await Promise.all([
      this.registry.listRows(namespaceId),
      this.depths(),
      this.registry.listPauseHolds(namespaceId),
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
    // Same for a queue a switched-off feature holds: a worker that never
    // registered it (it booted with the feature already off) reports nothing,
    // and the hold is exactly what the operator needs to see.
    for (const [queue, feature] of holds) {
      if (feature && !byQueue.has(queue)) byQueue.set(queue, []);
    }

    const depthByQueue = new Map(depths.map((d) => [d.queue, d]));
    const queues = [...byQueue.entries()]
      .map(([queue, queueRows]) =>
        this.aggregate(
          queue,
          queueRows,
          depthByQueue.get(queue),
          holds.has(queue),
          holds.get(queue) ?? null,
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
    const { heldBy } = await this.registry.setPaused(
      { namespaceId, queue },
      paused,
    );
    if (heldBy) {
      const feature = isWorkspaceFeatureKey(heldBy)
        ? WORKSPACE_FEATURE_LABELS[heldBy]
        : heldBy;
      throw new ConflictException(
        `Queue '${queue}' is paused because ${feature} is turned off for this ` +
          `workspace. It resumes when you turn ${feature} back on in ` +
          `${WORKSPACE_FEATURES_LOCATION}.`,
      );
    }
    const view = (await this.overview()).queues.find((q) => q.queue === queue);
    return (
      view ?? {
        queue,
        status: 'idle',
        paused,
        heldBy: null,
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

  /**
   * Drop a queue's waiting backlog (`created` and scheduled-`retry` jobs).
   * Side effects, and why each is accepted:
   * - Dropped jobs are gone, not re-queued: periodic schedules recover on
   *   their next fire, but one-off work (a manually scheduled recompute)
   *   needs a manual re-trigger.
   * - Jobs waiting to retry a failure go with the backlog: a failure that
   *   would have recovered on retry stays failed (its error row remains).
   * - Running jobs are untouched and finish normally; finished history and
   *   the cron schedules themselves are never touched.
   * Deliberately allowed while the workspace is paused (wind-down, like
   * storage cleanup): nothing refills the queue until resume.
   */
  async purgeQueued(
    queue: string,
  ): Promise<{ queue: string; droppedQueued: number }> {
    this.requireNamespaceId();
    const name = queue.trim();
    if (!name) throw new BadRequestException('queue is required');
    if (name.startsWith('__')) {
      throw new BadRequestException(
        `Queue '${name}' is pg-boss housekeeping and cannot be purged.`,
      );
    }
    const boss = await this.pgBoss.getBossAsync();
    const known = (await boss.getQueues()).map((q) => q.name);
    if (!known.includes(name)) {
      throw new NotFoundException(`Unknown queue '${name}'.`);
    }
    const droppedQueued =
      (await this.depths()).find((d) => d.queue === name)?.queuedCount ?? 0;
    await boss.deleteQueuedJobs(name);
    this.logger.log(
      `Purged ${droppedQueued} queued job(s) from queue '${name}'.`,
    );
    return { queue: name, droppedQueued };
  }

  private aggregate(
    queue: string,
    rows: WorkerQueueRow[],
    depth: QueueDepth | undefined,
    paused: boolean,
    heldBy: string | null,
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
      heldBy,
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
