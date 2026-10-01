import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { PgBossService } from '../scheduler/pg-boss.service';
import { PrismaService } from '../prisma.service';
import { SemanticLinkerService } from './linker/semantic-linker.service';
import { VocabularyService } from './vocabulary/vocabulary.service';
import { SemanticJobsScheduler } from './semantic-jobs.scheduler';
import { SemanticSuggestionsService } from './suggestions/semantic-suggestions.service';
import { SemanticMapService } from './map/semantic-map.service';
import { GlossaryPacksService } from './packs/glossary-packs.service';
import {
  SEMANTIC_LINKS_QUEUE,
  SEMANTIC_LINKS_RECONCILE_QUEUE,
  SEMANTIC_MAP_QUEUE,
  SEMANTIC_RECONCILE_CRON,
  SEMANTIC_SUGGESTIONS_CRON,
  SEMANTIC_SUGGESTIONS_NIGHTLY_QUEUE,
  SEMANTIC_SUGGESTIONS_QUEUE,
  VOCABULARY_REFRESH_QUEUE,
} from './semantic.constants';

/**
 * Consumes the semantic layer's queues for one namespace (registered by the
 * NamespaceWorkerManager inside the namespace's CLS context).
 *
 * `localConcurrency: 1` everywhere: the linker claims persisted jobs
 * atomically, the vocabulary refresh replaces a source's rows wholesale, and the
 * map rebuild truncates and repopulates its rollups.
 */
@Injectable()
export class SemanticWorker {
  private readonly logger = new Logger(SemanticWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly prisma: PrismaService,
    private readonly linker: SemanticLinkerService,
    private readonly vocabulary: VocabularyService,
    private readonly scheduler: SemanticJobsScheduler,
    @Optional() private readonly suggestions?: SemanticSuggestionsService,
    @Optional() private readonly map?: SemanticMapService,
    @Optional() private readonly packs?: GlossaryPacksService,
  ) {}

  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    for (const queue of [
      SEMANTIC_LINKS_QUEUE,
      SEMANTIC_LINKS_RECONCILE_QUEUE,
      VOCABULARY_REFRESH_QUEUE,
      SEMANTIC_SUGGESTIONS_QUEUE,
      SEMANTIC_SUGGESTIONS_NIGHTLY_QUEUE,
      SEMANTIC_MAP_QUEUE,
    ]) {
      await boss.createQueue(queue);
    }
    await this.pgBoss.work(SEMANTIC_LINKS_QUEUE, { localConcurrency: 1 }, () =>
      this.linker.drain(),
    );
    await this.pgBoss.work(
      SEMANTIC_LINKS_RECONCILE_QUEUE,
      { localConcurrency: 1 },
      async () => {
        await this.scheduler.scheduleReconcile('nightly');
        await this.linker.drain();
      },
    );
    await boss.schedule(
      SEMANTIC_LINKS_RECONCILE_QUEUE,
      SEMANTIC_RECONCILE_CRON,
      {},
      { tz: 'UTC' },
    );
    await this.pgBoss.work(
      VOCABULARY_REFRESH_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handleVocabulary(jobs as Job[]),
    );
    await this.pgBoss.work(
      SEMANTIC_SUGGESTIONS_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handleSuggestions(jobs as Job[]),
    );
    await this.pgBoss.work(
      SEMANTIC_SUGGESTIONS_NIGHTLY_QUEUE,
      { localConcurrency: 1 },
      () => this.suggestions?.runAll({ nightly: true }) ?? Promise.resolve(),
    );
    await boss.schedule(
      SEMANTIC_SUGGESTIONS_NIGHTLY_QUEUE,
      SEMANTIC_SUGGESTIONS_CRON,
      {},
      { tz: 'UTC' },
    );
    await this.pgBoss.work(SEMANTIC_MAP_QUEUE, { localConcurrency: 1 }, () =>
      this.map?.rebuild() ?? Promise.resolve(),
    );

    // First boot after the migration: build what nothing else would trigger.
    try {
      const [items, anyFinding] = await Promise.all([
        this.prisma.vocabularyItem.count(),
        this.prisma.finding.findFirst({
          where: { status: 'OPEN' },
          select: { id: true },
        }),
      ]);
      if (items === 0 && anyFinding) {
        await this.scheduler.scheduleVocabularyRefresh(null, 'first build');
      }
      if (this.map && !(await this.map.isBuilt())) {
        await this.scheduler.scheduleMapRebuild('first build', true);
      }
      const pending = await this.prisma.semanticLinkJob.count({
        where: { status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (pending > 0) {
        await this.scheduler.scheduleLinks('INCREMENTAL', {
          assetIds: [],
          reason: 'resume pending jobs',
        });
      }
    } catch (error) {
      this.logger.warn(`Semantic first-build checks failed: ${String(error)}`);
    }
    this.logger.log('Registered semantic-layer workers');
  }

  private async handleVocabulary(jobs: Job[]): Promise<void> {
    const sourceIds = new Set<string | null>();
    for (const job of jobs) {
      const data = (job.data ?? {}) as { sourceId?: string | null };
      sourceIds.add(data.sourceId ?? null);
    }
    if (sourceIds.has(null)) {
      await this.vocabulary.refreshAll();
    } else {
      for (const sourceId of sourceIds) {
        if (sourceId) await this.vocabulary.refreshSource(sourceId);
      }
    }
    // Pack bindings waiting for a detector go live once it exists (SL2 §4.5).
    await this.packs?.activateWaitingBindings().catch((error) =>
      this.logger.warn(`Activating waiting pack bindings failed: ${String(error)}`),
    );
    // Binding suggestions read the inventory (SL4 G-1).
    await this.scheduler.scheduleSuggestions({
      generators: ['binding'],
      reason: 'vocabulary refreshed',
    });
  }

  private async handleSuggestions(jobs: Job[]): Promise<void> {
    if (!this.suggestions) return;
    const generators = new Set<string>();
    const termIds = new Set<string>();
    for (const job of jobs) {
      const data = (job.data ?? {}) as { generators?: string[]; termIds?: string[] };
      for (const generator of data.generators ?? []) generators.add(generator);
      for (const termId of data.termIds ?? []) termIds.add(termId);
    }
    await this.suggestions.runAll({
      generators: generators.size ? [...generators] : undefined,
      termIds: termIds.size ? [...termIds] : undefined,
    });
  }
}
