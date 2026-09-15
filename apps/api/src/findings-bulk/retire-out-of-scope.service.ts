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
  RETIRE_DRY_RUN_MAX_AGE_MS,
  RETIRE_SAMPLE_IDS,
  RETIRE_SCAN_BLOCKS,
} from './finding-bulk-operation.constants';
import { FindingBulkOperationService } from './finding-bulk-operation.service';
import {
  buildRetirePlan,
  candidatePageSql,
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
}

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
          // the first retire has already changed.
          { filters: { path: ['fromOperationId'], equals: dryRun.id } },
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

    return this.operations.create({
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

    await this.assertDetectorUnchanged(plan);

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

      const byReason = new Map<string, string[]>();
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
        const ids = byReason.get(reason) ?? [];
        ids.push(row.id);
        byReason.set(reason, ids);
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
        const pageChanged = await this.prisma.$transaction(
          async (tx) => {
            let total = 0;
            for (const [reason, ids] of byReason) {
              let text = reasonTexts.get(reason);
              if (!text) {
                text = resolutionReasonFor(plan, reason);
                reasonTexts.set(reason, text);
              }
              total += await this.retirePage(tx, plan, ids, text, actor);
            }
            await tx.findingBulkOperation.update({
              where: { id: operation.id },
              data: {
                ...progress,
                changed: { increment: total },
                counts: countsJson(counts),
              },
            });
            return total;
          },
          { timeout: 30_000 },
        );
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
    for (const sourceId of Object.keys(counts.bySource).slice(0, 100)) {
      await this.inquiryMatching
        .processSourceCompletion(sourceId, null)
        .catch((error) =>
          this.logger.warn(
            `Inquiry counts for source ${sourceId} not refreshed: ${String(error)}`,
          ),
        );
    }
  }

  private async retirePage(
    tx: Prisma.TransactionClient,
    plan: RetirePlan,
    ids: string[],
    reason: string,
    actor: string,
  ): Promise<number> {
    const entry = historyEntryForStorage({
      timestamp: new Date(),
      runnerId: 'manual',
      eventType: HistoryEventType.RESOLVED,
      status: 'RESOLVED',
      changedBy: actor,
      changeReason: reason,
    });
    return tx.$executeRaw`
      UPDATE findings
      SET status = 'RESOLVED'::"FindingStatus",
          resolved_at = now(),
          resolution_reason = ${reason},
          updated_at = now(),
          history = COALESCE(history, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb
      WHERE id = ANY(${ids}::text[])
        AND status = 'OPEN'::"FindingStatus"
        AND custom_detector_key = ${plan.customDetectorKey}
    `;
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
    const rows = await this.prisma.$queryRaw<Array<{ one: number }>>`
      SELECT 1 AS one FROM findings
      WHERE custom_detector_key = ${plan.customDetectorKey}
        AND status = 'OPEN'::"FindingStatus"
        AND finding_type LIKE 'regex:%'
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
  };
}

function parseCounts(raw: unknown, plan: RetirePlan): RetireCounts {
  const base = emptyCounts(plan);
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...(raw as Partial<RetireCounts>) };
}

function countsJson(counts: RetireCounts): Prisma.InputJsonValue {
  return counts as unknown as Prisma.InputJsonValue;
}

function capOf(target: unknown): number {
  const cap =
    target && typeof target === 'object'
      ? Number((target as Record<string, unknown>).cap)
      : NaN;
  // A retire without a readable cap must change nothing, not everything.
  return Number.isInteger(cap) && cap >= 0 ? cap : 0;
}
