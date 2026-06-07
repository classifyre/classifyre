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
  LinkEvidenceDto,
  UpdateHypothesisDto,
} from './dto/hypothesis.dto';

type HypothesisRow = Prisma.HypothesisGetPayload<{
  include: { links: { include: { caseEvidence: true } } };
}>;

@Injectable()
export class HypothesesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    links: { include: { caseEvidence: true } },
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
      },
      include: this.include,
    });
    return (await this.mapMany([updated]))[0];
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.hypothesis.delete({ where: { id } });
  }

  async linkEvidence(
    hypothesisId: string,
    dto: LinkEvidenceDto,
  ): Promise<HypothesisResponseDto> {
    const hypothesis = await this.prisma.hypothesis.findUnique({
      where: { id: hypothesisId },
      select: { caseId: true },
    });
    if (!hypothesis) {
      throw new NotFoundException(`Hypothesis ${hypothesisId} not found`);
    }
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: dto.caseEvidenceId },
      select: { caseId: true },
    });
    if (!evidence || evidence.caseId !== hypothesis.caseId) {
      throw new BadRequestException(
        'Evidence must belong to the same case as the hypothesis',
      );
    }

    await this.prisma.hypothesisEvidence.upsert({
      where: {
        hypothesisId_caseEvidenceId: {
          hypothesisId,
          caseEvidenceId: dto.caseEvidenceId,
        },
      },
      create: {
        hypothesisId,
        caseEvidenceId: dto.caseEvidenceId,
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

  async unlinkEvidence(
    hypothesisId: string,
    linkId: string,
  ): Promise<HypothesisResponseDto> {
    const link = await this.prisma.hypothesisEvidence.findUnique({
      where: { id: linkId },
    });
    if (!link || link.hypothesisId !== hypothesisId) {
      throw new NotFoundException(`Evidence link ${linkId} not found`);
    }
    await this.prisma.hypothesisEvidence.delete({ where: { id: linkId } });
    return this.getOne(hypothesisId);
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
    // Resolve display labels for all linked evidence in one batch.
    const evidence = rows.flatMap((r) => r.links.map((l) => l.caseEvidence));
    const assetIds = evidence.filter((e) => e.entityType === 'asset').map((e) => e.entityId);
    const findingIds = evidence
      .filter((e) => e.entityType === 'finding')
      .map((e) => e.entityId);

    const [assets, findings] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, name: true },
      }),
      this.prisma.finding.findMany({
        where: { id: { in: findingIds } },
        select: { id: true, findingType: true },
      }),
    ]);
    const assetMap = new Map(assets.map((a) => [a.id, a.name]));
    const findingMap = new Map(findings.map((f) => [f.id, f.findingType]));

    const labelFor = (entityType: string, entityId: string): string => {
      if (entityType === 'asset') return assetMap.get(entityId) ?? '(deleted asset)';
      if (entityType === 'finding') return findingMap.get(entityId) ?? '(deleted finding)';
      return entityId;
    };

    return rows.map((r) => {
      const supportingCount = r.links.filter(
        (l) => l.stance === EvidenceStance.SUPPORTS,
      ).length;
      const contradictingCount = r.links.filter(
        (l) => l.stance === EvidenceStance.CONTRADICTS,
      ).length;
      return {
        id: r.id,
        caseId: r.caseId,
        statement: r.statement,
        status: r.status,
        confidence: r.confidence === null ? null : Number(r.confidence),
        createdBy: r.createdBy,
        supportingCount,
        contradictingCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        links: r.links.map((l) => ({
          id: l.id,
          caseEvidenceId: l.caseEvidenceId,
          stance: l.stance,
          weight: l.weight === null ? null : Number(l.weight),
          note: l.note,
          evidenceLabel: labelFor(
            l.caseEvidence.entityType,
            l.caseEvidence.entityId,
          ),
        })),
      };
    });
  }
}
