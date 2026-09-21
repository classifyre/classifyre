import { Injectable } from '@nestjs/common';
import { InquiryActivityType, Prisma, PrismaClient } from '@prisma/client';

type JsonInput = any;
import { PrismaService } from './prisma.service';
import { InquiryTimelineResponseDto } from './dto/inquiry-activity.dto';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type InquiryActivityPayload = Record<string, unknown>;

/**
 * Append-only log of what happened to an inquiry.
 *
 * It exists because an inquiry's NEW/GONE state is derived rather than stored:
 * a match is new only until its source runs again, so the live answer is gone
 * by the time anyone asks a second time. This is the durable half — "twelve
 * matches landed from this run, three were retired, the matchers changed on
 * Tuesday" — and it survives every recompute.
 *
 * Mirrors CaseActivityService deliberately, down to the cursor shape, so the
 * two timelines can share a renderer.
 */
@Injectable()
export class InquiryActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record one activity row. Pass a tx client when inside a transaction. */
  async record(
    inquiryId: string,
    activityType: InquiryActivityType,
    payload: InquiryActivityPayload,
    actor?: string,
    tx?: TxClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.inquiryActivity.create({
      data: {
        inquiryId,
        activityType,
        payload: payload as JsonInput,
        actor: actor ?? null,
      },
    });
  }

  /**
   * Record without ever failing the caller.
   *
   * Used from the matching worker, where the counters are already committed by
   * the time the timeline is written: a timeline row that cannot be stored is
   * a lost note, not a reason to fail a run and retry the whole match pass.
   */
  async tryRecord(
    inquiryId: string,
    activityType: InquiryActivityType,
    payload: InquiryActivityPayload,
    actor?: string,
  ): Promise<void> {
    try {
      await this.record(inquiryId, activityType, payload, actor);
    } catch {
      // Intentionally silent — see the docblock.
    }
  }

  async getTimeline(
    inquiryId: string,
    cursor?: string,
    limit = 50,
  ): Promise<InquiryTimelineResponseDto> {
    const take = Math.min(Math.max(1, limit), 100);

    const where: Prisma.InquiryActivityWhereInput = { inquiryId };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const rows = await this.prisma.inquiryActivity.findMany({
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
        inquiryId: r.inquiryId,
        activityType: r.activityType,
        actor: r.actor,
        payload: (r.payload ?? {}) as InquiryActivityPayload,
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }
}
