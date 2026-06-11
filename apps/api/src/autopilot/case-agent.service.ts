import { Injectable, Logger } from '@nestjs/common';
import {
  AgentDecisionAction,
  AgentKind,
  AgentMemoryKind,
} from '@prisma/client';
import { AiClientService } from '../ai';
import { PrismaService } from '../prisma.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentMemoryService } from './memory/agent-memory.service';
import { AgentSearchService } from './search/agent-search.service';
import {
  DecisionApplierService,
  ApplySummary,
} from './decision-applier.service';
import { runPipeline, stepOutput } from './agent-runtime';
import { caseDecisionSchema } from './schemas/case-decision.schema';
import { buildCaseSystemPrompt, buildCaseUserPrompt } from './prompts';
import {
  MAX_CASE_CLUSTERS_PER_CYCLE,
  MAX_GLOSSARY_ENTRIES,
} from './autopilot.constants';
import type {
  AgentContext,
  CaseDecisionOutput,
  CaseSummary,
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
    );
    return stepOutput<ApplySummary>(ctx, 'apply');
  }

  private async gatherContext(ctx: AgentContext): Promise<GatheredCaseContext> {
    const [inquiries, openCases, caseReadyIds] = await Promise.all([
      this.search.listActiveInquiries(),
      this.search.listOpenCases(),
      this.caseReadySignals(ctx),
    ]);

    const candidates: CandidateInquiry[] = [];
    for (const q of inquiries) {
      const caseReadySignal = caseReadyIds.has(q.id);
      if (q.newMatchCount === 0 && !caseReadySignal) continue;
      if (candidates.length >= MAX_CASE_CLUSTERS_PER_CYCLE) break;
      candidates.push({
        ...q,
        caseReadySignal,
        sampleMatches: await this.search.sampleInquiryMatches(q.id),
      });
    }
    return { candidates, openCases };
  }

  /** SIGNAL_CASE_READY decisions recorded by this cycle's inquiry run. */
  private async caseReadySignals(ctx: AgentContext): Promise<Set<string>> {
    const inquiryRun = await this.prisma.agentRun.findFirst({
      where: {
        agentKind: AgentKind.INQUIRY,
        sourceId: ctx.sourceId,
        runnerId: ctx.runnerId,
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
    const { candidates } = stepOutput<GatheredCaseContext>(
      ctx,
      'gather-context',
    );
    const terms = [
      ctx.sourceName,
      ...candidates.flatMap((c) => [c.title, ...c.findingTypes]),
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
    const { candidates, openCases } = stepOutput<GatheredCaseContext>(
      ctx,
      'gather-context',
    );
    const memories = stepOutput<RecalledMemory[]>(ctx, 'recall-memory');

    if (candidates.length === 0) {
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

    const { content } = await this.ai.completeJson<CaseDecisionOutput>(
      [
        {
          role: 'system',
          content: buildCaseSystemPrompt(ctx.settings.autopilotCaseGuidance),
        },
        {
          role: 'user',
          content: buildCaseUserPrompt({
            sourceName: ctx.sourceName,
            candidateInquiries: candidates,
            openCases,
            memories,
          }),
        },
      ],
      caseDecisionSchema,
      { temperature: 0.2 },
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
    return { written };
  }
}
