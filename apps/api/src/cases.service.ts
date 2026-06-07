import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import {
  AddEvidenceDto,
  CaseEvidenceDto,
  CaseListResponseDto,
  CaseResponseDto,
  CreateCaseDto,
  EvidenceEntityDto,
  QueryCasesDto,
  UpdateCaseDto,
} from './dto/case.dto';
import { GraphResponseDto } from './dto/graph.dto';

type CaseRow = Prisma.CaseGetPayload<{
  include: { _count: { select: { evidence: true; hypotheses: true } } };
}>;

type EvidenceRow = Prisma.CaseEvidenceGetPayload<object>;

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  private readonly countSelect = {
    _count: { select: { evidence: true, hypotheses: true } },
  } satisfies Prisma.CaseInclude;

  async create(dto: CreateCaseDto): Promise<CaseResponseDto> {
    const created = await this.prisma.case.create({
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        severity: dto.severity,
        assignee: dto.assignee,
        createdBy: dto.createdBy,
      },
      include: this.countSelect,
    });
    return this.mapCase(created);
  }

  async list(query: QueryCasesDto): Promise<CaseListResponseDto> {
    // No global ValidationPipe: query params arrive as strings, so coerce
    // defensively here rather than relying on DTO @Type decorators.
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const rawLimit = Number(query.limit ?? 50) || 50;
    const limit = Math.min(Math.max(1, rawLimit), 200);

    const statusFilter = this.toArray(query.status);
    const severityFilter = this.toArray(query.severity);

    const where: Prisma.CaseWhereInput = {};
    if (statusFilter.length > 0) {
      where.status = { in: statusFilter };
    }
    if (severityFilter.length > 0) {
      where.severity = { in: severityFilter };
    }
    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.case.findMany({
        where,
        include: this.countSelect,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.case.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.mapCase(r)),
      total,
      skip,
      limit,
    };
  }

  async findOne(id: string): Promise<CaseResponseDto | null> {
    const row = await this.prisma.case.findUnique({
      where: { id },
      include: { ...this.countSelect, evidence: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    const evidence = await this.hydrateEvidence(row.evidence);
    return { ...this.mapCase(row), evidence };
  }

  async update(id: string, dto: UpdateCaseDto): Promise<CaseResponseDto> {
    await this.ensureExists(id);
    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        severity: dto.severity,
        assignee: dto.assignee,
        conclusion: dto.conclusion,
      },
      include: this.countSelect,
    });
    return this.mapCase(updated);
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.case.delete({ where: { id } });
  }

  async addEvidence(
    caseId: string,
    dto: AddEvidenceDto,
  ): Promise<CaseEvidenceDto> {
    await this.ensureExists(caseId);
    const evidence = await this.prisma.caseEvidence.upsert({
      where: {
        caseId_entityType_entityId: {
          caseId,
          entityType: dto.entityType,
          entityId: dto.entityId,
        },
      },
      create: {
        caseId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        note: dto.note,
        addedBy: dto.addedBy,
      },
      update: { note: dto.note ?? undefined },
    });

    // Seed inferred edges so the new evidence is reachable in the graph.
    if (dto.entityType === 'asset') {
      await this.graph.inferEdgesForAsset(dto.entityId);
    } else if (dto.entityType === 'finding') {
      const finding = await this.prisma.finding.findUnique({
        where: { id: dto.entityId },
        select: { assetId: true },
      });
      if (finding) await this.graph.inferEdgesForAsset(finding.assetId);
    }

    const [hydrated] = await this.hydrateEvidence([evidence]);
    return hydrated;
  }

  async removeEvidence(caseId: string, evidenceId: string): Promise<void> {
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(`Evidence ${evidenceId} not found in case ${caseId}`);
    }
    await this.prisma.caseEvidence.delete({ where: { id: evidenceId } });
  }

  async getGraph(caseId: string, depth = 1): Promise<GraphResponseDto> {
    await this.ensureExists(caseId);
    return this.graph.caseGraph(caseId, depth);
  }

  /** Normalize a query param that may be a single value, array, or undefined. */
  private toArray<T extends string>(value: T | T[] | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return [value];
    return [];
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
  }

  private mapCase(row: CaseRow): CaseResponseDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      severity: row.severity,
      assignee: row.assignee,
      createdBy: row.createdBy,
      conclusion: row.conclusion,
      evidenceCount: row._count.evidence,
      hypothesisCount: row._count.hypotheses,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Resolve asset/finding rows referenced by a set of evidence records. */
  private async hydrateEvidence(rows: EvidenceRow[]): Promise<CaseEvidenceDto[]> {
    const assetIds = rows.filter((r) => r.entityType === 'asset').map((r) => r.entityId);
    const findingIds = rows
      .filter((r) => r.entityType === 'finding')
      .map((r) => r.entityId);

    const [assets, findings] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, name: true, assetType: true, sourceType: true },
      }),
      this.prisma.finding.findMany({
        where: { id: { in: findingIds } },
        select: {
          id: true,
          findingType: true,
          severity: true,
          detectorType: true,
        },
      }),
    ]);

    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const findingMap = new Map(findings.map((f) => [f.id, f]));

    return rows.map((r) => {
      let entity: EvidenceEntityDto | null = null;
      if (r.entityType === 'asset') {
        const a = assetMap.get(r.entityId);
        entity = a
          ? {
              id: a.id,
              label: a.name,
              assetType: a.assetType,
              sourceType: String(a.sourceType),
            }
          : { id: r.entityId, label: '(deleted asset)', missing: true };
      } else if (r.entityType === 'finding') {
        const f = findingMap.get(r.entityId);
        entity = f
          ? {
              id: f.id,
              label: f.findingType,
              severity: String(f.severity),
              detectorType: String(f.detectorType),
            }
          : { id: r.entityId, label: '(deleted finding)', missing: true };
      }
      return {
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        note: r.note,
        addedBy: r.addedBy,
        createdAt: r.createdAt,
        entity,
      };
    });
  }
}
