import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  FindingBulkOperationKind,
  FindingBulkOperationStatus,
  Prisma,
  type FindingBulkOperation,
} from '@prisma/client';

import { CorrelationJobScheduler } from '../correlation/correlation-job-scheduler.service';
import { CompiledMatcher } from '../matching/inquiry-matcher';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { FindingStatsScheduler } from '../stats/finding-stats-scheduler.service';
import { historyEntryForStorage } from '../types/finding-history';
import { HistoryEventType } from '../types/finding-history.types';
import {
  BULK_OPERATION_PAGE_PAUSE_MS,
  BULK_OPERATION_TX_TIMEOUT_MS,
  BULK_OPERATION_WRITE_BATCH_SIZE,
  RETIRE_DRY_RUN_MAX_AGE_MS,
  RETIRE_SAMPLE_IDS,
  RETIRE_SCAN_BLOCKS,
} from './finding-bulk-operation.constants';
import { FindingBulkOperationService } from './finding-bulk-operation.service';
import {
  buildRetirePlan,
  candidatePageSql,
  caseDriftCurrentName,
  outOfScopeReason,
  planNeedsWalk,
  resolutionReasonFor,
  type CandidateRow,
  type NotProvableDimension,
  type RetirePlan,
} from './retire-out-of-scope.plan';

type RetireMode = 'dry_run' | 'retire';

interface RetireFilters {
  mode: RetireMode;
  plan: RetirePlan;
  fromOperationId?: string;
  includeInquiryWatched?: boolean;
}

/** What a retire walk saw. Stored on the operation; a dry run's is the review. */
export interface RetireCounts {
  scan: { blocksScanned: number; blocksTotal: number };
  /** OPEN findings of this detector the current configuration cannot produce. */
  candidates: number;
  byReason: Record<string, number>;
  bySource: Record<string, number>;
  /** Candidates a case cites. Always exempt. */
  citedByCase: number;
  /** Candidates, not cited, that at least one ACTIVE inquiry matches. */
  watchedByInquiries: number;
  /** Per inquiry; one finding can count toward several. */
  inquiries: Array<{ id: string; title: string; count: number }>;
  /** Under the default policy: candidates minus cited minus watched. */
  wouldRetire: number;
  /** With the operator override: candidates minus cited. */
  wouldRetireIncludingWatched: number;
  sampleIds: string[];
  notProvable: NotProvableDimension[];
  /** A retire stopped at the reviewed count with candidates left. */
  capReached?: boolean;
  /** Sources of rows the retire actually changed, not merely examined. */
  changedBySource: Record<string, number>;
  /**
   * Live pattern names whose case-drifted stale identities retired. A dry-run
   * warning dimension: renaming a pattern by case orphans the old identities,
   * which can never be re-detected, without removing anything.
   */
  caseDriftedPatterns: string[];
}

/**
 * Partial unique indexes enforcing the one-shot dry-run binding and the
 * single active retire per detector at the database level (see the
 * `retire_one_shot_binding` migration). Named here so the P2002 mapping below
 * and the migration cannot drift apart silently.
 */
export const RETIRE_FROM_OPERATION_INDEX =
  'finding_bulk_operations_retire_from_op_uniq';
export const RETIRE_DETECTOR_ACTIVE_INDEX =
  'finding_bulk_operations_retire_detector_active_uniq';

const ACTIVE: FindingBulkOperationStatus[] = [
  FindingBulkOperationStatus.PENDING,
  FindingBulkOperationStatus.RUNNING,
];

/**
 * Retire findings a narrowed custom detector can no longer produce.
 *
 * Two operations, both background walks over the same pages with the same
 * exemption code, so the number an operator reviews is the number the retire
 * would change at that moment — not a second implementation of it in SQL:
 *
 *  1. dry run — counts candidates by reason and exemption, changes nothing;
 *  2. retire — requires a completed dry run of the unchanged detector plus an
 *     explicit confirmation, and never changes more findings than it reported.
 *
 * Exemptions: a finding a case cites is never retired. A finding an ACTIVE
 * inquiry watches is retired only when an operator passes the override, which
 * the MCP tool does not expose — an agent cannot empty an investigation.
 *
 * A retired finding is RESOLVED with a RESOLVED history entry, not a
 * STATUS_CHANGED one: it is not a manual override, so re-widening the scope
 * lets re-detection reopen it. It records no detector feedback, because
 * "out of scope" is not a judgement on whether the detection was right.
 */
@Injectable()
export class RetireOutOfScopeService {
  private readonly logger = new Logger(RetireOutOfScopeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: FindingBulkOperationService,
    @Optional() private readonly inquiryMatching?: InquiryMatchingService,
    @Optional() private readonly correlationJobs?: CorrelationJobScheduler,
    @Optional() private readonly statsJobs?: FindingStatsScheduler,
  ) {}

  async startDryRun(
    detectorId: string,
    input: { sourceIds?: unknown; createdBy?: string | null },
  ): Promise<FindingBulkOperation> {
    const detector = await this.detector(detectorId);
    const plan = buildRetirePlan(detector, normalizeSourceIds(input.sourceIds));
    return this.operations.create({
      kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
      filters: { mode: 'dry_run', plan } satisfies RetireFilters,
      target: {},
      totalEstimate: 0,
      counts: emptyCounts(plan) as unknown as Record<string, unknown>,
      createdBy: input.createdBy ?? null,
    });
  }

  async startRetire(
    detectorId: string,
    input: {
      fromOperationId?: unknown;
      expectedCount?: unknown;
      confirm?: unknown;
      includeInquiryWatched?: unknown;
      sourceIds?: unknown;
      createdBy?: string | null;
    },
    options: { allowInquiryOverride: boolean },
  ): Promise<FindingBulkOperation> {
    const includeInquiryWatched = input.includeInquiryWatched === true;
    if (includeInquiryWatched && !options.allowInquiryOverride) {
      throw new BadRequestException(
        'includeInquiryWatched is an operator decision and is not available here.',
      );
    }
    if (input.sourceIds !== undefined && input.sourceIds !== null) {
      throw new BadRequestException(
        'sourceIds is a dry-run-only parameter: start a new dry run to change the source scope.',
      );
    }
    if (typeof input.fromOperationId !== 'string' || !input.fromOperationId) {
      throw new BadRequestException(
        'fromOperationId is required: run a dry run first and pass its operation id.',
      );
    }
    if (input.confirm !== true) {
      throw new BadRequestException(
        'confirm: true is required to retire findings.',
      );
    }

    const dryRun = await this.operations.get(input.fromOperationId);
    const dryFilters = parseFilters(dryRun);
    if (dryFilters.mode !== 'dry_run') {
      throw new BadRequestException(
        `Operation ${dryRun.id} is not a retire dry run.`,
      );
    }
    if (dryFilters.plan.detectorId !== detectorId) {
      throw new BadRequestException(
        `Dry run ${dryRun.id} was for a different detector.`,
      );
    }
    if (dryRun.status !== FindingBulkOperationStatus.COMPLETED) {
      throw new ConflictException(
        `Dry run ${dryRun.id} is ${dryRun.status.toLowerCase()}, not completed.`,
      );
    }
    if (
      !dryRun.finishedAt ||
      Date.now() - dryRun.finishedAt.getTime() > RETIRE_DRY_RUN_MAX_AGE_MS
    ) {
      throw new ConflictException(
        `Dry run ${dryRun.id} is more than 24 hours old. Run a new one.`,
      );
    }

    const detector = await this.detector(detectorId);
    if (
      detector.version !== dryFilters.plan.detectorVersion ||
      detector.key !== dryFilters.plan.customDetectorKey
    ) {
      throw new ConflictException(
        `Detector ${detector.key} changed after the dry run ` +
          `(version ${dryFilters.plan.detectorVersion} → ${detector.version}). ` +
          'Run a new dry run.',
      );
    }

    const reviewed = parseCounts(dryRun.counts, dryFilters.plan);
    const cap = includeInquiryWatched
      ? reviewed.wouldRetireIncludingWatched
      : reviewed.wouldRetire;
    const expectedCount = Number(input.expectedCount);
    if (!Number.isInteger(expectedCount) || expectedCount !== cap) {
      throw new ConflictException({
        message:
          `expectedCount must be the dry run's ` +
          `${includeInquiryWatched ? 'wouldRetireIncludingWatched' : 'wouldRetire'} ` +
          `(${cap}).`,
        expectedCount: input.expectedCount ?? null,
        reviewedCount: cap,
      });
    }
    if (cap === 0) {
      throw new BadRequestException(
        'The dry run found nothing to retire under this policy.',
      );
    }

    const previous = await this.prisma.findingBulkOperation.findFirst({
      where: {
        kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
        OR: [
          // One dry run authorizes one retire: its counts describe a corpus
          // the first retire has already changed. A retire that changed
          // nothing and is no longer running (CANCELLED/FAILED with zero rows
          // changed) burned nothing — the corpus is as reviewed, so the dry
          // run stays usable.
          {
            filters: { path: ['fromOperationId'], equals: dryRun.id },
            OR: [{ changed: { gt: 0 } }, { status: { in: ACTIVE } }],
          },
          // Two retires walking the same detector at once; a dry run running
          // alongside changes nothing and blocks nothing.
          {
            status: { in: ACTIVE },
            AND: [
              { filters: { path: ['mode'], equals: 'retire' } },
              { filters: { path: ['plan', 'detectorId'], equals: detectorId } },
            ],
          },
        ],
      },
      select: { id: true, status: true },
    });
    if (previous) {
      throw new ConflictException(
        ACTIVE.includes(previous.status)
          ? `Operation ${previous.id} is already running for this detector.`
          : `Dry run ${dryRun.id} was already used by operation ${previous.id}. Run a new dry run.`,
      );
    }

    try {
      return await this.operations.create({
        kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
        filters: {
          mode: 'retire',
          plan: dryFilters.plan,
          fromOperationId: dryRun.id,
          includeInquiryWatched,
        } satisfies RetireFilters,
        target: { status: 'RESOLVED', cap },
        totalEstimate: cap,
        counts: emptyCounts(dryFilters.plan) as unknown as Record<
          string,
          unknown
        >,
        createdBy: input.createdBy ?? null,
      });
    } catch (error) {
      // The pre-check above can race a concurrent startRetire: the database
      // guard (partial unique indexes) wins, and its violation maps back to
      // the same 409s.
      throw retireCreateConflict(error, dryRun.id);
    }
  }

  /** One bounded chunk of a dry run or retire. */
  async runChunk(
    operation: FindingBulkOperation,
    budgetMs: number,
  ): Promise<{ done: boolean }> {
    const filters = parseFilters(operation);
    const { plan } = filters;
    const retire = filters.mode === 'retire';
    const cap = retire ? capOf(operation.target) : Number.POSITIVE_INFINITY;
    const counts = parseCounts(operation.counts, plan);

    if (
      operation.cursor === null &&
      !planNeedsWalk(plan) &&
      !(await this.hasStaleRegexFindings(plan))
    ) {
      await this.prisma.findingBulkOperation.update({
        where: { id: operation.id },
        data: { counts: countsJson(counts) },
      });
      return { done: true };
    }

    const matchers = await this.activeInquiryMatchers();
    const inquiryCounts = new Map(counts.inquiries.map((i) => [i.id, i]));
    const reasonTexts = new Map<string, string>();
    const actor = operation.createdBy ?? 'system';

    let blocksTotal = await this.relationBlocks();
    let block = operation.cursor ? Number(operation.cursor) : 0;
    let changed = operation.changed;
    const started = Date.now();

    for (;;) {
      // Re-read per page, not once per walk: a detector edit between pages
      // must stop the walk before the next page commits under a stale plan.
      // One indexed primary-key fetch per page.
      await this.assertDetectorUnchanged(plan);

      // Heartbeat before the expensive part of the page (scan SQL, classify,
      // writes): a slow page otherwise looks exactly like a dead worker while
      // watching progress. The final chunk of one dry run sat unchanged for
      // eleven minutes this way.
      counts.scan = { blocksScanned: block, blocksTotal };
      await this.prisma.findingBulkOperation.update({
        where: { id: operation.id },
        data: { counts: countsJson(counts) },
      });

      if (block >= blocksTotal) {
        // Ingest may have appended blocks since the walk began.
        blocksTotal = await this.relationBlocks();
        if (block >= blocksTotal) {
          counts.scan = { blocksScanned: blocksTotal, blocksTotal };
          await this.prisma.findingBulkOperation.update({
            where: { id: operation.id },
            data: { counts: countsJson(counts) },
          });
          return { done: true };
        }
      }

      const toBlock = block + RETIRE_SCAN_BLOCKS;
      const rows = await this.prisma.$queryRaw<CandidateRow[]>(
        candidatePageSql(plan, block, toBlock),
      );
      const cited = await this.citedAmong(rows.map((row) => row.id));

      const byReason = new Map<string, CandidateRow[]>();
      let examined = 0;
      let exempted = 0;
      let retirable = 0;
      for (const row of rows) {
        const reason = outOfScopeReason(plan, row);
        // SQL and this check are held to agree by a spec; if they ever do not,
        // doing nothing is the only safe reading.
        if (!reason) continue;
        examined += 1;
        counts.candidates += 1;
        counts.byReason[reason] = (counts.byReason[reason] ?? 0) + 1;
        counts.bySource[row.sourceId] =
          (counts.bySource[row.sourceId] ?? 0) + 1;

        if (cited.has(row.id)) {
          counts.citedByCase += 1;
          exempted += 1;
          continue;
        }
        const watchers = matchers.filter(({ matcher }) => matcher.matches(row));
        for (const { id, title } of watchers) {
          const entry = inquiryCounts.get(id) ?? { id, title, count: 0 };
          entry.count += 1;
          inquiryCounts.set(id, entry);
        }
        counts.wouldRetireIncludingWatched += 1;
        if (watchers.length > 0) {
          counts.watchedByInquiries += 1;
          if (!filters.includeInquiryWatched) {
            exempted += 1;
            continue;
          }
        } else {
          counts.wouldRetire += 1;
          if (counts.sampleIds.length < RETIRE_SAMPLE_IDS) {
            counts.sampleIds.push(row.id);
          }
        }
        if (!retire) continue;
        if (changed + retirable >= cap) {
          counts.capReached = true;
          continue;
        }
        retirable += 1;
        const group = byReason.get(reason) ?? [];
        group.push(row);
        byReason.set(reason, group);
        const drifted = caseDriftCurrentName(plan, reason);
        if (drifted && !counts.caseDriftedPatterns.includes(drifted)) {
          counts.caseDriftedPatterns.push(drifted);
          counts.caseDriftedPatterns.sort();
        }
      }
      counts.inquiries = [...inquiryCounts.values()].sort(
        (a, b) => b.count - a.count,
      );
      counts.scan = {
        blocksScanned: Math.min(toBlock, blocksTotal),
        blocksTotal,
      };

      const progress = {
        cursor: String(toBlock),
        processed: { increment: examined },
        exempted: { increment: exempted },
      };
      if (byReason.size > 0) {
        // One page is many small transactions, never one page-wide one. A
        // 2,000-row UPDATE measured 11–43 s on a real corpus against a 30 s
        // budget, failing deterministically; 250-row batches measured ~6–7 s.
        // Page-level atomicity buys nothing here: each row's status and
        // history move together in its batch, and the walk resumes from its
        // block cursor. After a crash mid-page the next walk re-scans these
        // blocks, so the candidacy census may over-count; `changed` stays
        // exact because every batch commits its own increment.
        const freshMatchers =
          filters.includeInquiryWatched === true
            ? null
            : await this.freshInquiryMatchers();
        const batches: Array<{ text: string; rows: CandidateRow[] }> = [];
        for (const [reason, candidates] of byReason) {
          let text = reasonTexts.get(reason);
          if (!text) {
            text = resolutionReasonFor(plan, reason);
            reasonTexts.set(reason, text);
          }
          for (const rows of splitIntoBatches(
            candidates,
            BULK_OPERATION_WRITE_BATCH_SIZE,
          )) {
            batches.push({ text, rows });
          }
        }
        let pageChanged = 0;
        for (let index = 0; index < batches.length; index += 1) {
          const batch = batches[index];
          const last = index === batches.length - 1;
          try {
            const batchChanged = await this.prisma.$transaction(
              async (tx) => {
                const changedSources = await this.retireBatch(
                  tx,
                  plan,
                  batch.rows,
                  batch.text,
                  actor,
                  freshMatchers,
                );
                for (const sourceId of changedSources) {
                  counts.changedBySource[sourceId] =
                    (counts.changedBySource[sourceId] ?? 0) + 1;
                }
                await tx.findingBulkOperation.update({
                  where: { id: operation.id },
                  // The cursor advances only with the last batch: earlier
                  // batches commit their `changed` increment, but the page is
                  // not done until every batch is.
                  data: last
                    ? {
                        ...progress,
                        changed: { increment: changedSources.length },
                        counts: countsJson(counts),
                      }
                    : {
                        changed: { increment: changedSources.length },
                        counts: countsJson(counts),
                      },
                });
                return changedSources.length;
              },
              { timeout: BULK_OPERATION_TX_TIMEOUT_MS },
            );
            pageChanged += batchChanged;
          } catch (error) {
            throw retireWriteError(error, batch.rows.length);
          }
        }
        changed += pageChanged;
      } else {
        await this.prisma.findingBulkOperation.update({
          where: { id: operation.id },
          data: { ...progress, counts: countsJson(counts) },
        });
      }
      block = toBlock;

      if (counts.capReached) return { done: true };
      if (Date.now() - started >= budgetMs) return { done: false };
      const latest = await this.prisma.findingBulkOperation.findUnique({
        where: { id: operation.id },
        select: { cancelRequested: true },
      });
      if (latest?.cancelRequested) return { done: true };
      await new Promise((resolve) =>
        setTimeout(resolve, BULK_OPERATION_PAGE_PAUSE_MS),
      );
    }
  }

  /** Rebuild what a finished retire invalidated, once. */
  async afterOperation(operation: FindingBulkOperation): Promise<void> {
    const filters = parseFilters(operation);
    if (filters.mode !== 'retire' || operation.changed === 0) return;
    await this.correlationJobs?.scheduleFull('out-of-scope findings retired');
    await this.statsJobs?.scheduleFull('out-of-scope findings retired');
    // Without the override no watched finding changed, so no ACTIVE inquiry's
    // count can have moved.
    if (!filters.includeInquiryWatched || !this.inquiryMatching) return;
    const counts = parseCounts(operation.counts, filters.plan);
    // Sources this retire actually changed — not the candidate census in
    // bySource, which also counts exempted findings nothing changed. Uncapped:
    // every changed source's inquiry counts must refresh, however many there
    // are.
    for (const sourceId of Object.keys(counts.changedBySource)) {
      await this.inquiryMatching
        .processSourceCompletion(sourceId, null)
        .catch((error) =>
          this.logger.warn(
            `Inquiry counts for source ${sourceId} not refreshed: ${String(error)}`,
          ),
        );
    }
  }

  /**
   * ACTIVE inquiry matchers as of now, fetched OUTSIDE any write transaction.
   * This used to reload and recompile every ACTIVE inquiry matcher once per
   * reason group inside the page transaction — avoidable work in the most
   * expensive place. One fetch per page is as fresh as the batch that uses it.
   */
  private async freshInquiryMatchers(): Promise<CompiledMatcher[]> {
    const fresh = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE' },
      select: {
        matchAllSources: true,
        sourceIds: true,
        detectorTypes: true,
        customDetectorKeys: true,
        findingTypes: true,
        findingTypeRegex: true,
        findingValueRegex: true,
      },
    });
    return fresh.map((inquiry) => new CompiledMatcher(inquiry));
  }

  /**
   * Resolve one write batch of candidates, re-checking both exemptions at
   * write time. The page snapshot (candidates, cited set, inquiry matchers)
   * can be stale by the time this transaction commits, so the UPDATE trusts
   * none of it: a case citation after the snapshot is closed by the NOT EXISTS
   * below, and an inquiry watch after the snapshot by re-matching against the
   * matchers fetched just before this batch. Returns the sources of the rows
   * the UPDATE actually changed.
   */
  private async retireBatch(
    tx: Prisma.TransactionClient,
    plan: RetirePlan,
    rows: CandidateRow[],
    reason: string,
    actor: string,
    freshMatchers: CompiledMatcher[] | null,
  ): Promise<string[]> {
    let targets = rows;
    if (freshMatchers && freshMatchers.length > 0) {
      targets = rows.filter(
        (row) => !freshMatchers.some((matcher) => matcher.matches(row)),
      );
    }
    if (targets.length === 0) return [];
    const entry = historyEntryForStorage({
      timestamp: new Date(),
      runnerId: 'manual',
      eventType: HistoryEventType.RESOLVED,
      status: 'RESOLVED',
      changedBy: actor,
      changeReason: reason,
    });
    const changed = await tx.$queryRaw<Array<{ sourceId: string }>>`
      UPDATE findings
      SET status = 'RESOLVED'::"FindingStatus",
          resolved_at = now(),
          resolution_reason = ${reason},
          updated_at = now(),
          history = COALESCE(history, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb
      WHERE id = ANY(${targets.map((row) => row.id)}::text[])
        AND status = 'OPEN'::"FindingStatus"
        AND custom_detector_key = ${plan.customDetectorKey}
        AND NOT EXISTS (
          SELECT 1 FROM case_findings WHERE finding_id = findings.id
        )
      RETURNING source_id AS "sourceId"
    `;
    return changed.map((row) => row.sourceId);
  }

  private async detector(id: string) {
    const detector = await this.prisma.customDetector.findUnique({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        version: true,
        pipelineSchema: true,
      },
    });
    if (!detector) {
      throw new NotFoundException(`Custom detector ${id} not found`);
    }
    return detector;
  }

  private async assertDetectorUnchanged(plan: RetirePlan): Promise<void> {
    const current = await this.prisma.customDetector.findUnique({
      where: { id: plan.detectorId },
      select: { key: true, version: true },
    });
    if (
      !current ||
      current.key !== plan.customDetectorKey ||
      current.version !== plan.detectorVersion
    ) {
      throw new Error(
        `Detector ${plan.customDetectorKey} changed while this operation ran; ` +
          'pages already committed stay committed. Run a new dry run.',
      );
    }
  }

  private async hasStaleRegexFindings(plan: RetirePlan): Promise<boolean> {
    // A scoped probe: without the source filter a stale finding in any other
    // source would send a source-restricted dry run on a full walk.
    const sources = plan.sourceIds
      ? Prisma.sql`AND source_id = ANY(${plan.sourceIds}::text[])`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM findings
      WHERE custom_detector_key = ${plan.customDetectorKey}
        AND status = 'OPEN'::"FindingStatus"
        AND finding_type LIKE 'regex:%'
        ${sources}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  private async relationBlocks(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ blocks: number }>>`
      SELECT (pg_relation_size('findings'::regclass)
              / current_setting('block_size')::bigint)::int AS blocks
    `;
    return Number(row?.blocks ?? 0);
  }

  private async citedAmong(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<Array<{ findingId: string }>>`
      SELECT DISTINCT finding_id AS "findingId"
      FROM case_findings
      WHERE finding_id = ANY(${ids}::text[])
    `;
    return new Set(rows.map((row) => row.findingId));
  }

  private async activeInquiryMatchers(): Promise<
    Array<{ id: string; title: string; matcher: CompiledMatcher }>
  > {
    const inquiries = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        title: true,
        matchAllSources: true,
        sourceIds: true,
        detectorTypes: true,
        customDetectorKeys: true,
        findingTypes: true,
        findingTypeRegex: true,
        findingValueRegex: true,
      },
    });
    return inquiries.map((inquiry) => ({
      id: inquiry.id,
      title: inquiry.title,
      matcher: new CompiledMatcher(inquiry),
    }));
  }
}

function normalizeSourceIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== 'string') ||
    value.length > 100
  ) {
    throw new BadRequestException(
      'sourceIds must be an array of at most 100 source ids.',
    );
  }
  return value as string[];
}

function parseFilters(operation: FindingBulkOperation): RetireFilters {
  const raw = operation.filters as Partial<RetireFilters> | null;
  if (
    operation.kind !== FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE ||
    !raw ||
    (raw.mode !== 'dry_run' && raw.mode !== 'retire') ||
    !raw.plan ||
    typeof raw.plan.customDetectorKey !== 'string'
  ) {
    throw new BadRequestException(
      `Operation ${operation.id} is not a retire operation.`,
    );
  }
  return raw as RetireFilters;
}

function emptyCounts(plan: RetirePlan): RetireCounts {
  return {
    scan: { blocksScanned: 0, blocksTotal: 0 },
    candidates: 0,
    byReason: {},
    bySource: {},
    citedByCase: 0,
    watchedByInquiries: 0,
    inquiries: [],
    wouldRetire: 0,
    wouldRetireIncludingWatched: 0,
    sampleIds: [],
    notProvable: plan.notProvable,
    changedBySource: {},
    caseDriftedPatterns: [],
  };
}

/**
 * A concurrent startRetire lost the database guard race. Maps the partial
 * unique index violation back to the same 409 the pre-check would have
 * raised; anything else is not ours to translate.
 */
function retireCreateConflict(error: unknown, dryRunId: string): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  ) {
    const detail =
      `${(error as Error).message ?? ''} ` +
      JSON.stringify((error as { meta?: unknown }).meta ?? '');
    if (detail.includes(RETIRE_DETECTOR_ACTIVE_INDEX)) {
      return new ConflictException(
        'Another retire operation is already running for this detector.',
      );
    }
    if (detail.includes(RETIRE_FROM_OPERATION_INDEX)) {
      return new ConflictException(
        `Dry run ${dryRunId} was already used by another operation. ` +
          'Run a new dry run.',
      );
    }
  }
  throw error;
}

function parseCounts(raw: unknown, plan: RetirePlan): RetireCounts {
  const base = emptyCounts(plan);
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...(raw as Partial<RetireCounts>) };
}

function countsJson(counts: RetireCounts): Prisma.InputJsonValue {
  return counts as unknown as Prisma.InputJsonValue;
}

function splitIntoBatches<T>(rows: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    batches.push(rows.slice(start, start + size));
  }
  return batches;
}

/**
 * Name the real cause when a write batch outlives its transaction: the batch
 * is too large for this corpus, not the query it happened to be running. The
 * previous error ("Transaction expired at tx.inquiry.findMany") sent the
 * investigation to the wrong line — the cost is the page UPDATE itself.
 */
function retireWriteError(error: unknown, batchSize: number): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/expired transaction|transaction.*timed? ?out|timed out/i.test(message)) {
    return new Error(
      `Retire write batch of ${batchSize} findings exceeded the ` +
        `${BULK_OPERATION_TX_TIMEOUT_MS} ms transaction budget (${message}). ` +
        'Do not raise the timeout to fit it: reduce ' +
        'BULK_OPERATION_WRITE_BATCH_SIZE.',
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function capOf(target: unknown): number {
  const cap =
    target && typeof target === 'object'
      ? Number((target as Record<string, unknown>).cap)
      : NaN;
  // A retire without a readable cap must change nothing, not everything.
  return Number.isInteger(cap) && cap >= 0 ? cap : 0;
}
