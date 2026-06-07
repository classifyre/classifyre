import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import {
  AddEvidenceDto,
  AddFindingDto,
  CaseEvidenceDto,
  CaseFindingDto,
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

type EvidenceRow = Prisma.CaseEvidenceGetPayload<{
  include: { findings: true };
}>;

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  private readonly countSelect = {
    _count: { select: { evidence: true, hypotheses: true } },
  } satisfies Prisma.CaseInclude;

  /** Create a case atomically with its first hypothesis. */
  async create(dto: CreateCaseDto): Promise<CaseResponseDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
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
      await tx.hypothesis.create({
        data: {
          caseId: c.id,
          statement: dto.hypothesis,
          createdBy: dto.createdBy,
        },
      });
      // Re-fetch so _count includes the just-created hypothesis.
      return tx.case.findUniqueOrThrow({
        where: { id: c.id },
        include: this.countSelect,
      });
    });
    return this.mapCase(created);
  }

  async list(query: QueryCasesDto): Promise<CaseListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const rawLimit = Number(query.limit ?? 50) || 50;
    const limit = Math.min(Math.max(1, rawLimit), 200);

    const statusFilter = this.toArray(query.status);
    const severityFilter = this.toArray(query.severity);

    const where: Prisma.CaseWhereInput = {};
    if (statusFilter.length > 0) where.status = { in: statusFilter };
    if (severityFilter.length > 0) where.severity = { in: severityFilter };
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

    return { items: rows.map((r) => this.mapCase(r)), total, skip, limit };
  }

  async findOne(id: string): Promise<CaseResponseDto | null> {
    const row = await this.prisma.case.findUnique({
      where: { id },
      include: {
        ...this.countSelect,
        evidence: {
          orderBy: { createdAt: 'asc' },
          include: { findings: true },
        },
      },
    });
    if (!row) return null;
    const evidence = await this.hydrateEvidence(row.evidence as EvidenceRow[]);
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

  /**
   * Add an asset as evidence. Requires at least one hypothesisId — evidence
   * without a hypothesis link is not allowed. Auto-links the evidence to each
   * supplied hypothesis and auto-pulls the asset's open findings as case_findings.
   */
  async addEvidence(caseId: string, dto: AddEvidenceDto): Promise<CaseEvidenceDto> {
    await this.ensureExists(caseId);

    if (dto.entityType !== 'asset') {
      throw new BadRequestException(
        'Evidence must be an asset. Use POST /cases/:id/evidence/:evidenceId/findings to attach findings.',
      );
    }

    if (!dto.hypothesisIds || dto.hypothesisIds.length === 0) {
      throw new BadRequestException(
        'Evidence must be linked to at least one hypothesis. Provide hypothesisIds.',
      );
    }

    // Validate all hypotheses belong to this case.
    const hyps = await this.prisma.hypothesis.findMany({
      where: { id: { in: dto.hypothesisIds }, caseId },
      select: { id: true },
    });
    if (hyps.length !== dto.hypothesisIds.length) {
      throw new BadRequestException(
        'One or more hypothesisIds do not belong to this case.',
      );
    }

    const evidence = await this.prisma.caseEvidence.upsert({
      where: { caseId_entityType_entityId: { caseId, entityType: 'asset', entityId: dto.entityId } },
      create: { caseId, entityType: 'asset', entityId: dto.entityId, note: dto.note, addedBy: dto.addedBy },
      update: { note: dto.note ?? undefined },
      include: { findings: true },
    });

    // Link evidence to each supplied hypothesis (NEUTRAL stance, skip duplicates).
    await this.prisma.caseHypothesisSupport.createMany({
      data: dto.hypothesisIds.map((hId) => ({
        hypothesisId: hId,
        targetType: 'evidence',
        targetId: evidence.id,
        stance: 'NEUTRAL',
      })),
      skipDuplicates: true,
    });

    // Seed inferred edges so the graph is reachable immediately.
    await this.graph.inferEdgesForAsset(dto.entityId);

    const updated = await this.prisma.caseEvidence.findUniqueOrThrow({
      where: { id: evidence.id },
      include: { findings: true },
    });
    const [hydrated] = await this.hydrateEvidence([updated as EvidenceRow]);
    return hydrated!;
  }

  /** Attach a finding (inferred observation) to a piece of case evidence. */
  async addFinding(caseId: string, evidenceId: string, dto: AddFindingDto): Promise<CaseFindingDto> {
    await this.ensureExists(caseId);

    const evidence = await this.prisma.caseEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(`Evidence ${evidenceId} not found in case ${caseId}`);
    }

    const cf = await this.prisma.caseFinding.upsert({
      where: { caseId_findingId: { caseId, findingId: dto.findingId } },
      create: { caseId, caseEvidenceId: evidenceId, findingId: dto.findingId, note: dto.note },
      update: { note: dto.note ?? undefined },
      include: { finding: { select: { findingType: true, severity: true, detectorType: true } } },
    });

    return this.mapCaseFinding(cf);
  }

  /** Remove a case finding by its id. */
  async removeFinding(caseId: string, caseFindingId: string): Promise<void> {
    const cf = await this.prisma.caseFinding.findUnique({ where: { id: caseFindingId } });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(`Case finding ${caseFindingId} not found in case ${caseId}`);
    }
    await this.prisma.caseFinding.delete({ where: { id: caseFindingId } });
  }

  async removeEvidence(caseId: string, evidenceId: string): Promise<void> {
    const evidence = await this.prisma.caseEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(`Evidence ${evidenceId} not found in case ${caseId}`);
    }
    await this.prisma.caseEvidence.delete({ where: { id: evidenceId } });
  }

  async getGraph(caseId: string, depth = 1): Promise<GraphResponseDto> {
    await this.ensureExists(caseId);
    return this.graph.caseGraph(caseId, depth);
  }

  // ─── Private ─────────────────────────────────────────────────────

  private toArray<T extends string>(value: T | T[] | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return [value];
    return [];
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.case.findUnique({ where: { id }, select: { id: true } });
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

  private mapCaseFinding(cf: {
    id: string;
    caseEvidenceId: string;
    findingId: string;
    note: string | null;
    createdAt: Date;
    finding: { findingType: string; severity: string | { toString(): string }; detectorType: string | { toString(): string } };
  }): CaseFindingDto {
    return {
      id: cf.id,
      caseEvidenceId: cf.caseEvidenceId,
      findingId: cf.findingId,
      findingLabel: cf.finding.findingType,
      severity: String(cf.finding.severity),
      detectorType: String(cf.finding.detectorType),
      note: cf.note,
      createdAt: cf.createdAt,
    };
  }

  private async hydrateEvidence(rows: EvidenceRow[]): Promise<CaseEvidenceDto[]> {
    const assetIds = rows.map((r) => r.entityId);

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, name: true, assetType: true, sourceType: true },
    });
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    // Hydrate findings for all evidence in one batch.
    const allFindingIds = rows.flatMap((r) => r.findings.map((f) => f.findingId));
    const findingRows = await this.prisma.finding.findMany({
      where: { id: { in: allFindingIds } },
      select: { id: true, findingType: true, severity: true, detectorType: true },
    });
    const findingMap = new Map(findingRows.map((f) => [f.id, f]));

    return rows.map((r) => {
      const a = assetMap.get(r.entityId);
      const entity: EvidenceEntityDto = a
        ? { id: a.id, label: a.name, assetType: a.assetType, sourceType: String(a.sourceType) }
        : { id: r.entityId, label: '(deleted asset)', missing: true };

      const findings: CaseFindingDto[] = r.findings.map((cf) => {
        const f = findingMap.get(cf.findingId);
        return {
          id: cf.id,
          caseEvidenceId: cf.caseEvidenceId,
          findingId: cf.findingId,
          findingLabel: f?.findingType ?? '(deleted finding)',
          severity: f ? String(f.severity) : undefined,
          detectorType: f ? String(f.detectorType) : undefined,
          note: cf.note,
          createdAt: cf.createdAt,
        };
      });

      return {
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        note: r.note,
        addedBy: r.addedBy,
        createdAt: r.createdAt,
        entity,
        findings,
      };
    });
  }
}
