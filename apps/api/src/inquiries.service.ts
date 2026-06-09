import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { InquiryMatchers } from './matching/inquiry-matcher';
import {
  CreateInquiryDto,
  MatchOptionsResponseDto,
  PreviewInquiryDto,
  PreviewResponseDto,
  QueryInquiriesDto,
  InquiryListResponseDto,
  InquiryMatchDto,
  InquiryMatchersDto,
  InquiryResponseDto,
  UpdateInquiryDto,
} from './dto/inquiry.dto';

type InquiryRow = Prisma.InquiryGetPayload<{ include: { _count: { select: { matches: true } } } }>;

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
    if (p.length > 500) throw new BadRequestException(`Regex pattern too long: ${p.slice(0, 30)}…`);
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
  ) {}

  async create(dto: CreateInquiryDto): Promise<InquiryResponseDto> {
    assertValidRegexAll(dto);
    if (dto.caseId) await this.ensureCaseExists(dto.caseId);

    const created = await this.prisma.inquiry.create({
      data: {
        title: dto.title,
        description: dto.description,
        caseId: dto.caseId,
        createdBy: dto.createdBy,
        ...this.matcherData(dto),
      },
      include: this.countInclude,
    });
    // Seed the new query with findings that already match.
    await this.matching.rematchInquiry(created.id);
    return this.findOneOrThrow(created.id);
  }

  async list(query: QueryInquiriesDto): Promise<InquiryListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);

    const where: Prisma.InquiryWhereInput = {};
    const statusFilter = this.toArray(query.status);
    if (statusFilter.length > 0) where.status = { in: statusFilter };
    if (query.caseId === 'none') where.caseId = null;
    else if (query.caseId) where.caseId = query.caseId;
    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.inquiry.findMany({ where, include: this.countInclude, orderBy: { updatedAt: 'desc' }, skip, take: limit }),
      this.prisma.inquiry.count({ where }),
    ]);
    const newCounts = await this.newMatchCounts(rows.map((r) => r.id));
    return { items: rows.map((r) => this.mapInquiry(r, newCounts.get(r.id) ?? 0)), total, skip, limit };
  }

  async findOne(id: string): Promise<InquiryResponseDto | null> {
    const row = await this.prisma.inquiry.findUnique({ where: { id }, include: this.countInclude });
    if (!row) return null;
    const newCounts = await this.newMatchCounts([id]);
    return this.mapInquiry(row, newCounts.get(id) ?? 0);
  }

  async update(id: string, dto: UpdateInquiryDto): Promise<InquiryResponseDto> {
    await this.ensureExists(id);
    assertValidRegexAll(dto);
    if (dto.caseId) await this.ensureCaseExists(dto.caseId);

    await this.prisma.inquiry.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        caseId: dto.caseId === undefined ? undefined : dto.caseId,
        ...this.matcherData(dto),
      },
    });

    // Matchers changed → recompute the match set from scratch.
    if (touchesMatchers(dto)) {
      await this.prisma.inquiryMatch.deleteMany({ where: { inquiryId: id } });
      await this.matching.rematchInquiry(id);
    }
    return this.findOneOrThrow(id);
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.inquiry.delete({ where: { id } });
  }

  /** Findings currently matching the query (joined live), newest first. */
  async listMatches(id: string): Promise<InquiryMatchDto[]> {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id }, select: { matchesSeenAt: true } });
    if (!inquiry) throw new NotFoundException(`Inquiry ${id} not found`);

    const matches = await this.prisma.inquiryMatch.findMany({
      where: { inquiryId: id },
      orderBy: { matchedAt: 'desc' },
    });
    if (matches.length === 0) return [];

    const findings = await this.prisma.finding.findMany({
      where: { id: { in: matches.map((m) => m.findingId) } },
      select: {
        id: true,
        findingType: true,
        severity: true,
        detectorType: true,
        matchedContent: true,
        assetId: true,
        asset: { select: { name: true, sourceType: true } },
      },
    });
    const fMap = new Map(findings.map((f) => [f.id, f]));
    const seenAt = inquiry.matchesSeenAt;

    return matches.flatMap((m) => {
      const f = fMap.get(m.findingId);
      if (!f) return []; // finding deleted/resolved — skip stale match
      return [
        {
          findingId: f.id,
          label: f.findingType,
          severity: String(f.severity),
          detectorType: String(f.detectorType),
          matchedContent: f.matchedContent ?? undefined,
          assetId: f.assetId,
          assetName: f.asset?.name,
          sourceType: f.asset ? String(f.asset.sourceType) : undefined,
          matchedAt: m.matchedAt,
          isNew: !seenAt || m.matchedAt > seenAt,
        },
      ];
    });
  }

  /** Mark the current matches as seen (clears the "new" badge). */
  async markSeen(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.inquiry.update({ where: { id }, data: { matchesSeenAt: new Date() } });
  }

  /** Recompute matches for a question (e.g. on demand). */
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
    const scopedSources = sourceIds && sourceIds.length > 0 ? sourceIds : undefined;
    const [sources, customDetectors, typeRows] = await Promise.all([
      this.prisma.source.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
      this.prisma.customDetector.findMany({ where: { isActive: true }, select: { key: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.finding.groupBy({
        by: ['findingType', 'detectorType'],
        where: { status: 'OPEN', ...(scopedSources ? { sourceId: { in: scopedSources } } : {}) },
        _count: { _all: true },
      }),
    ]);

    const findingTypes = typeRows
      .map((r) => ({ value: r.findingType, detectorType: String(r.detectorType), count: r._count._all }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    return {
      sources: sources.map((s) => ({ id: s.id, name: s.name, type: String(s.type) })),
      customDetectors,
      findingTypes,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────

  private readonly countInclude = { _count: { select: { matches: true } } } satisfies Prisma.InquiryInclude;

  private toArray<T extends string>(value: T | T[] | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return [value];
    return [];
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.inquiry.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException(`Inquiry ${id} not found`);
  }

  private async ensureCaseExists(id: string): Promise<void> {
    const found = await this.prisma.case.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException(`Case ${id} not found`);
  }

  private async findOneOrThrow(id: string): Promise<InquiryResponseDto> {
    const q = await this.findOne(id);
    if (!q) throw new NotFoundException(`Inquiry ${id} not found`);
    return q;
  }

  /** Per-question count of matches newer than that question's matchesSeenAt. */
  private async newMatchCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ inquiry_id: string; cnt: bigint }[]>`
      SELECT m.inquiry_id, COUNT(*) AS cnt
      FROM inquiry_matches m
      JOIN inquiries q ON q.id = m.inquiry_id
      WHERE m.inquiry_id IN (${Prisma.join(ids)})
        AND (q.matches_seen_at IS NULL OR m.matched_at > q.matches_seen_at)
      GROUP BY m.inquiry_id
    `;
    return new Map(rows.map((r) => [r.inquiry_id, Number(r.cnt)]));
  }

  /** Plain matcher field values for create/update (undefined fields are left untouched). */
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

  /** Build a fully-defaulted matcher (for preview, which has no DB row). */
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

  private mapInquiry(row: InquiryRow, newMatchCount: number): InquiryResponseDto {
    return {
      id: row.id,
      caseId: row.caseId,
      title: row.title,
      description: row.description,
      status: row.status,
      createdBy: row.createdBy,
      matchAllSources: row.matchAllSources,
      sourceIds: row.sourceIds,
      detectorTypes: row.detectorTypes,
      customDetectorKeys: row.customDetectorKeys,
      findingTypes: row.findingTypes,
      findingTypeRegex: row.findingTypeRegex,
      findingValueRegex: row.findingValueRegex,
      matchCount: row._count.matches,
      newMatchCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
