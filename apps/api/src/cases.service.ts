import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import {
  AddEvidenceDto,
  AddFindingDto,
  CaseEvidenceDto,
  CaseFindingDto,
  CaseLinkedInquiryDto,
  CaseListResponseDto,
  CaseResponseDto,
  CreateCaseDto,
  PullFromInquiryDto,
  PullFromInquiryResponseDto,
  QueryCasesDto,
  UpdateCaseDto,
  UpdateCaseFindingNoteDto,
  UpdateEvidenceNoteDto,
} from './dto/case.dto';
import { GraphResponseDto } from './dto/graph.dto';

type CaseRow = Prisma.CaseGetPayload<{
  include: { _count: { select: { evidence: true; hypotheses: true; inquiries: true } } };
}>;
type EvidenceRow = Prisma.CaseEvidenceGetPayload<{ include: { findings: true } }>;

const countSelect = {
  _count: { select: { evidence: true, hypotheses: true, inquiries: true } },
} satisfies Prisma.CaseInclude;

/** The investigation workspace: owns evidence, findings, hypotheses (via services) and the graph. */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly matching: InquiryMatchingService,
  ) {}

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
      include: countSelect,
    });
    if (dto.inquiryIds && dto.inquiryIds.length > 0) {
      await this.prisma.inquiry.updateMany({
        where: { id: { in: dto.inquiryIds } },
        data: { caseId: created.id },
      });
      return (await this.findOne(created.id))!;
    }
    return this.mapCase(created);
  }

  async list(query: QueryCasesDto): Promise<CaseListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);

    const where: Prisma.CaseWhereInput = {};
    const statusFilter = this.toArray(query.status);
    const severityFilter = this.toArray(query.severity);
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
      this.prisma.case.findMany({ where, include: countSelect, orderBy: { updatedAt: 'desc' }, skip, take: limit }),
      this.prisma.case.count({ where }),
    ]);
    return { items: rows.map((r) => this.mapCase(r)), total, skip, limit };
  }

  async findOne(id: string): Promise<CaseResponseDto | null> {
    const row = await this.prisma.case.findUnique({
      where: { id },
      include: {
        ...countSelect,
        evidence: { orderBy: { createdAt: 'asc' }, include: { findings: true } },
        inquiries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    const evidence = this.hydrateEvidence(row.evidence as EvidenceRow[]);
    const inquiries: CaseLinkedInquiryDto[] = row.inquiries.map((q) => ({
      id: q.id,
      title: q.title,
      status: q.status,
      matchCount: q.matchCount,
    }));
    return { ...this.mapCase(row), evidence, inquiries };
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
      include: countSelect,
    });
    return this.mapCase(updated);
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.case.delete({ where: { id } });
  }

  async addEvidence(caseId: string, dto: AddEvidenceDto): Promise<CaseEvidenceDto> {
    await this.ensureExists(caseId);
    if (dto.entityType !== 'asset') {
      throw new BadRequestException(
        'Evidence must be an asset. Use POST /cases/:id/evidence/:evidenceId/findings to attach findings.',
      );
    }
    const hypothesisIds = dto.hypothesisIds ?? [];
    if (hypothesisIds.length > 0) await this.assertHypothesesInCase(caseId, hypothesisIds);

    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.entityId },
      select: { name: true, assetType: true, sourceType: true },
    });
    const snapshot = {
      label: asset?.name ?? null,
      assetType: asset?.assetType ?? null,
      sourceType: asset ? String(asset.sourceType) : null,
    };
    const evidence = await this.prisma.caseEvidence.upsert({
      where: { caseId_entityType_entityId: { caseId, entityType: 'asset', entityId: dto.entityId } },
      create: { caseId, entityType: 'asset', entityId: dto.entityId, note: dto.note, addedBy: dto.addedBy, ...snapshot },
      update: { note: dto.note ?? undefined, ...snapshot },
      include: { findings: true },
    });
    if (hypothesisIds.length > 0) await this.linkSupport(hypothesisIds, 'evidence', evidence.id);
    await this.graph.inferEdgesForAsset(dto.entityId);

    const updated = await this.prisma.caseEvidence.findUniqueOrThrow({ where: { id: evidence.id }, include: { findings: true } });
    return this.hydrateEvidence([updated as EvidenceRow])[0]!;
  }

  async addFinding(caseId: string, evidenceId: string, dto: AddFindingDto): Promise<CaseFindingDto> {
    await this.ensureExists(caseId);
    const evidence = await this.prisma.caseEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(`Evidence ${evidenceId} not found in case ${caseId}`);
    }
    const finding = await this.prisma.finding.findUnique({
      where: { id: dto.findingId },
      select: {
        assetId: true,
        findingType: true,
        severity: true,
        detectorType: true,
        customDetectorName: true,
        matchedContent: true,
        asset: { select: { name: true, assetType: true, sourceType: true } },
      },
    });
    if (!finding) throw new NotFoundException(`Finding ${dto.findingId} not found`);

    const assetEv = await this.ensureAssetEvidence(caseId, finding.assetId, finding.asset);
    const cf = await this.prisma.caseFinding.upsert({
      where: { caseId_findingId: { caseId, findingId: dto.findingId } },
      create: {
        caseId,
        caseEvidenceId: assetEv,
        findingId: dto.findingId,
        label: finding.findingType,
        severity: String(finding.severity),
        detectorType: String(finding.detectorType),
        customDetectorName: finding.customDetectorName ?? null,
        matchedContent: finding.matchedContent,
        note: dto.note,
      },
      update: { note: dto.note ?? undefined },
    });
    await this.graph.inferEdgesForAsset(finding.assetId);
    return this.mapCaseFinding(cf);
  }

  async removeFinding(caseId: string, caseFindingId: string): Promise<void> {
    const cf = await this.prisma.caseFinding.findUnique({ where: { id: caseFindingId } });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(`Finding ${caseFindingId} not found in case ${caseId}`);
    }
    await this.prisma.caseFinding.delete({ where: { id: caseFindingId } });
  }

  async patchEvidenceNote(caseId: string, evidenceId: string, dto: UpdateEvidenceNoteDto): Promise<CaseEvidenceDto> {
    const evidence = await this.prisma.caseEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(`Evidence ${evidenceId} not found in case ${caseId}`);
    }
    const updated = await this.prisma.caseEvidence.update({
      where: { id: evidenceId },
      data: { note: dto.note ?? null },
      include: { findings: true },
    });
    return this.hydrateEvidence([updated as EvidenceRow])[0]!;
  }

  async patchFindingNote(caseId: string, caseFindingId: string, dto: UpdateCaseFindingNoteDto): Promise<CaseFindingDto> {
    const cf = await this.prisma.caseFinding.findUnique({ where: { id: caseFindingId } });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(`Finding ${caseFindingId} not found in case ${caseId}`);
    }
    const updated = await this.prisma.caseFinding.update({
      where: { id: caseFindingId },
      data: { note: dto.note ?? null },
    });
    return this.mapCaseFinding(updated);
  }

  async removeEvidence(caseId: string, evidenceId: string): Promise<void> {
    const evidence = await this.prisma.caseEvidence.findUnique({ where: { id: evidenceId } });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(`Evidence ${evidenceId} not found in case ${caseId}`);
    }
    await this.prisma.caseEvidence.delete({ where: { id: evidenceId } });
  }

  /** Pull a linked question's current matches into the case as evidence + findings. */
  async pullFromInquiry(caseId: string, dto: PullFromInquiryDto): Promise<PullFromInquiryResponseDto> {
    await this.ensureExists(caseId);
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id: dto.inquiryId }, select: { id: true } });
    if (!inquiry) throw new NotFoundException(`Inquiry ${dto.inquiryId} not found`);

    let findingIds = dto.findingIds;
    if (!findingIds || findingIds.length === 0) {
      findingIds = await this.matching.getMatchingFindingIds(dto.inquiryId);
    }
    if (findingIds.length === 0) return { pulled: 0 };

    const findings = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      select: {
        id: true,
        assetId: true,
        findingType: true,
        severity: true,
        detectorType: true,
        customDetectorName: true,
        matchedContent: true,
        asset: { select: { name: true, assetType: true, sourceType: true } },
      },
    });
    if (findings.length === 0) return { pulled: 0 };

    // One evidence row per asset, then the finding rows.
    const evidenceByAsset = new Map<string, string>();
    for (const f of findings) {
      if (!evidenceByAsset.has(f.assetId)) {
        evidenceByAsset.set(f.assetId, await this.ensureAssetEvidence(caseId, f.assetId, f.asset));
      }
    }
    const created = await this.prisma.caseFinding.createMany({
      data: findings.map((f) => ({
        caseId,
        caseEvidenceId: evidenceByAsset.get(f.assetId)!,
        findingId: f.id,
        label: f.findingType,
        severity: String(f.severity),
        detectorType: String(f.detectorType),
        customDetectorName: f.customDetectorName ?? null,
        matchedContent: f.matchedContent,
      })),
      skipDuplicates: true,
    });
    for (const assetId of evidenceByAsset.keys()) await this.graph.inferEdgesForAsset(assetId);
    return { pulled: created.count };
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

  private async assertHypothesesInCase(caseId: string, hypothesisIds: string[]): Promise<void> {
    const found = await this.prisma.hypothesis.findMany({ where: { id: { in: hypothesisIds }, caseId }, select: { id: true } });
    if (found.length !== hypothesisIds.length) {
      throw new BadRequestException('One or more hypothesisIds do not belong to this case.');
    }
  }

  private async linkSupport(hypothesisIds: string[], targetType: 'evidence' | 'finding', targetId: string): Promise<void> {
    await this.prisma.hypothesisSupport.createMany({
      data: hypothesisIds.map((hypothesisId) => ({ hypothesisId, targetType, targetId, stance: 'NEUTRAL' as const })),
      skipDuplicates: true,
    });
  }

  /** Upsert asset evidence (snapshotting display metadata) and return its id. */
  private async ensureAssetEvidence(
    caseId: string,
    assetId: string,
    asset: { name: string; assetType: string; sourceType: { toString(): string } } | null,
  ): Promise<string> {
    const ev = await this.prisma.caseEvidence.upsert({
      where: { caseId_entityType_entityId: { caseId, entityType: 'asset', entityId: assetId } },
      create: {
        caseId,
        entityType: 'asset',
        entityId: assetId,
        label: asset?.name ?? null,
        assetType: asset?.assetType ?? null,
        sourceType: asset ? String(asset.sourceType) : null,
      },
      update: {},
      select: { id: true },
    });
    return ev.id;
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
      inquiryCount: row._count.inquiries,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapCaseFinding(cf: {
    id: string;
    caseEvidenceId: string;
    findingId: string;
    label: string;
    severity: string | null;
    detectorType: string | null;
    customDetectorName?: string | null;
    matchedContent?: string | null;
    note: string | null;
    createdAt: Date;
  }): CaseFindingDto {
    return {
      id: cf.id,
      caseEvidenceId: cf.caseEvidenceId,
      findingId: cf.findingId,
      findingLabel: cf.label,
      severity: cf.severity ?? undefined,
      detectorType: cf.detectorType ?? undefined,
      customDetectorName: cf.customDetectorName ?? null,
      matchedContent: cf.matchedContent ?? null,
      note: cf.note,
      createdAt: cf.createdAt,
    };
  }

  private hydrateEvidence(rows: EvidenceRow[]): CaseEvidenceDto[] {
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      note: r.note,
      addedBy: r.addedBy,
      createdAt: r.createdAt,
      entity: {
        id: r.entityId,
        label: r.label ?? r.entityId,
        assetType: r.assetType ?? undefined,
        sourceType: r.sourceType ?? undefined,
      },
      findings: r.findings.map((cf) => this.mapCaseFinding(cf)),
    }));
  }
}
