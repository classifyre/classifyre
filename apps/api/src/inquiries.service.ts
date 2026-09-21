import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DetectorType, InquiryActivityType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { InquiryActivityService } from './inquiry-activity.service';
import { InquiryTimelineResponseDto } from './dto/inquiry-activity.dto';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';
import { InquiryMatchers } from './matching/inquiry-matcher';
import {
  CreateInquiryDto,
  MatchOptionsResponseDto,
  PreviewInquiryDto,
  PreviewResponseDto,
  QueryInquiriesDto,
  InquiryListResponseDto,
  InquiryMatchListResponseDto,
  InquiryMatchersDto,
  QueryInquiryMatchesDto,
  InquiryResponseDto,
  UpdateInquiryDto,
} from './dto/inquiry.dto';

/** True when any matcher field was provided (→ matches must be recomputed). */
function touchesMatchers(dto: InquiryMatchersDto): boolean {
  return (
    dto.matchAllSources !== undefined ||
    dto.sourceIds !== undefined ||
    dto.detectorTypes !== undefined ||
    dto.customDetectorKeys !== undefined ||
    dto.findingTypes !== undefined ||
    dto.findingTypeRegex !== undefined ||
    dto.findingValueRegex !== undefined
  );
}

function assertValidRegex(patterns: string[] | undefined): void {
  for (const p of patterns ?? []) {
    if (p.length > 500)
      throw new BadRequestException(
        `Regex pattern too long: ${p.slice(0, 30)}…`,
      );
    try {
      new RegExp(p);
    } catch {
      throw new BadRequestException(`Invalid regex pattern: ${p}`);
    }
  }
}

function assertValidRegexAll(dto: InquiryMatchersDto): void {
  assertValidRegex(dto.findingTypeRegex);
  assertValidRegex(dto.findingValueRegex);
}

/** Finding types listed per custom detector in the match-options response. */
const MATCH_OPTION_TYPE_CAP = 25;

/** The pipeline engine a custom detector runs on, or null if unreadable. */
function pipelineTypeOf(pipelineSchema: unknown): string | null {
  if (!pipelineSchema || typeof pipelineSchema !== 'object') return null;
  const type = (pipelineSchema as Record<string, unknown>).type;
  return typeof type === 'string' && type.length > 0 ? type : null;
}

/**
 * Which dimension of a detector's findings carries the answer.
 *
 * This is a property of the ENGINE, not of the data, which is why it can be
 * answered from the pipeline schema and does not need a statistical guess:
 *
 *   TAG    findingType = `tag:<label>` (the question), matchedContent = the
 *          verdict `hoch (5/12): amtswegig gelöscht; …` (the ANSWER).
 *   REGEX  findingType names the rule; matchedContent is what matched.
 *   LLM /  the predicted label IS the finding type (`insolvenzgefahr_hoch`)
 *   classifiers  and matchedContent is the model's prose reasoning.
 *
 * Getting it backwards produces zero matches and no error — an inquiry with a
 * wrong matcher and an inquiry with nothing to match look identical. Switching
 * one question from `findingValueRegex` to `findingTypes` took it from 0 to 50
 * matches instantly.
 */
function answerDimensionFor(
  pipelineType: string | null,
): 'findingType' | 'matchedContent' {
  switch ((pipelineType ?? '').toUpperCase()) {
    case 'LLM':
    case 'TEXT_CLASSIFICATION':
    case 'IMAGE_CLASSIFICATION':
    case 'OBJECT_DETECTION':
      return 'findingType';
    // TAG, REGEX, GLINER2 and anything unrecognised: the type names the rule
    // or the label, and the extracted value is what the reader wants.
    default:
      return 'matchedContent';
  }
}

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: InquiryMatchingService,
    private readonly agentMemory: AgentMemoryService,
    private readonly activity: InquiryActivityService,
  ) {}

  private readonly caseInclude = {
    caseLinks: {
      include: { case: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'asc' as const },
    },
  } satisfies Prisma.InquiryInclude;

  async create(dto: CreateInquiryDto): Promise<InquiryResponseDto> {
    assertValidRegexAll(dto);

    const created = await this.prisma.inquiry.create({
      data: {
        title: dto.title,
        description: dto.description,
        createdBy: dto.createdBy,
        ...this.matcherData(dto),
      },
    });
    // Seed the counters from the findings that already exist. A brand new
    // inquiry can legitimately open with matches already flagged NEW: newness
    // is measured against the source's latest run, not against the question's
    // own age.
    await this.matching.rematchInquiry(created.id);
    await this.activity.record(
      created.id,
      InquiryActivityType.INQUIRY_CREATED,
      { title: created.title, matchers: this.matcherSnapshot(created) },
      dto.createdBy ?? undefined,
    );
    await this.agentMemory.syncEntityMap('inquiry', created.id);
    return this.findOneOrThrow(created.id);
  }

  async list(query: QueryInquiriesDto): Promise<InquiryListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);

    const where: Prisma.InquiryWhereInput = {};
    const statusFilter = this.toArray(query.status);
    if (statusFilter.length > 0) where.status = { in: statusFilter };
    if (query.caseId === 'none') where.caseLinks = { none: {} };
    else if (query.caseId) where.caseLinks = { some: { caseId: query.caseId } };
    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        include: this.caseInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.inquiry.count({ where }),
    ]);
    return { items: rows.map((r) => this.mapInquiry(r)), total, skip, limit };
  }

  async findOne(id: string): Promise<InquiryResponseDto | null> {
    const row = await this.prisma.inquiry.findUnique({
      where: { id },
      include: this.caseInclude,
    });
    if (!row) return null;
    // Detail view only. The list would pay one anchor query per row for a value
    // no list column shows.
    const lastRunAt = await this.matching.latestRunAt(row);
    return { ...this.mapInquiry(row), lastRunAt };
  }

  async update(id: string, dto: UpdateInquiryDto): Promise<InquiryResponseDto> {
    const before = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!before) throw new NotFoundException(`Inquiry ${id} not found`);
    assertValidRegexAll(dto);

    const after = await this.prisma.inquiry.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        aiMode: dto.aiMode,
        ...this.matcherData(dto),
      },
    });

    if (dto.status && dto.status !== before.status) {
      await this.activity.record(id, InquiryActivityType.STATUS_CHANGED, {
        from: before.status,
        to: dto.status,
      });
    }

    // Matchers changed → recompute every counter from scratch. The before/after
    // snapshot is the point: a question whose answers changed shape is usually
    // a question whose definition changed, and without this the timeline shows
    // the effect with no trace of the cause.
    if (touchesMatchers(dto)) {
      await this.activity.record(id, InquiryActivityType.MATCHERS_UPDATED, {
        before: this.matcherSnapshot(before),
        after: this.matcherSnapshot(after),
      });
      await this.matching.rematchInquiry(id);
    }
    await this.agentMemory.syncEntityMap('inquiry', id);
    return this.findOneOrThrow(id);
  }

  /** The matcher dimensions, for a timeline diff. */
  private matcherSnapshot(row: {
    matchAllSources: boolean;
    sourceIds: string[];
    detectorTypes: unknown[];
    customDetectorKeys: string[];
    findingTypes: string[];
    findingTypeRegex: string[];
    findingValueRegex: string[];
  }): Record<string, unknown> {
    return {
      matchAllSources: row.matchAllSources,
      sourceIds: row.sourceIds,
      detectorTypes: row.detectorTypes.map(String),
      customDetectorKeys: row.customDetectorKeys,
      findingTypes: row.findingTypes,
      findingTypeRegex: row.findingTypeRegex,
      findingValueRegex: row.findingValueRegex,
    };
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.inquiry.findUnique({
      where: { id },
      select: { title: true },
    });
    if (!existing) throw new NotFoundException(`Inquiry ${id} not found`);
    await this.prisma.inquiry.delete({ where: { id } });
    // Keep the autopilot's memory consistent: drop memories referencing the
    // dead inquiry and remember that the operator deleted it on purpose.
    await this.agentMemory.recordEntityDeletion('inquiry', id, existing.title);
  }

  /** Findings currently matching the query (live query, never persisted). */
  async listMatches(
    id: string,
    query: QueryInquiryMatchesDto = {},
  ): Promise<InquiryMatchListResponseDto> {
    await this.ensureExists(id);
    return this.matching.getLiveMatches(id, query);
  }

  /**
   * Acknowledge the current matches.
   *
   * This no longer clears the "new" badge, and that is the point. Newness is
   * measured against the source's latest run, so reading an inquiry cannot make
   * its answers stale — only another scan can. Zeroing the counter here meant
   * the signal was destroyed by the act of looking at it, which is the opposite
   * of what a standing question is for. The stamp survives as an
   * acknowledgement other readers can use.
   */
  async markSeen(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.inquiry.update({
      where: { id },
      data: { matchesSeenAt: new Date() },
    });
  }

  /** Recompute matches for a query (e.g. on demand). */
  async rematch(id: string): Promise<{ landed: number }> {
    await this.ensureExists(id);
    const result = await this.matching.rematchInquiry(id);
    await this.activity.record(id, InquiryActivityType.REMATCHED, {
      matchCount: result.landed,
    });
    return result;
  }

  /** The inquiry's own history: config changes and each run's deltas. */
  async timeline(
    id: string,
    cursor?: string,
    limit?: number,
  ): Promise<InquiryTimelineResponseDto> {
    await this.ensureExists(id);
    return this.activity.getTimeline(id, cursor, limit);
  }

  /** Preview what a matcher config currently selects, before saving. */
  async preview(dto: PreviewInquiryDto): Promise<PreviewResponseDto> {
    assertValidRegexAll(dto);
    return this.matching.preview(this.toMatchers(dto));
  }

  /** Filter options for the create form: sources, custom detectors, distinct finding types. */
  async matchOptions(sourceIds?: string[]): Promise<MatchOptionsResponseDto> {
    const scopedSources =
      sourceIds && sourceIds.length > 0 ? sourceIds : undefined;
    const findingScope = {
      status: 'OPEN' as const,
      ...(scopedSources ? { sourceId: { in: scopedSources } } : {}),
    };
    // Per-source sizes are global (not scoped to the selected sources): the
    // source picker lists every source, so each row needs its own totals.
    // Both group-bys hit indexed source_id columns and return one row per
    // source, so this stays a constant handful of queries either way.
    const [
      sources,
      customDetectors,
      typeRows,
      customTypeRows,
      assetCounts,
      findingCounts,
    ] = await Promise.all([
      this.prisma.source.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customDetector.findMany({
        where: { isActive: true },
        select: { key: true, name: true, pipelineSchema: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.finding.groupBy({
        by: ['findingType', 'detectorType'],
        where: findingScope,
        _count: { _all: true },
      }),
      // Which finding types each custom detector actually emits. This is what
      // makes the answer-dimension hint actionable: for an LLM detector the
      // author can put these straight into `findingTypes`, instead of writing
      // a value regex that matches nothing.
      this.prisma.finding.groupBy({
        by: ['customDetectorKey', 'findingType'],
        where: { ...findingScope, detectorType: 'CUSTOM' },
        _count: { _all: true },
      }),
      this.prisma.asset.groupBy({
        by: ['sourceId'],
        _count: { _all: true },
      }),
      this.prisma.finding.groupBy({
        by: ['sourceId'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
    ]);

    const findingTypes = typeRows
      .map((r) => ({
        value: r.findingType,
        detectorType: String(r.detectorType),
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    const observed = new Map<string, Array<{ type: string; count: number }>>();
    for (const row of customTypeRows) {
      if (!row.customDetectorKey) continue;
      const list = observed.get(row.customDetectorKey) ?? [];
      list.push({ type: row.findingType, count: row._count._all });
      observed.set(row.customDetectorKey, list);
    }

    const assetsBySource = new Map(
      assetCounts.map((r) => [r.sourceId, r._count._all]),
    );
    const findingsBySource = new Map(
      findingCounts.map((r) => [r.sourceId, r._count._all]),
    );

    return {
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        type: String(s.type),
        assetCount: assetsBySource.get(s.id) ?? 0,
        openFindingCount: findingsBySource.get(s.id) ?? 0,
      })),
      customDetectors: customDetectors.map((d) => {
        const types = (observed.get(d.key) ?? []).sort(
          (a, b) => b.count - a.count || a.type.localeCompare(b.type),
        );
        const pipelineType = pipelineTypeOf(d.pipelineSchema);
        const answerDimension = answerDimensionFor(pipelineType);
        return {
          key: d.key,
          name: d.name,
          pipelineType,
          answerDimension,
          suggestedMatcher:
            answerDimension === 'findingType'
              ? ('findingTypes' as const)
              : ('findingValueRegex' as const),
          findingTypes: types
            .slice(0, MATCH_OPTION_TYPE_CAP)
            .map((t) => t.type),
          openFindings: types.reduce((sum, t) => sum + t.count, 0),
        };
      }),
      findingTypes,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────

  private toArray<T extends string>(value: T | T[] | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return [value];
    return [];
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.inquiry.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Inquiry ${id} not found`);
  }

  private async findOneOrThrow(id: string): Promise<InquiryResponseDto> {
    const q = await this.findOne(id);
    if (!q) throw new NotFoundException(`Inquiry ${id} not found`);
    return q;
  }

  private matcherData(dto: InquiryMatchersDto): {
    matchAllSources?: boolean;
    sourceIds?: string[];
    detectorTypes?: DetectorType[];
    customDetectorKeys?: string[];
    findingTypes?: string[];
    findingTypeRegex?: string[];
    findingValueRegex?: string[];
  } {
    return {
      matchAllSources: dto.matchAllSources,
      sourceIds: dto.sourceIds,
      detectorTypes: dto.detectorTypes,
      customDetectorKeys: dto.customDetectorKeys,
      findingTypes: dto.findingTypes,
      findingTypeRegex: dto.findingTypeRegex,
      findingValueRegex: dto.findingValueRegex,
    };
  }

  private toMatchers(dto: InquiryMatchersDto): InquiryMatchers {
    return {
      matchAllSources: dto.matchAllSources ?? false,
      sourceIds: dto.sourceIds ?? [],
      detectorTypes: dto.detectorTypes ?? [],
      customDetectorKeys: dto.customDetectorKeys ?? [],
      findingTypes: dto.findingTypes ?? [],
      findingTypeRegex: dto.findingTypeRegex ?? [],
      findingValueRegex: dto.findingValueRegex ?? [],
    };
  }

  private mapInquiry(
    row: Prisma.InquiryGetPayload<{
      include: {
        caseLinks: {
          include: {
            case: { select: { id: true; title: true; status: true } };
          };
        };
      };
    }>,
  ): InquiryResponseDto {
    return {
      id: row.id,
      cases: row.caseLinks.map((l) => ({
        id: l.case.id,
        title: l.case.title,
        status: String(l.case.status),
      })),
      title: row.title,
      description: row.description,
      status: row.status,
      aiMode: row.aiMode,
      createdBy: row.createdBy,
      matchAllSources: row.matchAllSources,
      sourceIds: row.sourceIds,
      detectorTypes: row.detectorTypes,
      customDetectorKeys: row.customDetectorKeys,
      findingTypes: row.findingTypes,
      findingTypeRegex: row.findingTypeRegex,
      findingValueRegex: row.findingValueRegex,
      matchCount: row.matchCount,
      newMatchCount: row.newMatchCount,
      goneMatchCount: row.goneMatchCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
