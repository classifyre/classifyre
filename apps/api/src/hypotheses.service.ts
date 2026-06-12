import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EvidenceStance, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import {
  CreateHypothesisDto,
  HypothesisResponseDto,
  HypothesisSupportLinkDto,
  LinkSupportDto,
  UpdateHypothesisDto,
} from './dto/hypothesis.dto';

type HypothesisRow = Prisma.HypothesisGetPayload<{
  include: { support: true };
}>;

@Injectable()
export class HypothesesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    support: true,
  } satisfies Prisma.HypothesisInclude;

  async list(caseId: string): Promise<HypothesisResponseDto[]> {
    const rows = await this.prisma.hypothesis.findMany({
      where: { caseId },
      include: this.include,
      orderBy: { createdAt: 'asc' },
    });
    return this.mapMany(rows);
  }

  async create(
    caseId: string,
    dto: CreateHypothesisDto,
  ): Promise<HypothesisResponseDto> {
    await this.ensureCaseExists(caseId);
    const created = await this.prisma.hypothesis.create({
      data: {
        caseId,
        statement: dto.statement,
        status: dto.status,
        confidence: dto.confidence,
        createdBy: dto.createdBy,
      },
      include: this.include,
    });
    return (await this.mapMany([created]))[0];
  }

  async update(
    id: string,
    dto: UpdateHypothesisDto,
  ): Promise<HypothesisResponseDto> {
    await this.ensureExists(id);
    const updated = await this.prisma.hypothesis.update({
      where: { id },
      data: {
        statement: dto.statement,
        status: dto.status,
        confidence: dto.confidence,
        color: dto.color,
      },
      include: this.include,
    });
    return (await this.mapMany([updated]))[0];
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.hypothesis.delete({ where: { id } });
  }

  /**
   * Link case evidence or a case finding to a hypothesis with a stance.
   * dto.targetType = "evidence" → targetId is a CaseEvidence.id
   * dto.targetType = "finding"  → targetId is a CaseFinding.id
   */
  async linkSupport(
    hypothesisId: string,
    dto: LinkSupportDto,
  ): Promise<HypothesisResponseDto> {
    const hypothesis = await this.prisma.hypothesis.findUnique({
      where: { id: hypothesisId },
      select: { caseId: true },
    });
    if (!hypothesis)
      throw new NotFoundException(`Hypothesis ${hypothesisId} not found`);

    await this.validateTarget(dto.targetType, dto.targetId, hypothesis.caseId);

    await this.prisma.hypothesisSupport.upsert({
      where: {
        hypothesisId_targetType_targetId: {
          hypothesisId,
          targetType: dto.targetType,
          targetId: dto.targetId,
        },
      },
      create: {
        hypothesisId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        stance: dto.stance ?? EvidenceStance.SUPPORTS,
        weight: dto.weight,
        note: dto.note,
      },
      update: {
        stance: dto.stance ?? EvidenceStance.SUPPORTS,
        weight: dto.weight,
        note: dto.note,
      },
    });
    return this.getOne(hypothesisId);
  }

  async unlinkSupport(
    hypothesisId: string,
    linkId: string,
  ): Promise<HypothesisResponseDto> {
    const link = await this.prisma.hypothesisSupport.findUnique({
      where: { id: linkId },
    });
    if (!link || link.hypothesisId !== hypothesisId) {
      throw new NotFoundException(
        `Support link ${linkId} not found on hypothesis ${hypothesisId}`,
      );
    }
    await this.prisma.hypothesisSupport.delete({ where: { id: linkId } });
    return this.getOne(hypothesisId);
  }

  // ─── Private ─────────────────────────────────────────────────────

  private async validateTarget(
    targetType: 'evidence' | 'finding',
    targetId: string,
    caseId: string,
  ): Promise<void> {
    if (targetType === 'evidence') {
      const ev = await this.prisma.caseEvidence.findUnique({
        where: { id: targetId },
        select: { caseId: true },
      });
      if (!ev || ev.caseId !== caseId)
        throw new BadRequestException(
          'Evidence must belong to the same case as the hypothesis',
        );
    } else {
      const cf = await this.prisma.caseFinding.findUnique({
        where: { id: targetId },
        select: { caseId: true },
      });
      if (!cf || cf.caseId !== caseId)
        throw new BadRequestException(
          'Finding must belong to the same case as the hypothesis',
        );
    }
  }

  private async getOne(id: string): Promise<HypothesisResponseDto> {
    const row = await this.prisma.hypothesis.findUnique({
      where: { id },
      include: this.include,
    });
    if (!row) throw new NotFoundException(`Hypothesis ${id} not found`);
    return (await this.mapMany([row]))[0];
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.hypothesis.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Hypothesis ${id} not found`);
  }

  private async ensureCaseExists(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
  }

  private async mapMany(
    rows: HypothesisRow[],
  ): Promise<HypothesisResponseDto[]> {
    const evidenceIds = rows
      .flatMap((r) => r.support)
      .filter((s) => s.targetType === 'evidence')
      .map((s) => s.targetId);
    const findingIds = rows
      .flatMap((r) => r.support)
      .filter((s) => s.targetType === 'finding')
      .map((s) => s.targetId);

    const [evidenceRows, findingRows] = await Promise.all([
      evidenceIds.length > 0
        ? this.prisma.caseEvidence.findMany({
            where: { id: { in: evidenceIds } },
            select: { id: true, label: true, entityId: true },
          })
        : Promise.resolve([]),
      findingIds.length > 0
        ? this.prisma.caseFinding.findMany({
            where: { id: { in: findingIds } },
            select: { id: true, label: true },
          })
        : Promise.resolve([]),
    ]);

    const evidenceMap = new Map<string, string>(
      evidenceRows.map((e): [string, string] => [e.id, e.label ?? e.entityId]),
    );
    const findingMap = new Map<string, string>(
      findingRows.map((cf): [string, string] => [cf.id, cf.label]),
    );

    const labelFor = (targetType: string, targetId: string): string => {
      if (targetType === 'evidence')
        return evidenceMap.get(targetId) ?? '(deleted evidence)';
      if (targetType === 'finding')
        return findingMap.get(targetId) ?? '(deleted finding)';
      return targetId;
    };

    return rows.map((r) => {
      const supportingCount = r.support.filter(
        (s) => s.stance === EvidenceStance.SUPPORTS,
      ).length;
      const contradictingCount = r.support.filter(
        (s) => s.stance === EvidenceStance.CONTRADICTS,
      ).length;
      const links: HypothesisSupportLinkDto[] = r.support.map((s) => ({
        id: s.id,
        targetType: s.targetType,
        targetId: s.targetId,
        stance: s.stance,
        weight: s.weight === null ? null : Number(s.weight),
        note: s.note,
        targetLabel: labelFor(s.targetType, s.targetId),
      }));
      return {
        id: r.id,
        caseId: r.caseId,
        statement: r.statement,
        status: r.status,
        confidence: r.confidence === null ? null : Number(r.confidence),
        color: r.color ?? null,
        createdBy: r.createdBy,
        supportingCount,
        contradictingCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        links,
      };
    });
  }
}
