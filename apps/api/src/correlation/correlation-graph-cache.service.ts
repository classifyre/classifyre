import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { CorrelationGraphResult } from './correlation.service';
import { CorrelationJobScheduler } from './correlation-job-scheduler.service';
import { CorrelationLockService } from './correlation-lock.service';

const SNAPSHOT_ID = 1;

type GraphBuilder = () => Promise<CorrelationGraphResult>;

/** PostgreSQL-backed last-good snapshot for the unscoped graph. */
@Injectable()
export class CorrelationGraphCacheService {
  private readonly logger = new Logger(CorrelationGraphCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: CorrelationLockService,
    private readonly jobs: CorrelationJobScheduler,
  ) {}

  async getOrBuild(builder: GraphBuilder): Promise<CorrelationGraphResult> {
    const snapshot = await this.prisma.correlationGraphSnapshot.findUnique({
      where: { id: SNAPSHOT_ID },
    });
    if (snapshot?.payload) {
      if (snapshot.builtVersion < snapshot.requestedVersion) {
        void this.jobs.scheduleGraphRefresh('stale graph read');
      }
      return snapshot.payload as unknown as CorrelationGraphResult;
    }

    // Only the first cold request pays the build cost. Other replicas wait on
    // the namespace lock, then re-read the row populated by the winner.
    return this.lock.runExclusive(async () => {
      const current = await this.ensureRow();
      if (current.payload) {
        return current.payload as unknown as CorrelationGraphResult;
      }
      return this.buildAndPublish(builder, current.requestedVersion);
    });
  }

  /** Called while the correlation write lock is already held. */
  async publishAfterRecomputeLocked(
    builder: GraphBuilder,
    reason: string,
  ): Promise<void> {
    const state = await this.prisma.correlationGraphSnapshot.upsert({
      where: { id: SNAPSHOT_ID },
      create: {
        id: SNAPSHOT_ID,
        requestedVersion: 1n,
        lastInvalidation: reason,
      },
      update: {
        requestedVersion: { increment: 1n },
        lastInvalidation: reason,
      },
    });
    try {
      await this.buildAndPublish(builder, state.requestedVersion);
    } catch (error) {
      await this.recordError(error);
      void this.jobs.scheduleGraphRefresh('snapshot publication failed');
      this.logger.warn(
        `Correlation recompute succeeded but graph snapshot publication failed: ${String(error)}`,
      );
    }
  }

  async invalidate(reason: string): Promise<void> {
    await this.prisma.correlationGraphSnapshot.upsert({
      where: { id: SNAPSHOT_ID },
      create: {
        id: SNAPSHOT_ID,
        requestedVersion: 1n,
        lastInvalidation: reason,
      },
      update: {
        requestedVersion: { increment: 1n },
        lastInvalidation: reason,
      },
    });
    await this.jobs.scheduleGraphRefresh(reason);
  }

  async refreshIfStale(builder: GraphBuilder): Promise<void> {
    await this.lock.runExclusive(async () => {
      const state = await this.ensureRow();
      if (state.payload && state.builtVersion >= state.requestedVersion) {
        return;
      }
      try {
        await this.buildAndPublish(builder, state.requestedVersion);
      } catch (error) {
        await this.recordError(error);
        throw error;
      }
    });
  }

  private async ensureRow() {
    return this.prisma.correlationGraphSnapshot.upsert({
      where: { id: SNAPSHOT_ID },
      create: { id: SNAPSHOT_ID },
      update: {},
    });
  }

  private async buildAndPublish(
    builder: GraphBuilder,
    version: bigint,
  ): Promise<CorrelationGraphResult> {
    const started = Date.now();
    const graph = await builder();
    const published = await this.prisma.correlationGraphSnapshot.updateMany({
      where: { id: SNAPSHOT_ID, requestedVersion: version },
      data: {
        payload: graph as unknown as Prisma.InputJsonValue,
        builtVersion: version,
        builtAt: new Date(),
        buildDurationMs: Date.now() - started,
        lastError: null,
      },
    });
    if (published.count === 0) {
      // Something invalidated the graph while it was being assembled. Never
      // replace the last-good payload with a snapshot of that moving target.
      void this.jobs.scheduleGraphRefresh(
        'graph changed during snapshot build',
      );
      return graph;
    }
    this.logger.log(
      `Published correlation graph snapshot v${version.toString()} (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${Date.now() - started} ms)`,
    );
    return graph;
  }

  private async recordError(error: unknown): Promise<void> {
    await this.prisma.correlationGraphSnapshot.update({
      where: { id: SNAPSHOT_ID },
      data: {
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
