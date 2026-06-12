import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
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

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: InquiryMatchingService,
    private readonly agentMemory: AgentMemoryService,
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
    // Seed matchCount with existing findings; resets newMatchCount to 0.
    await this.matching.rematchInquiry(created.id);
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
    return this.mapInquiry(row);
  }

  async update(id: string, dto: UpdateInquiryDto): Promise<InquiryResponseDto> {
    await this.ensureExists(id);
    assertValidRegexAll(dto);

    await this.prisma.inquiry.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        aiMode: dto.aiMode,
        ...this.matcherData(dto),
      },
    });

    // Matchers changed → recompute matchCount from scratch, reset newMatchCount.
    if (touchesMatchers(dto)) {
      await this.matching.rematchInquiry(id);
    }
    return this.findOneOrThrow(id);
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

  /** Mark the current matches as seen (clears the "new" badge). */
  async markSeen(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.inquiry.update({
      where: { id },
      data: { newMatchCount: 0, matchesSeenAt: new Date() },
    });
  }

  /** Recompute matches for a query (e.g. on demand). */
  async rematch(id: string): Promise<{ landed: number }> {
    await this.ensureExists(id);
    return this.matching.rematchInquiry(id);
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
    const [sources, customDetectors, typeRows] = await Promise.all([
      this.prisma.source.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customDetector.findMany({
        where: { isActive: true },
        select: { key: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.finding.groupBy({
        by: ['findingType', 'detectorType'],
        where: {
          status: 'OPEN',
          ...(scopedSources ? { sourceId: { in: scopedSources } } : {}),
        },
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

    return {
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        type: String(s.type),
      })),
      customDetectors,
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
