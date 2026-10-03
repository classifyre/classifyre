import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { jaroWinkler } from '../correlation/fuzzy';
import { glossaryEvents } from '../glossary/glossary-events';
import { SemanticJobsScheduler } from '../semantic/semantic-jobs.scheduler';
import { CaseLeadsScheduler } from '../cases/case-leads.scheduler';
import {
  INQUIRY_MATCH_COALESCE_SECONDS,
  INQUIRY_MATCH_QUEUE,
} from '../matching/matching.constants';
import {
  ENTITIES_RESOLVE_COALESCE_SECONDS,
  ENTITIES_RESOLVE_QUEUE,
  ENTITY_CANDIDATES_PER_RUN,
  ENTITY_CANDIDATES_PER_VALUE,
  ENTITY_CANDIDATE_MIN_JW,
  ENTITY_EVENT_TOP,
  ENTITY_FOLD_SCORE,
  ENTITY_MIN_ALIAS_CHARS,
  ENTITY_RESOLVE_PAGE,
} from './entities.constants';
import { foldKey } from './entity-labels';
import { EntityMentionsService } from './entity-mentions.service';
import { EntitySwitchService } from './entity-switch.service';
import { EntityValuesService } from './entity-values.service';

/** A value from the value index that may refer to an entity. */
export interface IndexedValue {
  valueHash: string;
  label: string;
  normalizedValue: string;
  phoneticHash: string | null;
}

/** A confirmed name value of an entity, with its blocking keys. */
export interface BlockingValue {
  termId: string;
  label: string;
  normalizedValue: string;
  phoneticHash: string | null;
  foldKey: string | null;
}

export interface Candidate {
  termId: string;
  value: IndexedValue;
  method: 'PHONETIC' | 'FUZZY';
  score: number;
}

export interface ResolveSummary {
  values: number;
  proposed: number;
  entitiesTouched: number;
  resynced: boolean;
}

export interface ResolveJob {
  runId?: string;
  sourceId?: string;
  termIds?: string[];
  all?: boolean;
  reason?: string;
}

/**
 * Score one indexed value against the entity values that share a blocking key
 * with it (R4). Pure, so the rule is testable without a database:
 *
 * - same letters and digits once punctuation, case and diacritics are folded
 *   away ("Acme Holding G.m.b.H." / "ACME Holding GmbH") → FUZZY;
 * - same phonetic fingerprint and Jaro-Winkler ≥ 0.92 → PHONETIC, scored by
 *   the similarity.
 *
 * Only values under the same label compare: a person's name is never proposed
 * for an organisation. At most {@link ENTITY_CANDIDATES_PER_VALUE} entities
 * are proposed for one value, best first.
 */
export function scoreCandidates(
  value: IndexedValue,
  blocking: BlockingValue[],
): Candidate[] {
  if (value.normalizedValue.length < ENTITY_MIN_ALIAS_CHARS) return [];
  const fold = foldKey(value.normalizedValue);
  const best = new Map<string, Candidate>();
  for (const row of blocking) {
    if (row.label !== value.label) continue;
    if (row.normalizedValue === value.normalizedValue) continue;
    const similarity = jaroWinkler(row.normalizedValue, value.normalizedValue);
    let candidate: Candidate | null = null;
    if (fold && row.foldKey === fold) {
      candidate = {
        termId: row.termId,
        value,
        method: 'FUZZY',
        score: round3(Math.max(ENTITY_FOLD_SCORE, similarity)),
      };
    } else if (
      value.phoneticHash &&
      row.phoneticHash === value.phoneticHash &&
      similarity >= ENTITY_CANDIDATE_MIN_JW
    ) {
      candidate = {
        termId: row.termId,
        value,
        method: 'PHONETIC',
        score: round3(similarity),
      };
    }
    if (!candidate) continue;
    const current = best.get(row.termId);
    if (!current || candidate.score > current.score) {
      best.set(row.termId, candidate);
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, ENTITY_CANDIDATES_PER_VALUE);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The resolution worker (G5 §6.2).
 *
 * Runs once a run's values are indexed, over that run's assets only. Exact
 * matches need nothing here: they are already mentions through the join. What
 * this adds is the uncertain part — phonetic and folded-spelling candidates,
 * written PROPOSED for a person to review — plus the counters of the entities
 * the run touched, and the wake-ups that let links, watches and case leads see
 * the new mentions. It never confirms a value and never merges two entities.
 */
@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly switchService: EntitySwitchService,
    private readonly values: EntityValuesService,
    private readonly mentions: EntityMentionsService,
    private readonly semanticJobs: SemanticJobsScheduler,
    private readonly pgBoss: PgBossService,
    @Optional() private readonly caseLeads?: CaseLeadsScheduler,
  ) {}

  // ── Triggers ────────────────────────────────────────────────────────────

  /** A run's values were just indexed: resolve it, inline (R11). */
  async afterRunIndexed(input: {
    sourceId: string;
    runnerId: string;
  }): Promise<ResolveSummary | null> {
    if (!(await this.switchService.isEnabled())) return null;
    return this.resolveRun(input.runnerId, input.sourceId);
  }

  /**
   * Some assets were re-indexed after an edit (a finding resolved, a value
   * excluded): their entities' counters and links follow.
   */
  async afterAssetsIndexed(assetIds: string[]): Promise<void> {
    if (!assetIds.length || !(await this.switchService.isEnabled())) return;
    try {
      const touched = await this.mentions.entitiesInAssets(assetIds);
      if (touched.length) await this.mentions.recount(touched);
      await this.semanticJobs.scheduleIncrementalForAssets(
        assetIds,
        'value index updated',
      );
    } catch (error) {
      this.logger.warn(
        `Entity counters after an index update failed: ${String(error)}`,
      );
    }
  }

  async scheduleResolveAll(reason: string): Promise<void> {
    if (!(await this.switchService.isEnabled())) return;
    await this.schedule({ all: true, reason });
  }

  async scheduleResolveTerms(termIds: string[], reason: string): Promise<void> {
    if (!termIds.length || !(await this.switchService.isEnabled())) return;
    await this.schedule({ termIds: [...new Set(termIds)], reason });
  }

  private async schedule(job: ResolveJob): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      // The workers of a sleeping workspace have not registered the queue yet
      // (cold mode); the job waits there until they wake.
      await boss.createQueue(ENTITIES_RESOLVE_QUEUE);
      await boss.send(ENTITIES_RESOLVE_QUEUE, job, {
        singletonKey: job.all
          ? 'entities:all'
          : `entities:terms:${(job.termIds ?? []).slice().sort().join(',').slice(0, 200)}`,
        singletonSeconds: ENTITIES_RESOLVE_COALESCE_SECONDS,
        singletonNextSlot: true,
        expireInSeconds: 6 * 3600,
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
      });
    } catch (error) {
      // Best-effort: the nightly recount repairs counters, and the next run
      // generates candidates again.
      this.logger.warn(
        `Could not queue entity resolution (${job.reason ?? ''}): ${String(error)}`,
      );
    }
  }

  // ── A run ───────────────────────────────────────────────────────────────

  /**
   * Resolve one run: its new values only, bounded by its assets.
   *
   * 1. If the run brought a name label no alias was indexed under yet,
   *    regenerate alias values (the exact matches of a detector added later).
   * 2. Page the run's assets; for name-like values without a confirmed entity,
   *    propose candidates.
   * 3. Recount the entities whose confirmed values occur in those assets.
   * 4. Wake the linker for the run, the watches that name a touched entity and
   *    the cases linked to one.
   * 5. Announce pending candidates (F1).
   */
  async resolveRun(runId: string, sourceId?: string): Promise<ResolveSummary> {
    const summary: ResolveSummary = {
      values: 0,
      proposed: 0,
      entitiesTouched: 0,
      resynced: false,
    };
    const nameLabels = await this.values.activeNameLabels();
    const touched = new Set<string>();
    const proposedPerTerm = new Map<string, number>();
    const seenLabels = new Set<string>();
    let cursor = '';
    for (;;) {
      const assetIds = await this.assetsOfRun(
        runId,
        cursor,
        ENTITY_RESOLVE_PAGE,
      );
      if (!assetIds.length) break;
      cursor = assetIds[assetIds.length - 1];
      for (const termId of await this.mentions.entitiesInAssets(assetIds)) {
        touched.add(termId);
      }
      const labels = await this.prisma.$queryRaw<Array<{ label: string }>>`
        SELECT DISTINCT label FROM asset_correlation_values
         WHERE asset_id = ANY(${assetIds}::text[])`;
      for (const row of labels) seenLabels.add(row.label);
      if (nameLabels.length && summary.proposed < ENTITY_CANDIDATES_PER_RUN) {
        const values = await this.unconfirmedValues(
          Prisma.sql`acv.asset_id = ANY(${assetIds}::text[])`,
          nameLabels,
        );
        summary.values += values.length;
        const written = await this.propose(values);
        summary.proposed += written.count;
        for (const [termId, n] of written.perTerm) {
          proposedPerTerm.set(termId, (proposedPerTerm.get(termId) ?? 0) + n);
        }
      }
      if (assetIds.length < ENTITY_RESOLVE_PAGE) break;
    }

    // A name label nothing was indexed under: a detector that arrived after
    // the entities did. Regenerating covers every entity, so one pass.
    const unsynced = await this.values.unsyncedNameLabels([...seenLabels]);
    if (unsynced.length) {
      const result = await this.values.syncAll();
      summary.resynced = true;
      this.logger.log(
        `New name label(s) ${unsynced.join(', ')}: regenerated alias values for ${result.changed} of ${result.entities} entities.`,
      );
      if (cursor) {
        // The regenerated values may link assets of this very run.
        let again = '';
        for (;;) {
          const assetIds = await this.assetsOfRun(
            runId,
            again,
            ENTITY_RESOLVE_PAGE,
          );
          if (!assetIds.length) break;
          again = assetIds[assetIds.length - 1];
          for (const termId of await this.mentions.entitiesInAssets(assetIds)) {
            touched.add(termId);
          }
          if (assetIds.length < ENTITY_RESOLVE_PAGE) break;
        }
      }
    }

    summary.entitiesTouched = touched.size;
    if (touched.size) await this.mentions.recount([...touched]);
    if (sourceId) {
      await this.semanticJobs.scheduleIncrementalForRun(runId, sourceId);
    }
    if (touched.size) {
      await this.wakeWatches([...touched], runId, sourceId);
      await this.wakeCases([...touched]);
    }
    if (summary.proposed > 0) {
      await this.announce(summary.proposed, proposedPerTerm, runId);
    }
    this.logger.log(
      `Entities resolved for run ${runId}: ${summary.entitiesTouched} mentioned, ` +
        `${summary.proposed} candidate(s) from ${summary.values} new name value(s).`,
    );
    return summary;
  }

  /** Assets a run touched: its assets, and the assets of findings it changed. */
  private async assetsOfRun(
    runId: string,
    afterId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM (
        (SELECT a.id FROM assets a WHERE a.runner_id = ${runId} AND a.id > ${afterId} ORDER BY a.id LIMIT ${limit})
        UNION
        (SELECT DISTINCT f.asset_id AS id FROM findings f WHERE f.runner_id = ${runId} AND f.asset_id > ${afterId} ORDER BY 1 LIMIT ${limit})
      ) x ORDER BY id LIMIT ${limit}`;
    return rows.map((row) => row.id);
  }

  // ── Everything, or some entities ────────────────────────────────────────

  /**
   * The catch-up after the feature is turned on, an import or a rebuilt value
   * index: alias values for every entity, candidates over the whole index,
   * every counter, and a linker backfill for every entity.
   */
  async resolveAll(): Promise<ResolveSummary> {
    const synced = await this.values.syncAll();
    const summary = await this.scanIndex();
    summary.resynced = synced.changed > 0;
    summary.entitiesTouched = await this.mentions.recountAll();
    await this.switchService.markRecounted();
    const entityIds = await this.entityIds();
    for (let i = 0; i < entityIds.length; i += 500) {
      await this.semanticJobs.scheduleBackfill({
        termIds: entityIds.slice(i, i + 500),
        reason: 'entities resolved',
      });
    }
    return summary;
  }

  /**
   * New or changed entities: look for their spelling variants in everything
   * already indexed, so creating "ACME Holding GmbH" proposes the
   * "Acme Holding G.m.b.H." scanned last month without waiting for a run.
   */
  async resolveTerms(termIds: string[]): Promise<ResolveSummary> {
    const summary = await this.scanIndex(termIds);
    summary.entitiesTouched = await this.mentions.recount(termIds);
    return summary;
  }

  /** Nightly: every counter, from scratch (R8). */
  async recountAll(): Promise<number> {
    const n = await this.mentions.recountAll();
    await this.switchService.markRecounted();
    return n;
  }

  private async entityIds(): Promise<string[]> {
    const rows = await this.prisma.glossaryTerm.findMany({
      where: { kind: 'ENTITY' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Walk the name-labelled values of the whole index, in value-hash order. */
  private async scanIndex(termIds?: string[]): Promise<ResolveSummary> {
    const summary: ResolveSummary = {
      values: 0,
      proposed: 0,
      entitiesTouched: 0,
      resynced: false,
    };
    const nameLabels = await this.values.activeNameLabels();
    if (!nameLabels.length) return summary;
    const perTerm = new Map<string, number>();
    let after = '';
    const PAGE = 2000;
    for (;;) {
      const values = await this.unconfirmedValues(
        Prisma.sql`acv.value_hash > ${after}`,
        nameLabels,
        PAGE,
      );
      if (!values.length) break;
      after = values[values.length - 1].valueHash;
      summary.values += values.length;
      const written = await this.propose(values, termIds);
      summary.proposed += written.count;
      for (const [termId, n] of written.perTerm) {
        perTerm.set(termId, (perTerm.get(termId) ?? 0) + n);
      }
      if (
        values.length < PAGE ||
        summary.proposed >= ENTITY_CANDIDATES_PER_RUN
      ) {
        break;
      }
    }
    if (summary.proposed > 0) await this.announce(summary.proposed, perTerm);
    return summary;
  }

  // ── Candidate generation (R4) ───────────────────────────────────────────

  /**
   * Distinct name-like values in scope that no entity has confirmed. A value
   * that is already somebody's is an exact mention, not a candidate.
   */
  private async unconfirmedValues(
    scope: Prisma.Sql,
    nameLabels: string[],
    limit?: number,
  ): Promise<IndexedValue[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        value_hash: string;
        label: string;
        normalized_value: string;
        phonetic_hash: string | null;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (acv.value_hash)
             acv.value_hash, acv.label, acv.normalized_value, acv.phonetic_hash
        FROM asset_correlation_values acv
       WHERE ${scope}
         AND acv.label = ANY(${nameLabels}::text[])
         AND NOT EXISTS (
           SELECT 1 FROM entity_values ev
            WHERE ev.value_hash = acv.value_hash AND ev.verdict = 'CONFIRMED')
       ORDER BY acv.value_hash
       ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}`);
    return rows.map((row) => ({
      valueHash: row.value_hash,
      label: row.label,
      normalizedValue: row.normalized_value,
      phoneticHash: row.phonetic_hash,
    }));
  }

  /**
   * Propose entities for these values. Blocking rows are loaded once for the
   * batch — the confirmed name values of APPROVED entities that share a
   * phonetic fingerprint or a fold key with any of them — and each value is
   * scored in memory. `ON CONFLICT DO NOTHING` on (term, value) is what makes
   * a rejection stick: the REJECTED row is still there.
   */
  private async propose(
    values: IndexedValue[],
    termIds?: string[],
  ): Promise<{ count: number; perTerm: Map<string, number> }> {
    const perTerm = new Map<string, number>();
    if (!values.length) return { count: 0, perTerm };
    const phonetic = [
      ...new Set(
        values
          .map((v) => v.phoneticHash)
          .filter((h): h is string => Boolean(h)),
      ),
    ];
    const folds = [
      ...new Set(
        values
          .map((v) => foldKey(v.normalizedValue))
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    if (!phonetic.length && !folds.length) return { count: 0, perTerm };
    const blocking = await this.prisma.$queryRaw<
      Array<{
        term_id: string;
        label: string;
        normalized_value: string;
        phonetic_hash: string | null;
        fold_key: string | null;
      }>
    >(Prisma.sql`
      SELECT ev.term_id, ev.label, ev.normalized_value, ev.phonetic_hash, ev.fold_key
        FROM entity_values ev
        JOIN glossary_terms t ON t.id = ev.term_id
       WHERE ev.verdict = 'CONFIRMED'
         AND t.kind = 'ENTITY' AND t.status = 'APPROVED'
         AND (ev.phonetic_hash = ANY(${phonetic}::text[]) OR ev.fold_key = ANY(${folds}::text[]))
         ${termIds?.length ? Prisma.sql`AND ev.term_id = ANY(${termIds}::text[])` : Prisma.empty}`);
    if (!blocking.length) return { count: 0, perTerm };
    const rows: BlockingValue[] = blocking.map((row) => ({
      termId: row.term_id,
      label: row.label,
      normalizedValue: row.normalized_value,
      phoneticHash: row.phonetic_hash,
      foldKey: row.fold_key,
    }));
    const byPhonetic = new Map<string, BlockingValue[]>();
    const byFold = new Map<string, BlockingValue[]>();
    for (const row of rows) {
      if (row.phoneticHash) push(byPhonetic, row.phoneticHash, row);
      if (row.foldKey) push(byFold, row.foldKey, row);
    }
    const candidates: Candidate[] = [];
    for (const value of values) {
      const fold = foldKey(value.normalizedValue);
      const bucket = [
        ...(value.phoneticHash
          ? (byPhonetic.get(value.phoneticHash) ?? [])
          : []),
        ...(fold ? (byFold.get(fold) ?? []) : []),
      ];
      if (bucket.length) candidates.push(...scoreCandidates(value, bucket));
    }
    if (!candidates.length) return { count: 0, perTerm };
    // De-duplicate before the insert: two blocking keys can yield one pair.
    const unique = new Map<string, Candidate>();
    for (const candidate of candidates) {
      const key = `${candidate.termId}\u0000${candidate.value.valueHash}`;
      const current = unique.get(key);
      if (!current || candidate.score > current.score)
        unique.set(key, candidate);
    }
    const data = [...unique.values()];
    const inserted = await this.prisma.$queryRaw<Array<{ term_id: string }>>`
      INSERT INTO entity_values (
        id, term_id, value_hash, label, normalized_value, raw_value,
        method, verdict, score, created_by
      )
      SELECT gen_random_uuid()::text, d.term_id, d.value_hash, d.label, d.value, d.value,
             d.method::"EntityValueMethod", 'PROPOSED', d.score, 'entity-resolution'
        FROM unnest(
          ${data.map((c) => c.termId)}::text[],
          ${data.map((c) => c.value.valueHash)}::text[],
          ${data.map((c) => c.value.label)}::text[],
          ${data.map((c) => c.value.normalizedValue)}::text[],
          ${data.map((c) => c.method)}::text[],
          ${data.map((c) => c.score)}::float8[]
        ) AS d(term_id, value_hash, label, value, method, score)
      ON CONFLICT (term_id, value_hash) DO NOTHING
      RETURNING term_id`;
    for (const row of inserted) {
      perTerm.set(row.term_id, (perTerm.get(row.term_id) ?? 0) + 1);
    }
    return { count: inserted.length, perTerm };
  }

  // ── Wake-ups ────────────────────────────────────────────────────────────

  /**
   * Watches on a touched entity matched this run before its values were
   * indexed, so the new mentions were not there to match. Run the source's
   * matching once more, now that they are.
   */
  private async wakeWatches(
    termIds: string[],
    runId: string,
    sourceId?: string,
  ): Promise<void> {
    if (!sourceId) return;
    try {
      const terms = await this.prisma.glossaryTerm.findMany({
        where: { id: { in: termIds } },
        select: { key: true, previousKeys: true },
      });
      const keys = terms.flatMap((term) => [term.key, ...term.previousKeys]);
      if (!keys.length) return;
      const watching = await this.prisma.inquiry.findFirst({
        where: { termKeys: { hasSome: keys } },
        select: { id: true },
      });
      if (!watching) return;
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        INQUIRY_MATCH_QUEUE,
        { sourceId, runnerId: runId },
        {
          singletonKey: `${sourceId}:entities`,
          singletonSeconds: INQUIRY_MATCH_COALESCE_SECONDS,
          singletonNextSlot: true,
        },
      );
    } catch (error) {
      this.logger.warn(`Could not re-run watch matching: ${String(error)}`);
    }
  }

  /** Cases linked to a touched entity refresh their leads (R17). */
  private async wakeCases(termIds: string[]): Promise<void> {
    if (!this.caseLeads) return;
    try {
      const cases = await this.prisma.glossaryReference.findMany({
        where: {
          glossaryTermId: { in: termIds },
          entityType: 'case',
          role: 'ABOUT',
        },
        select: { entityId: true },
        distinct: ['entityId'],
        take: 200,
      });
      for (const row of cases) {
        await this.caseLeads.request(row.entityId, 'entity mentions');
      }
    } catch (error) {
      this.logger.warn(`Could not refresh case leads: ${String(error)}`);
    }
  }

  private async announce(
    count: number,
    perTerm: Map<string, number>,
    runId?: string,
  ): Promise<void> {
    const top = [...perTerm.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, ENTITY_EVENT_TOP);
    const terms = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, key: true, term: true },
    });
    const byId = new Map(terms.map((term) => [term.id, term]));
    glossaryEvents.emit({
      type: 'entity.candidates_pending',
      count,
      runId: runId ?? null,
      top: top
        .map(([id, n]) => {
          const term = byId.get(id);
          return term ? { key: term.key, term: term.term, count: n } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    });
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
