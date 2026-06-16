import { Injectable, Logger } from '@nestjs/common';
import {
  AgentDecisionAction,
  AgentKind,
  AgentMemoryKind,
} from '@prisma/client';
import { AiClientService } from '../ai';
import { PrismaService } from '../prisma.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentLoggerService } from './audit/agent-logger.service';
import { AgentMemoryService } from './memory/agent-memory.service';
import { AgentSearchService } from './search/agent-search.service';
import {
  DecisionApplierService,
  ApplySummary,
} from './decision-applier.service';
import { runPipeline, stepOutput } from './agent-runtime';
import { caseDecisionSchema } from './schemas/case-decision.schema';
import { repairCaseOutput } from './schemas/repair';
import {
  chunkByBudget,
  mergeDecisionOutputs,
  promptCharBudget,
  runChunked,
} from './context-budget';
import { buildCaseSystemPrompt, buildCaseUserPrompt } from './prompts';
import {
  MAX_CASE_CLUSTERS_PER_CYCLE,
  MAX_GLOSSARY_ENTRIES,
} from './autopilot.constants';
import type {
  AgentContext,
  CaseDecisionOutput,
  CaseSummary,
  DuplicateSummary,
  FocusedCaseDetail,
  InquirySummary,
  RecalledMemory,
} from './autopilot.types';

type CandidateInquiry = InquirySummary & {
  caseReadySignal: boolean;
  sampleMatches: Array<{
    findingId: string;
    assetId: string;
    label: string;
    severity: string;
    detectorType: string;
    value?: string;
  }>;
};

interface GatheredCaseContext {
  candidates: CandidateInquiry[];
  openCases: CaseSummary[];
  closedCases: Array<{
    id: string;
    title: string;
    status: string;
    conclusion: string | null;
  }>;
  /** Set on case-targeted runs: the one case this run works on, in full. */
  focusCase: FocusedCaseDetail | null;
  duplicates: DuplicateSummary;
}

/**
 * Autonomous case manager. After the inquiry agent has run, looks at inquiries
 * with new matches (or flagged SIGNAL_CASE_READY) plus open cases, and decides
 * whether to build a new case or advance existing ones — hypotheses, evidence,
 * findings, notes, edges, status. Pipeline steps are resumable.
 */
@Injectable()
export class CaseAgentService {
  private readonly logger = new Logger(CaseAgentService.name);
  readonly agentKind = AgentKind.CASE;

  constructor(
    private readonly ai: AiClientService,
    private readonly prisma: PrismaService,
    private readonly search: AgentSearchService,
    private readonly memory: AgentMemoryService,
    private readonly applier: DecisionApplierService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
  ) {}

  async execute(ctx: AgentContext): Promise<ApplySummary> {
    await runPipeline(
      ctx,
      [
        { name: 'gather-context', execute: (c) => this.gatherContext(c) },
        { name: 'recall-memory', execute: (c) => this.recallMemory(c) },
        { name: 'decide', execute: (c) => this.decide(c) },
        { name: 'apply', execute: (c) => this.apply(c) },
        { name: 'persist-memory', execute: (c) => this.persistMemory(c) },
      ],
      this.audit,
      this.log,
    );
    return stepOutput<ApplySummary>(ctx, 'apply');
  }

  private async gatherContext(ctx: AgentContext): Promise<GatheredCaseContext> {
    const [
      inquiries,
      openCases,
      closedCases,
      caseReadyIds,
      focusCase,
      duplicates,
    ] = await Promise.all([
      this.search.listActiveInquiries(),
      this.search.listOpenCases(),
      this.search.listRecentlyClosedCases(),
      this.caseReadySignals(ctx),
      ctx.caseId ? this.search.caseDetail(ctx.caseId) : Promise.resolve(null),
      this.search.summarizeDuplicatesForRunner(
        ctx.sourceId,
        ctx.manual ? null : ctx.runnerId,
      ),
    ]);
    if (ctx.caseId && !focusCase) {
      throw new Error(
        `Case ${ctx.caseId} no longer exists — cannot run a focused cycle.`,
      );
    }

    const candidates: CandidateInquiry[] = [];
    for (const q of inquiries) {
      const caseReadySignal = caseReadyIds.has(q.id);
      // Scan cycles react to the delta; manual cycles review every inquiry
      // that currently matches anything.
      const eligible = ctx.manual
        ? q.matchCount > 0 || caseReadySignal
        : q.newMatchCount > 0 || caseReadySignal;
      if (!eligible) continue;
      if (candidates.length >= MAX_CASE_CLUSTERS_PER_CYCLE) break;
      candidates.push({
        ...q,
        caseReadySignal,
        sampleMatches: await this.search.sampleInquiryMatches(q.id),
      });
    }
    await this.log.business(
      ctx.run.id,
      focusCase
        ? `Focused run on case "${focusCase.title}": ${focusCase.hypotheses.length} hypothes${focusCase.hypotheses.length === 1 ? 'is' : 'es'}, ${focusCase.evidence.length} evidence item(s), ${focusCase.findings.length} finding(s), ${focusCase.edges.length} edge(s).`
        : `Reviewing ${candidates.length} candidate inquir${candidates.length === 1 ? 'y' : 'ies'} against ${openCases.length} open case(s).`,
    );
    return { candidates, openCases, closedCases, focusCase, duplicates };
  }

  /** SIGNAL_CASE_READY decisions recorded by this cycle's inquiry run. */
  private async caseReadySignals(ctx: AgentContext): Promise<Set<string>> {
    const inquiryRun = await this.prisma.agentRun.findFirst({
      where: {
        agentKind: AgentKind.INQUIRY,
        cycleKey: ctx.run.cycleKey,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!inquiryRun) return new Set();
    const signals = await this.prisma.agentDecision.findMany({
      where: {
        runId: inquiryRun.id,
        action: AgentDecisionAction.SIGNAL_CASE_READY,
      },
      select: { entityId: true },
    });
    return new Set(
      signals.map((s) => s.entityId).filter((id): id is string => !!id),
    );
  }

  private async recallMemory(ctx: AgentContext): Promise<RecalledMemory[]> {
    const { candidates, focusCase } = stepOutput<GatheredCaseContext>(
      ctx,
      'gather-context',
    );
    const terms = [
      ctx.sourceName,
      ...candidates.flatMap((c) => [c.title, ...c.findingTypes]),
      ...(focusCase
        ? [focusCase.title, ...focusCase.hypotheses.map((h) => h.title)]
        : []),
    ];
    const [glossary, related] = await Promise.all([
      this.memory.topByWeight(AgentMemoryKind.GLOSSARY, MAX_GLOSSARY_ENTRIES),
      this.memory.recall(
        [AgentMemoryKind.DECISION_PRECEDENT, AgentMemoryKind.TOPIC_INQUIRY_MAP],
        terms,
      ),
    ]);
    return [...glossary, ...related];
  }

  private async decide(ctx: AgentContext): Promise<CaseDecisionOutput> {
    const { candidates, openCases, closedCases, focusCase, duplicates } =
      stepOutput<GatheredCaseContext>(ctx, 'gather-context');
    const memories = stepOutput<RecalledMemory[]>(ctx, 'recall-memory');

    // Focused runs always consult the model — the operator explicitly asked
    // for work on this case, even when no inquiry has new matches.
    if (candidates.length === 0 && !focusCase) {
      await this.log.business(
        ctx.run.id,
        'No candidate inquiries — skipping the model call.',
      );
      return {
        decisions: [
          {
            action: 'NO_ACTION',
            rationale: `No inquiry gained new matches from the scan of "${ctx.sourceName}" and none was flagged case-ready; the open cases need no update from this cycle.`,
          },
        ],
        memoryWrites: [],
      };
    }

    const systemPrompt = buildCaseSystemPrompt(
      ctx.settings.autopilotCaseGuidance,
      { focused: focusCase !== null },
    );
    const buildPrompt = (
      chunk: CandidateInquiry[],
      part?: { index: number; total: number },
    ) =>
      buildCaseUserPrompt({
        sourceName: ctx.sourceName,
        manual: ctx.manual,
        instruction: ctx.instruction,
        candidateInquiries: chunk,
        openCases,
        closedCases,
        focusCase,
        memories,
        duplicates,
        part,
      });

    // Token budget: split candidate inquiries into context-window-sized
    // chunks instead of truncating.
    const budget = promptCharBudget(await this.ai.getContextSize());
    const fixedChars = systemPrompt.length + buildPrompt([]).length;
    // A focused run may have zero candidates and still needs one model call.
    const chunks =
      candidates.length === 0
        ? [[] as CandidateInquiry[]]
        : chunkByBudget(
            candidates,
            fixedChars,
            budget,
            (c) => JSON.stringify(c).length + 40,
          );
    if (chunks.length > 1) {
      await this.log.technical(
        ctx.run.id,
        `Context exceeds the model window — assessing the ${candidates.length} candidate inquir${candidates.length === 1 ? 'y' : 'ies'} in ${chunks.length} part(s).`,
        { budgetChars: budget, fixedChars },
      );
    }

    const outputs = await runChunked(chunks, async (chunk, index, total) => {
      const userPrompt = buildPrompt(
        chunk,
        total > 1 ? { index, total } : undefined,
      );
      await this.log.technical(
        ctx.run.id,
        `Requesting case decisions from the model${total > 1 ? ` (part ${index}/${total})` : ''}.`,
        { systemPrompt, userPrompt, memoriesRecalled: memories.length },
      );
      const { content, model, raw } =
        await this.ai.completeJson<CaseDecisionOutput>(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          caseDecisionSchema,
          { temperature: 0.2, repair: repairCaseOutput },
        );
      await this.log.technical(
        ctx.run.id,
        `Model ${model} returned a valid decision payload${total > 1 ? ` (part ${index}/${total})` : ''}.`,
        { raw },
      );
      return content;
    });

    const content = mergeDecisionOutputs(outputs);
    await this.log.business(
      ctx.run.id,
      `Model proposed ${content.decisions.length} case decision(s): ${content.decisions.map((d) => d.action).join(', ')}.`,
    );
    this.logger.log(
      `Run ${ctx.run.id}: model returned ${content.decisions.length} case decision(s)`,
    );
    return content;
  }

  private async apply(ctx: AgentContext): Promise<ApplySummary> {
    const output = stepOutput<CaseDecisionOutput>(ctx, 'decide');
    return this.applier.applyCaseDecisions(ctx.run.id, output.decisions, {
      inquiryEnabled: ctx.settings.autopilotInquiryEnabled,
      caseEnabled: ctx.settings.autopilotCaseEnabled,
    });
  }

  private async persistMemory(ctx: AgentContext): Promise<{ written: number }> {
    const output = stepOutput<CaseDecisionOutput>(ctx, 'decide');
    const written = await this.memory.writeMany(output.memoryWrites);
    if (written > 0) {
      await this.log.business(
        ctx.run.id,
        `Learned ${written} memory entr${written === 1 ? 'y' : 'ies'} for future cycles.`,
      );
    }
    return { written };
  }
}
