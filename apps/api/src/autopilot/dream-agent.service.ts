import { Injectable, Logger } from '@nestjs/common';
import { AgentKind } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AiClientService } from '../ai';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentLoggerService } from './audit/agent-logger.service';
import { AgentMemoryService } from './memory/agent-memory.service';
import { AgentSearchService } from './search/agent-search.service';
import { runPipeline, stepOutput } from './agent-runtime';
import {
  dreamConsolidationSchema,
  repairDreamOutput,
  type DreamConsolidationOutput,
} from './schemas/dream.schema';
import {
  chunkByBudget,
  promptCharBudget,
  runChunked,
} from './context-budget';
import { buildDreamSystemPrompt, buildDreamUserPrompt } from './prompts';
import type { AgentContext } from './autopilot.types';

interface DreamGathered {
  memories: Array<{
    id: string;
    kind: string;
    key: string;
    content: string;
    tags: string[];
    weight: number;
    updatedAt: Date;
  }>;
  recentRuns: Array<{
    agentKind: string;
    status: string;
    summary: string | null;
    finishedAt: Date | null;
  }>;
  liveInquiryTitles: string[];
  openCaseTitles: string[];
}

export interface DreamSummary {
  deleted: number;
  rewritten: number;
  created: number;
  failed: number;
  journal: string;
}

/**
 * The "dreaming" agent: a periodic memory-consolidation cycle. It reviews the
 * whole memory store plus recent run summaries, then prunes noise, merges
 * duplicates and distills important notes — never touching inquiries or
 * cases. Every operation is recorded as a CONSOLIDATE_MEMORY decision and
 * narrated in the execution log, like any other agent run.
 */
@Injectable()
export class DreamAgentService {
  private readonly logger = new Logger(DreamAgentService.name);
  readonly agentKind = AgentKind.DREAM;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly search: AgentSearchService,
    private readonly memory: AgentMemoryService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
  ) {}

  async execute(ctx: AgentContext): Promise<DreamSummary> {
    await runPipeline(
      ctx,
      [
        { name: 'gather-memory', execute: (c) => this.gather(c) },
        { name: 'consolidate', execute: (c) => this.consolidate(c) },
        { name: 'apply', execute: (c) => this.apply(c) },
      ],
      this.audit,
      this.log,
    );
    return stepOutput<DreamSummary>(ctx, 'apply');
  }

  private async gather(ctx: AgentContext): Promise<DreamGathered> {
    const [memories, recentRuns, inquiries, cases] = await Promise.all([
      this.memory.listForConsolidation(),
      this.recentRunSummaries(),
      this.search.listActiveInquiries(),
      this.search.listOpenCases(),
    ]);
    await this.log.business(
      ctx.run.id,
      `Dreaming over ${memories.length} memory entr${memories.length === 1 ? 'y' : 'ies'} and ${recentRuns.length} recent run summar${recentRuns.length === 1 ? 'y' : 'ies'}.`,
    );
    return {
      memories,
      recentRuns,
      liveInquiryTitles: inquiries.map((q) => q.title),
      openCaseTitles: cases.map((c) => c.title),
    };
  }

  private async recentRunSummaries(): Promise<DreamGathered['recentRuns']> {
    const rows = await this.prisma.agentRun.findMany({
      where: {
        agentKind: { in: [AgentKind.INQUIRY, AgentKind.CASE] },
        summary: { not: null },
      },
      select: {
        agentKind: true,
        status: true,
        summary: true,
        finishedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => ({
      agentKind: String(r.agentKind),
      status: String(r.status),
      summary: r.summary,
      finishedAt: r.finishedAt,
    }));
  }

  private async consolidate(
    ctx: AgentContext,
  ): Promise<DreamConsolidationOutput> {
    const gathered = stepOutput<DreamGathered>(ctx, 'gather-memory');

    if (gathered.memories.length === 0) {
      await this.log.business(
        ctx.run.id,
        'Memory store is empty — nothing to consolidate.',
      );
      return {
        deletions: [],
        rewrites: [],
        creations: [],
        summary: 'Memory store is empty; nothing to consolidate this dream.',
      };
    }

    const systemPrompt = buildDreamSystemPrompt();
    const buildPrompt = (
      memories: DreamGathered['memories'],
      part?: { index: number; total: number },
    ) =>
      buildDreamUserPrompt({
        memories,
        recentRuns: gathered.recentRuns,
        liveInquiryTitles: gathered.liveInquiryTitles,
        openCaseTitles: gathered.openCaseTitles,
        part,
      });

    // Same no-truncation strategy as the other agents: split the memory list
    // into context-window-sized chunks and consolidate each.
    const budget = promptCharBudget(await this.ai.getContextSize());
    const fixedChars = systemPrompt.length + buildPrompt([]).length;
    const chunks = chunkByBudget(
      gathered.memories,
      fixedChars,
      budget,
      (m) => JSON.stringify(m).length + 40,
    );

    const outputs = await runChunked(chunks, async (chunk, index, total) => {
      const userPrompt = buildPrompt(
        chunk,
        total > 1 ? { index, total } : undefined,
      );
      await this.log.technical(
        ctx.run.id,
        `Requesting memory consolidation from the model${total > 1 ? ` (part ${index}/${total})` : ''}.`,
        { systemPrompt, userPrompt },
      );
      const { content, model, raw } =
        await this.ai.completeJson<DreamConsolidationOutput>(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          dreamConsolidationSchema,
          { temperature: 0.2, repair: repairDreamOutput },
        );
      await this.log.technical(
        ctx.run.id,
        `Model ${model} returned a valid consolidation payload${total > 1 ? ` (part ${index}/${total})` : ''}.`,
        { raw },
      );
      return content;
    });

    const merged = mergeDreamOutputs(outputs);
    await this.log.business(
      ctx.run.id,
      `Dream proposes ${merged.deletions.length} deletion(s), ${merged.rewrites.length} rewrite(s), ${merged.creations.length} new note(s).`,
    );
    return merged;
  }

  private async apply(ctx: AgentContext): Promise<DreamSummary> {
    const plan = stepOutput<DreamConsolidationOutput>(ctx, 'consolidate');
    const gathered = stepOutput<DreamGathered>(ctx, 'gather-memory');
    const knownIds = new Set(gathered.memories.map((m) => m.id));

    const summary: DreamSummary = {
      deleted: 0,
      rewritten: 0,
      created: 0,
      failed: 0,
      journal: plan.summary,
    };

    for (const [i, del] of plan.deletions.entries()) {
      const dedupeKey = `dream:delete:${del.id}:${i}`;
      if (await this.audit.hasDecision(ctx.run.id, dedupeKey)) continue;
      if (!knownIds.has(del.id)) {
        summary.failed++;
        await this.audit.recordDecision(ctx.run.id, {
          action: 'CONSOLIDATE_MEMORY',
          outcome: 'FAILED',
          rationale: del.rationale,
          payload: { op: 'delete', id: del.id, error: 'Unknown memory id' },
          dedupeKey,
        });
        continue;
      }
      const ok = await this.memory.deleteById(del.id);
      if (ok) summary.deleted++;
      else summary.failed++;
      await this.audit.recordDecision(ctx.run.id, {
        action: 'CONSOLIDATE_MEMORY',
        outcome: ok ? 'APPLIED' : 'FAILED',
        rationale: del.rationale,
        payload: { op: 'delete', id: del.id },
        dedupeKey,
      });
    }

    for (const [i, rw] of plan.rewrites.entries()) {
      const dedupeKey = `dream:rewrite:${rw.id}:${i}`;
      if (await this.audit.hasDecision(ctx.run.id, dedupeKey)) continue;
      const ok =
        knownIds.has(rw.id) &&
        (await this.memory.rewriteById(rw.id, rw.content, rw.tags));
      if (ok) summary.rewritten++;
      else summary.failed++;
      await this.audit.recordDecision(ctx.run.id, {
        action: 'CONSOLIDATE_MEMORY',
        outcome: ok ? 'APPLIED' : 'FAILED',
        rationale: rw.rationale,
        payload: { op: 'rewrite', id: rw.id, content: rw.content },
        dedupeKey,
      });
    }

    for (const [i, cr] of plan.creations.entries()) {
      const dedupeKey = `dream:create:${cr.kind}:${cr.key}:${i}`;
      if (await this.audit.hasDecision(ctx.run.id, dedupeKey)) continue;
      const written = await this.memory.writeMany([
        { kind: cr.kind, key: cr.key, content: cr.content, tags: cr.tags },
      ]);
      const ok = written > 0;
      if (ok) summary.created++;
      else summary.failed++;
      await this.audit.recordDecision(ctx.run.id, {
        action: 'CONSOLIDATE_MEMORY',
        outcome: ok ? 'APPLIED' : 'FAILED',
        rationale: cr.rationale,
        payload: { op: 'create', kind: cr.kind, key: cr.key },
        dedupeKey,
      });
    }

    await this.log.business(ctx.run.id, `Dream journal: ${plan.summary}`);
    return summary;
  }
}

/** Concatenate per-chunk dream outputs; the summaries become one journal. */
function mergeDreamOutputs(
  outputs: DreamConsolidationOutput[],
): DreamConsolidationOutput {
  return {
    deletions: outputs.flatMap((o) => o.deletions),
    rewrites: outputs.flatMap((o) => o.rewrites),
    creations: outputs.flatMap((o) => o.creations),
    summary: outputs
      .map((o) => o.summary)
      .filter(Boolean)
      .join(' '),
  };
}
