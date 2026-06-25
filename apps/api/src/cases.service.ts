import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CaseActivityType, CaseThreadKind, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { CaseActivityService } from './case-activity.service';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';
import {
  AddEvidenceDto,
  AddFindingDto,
  AttachFindingsDto,
  AttachFindingsResponseDto,
  CaseEvidenceDto,
  CaseFindingDto,
  CaseLinkedInquiryDto,
  CaseListResponseDto,
  CaseResponseDto,
  CloseCaseDto,
  CloseCaseResponseDto,
  CreateCaseDto,
  LinkInquiriesDto,
  PullFromInquiryDto,
  PullFromInquiryResponseDto,
  QueryCasesDto,
  UpdateCaseDto,
  UpdateCaseFindingNoteDto,
  UpdateEvidenceNoteDto,
} from './dto/case.dto';
import { GraphResponseDto } from './dto/graph.dto';

type CaseRow = Prisma.CaseGetPayload<{
  include: {
    _count: {
      select: {
        evidence: true;
        threads: { where: { kind: 'HYPOTHESIS' } };
        inquiryLinks: true;
      };
    };
  };
}>;
type EvidenceRow = Prisma.CaseEvidenceGetPayload<{
  include: { findings: true };
}>;

// Hypotheses are CaseThreads of kind HYPOTHESIS; count those for the DTO.
const countSelect = {
  _count: {
    select: {
      evidence: true,
      threads: { where: { kind: CaseThreadKind.HYPOTHESIS } },
      inquiryLinks: true,
    },
  },
} satisfies Prisma.CaseInclude;

/** The investigation workspace: owns evidence, findings, hypotheses (via services) and the graph. */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly matching: InquiryMatchingService,
    private readonly activity: CaseActivityService,
    private readonly agentMemory: AgentMemoryService,
  ) {}

  async create(dto: CreateCaseDto): Promise<CaseResponseDto> {
    const inquiryIds = [...new Set(dto.inquiryIds ?? [])];
    let inquiries: Array<{ id: string; title: string }> = [];
    if (inquiryIds.length > 0) {
      inquiries = await this.prisma.inquiry.findMany({
        where: { id: { in: inquiryIds } },
        select: { id: true, title: true },
      });
      if (inquiries.length !== inquiryIds.length) {
        throw new BadRequestException('One or more inquiries do not exist.');
      }
    }
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
    await this.activity.record(
      created.id,
      CaseActivityType.CASE_CREATED,
      { title: dto.title },
      dto.createdBy,
    );
    if (inquiryIds.length > 0) {
      await this.prisma.caseInquiry.createMany({
        data: inquiryIds.map((inquiryId) => ({
          caseId: created.id,
          inquiryId,
        })),
        skipDuplicates: true,
      });
      for (const q of inquiries) {
        await this.activity.record(
          created.id,
          CaseActivityType.INQUIRY_LINKED,
          { inquiryId: q.id, inquiryTitle: q.title },
          dto.createdBy,
        );
      }
      return (await this.findOne(created.id))!;
    }
    return this.mapCase(created);
  }

  /** Link additional inquiries to a case. Already-linked ones are ignored. */
  async linkInquiries(
    caseId: string,
    dto: LinkInquiriesDto,
    actor?: string,
  ): Promise<CaseResponseDto> {
    await this.ensureExists(caseId);
    const inquiryIds = [...new Set(dto.inquiryIds ?? [])];
    if (inquiryIds.length === 0) return (await this.findOne(caseId))!;
    const inquiries = await this.prisma.inquiry.findMany({
      where: { id: { in: inquiryIds } },
      select: { id: true, title: true },
    });
    if (inquiries.length !== inquiryIds.length) {
      throw new BadRequestException('One or more inquiries do not exist.');
    }
    const existing = await this.prisma.caseInquiry.findMany({
      where: { caseId, inquiryId: { in: inquiryIds } },
      select: { inquiryId: true },
    });
    const existingIds = new Set(existing.map((l) => l.inquiryId));
    await this.prisma.caseInquiry.createMany({
      data: inquiryIds.map((inquiryId) => ({ caseId, inquiryId })),
      skipDuplicates: true,
    });
    for (const q of inquiries) {
      if (existingIds.has(q.id)) continue;
      await this.activity.record(
        caseId,
        CaseActivityType.INQUIRY_LINKED,
        { inquiryId: q.id, inquiryTitle: q.title },
        actor,
      );
    }
    return (await this.findOne(caseId))!;
  }

  /** Unlink an inquiry from a case. The inquiry itself is untouched. */
  async unlinkInquiry(
    caseId: string,
    inquiryId: string,
  ): Promise<CaseResponseDto> {
    await this.ensureExists(caseId);
    const link = await this.prisma.caseInquiry.findUnique({
      where: { caseId_inquiryId: { caseId, inquiryId } },
      include: { inquiry: { select: { title: true } } },
    });
    if (!link)
      throw new NotFoundException(
        `Inquiry ${inquiryId} is not linked to case ${caseId}`,
      );
    await this.prisma.caseInquiry.delete({ where: { id: link.id } });
    await this.activity.record(caseId, CaseActivityType.INQUIRY_UNLINKED, {
      inquiryId,
      inquiryTitle: link.inquiry.title,
    });
    return (await this.findOne(caseId))!;
  }

  /** Close the case with a conclusion and archive its linked inquiries. */
  async close(id: string, dto: CloseCaseDto): Promise<CloseCaseResponseDto> {
    await this.ensureExists(id);
    const conclusion = (dto.conclusion ?? '').trim();
    if (conclusion.length === 0) {
      throw new BadRequestException(
        'A conclusion is required to close a case.',
      );
    }
    await this.prisma.case.update({
      where: { id },
      data: { status: 'CLOSED', conclusion },
    });
    // Archive linked inquiries — but only those not driving another open case.
    const linked = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE', caseLinks: { some: { caseId: id } } },
      select: {
        id: true,
        caseLinks: { select: { case: { select: { id: true, status: true } } } },
      },
    });
    const archivable = linked
      .filter((q) =>
        q.caseLinks.every(
          (l) =>
            l.case.id === id ||
            l.case.status === 'CLOSED' ||
            l.case.status === 'ARCHIVED',
        ),
      )
      .map((q) => q.id);
    const archived =
      archivable.length > 0
        ? await this.prisma.inquiry.updateMany({
            where: { id: { in: archivable } },
            data: { status: 'ARCHIVED' },
          })
        : { count: 0 };
    await this.activity.record(
      id,
      CaseActivityType.CONCLUSION_UPDATED,
      { closed: true, archivedInquiries: archived.count },
      dto.closedBy,
    );
    return {
      case: (await this.findOne(id))!,
      archivedInquiries: archived.count,
    };
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
      this.prisma.case.findMany({
        where,
        include: countSelect,
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
        ...countSelect,
        evidence: {
          orderBy: { createdAt: 'asc' },
          include: { findings: true },
        },
        inquiryLinks: {
          orderBy: { createdAt: 'asc' },
          include: { inquiry: true },
        },
      },
    });
    if (!row) return null;
    const evidence = this.hydrateEvidence(row.evidence);
    const inquiries: CaseLinkedInquiryDto[] = row.inquiryLinks.map((l) => ({
      id: l.inquiry.id,
      title: l.inquiry.title,
      status: l.inquiry.status,
      matchCount: l.inquiry.matchCount,
      newMatchCount: l.inquiry.newMatchCount,
    }));
    return { ...this.mapCase(row), evidence, inquiries };
  }

  async update(
    id: string,
    dto: UpdateCaseDto,
    actor?: string,
  ): Promise<CaseResponseDto> {
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
        aiMode: dto.aiMode,
      },
      include: countSelect,
    });
    const actType =
      dto.conclusion !== undefined
        ? CaseActivityType.CONCLUSION_UPDATED
        : CaseActivityType.CASE_UPDATED;
    await this.activity.record(
      id,
      actType,
      { title: dto.title, status: dto.status, severity: dto.severity },
      actor,
    );
    return this.mapCase(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.case.findUnique({
      where: { id },
      select: { title: true },
    });
    if (!existing) throw new NotFoundException(`Case with ID ${id} not found`);
    await this.prisma.case.delete({ where: { id } });
    // Keep the autopilot's memory consistent: drop memories referencing the
    // dead case and remember that the operator deleted it on purpose.
    await this.agentMemory.recordEntityDeletion('case', id, existing.title);
  }

  async addEvidence(
    caseId: string,
    dto: AddEvidenceDto,
  ): Promise<CaseEvidenceDto> {
    await this.ensureExists(caseId);
    if (dto.entityType !== 'asset') {
      throw new BadRequestException(
        'Evidence must be an asset. Use POST /cases/:id/evidence/:evidenceId/findings to attach findings.',
      );
    }
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
      where: {
        caseId_entityType_entityId: {
          caseId,
          entityType: 'asset',
          entityId: dto.entityId,
        },
      },
      create: {
        caseId,
        entityType: 'asset',
        entityId: dto.entityId,
        note: dto.note,
        addedBy: dto.addedBy,
        ...snapshot,
      },
      update: { note: dto.note ?? undefined, ...snapshot },
      include: { findings: true },
    });
    await this.graph.inferEdgesForAsset(dto.entityId);
    await this.activity.record(
      caseId,
      CaseActivityType.EVIDENCE_ADDED,
      {
        evidenceId: evidence.id,
        entityId: dto.entityId,
        label: snapshot.label,
      },
      dto.addedBy,
    );

    const updated = await this.prisma.caseEvidence.findUniqueOrThrow({
      where: { id: evidence.id },
      include: { findings: true },
    });
    return this.hydrateEvidence([updated])[0];
  }

  async addFinding(
    caseId: string,
    evidenceId: string,
    dto: AddFindingDto,
  ): Promise<CaseFindingDto> {
    await this.ensureExists(caseId);
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(
        `Evidence ${evidenceId} not found in case ${caseId}`,
      );
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
    if (!finding)
      throw new NotFoundException(`Finding ${dto.findingId} not found`);

    const assetEv = await this.ensureAssetEvidence(
      caseId,
      finding.assetId,
      finding.asset,
    );
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
    await this.activity.record(caseId, CaseActivityType.FINDING_ADDED, {
      caseFindingId: cf.id,
      findingId: dto.findingId,
      label: finding.findingType,
    });
    return this.mapCaseFinding(cf);
  }

  /** Batch-attach findings; asset evidence rows are created automatically. */
  async attachFindings(
    caseId: string,
    dto: AttachFindingsDto,
  ): Promise<AttachFindingsResponseDto> {
    await this.ensureExists(caseId);
    const findingIds = [...new Set(dto.findingIds ?? [])];
    if (findingIds.length === 0) return { attached: 0 };

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
    if (findings.length === 0) return { attached: 0 };

    const evidenceByAsset = new Map<string, string>();
    for (const f of findings) {
      if (!evidenceByAsset.has(f.assetId)) {
        evidenceByAsset.set(
          f.assetId,
          await this.ensureAssetEvidence(caseId, f.assetId, f.asset),
        );
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
    for (const assetId of evidenceByAsset.keys())
      await this.graph.inferEdgesForAsset(assetId);
    await this.activity.record(
      caseId,
      CaseActivityType.FINDING_ADDED,
      {
        count: created.count,
        label: `${created.count} finding${created.count === 1 ? '' : 's'} attached`,
        findingLabels: findings.slice(0, 10).map((f) => f.findingType),
        assetLabels: [
          ...new Set(findings.map((f) => f.asset?.name).filter(Boolean)),
        ].slice(0, 10),
      },
      dto.addedBy,
    );
    return { attached: created.count };
  }

  async removeFinding(caseId: string, caseFindingId: string): Promise<void> {
    const cf = await this.prisma.caseFinding.findUnique({
      where: { id: caseFindingId },
    });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(
        `Finding ${caseFindingId} not found in case ${caseId}`,
      );
    }
    await this.prisma.caseFinding.delete({ where: { id: caseFindingId } });
    await this.activity.record(caseId, CaseActivityType.FINDING_REMOVED, {
      caseFindingId,
      findingId: cf.findingId,
      label: cf.label,
    });
  }

  async patchEvidenceNote(
    caseId: string,
    evidenceId: string,
    dto: UpdateEvidenceNoteDto,
  ): Promise<CaseEvidenceDto> {
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(
        `Evidence ${evidenceId} not found in case ${caseId}`,
      );
    }
    const updated = await this.prisma.caseEvidence.update({
      where: { id: evidenceId },
      data: { note: dto.note ?? null },
      include: { findings: true },
    });
    await this.activity.record(caseId, CaseActivityType.EVIDENCE_NOTE_UPDATED, {
      evidenceId,
      label: updated.label ?? updated.entityId,
      note: (dto.note ?? '').slice(0, 300) || null,
    });
    return this.hydrateEvidence([updated])[0];
  }

  async patchFindingNote(
    caseId: string,
    caseFindingId: string,
    dto: UpdateCaseFindingNoteDto,
  ): Promise<CaseFindingDto> {
    const cf = await this.prisma.caseFinding.findUnique({
      where: { id: caseFindingId },
    });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(
        `Finding ${caseFindingId} not found in case ${caseId}`,
      );
    }
    const updated = await this.prisma.caseFinding.update({
      where: { id: caseFindingId },
      data: { note: dto.note ?? null },
    });
    await this.activity.record(caseId, CaseActivityType.FINDING_NOTE_UPDATED, {
      caseFindingId,
      label: updated.label,
      note: (dto.note ?? '').slice(0, 300) || null,
    });
    return this.mapCaseFinding(updated);
  }

  async removeEvidence(caseId: string, evidenceId: string): Promise<void> {
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(
        `Evidence ${evidenceId} not found in case ${caseId}`,
      );
    }
    await this.prisma.caseEvidence.delete({ where: { id: evidenceId } });
    await this.activity.record(caseId, CaseActivityType.EVIDENCE_REMOVED, {
      evidenceId,
      entityId: evidence.entityId,
      label: evidence.label,
    });
  }

  /** Pull a linked question's current matches into the case as evidence + findings. */
  async pullFromInquiry(
    caseId: string,
    dto: PullFromInquiryDto,
  ): Promise<PullFromInquiryResponseDto> {
    await this.ensureExists(caseId);
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: dto.inquiryId },
      select: { id: true, title: true },
    });
    if (!inquiry)
      throw new NotFoundException(`Inquiry ${dto.inquiryId} not found`);

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
        evidenceByAsset.set(
          f.assetId,
          await this.ensureAssetEvidence(caseId, f.assetId, f.asset),
        );
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
    for (const assetId of evidenceByAsset.keys())
      await this.graph.inferEdgesForAsset(assetId);
    await this.activity.record(caseId, CaseActivityType.INQUIRY_PULLED, {
      inquiryId: dto.inquiryId,
      inquiryTitle: inquiry.title,
      pulled: created.count,
      findingLabels: findings.slice(0, 10).map((f) => f.findingType),
      assetLabels: [
        ...new Set(findings.map((f) => f.asset?.name).filter(Boolean)),
      ].slice(0, 10),
    });
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
    const found = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
  }

  /** Upsert asset evidence (snapshotting display metadata) and return its id. */
  private async ensureAssetEvidence(
    caseId: string,
    assetId: string,
    asset: {
      name: string;
      assetType: string;
      sourceType: { toString(): string };
    } | null,
  ): Promise<string> {
    const ev = await this.prisma.caseEvidence.upsert({
      where: {
        caseId_entityType_entityId: {
          caseId,
          entityType: 'asset',
          entityId: assetId,
        },
      },
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
      aiMode: row.aiMode,
      assignee: row.assignee,
      createdBy: row.createdBy,
      conclusion: row.conclusion,
      evidenceCount: row._count.evidence,
      hypothesisCount: row._count.threads,
      inquiryCount: row._count.inquiryLinks,
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
