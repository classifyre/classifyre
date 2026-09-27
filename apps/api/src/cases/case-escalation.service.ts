import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  CaseActivityType,
  CaseFindingRuleAction,
  Prisma,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CaseActivityService,
  mergeDistinct,
  mergeListed,
  type ActivityPayload,
} from '../case-activity.service';
import { NotificationsService } from '../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import { isReadOnlyCase } from '../case-board/board-rows';
import { AUTO_PULL_ACTOR } from './case-pull.port';
import {
  CaseCleanupService,
  type CitedFinding,
  type FilterSummary,
} from './case-cleanup.service';
import type { FindingFilterRule } from './case-cleanup.rules';

type Db = Prisma.TransactionClient;

/** Findings one escalation entry names; `count` says the rest. */
const LIST_CAP = 50;
const VALUE_MAX = 160;
/** One unread escalation notification per case in this window, not one per scan. */
const NOTIFY_QUIET_MS = 60 * 60_000;

/** What made findings escalate, as the timeline tells it. */
export type EscalationTrigger =
  | 'ARRIVAL'
  | 'ATTACHED'
  | 'RULE_ADDED'
  | 'RULE_UPDATED';

/** The finding fields an escalation reads and names. */
export interface EscalationCandidate {
  caseFindingId: string;
  findingId: string;
  findingType: string;
  matchedContent: string | null;
  severity: string | null;
  assetId: string;
  assetLabel: string | null;
  alreadyEscalated: boolean;
}

/**
 * Escalation rules at work: the case finding rules whose action is ESCALATE.
 * A matching finding is marked (escalatedAt, the rule and a label saying what
 * it matched), the case records when it last escalated, and the timeline
 * names each escalated finding. What arrives on its own — a watch's answers
 * after a scan — also raises a notification, since escalation exists to get
 * a person's attention.
 *
 * The matching itself is the filters' matching (CaseCleanupService), so a rule
 * means the same thing whichever action it has.
 */
@Injectable()
export class CaseEscalationService {
  private readonly logger = new Logger(CaseEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
    private readonly cleanup: CaseCleanupService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * The escalation rules a finding arriving through `inquiryId` meets (null:
   * arriving any other way — only case-wide rules hold).
   */
  gate(caseId: string, inquiryId: string | null, db?: Db) {
    return this.cleanup.ruleGate(
      caseId,
      inquiryId,
      CaseFindingRuleAction.ESCALATE,
      db,
    );
  }

  /**
   * Mark the case findings that just arrived and meet an escalation rule.
   * `added` says the watch brought them in only because they escalate (its
   * auto-add is off), which the timeline says. Returns how many escalated.
   */
  async escalateArrivals(
    caseId: string,
    inquiry: { id: string; title: string } | null,
    arrived: EscalationCandidate[],
    ctx: {
      trigger: 'ARRIVAL' | 'ATTACHED';
      actor: string | undefined;
      added?: boolean;
      run?: { sourceId?: string | null; runnerId?: string | null };
      db?: Db;
    },
  ): Promise<number> {
    if (arrived.length === 0) return 0;
    const db = ctx.db ?? this.prisma;
    const gate = await this.gate(caseId, inquiry?.id ?? null, db);
    const hits: Array<{ f: EscalationCandidate; rule: FilterSummary }> = [];
    for (const f of arrived) {
      if (f.alreadyEscalated) continue;
      const rule = gate({
        findingType: f.findingType,
        matchedContent: f.matchedContent,
      });
      if (rule) hits.push({ f, rule });
    }
    if (hits.length === 0) return 0;
    const source = ctx.run?.sourceId
      ? await db.source.findUnique({
          where: { id: ctx.run.sourceId },
          select: { name: true },
        })
      : null;
    await this.mark(db, caseId, hits, {
      trigger: ctx.trigger,
      actor: ctx.actor,
      extra: {
        ...(inquiry
          ? { inquiryId: inquiry.id, inquiryTitle: inquiry.title }
          : {}),
        ...(ctx.added ? { added: true } : {}),
        ...(ctx.run?.sourceId
          ? {
              sourceId: ctx.run.sourceId,
              ...(source ? { sourceNames: [source.name] } : {}),
              ...(ctx.run.runnerId ? { runnerId: ctx.run.runnerId } : {}),
            }
          : {}),
      },
      coalesce:
        ctx.actor === AUTO_PULL_ACTOR
          ? `escalate:${inquiry?.id ?? 'case'}`
          : undefined,
    });
    if (ctx.actor === AUTO_PULL_ACTOR) {
      await this.notify(caseId, hits, inquiry);
    }
    return hits.length;
  }

  /**
   * Mark what an escalation rule just added (or changed) matches among the
   * findings the case holds already. Joins the caller's transaction.
   */
  async escalateExisting(
    tx: Db,
    caseId: string,
    rules: Array<FindingFilterRule & FilterSummary>,
    ctx: { trigger: 'RULE_ADDED' | 'RULE_UPDATED'; actor: string | undefined },
  ): Promise<number> {
    const escalating = rules.filter(
      (r) => r.action === CaseFindingRuleAction.ESCALATE,
    );
    if (escalating.length === 0) return 0;
    const row = await tx.case.findUnique({
      where: { id: caseId },
      select: { status: true },
    });
    if (!row || isReadOnlyCase(row.status)) return 0;
    const matches = await this.cleanup.planFilterRemovals(
      tx,
      caseId,
      escalating,
    );
    const byId = new Map(escalating.map((r) => [r.id, r]));
    const hits = matches
      .filter((m) => !m.cf.escalatedAt && m.filterId && byId.has(m.filterId))
      .map((m) => ({ f: candidateOf(m.cf), rule: byId.get(m.filterId!)! }));
    if (hits.length === 0) return 0;
    await this.mark(tx, caseId, hits, {
      trigger: ctx.trigger,
      actor: ctx.actor,
      extra: {},
    });
    return hits.length;
  }

  /**
   * Take the escalation mark off findings (all of the case's, when
   * `findingIds` is omitted). The findings stay in the case.
   */
  async clear(
    caseId: string,
    findingIds: string[] | undefined,
    actor: string | undefined,
  ): Promise<{ cleared: number }> {
    const rows = await this.prisma.caseFinding.findMany({
      where: {
        caseId,
        escalatedAt: { not: null },
        ...(findingIds && findingIds.length > 0
          ? { findingId: { in: findingIds } }
          : {}),
      },
      include: { caseEvidence: { select: { entityId: true, label: true } } },
      orderBy: { escalatedAt: 'desc' },
    });
    if (rows.length === 0) return { cleared: 0 };
    await this.prisma.$transaction(async (tx) => {
      await tx.caseFinding.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: {
          escalatedAt: null,
          escalationRuleId: null,
          escalationLabel: null,
        },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.ESCALATION_CLEARED,
        {
          count: rows.length,
          findings: rows.slice(0, LIST_CAP).map((r) => ({
            ...listed(candidateOf(r)),
            escalationLabel: r.escalationLabel,
          })),
          ...(rows.length > LIST_CAP ? { truncated: true } : {}),
        },
        actor,
        tx,
      );
    });
    return { cleared: rows.length };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async mark(
    db: Db,
    caseId: string,
    hits: Array<{ f: EscalationCandidate; rule: FilterSummary }>,
    ctx: {
      trigger: EscalationTrigger;
      actor: string | undefined;
      extra: ActivityPayload;
      coalesce?: string;
    },
  ): Promise<void> {
    const now = new Date();
    // One update per rule: every finding it matched gets the same label.
    const byRule = new Map<string, typeof hits>();
    for (const hit of hits) {
      const list = byRule.get(hit.rule.id) ?? [];
      list.push(hit);
      byRule.set(hit.rule.id, list);
    }
    for (const [ruleId, list] of byRule) {
      await db.caseFinding.updateMany({
        where: {
          id: { in: list.map((h) => h.f.caseFindingId) },
          escalatedAt: null,
        },
        data: {
          escalatedAt: now,
          escalationRuleId: ruleId,
          escalationLabel: describeRule(list[0].rule),
        },
      });
    }
    await db.case.update({
      where: { id: caseId },
      data: { lastEscalatedAt: now },
    });
    const items = await this.itemsFor(
      db,
      caseId,
      hits.map((h) => h.f.assetId),
    );
    const rules = [...new Map(hits.map((h) => [h.rule.id, h.rule])).values()];
    const payload: ActivityPayload = {
      trigger: ctx.trigger,
      count: hits.length,
      findings: hits.slice(0, LIST_CAP).map((h) => ({
        ...listed(h.f),
        ruleId: h.rule.id,
        ...(items.get(h.f.assetId) ? { itemId: items.get(h.f.assetId) } : {}),
      })),
      ...(hits.length > LIST_CAP ? { truncated: true } : {}),
      rules: rules.slice(0, 10),
      ...ctx.extra,
    };
    if (ctx.coalesce && ctx.actor) {
      await this.activity.recordCoalesced(
        caseId,
        CaseActivityType.FINDINGS_ESCALATED,
        payload,
        ctx.actor,
        {
          key: ctx.coalesce,
          merge: (previous, next) => {
            const merged = mergeListed(previous, next, 'findings', LIST_CAP);
            const ruleList = new Map<string, unknown>();
            for (const r of [
              ...(Array.isArray(next.rules) ? next.rules : []),
              ...(Array.isArray(previous.rules) ? previous.rules : []),
            ] as Array<{ id?: string }>) {
              if (r?.id && !ruleList.has(r.id)) ruleList.set(r.id, r);
            }
            return {
              ...next,
              count: numberOf(previous.count) + numberOf(next.count),
              findings: merged.list,
              truncated: merged.truncated || undefined,
              rules: [...ruleList.values()].slice(0, 10),
              sourceNames: mergeDistinct(previous, next, 'sourceNames', 10),
            };
          },
        },
        db,
      );
      return;
    }
    await this.activity.record(
      caseId,
      CaseActivityType.FINDINGS_ESCALATED,
      payload,
      ctx.actor,
      db,
    );
  }

  /** Board items of the assets, so the timeline can offer "Show on board". */
  private async itemsFor(
    db: Db,
    caseId: string,
    assetIds: string[],
  ): Promise<Map<string, string>> {
    const evidence = await db.caseEvidence.findMany({
      where: {
        caseId,
        entityType: 'asset',
        entityId: { in: [...new Set(assetIds)] },
      },
      select: { id: true, entityId: true },
    });
    if (evidence.length === 0) return new Map();
    const items = await db.caseBoardItem.findMany({
      where: {
        board: { caseId },
        kind: 'EVIDENCE',
        refId: { in: evidence.map((e) => e.id) },
        deletedAt: null,
      },
      select: { id: true, refId: true },
    });
    const assetByEvidence = new Map(evidence.map((e) => [e.id, e.entityId]));
    const out = new Map<string, string>();
    for (const item of items) {
      const assetId = item.refId ? assetByEvidence.get(item.refId) : undefined;
      if (assetId) out.set(assetId, item.id);
    }
    return out;
  }

  /**
   * Tell someone. One unread notification per case at a time: a source that
   * scans every few minutes must not bury the inbox under the same news.
   */
  private async notify(
    caseId: string,
    hits: Array<{ f: EscalationCandidate; rule: FilterSummary }>,
    inquiry: { id: string; title: string } | null,
  ): Promise<void> {
    if (!this.notifications) return;
    try {
      const recent = await this.prisma.notification.findFirst({
        where: {
          event: NotificationEvent.CASE_FINDINGS_ESCALATED,
          isRead: false,
          createdAt: { gte: new Date(Date.now() - NOTIFY_QUIET_MS) },
          metadata: { path: ['caseId'], equals: caseId },
        },
        select: { id: true },
      });
      if (recent) return;
      const found = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { title: true, severity: true },
      });
      if (!found) return;
      const rules = [
        ...new Set(hits.map((h) => describeRule(h.rule, false))),
      ].slice(0, 3);
      await this.notifications.create({
        type: NotificationType.FINDING,
        event: NotificationEvent.CASE_FINDINGS_ESCALATED,
        severity: found.severity ?? Severity.HIGH,
        title: `Escalation: ${found.title}`,
        message:
          `${hits.length} finding(s) matched an escalation rule (${rules.join('; ')})` +
          (inquiry ? ` and came in through “${inquiry.title}”.` : '.'),
        actionUrl: `/investigations/${caseId}`,
        isImportant: true,
        metadata: {
          caseId,
          caseTitle: found.title,
          count: hits.length,
          ruleIds: [...new Set(hits.map((h) => h.rule.id))],
          ...(inquiry ? { inquiryId: inquiry.id } : {}),
        },
      });
    } catch (error) {
      // The escalation is recorded; a failed notification must not undo it.
      this.logger.warn(
        `Escalation notification for case ${caseId} failed: ${String(error)}`,
      );
    }
  }
}

/** A rule in words: "type IP_ADDRESS" or "value /^10\./ — internal". */
export function describeRule(
  rule: Pick<FilterSummary, 'kind' | 'pattern' | 'description'>,
  withDescription = true,
): string {
  const what =
    rule.kind === 'FINDING_TYPE'
      ? `type ${rule.pattern}`
      : `value /${rule.pattern}/`;
  return withDescription && rule.description
    ? `${what} — ${rule.description}`
    : what;
}

export function candidateOf(cf: CitedFinding): EscalationCandidate {
  return {
    caseFindingId: cf.id,
    findingId: cf.findingId,
    findingType: cf.label,
    matchedContent: cf.matchedContent,
    severity: cf.severity,
    assetId: cf.caseEvidence.entityId,
    assetLabel: cf.caseEvidence.label,
    alreadyEscalated: cf.escalatedAt != null,
  };
}

function listed(f: EscalationCandidate): ActivityPayload {
  return {
    caseFindingId: f.caseFindingId,
    findingId: f.findingId,
    label: f.findingType,
    value:
      f.matchedContent && f.matchedContent.length > VALUE_MAX
        ? `${f.matchedContent.slice(0, VALUE_MAX)}…`
        : f.matchedContent,
    severity: f.severity,
    assetId: f.assetId,
    assetLabel: f.assetLabel,
  };
}

function numberOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
