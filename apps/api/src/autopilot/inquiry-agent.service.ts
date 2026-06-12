import { Injectable, Logger } from '@nestjs/common';
import { AgentKind, AgentMemoryKind } from '@prisma/client';
import { AiClientService } from '../ai';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentLoggerService } from './audit/agent-logger.service';
import { AgentMemoryService } from './memory/agent-memory.service';
import { AgentSearchService } from './search/agent-search.service';
import {
  DecisionApplierService,
  ApplySummary,
} from './decision-applier.service';
import { runPipeline, stepOutput } from './agent-runtime';
import { inquiryDecisionSchema } from './schemas/inquiry-decision.schema';
import { repairInquiryOutput } from './schemas/repair';
import {
  chunkByBudget,
  mergeDecisionOutputs,
  promptCharBudget,
  runChunked,
} from './context-budget';
import { buildInquirySystemPrompt, buildInquiryUserPrompt } from './prompts';
import { MAX_GLOSSARY_ENTRIES } from './autopilot.constants';
import type {
  AgentContext,
  FindingGroupSummary,
  InquiryDecisionOutput,
  InquirySummary,
  RecalledMemory,
} from './autopilot.types';

interface GatheredContext {
  findingGroups: FindingGroupSummary[];
  inquiries: InquirySummary[];
  archivedInquiries: Array<{
    id: string;
    title: string;
    description: string | null;
  }>;
}

/**
 * Autonomous inquiry manager. After a scan, reviews the run's new findings
 * against existing inquiries and decides to create, enrich, or leave alone —
 * always recording why. Pipeline steps are resumable (see agent-runtime).
 */
@Injectable()
export class InquiryAgentService {
  private readonly logger = new Logger(InquiryAgentService.name);
  readonly agentKind = AgentKind.INQUIRY;

  constructor(
    private readonly ai: AiClientService,
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

  private async gatherContext(ctx: AgentContext): Promise<GatheredContext> {
    // Manual "steer" cycles review all open findings in scope, not the delta.
    const [findingGroups, inquiries, archivedInquiries] = await Promise.all([
      this.search.summarizeNewFindings(
        ctx.sourceId,
        ctx.manual ? null : ctx.runnerId,
      ),
      this.search.listActiveInquiries(),
      this.search.listRecentlyArchivedInquiries(),
    ]);
    await this.log.business(
      ctx.run.id,
      `Observed ${findingGroups.reduce((n, g) => n + g.count, 0)} open finding(s) in ${findingGroups.length} group(s) across ${ctx.sourceName}; ${inquiries.length} active inquiries to compare against.`,
    );
    return { findingGroups, inquiries, archivedInquiries };
  }

  private async recallMemory(ctx: AgentContext): Promise<RecalledMemory[]> {
    const { findingGroups } = stepOutput<GatheredContext>(
      ctx,
      'gather-context',
    );
    const terms = [
      ctx.sourceName,
      ...findingGroups.flatMap((g) => [
        g.findingType,
        g.detectorType,
        g.customDetectorKey ?? '',
      ]),
    ];
    const [glossary, related] = await Promise.all([
      this.memory.topByWeight(AgentMemoryKind.GLOSSARY, MAX_GLOSSARY_ENTRIES),
      this.memory.recall(
        [AgentMemoryKind.TOPIC_INQUIRY_MAP, AgentMemoryKind.DECISION_PRECEDENT],
        terms,
      ),
    ]);
    return [...glossary, ...related];
  }

  private async decide(ctx: AgentContext): Promise<InquiryDecisionOutput> {
    const { findingGroups, inquiries, archivedInquiries } =
      stepOutput<GatheredContext>(ctx, 'gather-context');
    const memories = stepOutput<RecalledMemory[]>(ctx, 'recall-memory');

    // Cheap path: no new findings → documented no-op without an LLM call.
    if (findingGroups.length === 0) {
      await this.log.business(
        ctx.run.id,
        'No open findings in scope — skipping the model call.',
      );
      return {
        decisions: [
          {
            action: 'NO_ACTION',
            rationale: `Scan of source "${ctx.sourceName}" produced no new open findings; nothing to evaluate against existing inquiries.`,
          },
        ],
        memoryWrites: [],
      };
    }

    const systemPrompt = buildInquirySystemPrompt({
      desired: ctx.settings.autopilotInquiryDesired,
      searchable: ctx.settings.autopilotInquirySearchable,
    });
    const buildPrompt = (
      groups: FindingGroupSummary[],
      part?: { index: number; total: number },
    ) =>
      buildInquiryUserPrompt({
        sourceName: ctx.sourceName,
        sourceId: ctx.sourceId,
        manual: ctx.manual,
        instruction: ctx.instruction,
        findingGroups: groups,
        inquiries,
        archivedInquiries,
        memories,
        part,
      });

    // Token budget: never truncate — split finding groups into chunks the
    // provider's context window can hold and assess each chunk.
    const budget = promptCharBudget(await this.ai.getContextSize());
    const fixedChars = systemPrompt.length + buildPrompt([]).length;
    const chunks = chunkByBudget(
      findingGroups,
      fixedChars,
      budget,
      (g) => JSON.stringify(g).length + 40,
    );
    if (chunks.length > 1) {
      await this.log.technical(
        ctx.run.id,
        `Context exceeds the model window — assessing the ${findingGroups.length} finding group(s) in ${chunks.length} part(s).`,
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
        `Requesting inquiry decisions from the model${total > 1 ? ` (part ${index}/${total})` : ''}.`,
        { systemPrompt, userPrompt, memoriesRecalled: memories.length },
      );
      const { content, model, raw } =
        await this.ai.completeJson<InquiryDecisionOutput>(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          inquiryDecisionSchema,
          { temperature: 0.2, repair: repairInquiryOutput },
        );
      await this.log.technical(
        ctx.run.id,
        `Model ${model} returned a valid decision payload${total > 1 ? ` (part ${index}/${total})` : ''}.`,
        { raw },
      );
      return content;
    });

    const content = mergeDecisionOutputs(outputs) as InquiryDecisionOutput;
    await this.log.business(
      ctx.run.id,
      `Model proposed ${content.decisions.length} inquiry decision(s): ${content.decisions.map((d) => d.action).join(', ')}.`,
    );
    this.logger.log(
      `Run ${ctx.run.id}: model returned ${content.decisions.length} inquiry decision(s)`,
    );
    return content;
  }

  private async apply(ctx: AgentContext): Promise<ApplySummary> {
    const output = stepOutput<InquiryDecisionOutput>(ctx, 'decide');
    return this.applier.applyInquiryDecisions(ctx.run.id, output.decisions, {
      inquiryEnabled: ctx.settings.autopilotInquiryEnabled,
      caseEnabled: ctx.settings.autopilotCaseEnabled,
    });
  }

  private async persistMemory(ctx: AgentContext): Promise<{ written: number }> {
    const output = stepOutput<InquiryDecisionOutput>(ctx, 'decide');
    const applied = stepOutput<ApplySummary>(ctx, 'apply');

    let written = await this.memory.writeMany(output.memoryWrites);
    for (const inquiry of applied.createdInquiries) {
      await this.memory.rememberTopicInquiry(
        inquiry.title,
        inquiry.id,
        inquiry.title,
      );
      written++;
    }
    if (written > 0) {
      await this.log.business(
        ctx.run.id,
        `Learned ${written} memory entr${written === 1 ? 'y' : 'ies'} for future cycles.`,
      );
    }
    return { written };
  }
}
