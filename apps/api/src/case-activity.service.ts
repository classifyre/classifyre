import { Injectable } from '@nestjs/common';
import { CaseActivityType, Prisma, PrismaClient } from '@prisma/client';

type JsonInput = any;
import { PrismaService } from './prisma.service';
import { CaseTimelineResponseDto } from './dto/case-activity.dto';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type ActivityPayload = Record<string, unknown>;

@Injectable()
export class CaseActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record one activity row. Pass a tx client when inside a transaction. */
  async record(
    caseId: string,
    activityType: CaseActivityType,
    payload: ActivityPayload,
    actor?: string,
    tx?: TxClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.caseActivity.create({
      data: {
        caseId,
        activityType,
        payload: payload as JsonInput,
        actor: actor ?? null,
      },
    });
  }

  async getTimeline(
    caseId: string,
    cursor?: string,
    limit = 50,
  ): Promise<CaseTimelineResponseDto> {
    const take = Math.min(Math.max(1, limit), 100);

    const where: Prisma.CaseActivityWhereInput = { caseId };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const rows = await this.prisma.caseActivity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const items = rows.slice(0, take);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((r) => ({
        id: r.id,
        caseId: r.caseId,
        activityType: r.activityType,
        actor: r.actor,
        payload: (r.payload ?? {}) as ActivityPayload,
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }
}
