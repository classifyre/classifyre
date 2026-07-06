import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseThreadEntryType,
  CaseThreadKind,
  EvidenceStance,
  HypothesisStatus,
  Prisma,
} from '@prisma/client';

type JsonInput = any;
import { PrismaService } from './prisma.service';
import { CaseActivityService } from './case-activity.service';
import {
  AddThreadEntryDto,
  CreateThreadDto,
  LinkThreadSupportDto,
  ThreadEntriesResponseDto,
  ThreadEntryDto,
  ThreadResponseDto,
  ThreadSupportLinkDto,
  UpdateThreadDto,
} from './dto/case-thread.dto';

type ThreadRow = Prisma.CaseThreadGetPayload<{
  include: { support: true; entries: true };
}>;

@Injectable()
export class CaseThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
  ) {}

  private readonly include = {
    support: true,
    entries: { orderBy: { createdAt: 'asc' as const } },
  } satisfies Prisma.CaseThreadInclude;

  async list(caseId: string): Promise<ThreadResponseDto[]> {
    const rows = await this.prisma.caseThread.findMany({
      where: { caseId },
      include: this.include,
      orderBy: { createdAt: 'asc' },
    });
    return this.mapMany(rows);
  }

  async create(
    caseId: string,
    dto: CreateThreadDto,
  ): Promise<ThreadResponseDto> {
    await this.ensureCaseExists(caseId);
    const thread = await this.prisma.$transaction(async (tx) => {
      const created = await tx.caseThread.create({
        data: {
          caseId,
          kind: dto.kind ?? CaseThreadKind.HYPOTHESIS,
          title: dto.title,
          status:
            dto.kind === CaseThreadKind.DISCUSSION
              ? null
              : (dto.status ?? HypothesisStatus.PROPOSED),
          confidence: dto.confidence,
          createdBy: dto.createdBy,
        },
        include: this.include,
      });
      if (dto.statement) {
        await tx.caseThreadEntry.create({
          data: {
            threadId: created.id,
            entryType: CaseThreadEntryType.STATEMENT,
            body: dto.statement,
            author: dto.createdBy,
          },
        });
      }
      await this.activity.record(
        caseId,
        CaseActivityType.THREAD_CREATED,
        {
          threadId: created.id,
          threadTitle: created.title,
          kind: created.kind,
        },
        dto.createdBy,
        tx,
      );
      return created;
    });
    return await this.getOne(thread.id);
  }

  async update(id: string, dto: UpdateThreadDto): Promise<ThreadResponseDto> {
    const existing = await this.prisma.caseThread.findUnique({
      where: { id },
      select: { id: true, caseId: true, status: true, confidence: true },
    });
    if (!existing) throw new NotFoundException(`Thread ${id} not found`);

    const data: Prisma.CaseThreadUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.color !== undefined) data.color = dto.color;

    const activityPayload: Record<string, unknown> = { threadId: id };
    const entriesToCreate: Array<{
      entryType: CaseThreadEntryType;
      metadata: Record<string, unknown>;
    }> = [];

    if (dto.status !== undefined && dto.status !== existing.status) {
      data.status = dto.status;
      entriesToCreate.push({
        entryType: CaseThreadEntryType.STATUS_CHANGE,
        metadata: { previousStatus: existing.status, status: dto.status },
      });
      activityPayload.previousStatus = existing.status;
      activityPayload.status = dto.status;
    }
    if (
      dto.confidence !== undefined &&
      dto.confidence !== Number(existing.confidence)
    ) {
      data.confidence = dto.confidence;
      entriesToCreate.push({
        entryType: CaseThreadEntryType.CONFIDENCE_CHANGE,
        metadata: {
          previousConfidence:
            existing.confidence === null ? null : Number(existing.confidence),
          confidence: dto.confidence,
        },
      });
      activityPayload.confidence = dto.confidence;
    }

    const primaryActivityType = entriesToCreate.some(
      (e) => e.entryType === CaseThreadEntryType.STATUS_CHANGE,
    )
      ? CaseActivityType.THREAD_STATUS_CHANGED
      : entriesToCreate.some(
            (e) => e.entryType === CaseThreadEntryType.CONFIDENCE_CHANGE,
          )
        ? CaseActivityType.THREAD_CONFIDENCE_CHANGED
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.caseThread.update({ where: { id }, data });
      for (const entry of entriesToCreate) {
        await tx.caseThreadEntry.create({
          data: {
            threadId: id,
            entryType: entry.entryType,
            metadata: entry.metadata as JsonInput,
          },
        });
      }
      if (primaryActivityType) {
        await this.activity.record(
          existing.caseId,
          primaryActivityType,
          activityPayload,
          dto.actor,
          tx,
        );
      }
    });

    return this.getOne(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.caseThread.findUnique({
      where: { id },
      select: { id: true, caseId: true, title: true, kind: true },
    });
    if (!existing) throw new NotFoundException(`Thread ${id} not found`);
    await this.prisma.caseThread.delete({ where: { id } });
  }

  async addEntry(
    threadId: string,
    dto: AddThreadEntryDto,
  ): Promise<ThreadResponseDto> {
    const thread = await this.prisma.caseThread.findUnique({
      where: { id: threadId },
      select: { id: true, caseId: true, title: true },
    });
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.caseThreadEntry.create({
        data: {
          threadId,
          entryType: dto.entryType,
          body: dto.body,
          author: dto.author,
        },
      });

      const actType =
        dto.entryType === CaseThreadEntryType.STATEMENT
          ? CaseActivityType.THREAD_STATEMENT_UPDATED
          : CaseActivityType.THREAD_ENTRY_ADDED;

      await this.activity.record(
        thread.caseId,
        actType,
        {
          threadId,
          entryId: entry.id,
          threadTitle: thread.title,
          entryType: dto.entryType,
          body: dto.body?.slice(0, 100),
        },
        dto.author,
        tx,
      );

      if (dto.entryType === CaseThreadEntryType.STATEMENT && dto.body) {
        await tx.caseThread.update({
          where: { id: threadId },
          data: { title: dto.body.slice(0, 200) },
        });
      }
    });

    return this.getOne(threadId);
  }

  async getEntries(
    threadId: string,
    cursor?: string,
    limit = 50,
  ): Promise<ThreadEntriesResponseDto> {
    const found = await this.prisma.caseThread.findUnique({
      where: { id: threadId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Thread ${threadId} not found`);

    const take = Math.min(Math.max(1, limit), 100);
    const where: Prisma.CaseThreadEntryWhereInput = { threadId };
    if (cursor) where.id = { lt: cursor };

    const rows = await this.prisma.caseThreadEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = rows.slice(0, take);
    return {
      items: items.map((r) => this.mapEntry(r)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async linkSupport(
    threadId: string,
    dto: LinkThreadSupportDto,
  ): Promise<ThreadResponseDto> {
    const thread = await this.prisma.caseThread.findUnique({
      where: { id: threadId },
      select: { caseId: true, title: true },
    });
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const { label: targetLabel, canonicalId } = await this.validateTarget(
      dto.targetType,
      dto.targetId,
      thread.caseId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.caseThreadSupport.upsert({
        where: {
          threadId_targetType_targetId: {
            threadId,
            targetType: dto.targetType,
            targetId: canonicalId,
          },
        },
        create: {
          threadId,
          targetType: dto.targetType,
          targetId: canonicalId,
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
      await this.activity.record(
        thread.caseId,
        CaseActivityType.SUPPORT_LINKED,
        {
          threadId,
          threadTitle: thread.title,
          targetType: dto.targetType,
          targetId: dto.targetId,
          targetLabel,
          stance: dto.stance ?? EvidenceStance.SUPPORTS,
        },
        undefined,
        tx,
      );
    });

    return this.getOne(threadId);
  }

  async unlinkSupport(
    threadId: string,
    linkId: string,
  ): Promise<ThreadResponseDto> {
    const link = await this.prisma.caseThreadSupport.findUnique({
      where: { id: linkId },
      select: { threadId: true, targetType: true, targetId: true },
    });
    if (!link || link.threadId !== threadId) {
      throw new NotFoundException(
        `Support link ${linkId} not found on thread ${threadId}`,
      );
    }
    const thread = await this.prisma.caseThread.findUnique({
      where: { id: threadId },
      select: { caseId: true, title: true },
    });
    const targetLabel = await this.lookupTargetLabel(
      link.targetType,
      link.targetId,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.caseThreadSupport.delete({ where: { id: linkId } });
      if (thread) {
        await this.activity.record(
          thread.caseId,
          CaseActivityType.SUPPORT_UNLINKED,
          {
            threadId,
            threadTitle: thread.title,
            linkId,
            targetType: link.targetType,
            targetLabel,
          },
          undefined,
          tx,
        );
      }
    });

    return this.getOne(threadId);
  }

  // ─── Private ─────────────────────────────────────────────────────

  private async getOne(id: string): Promise<ThreadResponseDto> {
    const row = await this.prisma.caseThread.findUnique({
      where: { id },
      include: this.include,
    });
    if (!row) throw new NotFoundException(`Thread ${id} not found`);
    return (await this.mapMany([row]))[0];
  }

  private async ensureCaseExists(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
  }

  /**
   * Validates the target belongs to the case and returns its display label
   * plus the canonical link-row id. Accepts either the link-row id
   * (CaseEvidence/CaseFinding) or the underlying entity id (asset/finding) —
   * agents naturally pass the latter.
   */
  private async validateTarget(
    targetType: 'evidence' | 'finding',
    targetId: string,
    caseId: string,
  ): Promise<{ label: string; canonicalId: string }> {
    if (targetType === 'evidence') {
      const ev =
        (await this.prisma.caseEvidence.findUnique({
          where: { id: targetId },
          select: { id: true, caseId: true, label: true, entityId: true },
        })) ??
        (await this.prisma.caseEvidence.findFirst({
          where: { caseId, entityId: targetId },
          select: { id: true, caseId: true, label: true, entityId: true },
        }));
      if (!ev || ev.caseId !== caseId)
        throw new BadRequestException(
          'Evidence must belong to the same case as the thread',
        );
      return { label: ev.label ?? ev.entityId, canonicalId: ev.id };
    }
    const cf =
      (await this.prisma.caseFinding.findUnique({
        where: { id: targetId },
        select: { id: true, caseId: true, label: true },
      })) ??
      (await this.prisma.caseFinding.findFirst({
        where: { caseId, findingId: targetId },
        select: { id: true, caseId: true, label: true },
      }));
    if (!cf || cf.caseId !== caseId)
      throw new BadRequestException(
        'Finding must belong to the same case as the thread',
      );
    return { label: cf.label, canonicalId: cf.id };
  }

  /** Best-effort display label for a support target (used when unlinking). */
  private async lookupTargetLabel(
    targetType: string,
    targetId: string,
  ): Promise<string | null> {
    if (targetType === 'evidence') {
      const ev = await this.prisma.caseEvidence.findUnique({
        where: { id: targetId },
        select: { label: true, entityId: true },
      });
      return ev ? (ev.label ?? ev.entityId) : null;
    }
    const cf = await this.prisma.caseFinding.findUnique({
      where: { id: targetId },
      select: { label: true },
    });
    return cf?.label ?? null;
  }

  private async mapMany(rows: ThreadRow[]): Promise<ThreadResponseDto[]> {
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
      const links: ThreadSupportLinkDto[] = r.support.map((s) => ({
        id: s.id,
        targetType: s.targetType,
        targetId: s.targetId,
        stance: s.stance,
        weight: s.weight === null ? null : Number(s.weight),
        note: s.note,
        targetLabel: labelFor(s.targetType, s.targetId),
        createdAt: s.createdAt,
      }));
      return {
        id: r.id,
        caseId: r.caseId,
        kind: r.kind,
        title: r.title,
        status: r.status,
        confidence: r.confidence === null ? null : Number(r.confidence),
        color: r.color ?? null,
        createdBy: r.createdBy,
        supportingCount,
        contradictingCount,
        links,
        entries: r.entries.map((e) => this.mapEntry(e)),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  private mapEntry(e: {
    id: string;
    threadId: string;
    entryType: CaseThreadEntryType;
    body: string | null;
    metadata: Prisma.JsonValue;
    author: string | null;
    createdAt: Date;
  }): ThreadEntryDto {
    return {
      id: e.id,
      threadId: e.threadId,
      entryType: e.entryType,
      body: e.body,
      metadata: (e.metadata ?? null) as Record<string, unknown> | null,
      author: e.author,
      createdAt: e.createdAt,
    };
  }
}
