import { Injectable, Optional } from '@nestjs/common';
import { CaseActivityType, Prisma, PrismaClient } from '@prisma/client';

type JsonInput = any;
import { PrismaService } from './prisma.service';
import { CaseTimelineResponseDto } from './dto/case-activity.dto';
import { afterAnchor, pageSize, UNTIL_MAX, upToAnchor } from './activity-page';
// A value import: an @Optional() injection resolves from emitted metadata.
import { CaseLeadsScheduler } from './cases/case-leads.scheduler';

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
  /** How long since it last grew the entry keeps absorbing (default {@link COALESCE_GAP_MS}). */
  gapMs?: number;
}

/**
 * A person editing one of the case's own fields: the case file saves as they
 * type, so a stretch of editing is one entry, closed after this long without
 * a save.
 */
export const EDIT_COALESCE_GAP_MS = 15 * 60_000;

/**
 * Activity that changes what a case's leads should be: new evidence (new seeds,
 * new documents to find copies of), a watch linked or answering, a filter that
 * rules a kind of finding out. Every way into a case records one of these, so
 * this is the one place the lead refresh has to listen.
 */
const REFRESHES_LEADS: ReadonlySet<CaseActivityType> = new Set([
  CaseActivityType.EVIDENCE_ADDED,
  CaseActivityType.FINDING_ADDED,
  CaseActivityType.INQUIRY_LINKED,
  CaseActivityType.INQUIRY_PULLED,
  CaseActivityType.LEAD_ACCEPTED,
  CaseActivityType.FINDINGS_ESCALATED,
  CaseActivityType.FINDING_FILTER_ADDED,
  CaseActivityType.FINDING_FILTER_UPDATED,
]);

@Injectable()
export class CaseActivityService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly leads?: CaseLeadsScheduler,
  ) {}

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
    this.nudgeLeads(caseId, activityType);
  }

  /**
   * Ask for the case's leads to be refreshed after this activity. Fire and
   * forget: the refresh starts after a short delay (so a surrounding
   * transaction has committed) and coalesces with the rest of a burst.
   */
  private nudgeLeads(caseId: string, activityType: CaseActivityType): void {
    if (!this.leads || !REFRESHES_LEADS.has(activityType)) return;
    void this.leads.request(caseId, activityType.toLowerCase());
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
   * A person's own actions never go through here — each is its own entry —
   * except their edits to a field the case file autosaves (see
   * {@link recordEdit}), where every keystroke pause is a save.
   */
  async recordCoalesced(
    caseId: string,
    activityType: CaseActivityType,
    payload: ActivityPayload,
    actor: string | null,
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
        createdAt: {
          gte: new Date(now.getTime() - (coalesce.gapMs ?? COALESCE_GAP_MS)),
        },
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
      this.nudgeLeads(caseId, activityType);
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
    this.nudgeLeads(caseId, activityType);
  }

  /**
   * A person's edit to the case's own fields (title, description, the
   * conclusion draft…), saved as they type. Saves by the same person to the
   * same `key` within {@link EDIT_COALESCE_GAP_MS} of each other read as one
   * entry; two people's edits never merge.
   */
  async recordEdit(
    caseId: string,
    activityType: CaseActivityType,
    payload: ActivityPayload,
    actor: string | undefined,
    key: string,
    merge: CoalescedRecord['merge'],
    tx?: TxClient,
  ): Promise<void> {
    await this.recordCoalesced(
      caseId,
      activityType,
      payload,
      actor ?? null,
      { key: `edit:${key}`, merge, gapMs: EDIT_COALESCE_GAP_MS },
      tx,
    );
  }

  /**
   * A page of the case's timeline, newest first. `types` narrows it to some
   * activity types, `inquiryId` to entries about one watch. `until` names an
   * entry the page must reach (a deep link to it): the page then runs from
   * the top down to and including that entry, however long, up to
   * {@link UNTIL_MAX} rows.
   */
  async getTimeline(
    caseId: string,
    cursor?: string,
    limit = 50,
    opts: {
      types?: CaseActivityType[];
      inquiryId?: string;
      until?: string;
    } = {},
  ): Promise<CaseTimelineResponseDto> {
    let take = pageSize(limit);
    const filters: Prisma.CaseActivityWhereInput[] = [{ caseId }];
    if (opts.types && opts.types.length > 0) {
      filters.push({ activityType: { in: opts.types } });
    }
    if (opts.inquiryId) {
      filters.push({
        payload: { path: ['inquiryId'], equals: opts.inquiryId },
      });
    }
    if (cursor) {
      const anchor = await this.prisma.caseActivity.findFirst({
        where: { id: cursor, caseId },
        select: { id: true, createdAt: true },
      });
      // A cursor that names nothing in this case ends the feed.
      if (!anchor) return { items: [], nextCursor: null };
      filters.push(afterAnchor(anchor));
    }
    if (opts.until) {
      const target = await this.prisma.caseActivity.findFirst({
        where: { id: opts.until, caseId },
        select: { id: true, createdAt: true },
      });
      if (target) {
        const reach = await this.prisma.caseActivity.count({
          where: { AND: [...filters, upToAnchor(target)] },
        });
        take = Math.min(Math.max(take, reach), UNTIL_MAX);
      }
    }

    const rows = await this.prisma.caseActivity.findMany({
      where: { AND: filters },
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
