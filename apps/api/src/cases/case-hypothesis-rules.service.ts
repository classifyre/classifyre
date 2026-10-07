import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  CaseActivityType,
  CaseFindingFilterKind,
  EvidenceStance,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CaseActivityService } from '../case-activity.service';
import { isReadOnlyCase } from '../case-board/board-rows';
import {
  CASE_BOARD_ARRIVALS,
  type CaseBoardArrivalsPort,
} from './case-board-arrivals.port';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import {
  AddCaseHypothesisRuleDto,
  CaseHypothesisRuleDto,
  CaseHypothesisRulesChangeResponseDto,
  CaseHypothesisRuleRemovalResponseDto,
  UpdateCaseHypothesisRuleDto,
} from '../dto/case-hypothesis-rules.dto';
import {
  describeRuleMatcher,
  linkKey,
  planLinks,
  ruleMatcherProblem,
  type HypothesisRuleSpec,
  type PlannedLink,
} from './case-hypothesis-rules.rules';

/** Rules one case may hold. */
const RULES_PER_CASE = 100;
/** Findings named on a timeline entry. */
const LISTED = 10;

type RuleRow = Prisma.CaseHypothesisRuleGetPayload<{
  include: {
    watch: {
      select: { inquiryId: true; inquiry: { select: { title: true } } };
    };
    thread: { select: { title: true; status: true } };
    _count: { select: { links: true } };
  };
}>;

export const RULE_INCLUDE = {
  watch: {
    select: { inquiryId: true, inquiry: { select: { title: true } } },
  },
  thread: { select: { title: true, status: true } },
  _count: { select: { links: true } },
} as const;

/** What a pass of links changed, for the timeline and for placement. */
interface LinkOutcome {
  linked: number;
  /** Case-evidence ids that now carry a stance, to be laid out on the board. */
  evidenceIds: string[];
}

/**
 * A case's hypothesis rules: what the case does, by itself, with the answers
 * one of its watches brings in. A rule says "link these answers to that
 * hypothesis with this stance"; every arrival from the watch is linked as it
 * lands, and its evidence is laid out beside the hypothesis on the board (in
 * the hypothesis's frame, when it has one).
 *
 * Rules live on the case, like finding filters, so the watch is untouched and
 * the same watch can feed other cases with their own handling. A rule goes
 * when its hypothesis or its watch link does (foreign keys), and the links it
 * made stay unless the person removing the rule asks otherwise.
 */
@Injectable()
export class CaseHypothesisRulesService {
  private readonly logger = new Logger(CaseHypothesisRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
    private readonly matching: InquiryMatchingService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async list(caseId: string): Promise<CaseHypothesisRuleDto[]> {
    await this.ensureCase(caseId);
    const rows = await this.prisma.caseHypothesisRule.findMany({
      where: { caseId },
      include: RULE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRuleDto);
  }

  async add(
    caseId: string,
    dto: AddCaseHypothesisRuleDto,
    actor?: string,
  ): Promise<CaseHypothesisRulesChangeResponseDto> {
    await this.ensureWritable(caseId);
    const link = await this.watchLink(caseId, dto.inquiryId);
    const thread = await this.hypothesis(caseId, dto.threadId);
    const { kind, pattern } = this.matcher(dto.kind, dto.pattern);
    const stance = dto.stance ?? EvidenceStance.SUPPORTS;

    const same = await this.prisma.caseHypothesisRule.findMany({
      where: {
        caseId,
        caseInquiryId: link.id,
        threadId: thread.id,
        kind: kind ?? null,
        pattern: pattern ?? null,
      },
      select: { id: true, stance: true },
    });
    const clash = same.find((r) => r.stance !== stance);
    if (clash) {
      throw new ConflictException(
        'This watch already has a rule for the same answers and this hypothesis with another stance. Change that rule instead.',
      );
    }
    let ruleId = same[0]?.id;
    if (!ruleId) {
      const count = await this.prisma.caseHypothesisRule.count({
        where: { caseId },
      });
      if (count >= RULES_PER_CASE) {
        throw new BadRequestException(
          `A case holds at most ${RULES_PER_CASE} hypothesis rules.`,
        );
      }
      const created = await this.prisma.caseHypothesisRule.create({
        data: {
          caseId,
          caseInquiryId: link.id,
          threadId: thread.id,
          stance,
          kind: kind ?? null,
          pattern: pattern ?? null,
          description: dto.description?.trim() || null,
          createdBy: actor ?? null,
        },
      });
      ruleId = created.id;
      await this.activity.record(
        caseId,
        CaseActivityType.HYPOTHESIS_RULE_ADDED,
        {
          inquiryId: link.inquiryId,
          inquiryTitle: link.title,
          threadId: thread.id,
          threadTitle: thread.title,
          stance,
          matcher: describeRuleMatcher(kind ?? null, pattern ?? null),
          ...(kind && pattern ? { kind, pattern } : {}),
        },
        actor,
      );
    }

    let outcome: LinkOutcome = { linked: 0, evidenceIds: [] };
    if (dto.applyToExisting) {
      outcome = await this.linkHeld(caseId, link, ruleId, actor);
      await this.land(caseId, outcome.evidenceIds, actor);
    }
    return { rules: await this.list(caseId), linked: outcome.linked };
  }

  async update(
    caseId: string,
    ruleId: string,
    dto: UpdateCaseHypothesisRuleDto,
    actor?: string,
  ): Promise<CaseHypothesisRulesChangeResponseDto> {
    await this.ensureWritable(caseId);
    const rule = await this.prisma.caseHypothesisRule.findUnique({
      where: { id: ruleId },
      include: RULE_INCLUDE,
    });
    if (!rule || rule.caseId !== caseId) {
      throw new NotFoundException(
        `Hypothesis rule ${ruleId} not found in case ${caseId}`,
      );
    }
    const thread =
      dto.threadId && dto.threadId !== rule.threadId
        ? await this.hypothesis(caseId, dto.threadId)
        : null;
    const matcherGiven = dto.kind !== undefined || dto.pattern !== undefined;
    const next = matcherGiven
      ? this.matcher(dto.kind, dto.pattern)
      : { kind: rule.kind, pattern: rule.pattern };
    const stance = dto.stance ?? rule.stance;
    const threadId = thread?.id ?? rule.threadId;

    const sameAs = await this.prisma.caseHypothesisRule.findFirst({
      where: {
        caseId,
        caseInquiryId: rule.caseInquiryId,
        threadId,
        kind: next.kind ?? null,
        pattern: next.pattern ?? null,
        NOT: { id: rule.id },
      },
      select: { id: true },
    });
    if (sameAs) {
      throw new ConflictException(
        'This watch already has a rule for the same answers and this hypothesis.',
      );
    }

    const changed: Array<{ setting: string; from: unknown; to: unknown }> = [];
    if (threadId !== rule.threadId) {
      changed.push({
        setting: 'hypothesis',
        from: rule.thread.title,
        to: thread?.title ?? threadId,
      });
    }
    if (stance !== rule.stance) {
      changed.push({ setting: 'stance', from: rule.stance, to: stance });
    }
    if (next.kind !== rule.kind || next.pattern !== rule.pattern) {
      changed.push({
        setting: 'answers',
        from: describeRuleMatcher(rule.kind, rule.pattern),
        to: describeRuleMatcher(next.kind ?? null, next.pattern ?? null),
      });
    }
    const description =
      dto.description === undefined
        ? rule.description
        : dto.description?.trim() || null;

    await this.prisma.caseHypothesisRule.update({
      where: { id: rule.id },
      data: {
        threadId,
        stance,
        kind: next.kind ?? null,
        pattern: next.pattern ?? null,
        description,
      },
    });

    let moved = 0;
    const retarget = threadId !== rule.threadId || stance !== rule.stance;
    if (retarget && dto.updateLinks !== false) {
      moved = await this.retargetLinks(rule.id, threadId, stance);
    }
    if (changed.length > 0) {
      await this.activity.record(
        caseId,
        CaseActivityType.HYPOTHESIS_RULE_UPDATED,
        {
          inquiryId: rule.watch.inquiryId,
          inquiryTitle: rule.watch.inquiry.title,
          threadId,
          threadTitle: thread?.title ?? rule.thread.title,
          stance,
          changes: changed,
          ...(moved > 0 ? { links: moved } : {}),
        },
        actor,
      );
    }
    return { rules: await this.list(caseId), linked: moved };
  }

  async remove(
    caseId: string,
    ruleId: string,
    opts: { removeLinks?: boolean } = {},
    actor?: string,
  ): Promise<CaseHypothesisRuleRemovalResponseDto> {
    await this.ensureWritable(caseId);
    const rule = await this.prisma.caseHypothesisRule.findUnique({
      where: { id: ruleId },
      include: RULE_INCLUDE,
    });
    if (!rule || rule.caseId !== caseId) {
      throw new NotFoundException(
        `Hypothesis rule ${ruleId} not found in case ${caseId}`,
      );
    }
    let unlinked = 0;
    if (opts.removeLinks) {
      const gone = await this.prisma.caseThreadSupport.deleteMany({
        where: { ruleId: rule.id },
      });
      unlinked = gone.count;
    }
    await this.prisma.caseHypothesisRule.delete({ where: { id: rule.id } });
    await this.activity.record(
      caseId,
      CaseActivityType.HYPOTHESIS_RULE_REMOVED,
      {
        inquiryId: rule.watch.inquiryId,
        inquiryTitle: rule.watch.inquiry.title,
        threadId: rule.threadId,
        threadTitle: rule.thread.title,
        stance: rule.stance,
        matcher: describeRuleMatcher(rule.kind, rule.pattern),
        kept: opts.removeLinks ? 0 : rule._count.links,
        unlinked,
      },
      actor,
    );
    return { rules: await this.list(caseId), unlinked };
  }

  /**
   * Findings of `inquiry` that just joined `caseId`: link each to the
   * hypotheses the case's rules for that watch name, then lay their evidence
   * out beside the hypothesis. Called by the pull, after the findings are in.
   *
   * A link a person already made on a pair is never touched, and a failure
   * here never fails the pull: the findings are in the case either way.
   */
  async onArrival(
    caseId: string,
    inquiry: { id: string; title: string },
    findingIds: readonly string[],
    actor?: string,
  ): Promise<number> {
    if (findingIds.length === 0) return 0;
    try {
      const link = await this.prisma.caseInquiry.findUnique({
        where: { caseId_inquiryId: { caseId, inquiryId: inquiry.id } },
        select: { id: true },
      });
      if (!link) return 0;
      const rules = await this.rulesOf(link.id);
      if (rules.length === 0) return 0;
      const outcome = await this.linkFindings(
        caseId,
        { id: link.id, inquiryId: inquiry.id, title: inquiry.title },
        rules,
        findingIds,
        actor,
        true,
      );
      await this.land(caseId, outcome.evidenceIds, actor);
      return outcome.linked;
    } catch (error) {
      this.logger.warn(
        `Hypothesis rules for case ${caseId} could not link the answers of inquiry ${inquiry.id}: ${String(error)}`,
      );
      return 0;
    }
  }

  // ─── Linking ──────────────────────────────────────────────────────────────

  /** One rule over what the case holds already from its watch. */
  private async linkHeld(
    caseId: string,
    link: { id: string; inquiryId: string; title: string },
    ruleId: string,
    actor?: string,
  ): Promise<LinkOutcome> {
    const rules = (await this.rulesOf(link.id)).filter((r) => r.id === ruleId);
    if (rules.length === 0) return { linked: 0, evidenceIds: [] };
    const answers = await this.matching.getMatchingFindingIds(link.inquiryId);
    if (answers.length === 0) return { linked: 0, evidenceIds: [] };
    return this.linkFindings(caseId, link, rules, answers, actor, false);
  }

  private async linkFindings(
    caseId: string,
    link: { id: string; inquiryId: string; title: string },
    rules: HypothesisRuleSpec[],
    findingIds: readonly string[],
    actor: string | undefined,
    automatic: boolean,
  ): Promise<LinkOutcome> {
    const held = await this.prisma.caseFinding.findMany({
      where: { caseId, findingId: { in: [...findingIds] } },
      select: {
        id: true,
        caseEvidenceId: true,
        label: true,
        matchedContent: true,
      },
    });
    if (held.length === 0) return { linked: 0, evidenceIds: [] };
    const taken = await this.prisma.caseThreadSupport.findMany({
      where: {
        targetType: 'finding',
        targetId: { in: held.map((h) => h.id) },
        threadId: { in: [...new Set(rules.map((r) => r.threadId))] },
      },
      select: { targetId: true, threadId: true },
    });
    const plan = planLinks(
      rules,
      held.map((h) => ({
        caseFindingId: h.id,
        findingType: h.label,
        matchedContent: h.matchedContent,
      })),
      new Set(taken.map((t) => linkKey(t.targetId, t.threadId))),
    );
    if (plan.length === 0) return { linked: 0, evidenceIds: [] };

    const created = await this.prisma.caseThreadSupport.createMany({
      data: plan.map((p) => ({
        threadId: p.threadId,
        targetType: 'finding',
        targetId: p.caseFindingId,
        stance: p.stance,
        ruleId: p.ruleId,
      })),
      skipDuplicates: true,
    });
    if (created.count > 0) {
      await this.recordLinked(caseId, link, plan, held, actor, automatic);
    }
    const evidenceOf = new Map(held.map((h) => [h.id, h.caseEvidenceId]));
    return {
      linked: created.count,
      evidenceIds: [
        ...new Set(plan.map((p) => evidenceOf.get(p.caseFindingId)!)),
      ],
    };
  }

  /**
   * The timeline entry: which watch, which hypotheses with which stance, and
   * how many findings. An automatic pass folds into the previous entry of the
   * same watch, so a source that scans every few minutes reads as one growing
   * line, not one per scan.
   */
  private async recordLinked(
    caseId: string,
    link: { inquiryId: string; title: string },
    plan: PlannedLink[],
    held: Array<{ id: string; label: string; matchedContent: string | null }>,
    actor: string | undefined,
    automatic: boolean,
  ): Promise<void> {
    const threads = await this.prisma.caseThread.findMany({
      where: { id: { in: [...new Set(plan.map((p) => p.threadId))] } },
      select: { id: true, title: true },
    });
    const title = new Map(threads.map((t) => [t.id, t.title]));
    const byThread = new Map<
      string,
      { threadId: string; threadTitle: string; stance: string; count: number }
    >();
    for (const p of plan) {
      const key = `${p.threadId}\u0000${p.stance}`;
      const row = byThread.get(key) ?? {
        threadId: p.threadId,
        threadTitle: title.get(p.threadId) ?? '',
        stance: p.stance,
        count: 0,
      };
      row.count += 1;
      byThread.set(key, row);
    }
    const label = new Map(held.map((h) => [h.id, h]));
    const payload = {
      inquiryId: link.inquiryId,
      inquiryTitle: link.title,
      automatic,
      linked: plan.length,
      hypotheses: [...byThread.values()],
      findings: [...new Set(plan.map((p) => p.caseFindingId))]
        .slice(0, LISTED)
        .map((id) => ({
          label: label.get(id)?.label ?? '',
          value: label.get(id)?.matchedContent?.slice(0, 80) ?? null,
        })),
    };
    if (!automatic) {
      await this.activity.record(
        caseId,
        CaseActivityType.FINDINGS_AUTO_LINKED,
        payload,
        actor,
      );
      return;
    }
    await this.activity.recordCoalesced(
      caseId,
      CaseActivityType.FINDINGS_AUTO_LINKED,
      payload,
      actor ?? null,
      {
        key: `auto-link:${link.inquiryId}`,
        merge: (previous, next) => {
          const rows = new Map<string, Record<string, unknown>>();
          for (const r of [
            ...asList(previous.hypotheses),
            ...asList(next.hypotheses),
          ]) {
            const key = `${String(r.threadId)}\u0000${String(r.stance)}`;
            const seen = rows.get(key);
            rows.set(
              key,
              seen ? { ...seen, count: num(seen.count) + num(r.count) } : r,
            );
          }
          return {
            ...next,
            linked: num(previous.linked) + num(next.linked),
            hypotheses: [...rows.values()],
            findings: [
              ...asList(next.findings),
              ...asList(previous.findings),
            ].slice(0, LISTED),
          };
        },
      },
    );
  }

  /** Carry a rule's links to its new hypothesis and/or stance. */
  private async retargetLinks(
    ruleId: string,
    threadId: string,
    stance: EvidenceStance,
  ): Promise<number> {
    const rows = await this.prisma.caseThreadSupport.findMany({
      where: { ruleId },
      select: { id: true, threadId: true, targetType: true, targetId: true },
    });
    if (rows.length === 0) return 0;
    const moving = rows.filter((r) => r.threadId !== threadId);
    const occupied = new Set<string>();
    if (moving.length > 0) {
      const there = await this.prisma.caseThreadSupport.findMany({
        where: {
          threadId,
          targetId: { in: moving.map((r) => r.targetId) },
        },
        select: { targetType: true, targetId: true },
      });
      for (const t of there) occupied.add(`${t.targetType}\u0000${t.targetId}`);
    }
    let touched = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const clash =
          row.threadId !== threadId &&
          occupied.has(`${row.targetType}\u0000${row.targetId}`);
        if (clash) {
          // The new hypothesis already has its own link to this target (a
          // person's, or another rule's): theirs stands, ours is redundant.
          await tx.caseThreadSupport.delete({ where: { id: row.id } });
          continue;
        }
        await tx.caseThreadSupport.update({
          where: { id: row.id },
          data: { threadId, stance },
        });
        touched += 1;
      }
    });
    return touched;
  }

  /** Lay out the evidence that just got a stance; never throws. */
  private async land(
    caseId: string,
    evidenceIds: readonly string[],
    actor?: string,
  ): Promise<void> {
    if (evidenceIds.length === 0) return;
    try {
      // Resolved lazily: see case-board-arrivals.port.ts.
      const board = this.moduleRef.get<CaseBoardArrivalsPort>(
        CASE_BOARD_ARRIVALS,
        { strict: false },
      );
      await board.placeArrivals(caseId, evidenceIds, actor);
    } catch (error) {
      this.logger.warn(
        `Could not lay out the linked evidence of case ${caseId}: ${String(error)}`,
      );
    }
  }

  // ─── Reads and checks ─────────────────────────────────────────────────────

  private async rulesOf(caseInquiryId: string): Promise<HypothesisRuleSpec[]> {
    const rows = await this.prisma.caseHypothesisRule.findMany({
      where: { caseInquiryId },
      select: {
        id: true,
        threadId: true,
        stance: true,
        kind: true,
        pattern: true,
        createdAt: true,
      },
    });
    return rows;
  }

  private matcher(
    kind: CaseFindingFilterKind | null | undefined,
    pattern: string | null | undefined,
  ): { kind: CaseFindingFilterKind | null; pattern: string | null } {
    const problem = ruleMatcherProblem(kind, pattern);
    if (problem) throw new BadRequestException(problem);
    const narrowed = kind != null && pattern != null && pattern !== '';
    return narrowed
      ? { kind: kind, pattern: pattern }
      : { kind: null, pattern: null };
  }

  private async watchLink(
    caseId: string,
    inquiryId: string,
  ): Promise<{ id: string; inquiryId: string; title: string }> {
    const link = await this.prisma.caseInquiry.findUnique({
      where: { caseId_inquiryId: { caseId, inquiryId } },
      select: {
        id: true,
        inquiryId: true,
        inquiry: { select: { title: true } },
      },
    });
    if (!link) {
      throw new BadRequestException(
        `Inquiry ${inquiryId} does not drive case ${caseId}; link it first.`,
      );
    }
    return {
      id: link.id,
      inquiryId: link.inquiryId,
      title: link.inquiry.title,
    };
  }

  private async hypothesis(
    caseId: string,
    threadId: string,
  ): Promise<{ id: string; title: string }> {
    const thread = await this.prisma.caseThread.findUnique({
      where: { id: threadId },
      select: { id: true, caseId: true, kind: true, title: true },
    });
    if (!thread || thread.caseId !== caseId || thread.kind !== 'HYPOTHESIS') {
      throw new BadRequestException(
        `Thread ${threadId} is not a hypothesis of case ${caseId}.`,
      );
    }
    return { id: thread.id, title: thread.title };
  }

  private async ensureCase(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
  }

  private async ensureWritable(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { status: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
    if (isReadOnlyCase(found.status)) {
      throw new ConflictException(
        `This case is ${found.status.toLowerCase()}. Reopen it to change its hypothesis rules.`,
      );
    }
  }
}

export function toRuleDto(row: RuleRow): CaseHypothesisRuleDto {
  return {
    id: row.id,
    inquiryId: row.watch.inquiryId,
    inquiryTitle: row.watch.inquiry.title,
    threadId: row.threadId,
    threadTitle: row.thread.title,
    threadStatus: row.thread.status,
    stance: row.stance,
    kind: row.kind,
    pattern: row.pattern,
    description: row.description,
    linkCount: row._count.links,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const asList = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
