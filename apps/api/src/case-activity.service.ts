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

/**
 * How long an automatic entry keeps absorbing the next pass of the same kind:
 * the gap since it last grew, and how far back its first pass may lie.
 */
export const COALESCE_GAP_MS = 60 * 60_000;
export const COALESCE_SPAN_MS = 24 * 60 * 60_000;

/**
 * One automatic pass, as it asks to be folded into the timeline: `key` names
 * what may merge with it (a watch, a removal reason), `merge` combines the
 * entry so far with this pass.
 */
export interface CoalescedRecord {
  key: string;
  merge: (previous: ActivityPayload, next: ActivityPayload) => ActivityPayload;
}

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

  /**
   * Record what the platform did by itself — a watch's auto-add, the
   * clean-up after a scan — so that a stretch of it reads as ONE entry.
   *
   * A source that scans every few minutes would otherwise write a row per
   * scan and bury everything a person did. So the pass folds into the latest
   * entry of the same type, actor and key while that entry last grew within
   * {@link COALESCE_GAP_MS} and began within {@link COALESCE_SPAN_MS}. The
   * merged entry moves to the time of its latest pass and keeps `firstAt`,
   * `lastAt` and `passes`, so it can say "5 scans between 14:00 and 15:40".
   *
   * A person's own actions never go through here: each is its own entry.
   */
  async recordCoalesced(
    caseId: string,
    activityType: CaseActivityType,
    payload: ActivityPayload,
    actor: string,
    coalesce: CoalescedRecord,
    tx?: TxClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const now = new Date();
    const recent = await client.caseActivity.findFirst({
      where: {
        caseId,
        activityType,
        actor,
        createdAt: { gte: new Date(now.getTime() - COALESCE_GAP_MS) },
        payload: { path: ['coalesceKey'], equals: coalesce.key },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const previous = recent?.payload as ActivityPayload | null | undefined;
    const firstAt =
      typeof previous?.firstAt === 'string' ? new Date(previous.firstAt) : null;
    if (
      recent &&
      previous &&
      firstAt &&
      now.getTime() - firstAt.getTime() <= COALESCE_SPAN_MS
    ) {
      const merged: ActivityPayload = {
        ...coalesce.merge(previous, payload),
        coalesceKey: coalesce.key,
        firstAt: previous.firstAt,
        lastAt: now.toISOString(),
        passes: (Number(previous.passes) || 1) + 1,
      };
      await client.caseActivity.update({
        where: { id: recent.id },
        data: { payload: merged as JsonInput, createdAt: now },
      });
      return;
    }
    await client.caseActivity.create({
      data: {
        caseId,
        activityType,
        actor,
        createdAt: now,
        payload: {
          ...payload,
          coalesceKey: coalesce.key,
          firstAt: now.toISOString(),
          lastAt: now.toISOString(),
          passes: 1,
        } as JsonInput,
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

/**
 * Merge two capped lists of named items (findings or assets), newest first,
 * so a merged entry keeps showing what arrived last. `truncated` survives:
 * once a pass named fewer than it counted, the merged list does too.
 */
export function mergeListed(
  previous: ActivityPayload,
  next: ActivityPayload,
  key: string,
  cap: number,
): { list: unknown[]; truncated: boolean } {
  const earlier = Array.isArray(previous[key]) ? previous[key] : [];
  const later = Array.isArray(next[key]) ? next[key] : [];
  const all = [...later, ...earlier];
  return {
    list: all.slice(0, cap),
    truncated:
      previous.truncated === true ||
      next.truncated === true ||
      all.length > cap,
  };
}

/** Distinct values of a string list across two payloads, capped. */
export function mergeDistinct(
  previous: ActivityPayload,
  next: ActivityPayload,
  key: string,
  cap: number,
): string[] {
  const values = [
    ...(Array.isArray(next[key]) ? (next[key] as unknown[]) : []),
    ...(Array.isArray(previous[key]) ? (previous[key] as unknown[]) : []),
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [...new Set(values)].slice(0, cap);
}
