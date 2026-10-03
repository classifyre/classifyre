import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { PgBossService } from '../scheduler/pg-boss.service';
import { glossaryEvents } from '../glossary/glossary-events';
import { SemanticJobsScheduler } from '../semantic/semantic-jobs.scheduler';
import {
  ENTITIES_RECOUNT_CRON,
  ENTITIES_RECOUNT_QUEUE,
  ENTITIES_RESOLVE_QUEUE,
} from './entities.constants';
import {
  EntityResolutionService,
  type ResolveJob,
} from './entity-resolution.service';
import { EntitySwitchService } from './entity-switch.service';
import { EntityValuesService } from './entity-values.service';
import { EntitiesService } from './entities.service';

let listenersInstalled = false;

/**
 * Consumes the entity queues for one namespace, and turns glossary changes
 * into entity work.
 *
 * `entities.resolve` is the catch-up path — after the feature is turned on, an
 * import, a rebuilt value index, or a new entity whose variants may already be
 * in the index. The per-run pass does not come through here: the correlation
 * worker runs it inline, right after it indexed the run's values, so the
 * autopilot hand-off that follows sees fresh mentions (R11).
 */
@Injectable()
export class EntitiesWorker {
  private readonly logger = new Logger(EntitiesWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly resolution: EntityResolutionService,
    private readonly values: EntityValuesService,
    private readonly switchService: EntitySwitchService,
    private readonly semanticJobs: SemanticJobsScheduler,
    private readonly entities: EntitiesService,
  ) {
    // Once per process: several modules provide the publishers, and a second
    // installation would regenerate every entity's values twice.
    if (listenersInstalled) return;
    listenersInstalled = true;
    this.installListeners();
  }

  private installListeners(): void {
    // An entity's name, aliases, type, kind or status changed: its exact
    // values follow (R3). Listeners run in the emitter's namespace context.
    glossaryEvents.on('glossary.term_changed', async (event) => {
      if (event.change === 'deleted') return;
      const relevant =
        event.change === 'created' ||
        event.labelsChanged ||
        event.linkingChanged ||
        ['approved', 'unapproved', 'deprecated', 'reinstated'].includes(
          event.change,
        );
      if (!relevant) return;
      const changed = await this.values.syncTerm(event.termId);
      if (changed && event.kind === 'ENTITY') {
        await this.resolution.scheduleResolveTerms(
          [event.termId],
          `entity ${event.key} ${event.change}`,
        );
      }
    });

    // Confirmed values changed: the semantic links (method MENTION) of those
    // entities are re-derived. Counters are recomputed by whoever changed the
    // values, or by the resolve job; the nightly recount covers the rest.
    glossaryEvents.on('entity.values_changed', async (event) => {
      await this.semanticJobs.scheduleBackfill({
        termIds: event.termIds,
        reason: 'entity values changed',
      });
    });

    glossaryEvents.on('glossary.imported', () =>
      this.resolution.scheduleResolveAll('glossary imported'),
    );
    glossaryEvents.on('semantic.derived_cleared', async (event) => {
      if (event.dataset === 'entities') {
        await this.resolution.scheduleResolveAll('entity data cleaned up');
      }
    });
  }

  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(ENTITIES_RESOLVE_QUEUE);
    await boss.createQueue(ENTITIES_RECOUNT_QUEUE);
    await this.pgBoss.work(
      ENTITIES_RESOLVE_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handleResolve(jobs as Job[]),
    );
    await this.pgBoss.work(
      ENTITIES_RECOUNT_QUEUE,
      { localConcurrency: 1 },
      () => this.handleRecount(),
    );
    await boss.schedule(
      ENTITIES_RECOUNT_QUEUE,
      ENTITIES_RECOUNT_CRON,
      {},
      { tz: 'UTC' },
    );
    this.logger.log(
      `Registered workers for queues ${ENTITIES_RESOLVE_QUEUE}, ${ENTITIES_RECOUNT_QUEUE}`,
    );
  }

  private async handleResolve(jobs: Job[]): Promise<void> {
    if (!(await this.switchService.isEnabled())) return;
    // Several coalesced wake-ups amount to one pass.
    const termIds = new Set<string>();
    let all = false;
    const runs: ResolveJob[] = [];
    for (const job of jobs) {
      const data = (job.data ?? {}) as ResolveJob;
      if (data.all) all = true;
      for (const id of data.termIds ?? []) termIds.add(id);
      if (data.runId) runs.push(data);
    }
    if (all) {
      // Entities that sources declared while the feature was off (or before
      // an import) exist only on their assets until this replays them.
      const replayed = await this.entities.replayDeclarations();
      if (replayed.declared > 0) {
        this.logger.log(
          `Replayed ${replayed.declared} declared entit(ies), ${replayed.created} new.`,
        );
      }
      const summary = await this.resolution.resolveAll();
      this.logger.log(
        `Entities resolved: ${summary.entitiesTouched} recounted, ${summary.proposed} candidate(s) proposed.`,
      );
      return;
    }
    for (const run of runs) {
      await this.resolution.resolveRun(run.runId!, run.sourceId);
    }
    if (termIds.size) await this.resolution.resolveTerms([...termIds]);
  }

  private async handleRecount(): Promise<void> {
    if (!(await this.switchService.isEnabled())) return;
    const n = await this.resolution.recountAll();
    this.logger.log(`Entity counters recomputed for ${n} entities.`);
  }
}
