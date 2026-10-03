import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  SEMANTIC_LINKS_COALESCE_SECONDS,
  SEMANTIC_LINKS_QUEUE,
  SEMANTIC_MAP_COALESCE_SECONDS,
  SEMANTIC_MAP_QUEUE,
  SEMANTIC_SUGGESTIONS_COALESCE_SECONDS,
  SEMANTIC_SUGGESTIONS_QUEUE,
  SemanticLinkJobKind,
  SemanticLinkTrigger,
  VOCABULARY_COALESCE_SECONDS,
  VOCABULARY_REFRESH_QUEUE,
} from './semantic.constants';

type BossLike = {
  send(
    queue: string,
    data: object,
    options: Record<string, unknown>,
  ): Promise<unknown>;
};

/**
 * Queue the semantic work that follows a finished run, from code that has a
 * Prisma client and a pg-boss instance but not this module (the CLI runner):
 * an INCREMENTAL linker job for the assets the run touched, and a vocabulary
 * refresh for its source. Best-effort, like every post-run kick.
 */
export async function enqueueSemanticAfterRun(
  prisma: Pick<PrismaService, 'semanticLinkJob'>,
  boss: BossLike,
  runId: string,
  sourceId: string,
): Promise<void> {
  await prisma.semanticLinkJob.create({
    data: {
      kind: 'INCREMENTAL',
      status: 'QUEUED',
      trigger: { runId, sourceId, reason: `run ${runId}` },
    },
  });
  const options = (key: string, seconds: number) => ({
    singletonKey: key,
    singletonSeconds: seconds,
    singletonNextSlot: true,
    expireInSeconds: 6 * 3600,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  });
  await boss.send(
    SEMANTIC_LINKS_QUEUE,
    { reason: `run ${runId}` },
    options('semantic-links', SEMANTIC_LINKS_COALESCE_SECONDS),
  );
  await boss.send(
    VOCABULARY_REFRESH_QUEUE,
    { sourceId, reason: `run ${runId}` },
    options(`vocabulary:${sourceId}`, VOCABULARY_COALESCE_SECONDS),
  );
}

/**
 * The only place that enqueues semantic-layer work.
 *
 * Linker work is persisted first (`semantic_link_jobs`, status QUEUED) and the
 * pg-boss job only wakes the worker, which claims and merges every QUEUED row.
 * Several pending binding changes therefore become one walk, and a change made
 * while a job is coalesced is never dropped. Every method is best-effort: a
 * missed schedule leaves meaning stale (the nightly reconcile repairs it), and
 * must never fail the scan or the edit that asked for it.
 */
@Injectable()
export class SemanticJobsScheduler {
  private readonly logger = new Logger(SemanticJobsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
  ) {}

  private async send(
    queue: string,
    data: object,
    singletonKey: string,
    seconds: number,
  ): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.send(queue, data, {
      singletonKey,
      singletonSeconds: seconds,
      singletonNextSlot: true,
      expireInSeconds: 6 * 3600,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    });
  }

  async scheduleLinks(
    kind: SemanticLinkJobKind,
    trigger: SemanticLinkTrigger,
  ): Promise<string | null> {
    try {
      const job = await this.prisma.semanticLinkJob.create({
        data: {
          kind,
          status: 'QUEUED',
          trigger: trigger as unknown as Prisma.InputJsonValue,
        },
      });
      await this.send(
        SEMANTIC_LINKS_QUEUE,
        { reason: trigger.reason ?? kind },
        'semantic-links',
        SEMANTIC_LINKS_COALESCE_SECONDS,
      );
      return job.id;
    } catch (error) {
      this.logger.warn(
        `Could not queue semantic linking (${kind}, ${trigger.reason ?? ''}): ${String(error)}`,
      );
      return null;
    }
  }

  /** After a run finalises: the assets the run touched. */
  scheduleIncrementalForRun(
    runId: string,
    sourceId: string,
  ): Promise<string | null> {
    return this.scheduleLinks('INCREMENTAL', {
      runId,
      sourceId,
      reason: `run ${runId}`,
    });
  }

  scheduleIncrementalForAssets(
    assetIds: string[],
    reason: string,
  ): Promise<string | null> {
    if (!assetIds.length) return Promise.resolve(null);
    return this.scheduleLinks('INCREMENTAL', {
      assetIds: [...new Set(assetIds)],
      reason,
    });
  }

  scheduleBackfill(trigger: SemanticLinkTrigger): Promise<string | null> {
    return this.scheduleLinks('BACKFILL', trigger);
  }

  scheduleReconcile(reason = 'on demand'): Promise<string | null> {
    return this.scheduleLinks('RECONCILE', { reason });
  }

  async scheduleVocabularyRefresh(sourceId: string | null, reason: string) {
    try {
      await this.send(
        VOCABULARY_REFRESH_QUEUE,
        { sourceId, reason },
        `vocabulary:${sourceId ?? 'all'}`,
        VOCABULARY_COALESCE_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue vocabulary refresh (${reason}): ${String(error)}`,
      );
    }
  }

  async scheduleSuggestions(input: {
    generators?: string[];
    termIds?: string[];
    reason: string;
  }) {
    try {
      const key = input.termIds?.length
        ? `suggestions:terms:${input.termIds.slice().sort().join(',').slice(0, 200)}`
        : `suggestions:${(input.generators ?? ['all']).slice().sort().join(',')}`;
      await this.send(
        SEMANTIC_SUGGESTIONS_QUEUE,
        input,
        key,
        input.termIds?.length ? 10 : SEMANTIC_SUGGESTIONS_COALESCE_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue semantic suggestions (${input.reason}): ${String(error)}`,
      );
    }
  }

  async scheduleMapRebuild(reason: string, immediate = false) {
    try {
      await this.send(
        SEMANTIC_MAP_QUEUE,
        { reason },
        'semantic-map',
        immediate ? 1 : SEMANTIC_MAP_COALESCE_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Could not queue semantic map rebuild (${reason}): ${String(error)}`,
      );
    }
  }
}
