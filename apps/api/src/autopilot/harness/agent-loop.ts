import { Logger } from '@nestjs/common';
import { AiClientService, type AiMessage, type JsonSchema } from '../../ai';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import { AgentRunCancelledError } from '../agent-runtime';
import type { ApplySummary } from '../decision-applier.service';
import { ToolDispatcherService } from '../tools/tool-dispatcher.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import type { AgentContext } from '../autopilot.types';
import type { Mission } from './missions';

const logger = new Logger('AgentLoop');

/** State key under which mid-loop progress is persisted in AgentRun.stepState. */
const PROGRESS_KEY = 'reason-act:progress';

/** One turn the model emits in the ReAct loop. */
interface LoopTurn {
  thought: string;
  toolCalls: Array<{ tool: string; input: unknown; rationale: string }>;
  finish?: { summary: string };
}

const loopTurnSchema: JsonSchema = {
  type: 'object',
  properties: {
    thought: { type: 'string' },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          input: { type: 'object' },
          rationale: { type: 'string' },
        },
        required: ['tool', 'rationale'],
        additionalProperties: true,
      },
    },
    finish: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false,
    },
  },
  required: ['thought'],
  additionalProperties: true,
};

/** Resumable progress persisted between iterations. */
interface LoopProgress {
  messages: AiMessage[];
  iteration: number;
  toolCalls: number;
  applied: number;
  skippedObserveOnly: number;
  failed: number;
  createdInquiries: Array<{ id: string; title: string }>;
  createdCases: Array<{ id: string; title: string }>;
  caseReadyInquiryIds: string[];
  done: boolean;
  summary: string;
}

export interface AgentLoopDeps {
  ai: AiClientService;
  registry: ToolRegistry;
  dispatcher: ToolDispatcherService;
  audit: AgentAuditService;
  log: AgentLoggerService;
}

export interface AgentLoopResult {
  summary: ApplySummary;
  narrative: string;
  iterations: number;
  toolCalls: number;
}

/**
 * The harness driver: a resumable ReAct loop. The model reasons and emits tool
 * calls; each call is dispatched (validated, gated, audited) and its result fed
 * back. Progress (the full transcript + counters) is persisted to stepState
 * after every iteration so a redelivered run resumes mid-conversation without
 * replaying LLM calls; tool side effects stay idempotent via per-call dedupe.
 */
export async function runAgentLoop(
  ctx: AgentContext,
  mission: Mission,
  deps: AgentLoopDeps,
  opts: { systemBrief?: string } = {},
): Promise<AgentLoopResult> {
  const runId = ctx.run.id;
  const progress = loadProgress(ctx, mission, deps.registry, opts.systemBrief);

  while (!progress.done && progress.iteration < mission.maxIterations) {
    if (await deps.audit.isCancelled(runId)) {
      throw new AgentRunCancelledError(runId);
    }
    progress.iteration++;

    const { content: turn, raw } = await deps.ai.completeJson<LoopTurn>(
      progress.messages,
      loopTurnSchema,
      { temperature: 0.2, repair: repairTurn },
    );

    await deps.log.business(runId, `Thinking: ${turn.thought}`);
    progress.messages.push({ role: 'assistant', content: raw ?? '' });

    const calls = turn.toolCalls ?? [];
    if (calls.length === 0 || turn.finish) {
      progress.done = true;
      progress.summary = turn.finish?.summary ?? turn.thought;
      await persist(ctx, deps.audit, progress);
      break;
    }

    const observations: unknown[] = [];
    for (const [i, call] of calls.entries()) {
      const tool =
        mission.allowedTools.includes(call.tool) &&
        deps.registry.get(call.tool);
      if (!tool) {
        observations.push({
          tool: call.tool,
          outcome: 'FAILED',
          result: { error: `Unknown or disallowed tool "${call.tool}".` },
        });
        continue;
      }
      const dedupeKey = `loop:${progress.iteration}:${i}:${call.tool}`;
      const result = await deps.dispatcher.dispatch(
        { ctx, audit: deps.audit, log: deps.log },
        tool,
        call.input,
        dedupeKey,
        call.rationale,
      );
      tallyResult(progress, call.tool, result);
      observations.push(result);
    }

    progress.messages.push({
      role: 'user',
      content: `Tool results:\n${JSON.stringify(observations)}`,
    });
    await persist(ctx, deps.audit, progress);
  }

  if (!progress.done) {
    progress.summary = `Reached the ${mission.maxIterations}-iteration budget without finishing.`;
    await deps.log.business(runId, progress.summary, undefined, 'WARN');
    await persist(ctx, deps.audit, progress);
  }

  logger.log(
    `Run ${runId}: harness loop finished in ${progress.iteration} iteration(s), ${progress.toolCalls} tool call(s).`,
  );

  return {
    summary: {
      applied: progress.applied,
      skippedObserveOnly: progress.skippedObserveOnly,
      failed: progress.failed,
      createdInquiries: progress.createdInquiries,
      createdCases: progress.createdCases,
      caseReadyInquiryIds: progress.caseReadyInquiryIds,
    },
    narrative: progress.summary,
    iterations: progress.iteration,
    toolCalls: progress.toolCalls,
  };
}

function loadProgress(
  ctx: AgentContext,
  mission: Mission,
  registry: ToolRegistry,
  systemBrief?: string,
): LoopProgress {
  const existing = ctx.state[PROGRESS_KEY] as LoopProgress | undefined;
  if (existing && Array.isArray(existing.messages)) return existing;
  return {
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(ctx, mission, registry, systemBrief),
      },
      { role: 'user', content: buildUserPrompt(ctx, mission) },
    ],
    iteration: 0,
    toolCalls: 0,
    applied: 0,
    skippedObserveOnly: 0,
    failed: 0,
    createdInquiries: [],
    createdCases: [],
    caseReadyInquiryIds: [],
    done: false,
    summary: '',
  };
}

async function persist(
  ctx: AgentContext,
  audit: AgentAuditService,
  progress: LoopProgress,
): Promise<void> {
  ctx.state[PROGRESS_KEY] = progress;
  await audit.saveStep(ctx.run.id, 'reason-act', ctx.state);
}

function tallyResult(
  progress: LoopProgress,
  toolName: string,
  result: { outcome: string; result: unknown },
): void {
  progress.toolCalls++;
  switch (result.outcome) {
    case 'APPLIED':
      progress.applied++;
      if (toolName === 'inquiries.create')
        pushCreated(progress.createdInquiries, result.result);
      if (toolName === 'cases.create')
        pushCreated(progress.createdCases, result.result);
      break;
    case 'SKIPPED_OBSERVE_ONLY':
      progress.skippedObserveOnly++;
      break;
    case 'FAILED':
      progress.failed++;
      break;
    // DEDUPED: already counted in a prior attempt — ignore.
  }
}

function pushCreated(
  into: Array<{ id: string; title: string }>,
  result: unknown,
): void {
  if (result && typeof result === 'object' && 'id' in result) {
    const r = result as { id?: unknown; title?: unknown };
    if (typeof r.id === 'string')
      into.push({ id: r.id, title: String(r.title ?? r.id) });
  }
}

function buildSystemPrompt(
  ctx: AgentContext,
  mission: Mission,
  registry: ToolRegistry,
  systemBrief?: string,
): string {
  const guidance = ctx.instruction
    ? `\n\nOperator instruction for this run:\n${ctx.instruction}`
    : '';
  const brief = systemBrief?.trim() ? `\n${systemBrief.trim()}\n` : '';
  return [
    mission.goal,
    brief,
    guidance,
    '\n## Tools you may call',
    registry.catalog(mission.allowedTools),
    '\n## How to respond',
    'Each turn, return JSON: {"thought": "...", "toolCalls": [{"tool": "name", "input": {...}, "rationale": "why"}]}.',
    'Call read tools to gather what you need before mutating. When you are done, return {"thought":"...","finish":{"summary":"what you did"}} with an empty or omitted toolCalls.',
    'Only call tools from the list above. Keep rationale short and specific.',
  ].join('\n');
}

function buildUserPrompt(ctx: AgentContext, mission: Mission): string {
  const scope = ctx.sourceId
    ? `source "${ctx.sourceName}" (id ${ctx.sourceId})`
    : 'all sources';
  const mode = ctx.manual
    ? 'This is a manual review of existing open data.'
    : 'This is a post-scan review of the latest findings.';
  return [
    `Mission: ${mission.kind}.`,
    `Scope: ${scope}. ${mode}`,
    'Begin by observing the relevant state, then take the minimal correct actions.',
  ].join('\n');
}

/** Tolerate common shape drift in the model's turn output. */
function repairTurn(value: unknown): unknown {
  if (!value || typeof value !== 'object') return { thought: String(value) };
  const v = value as Record<string, unknown>;
  if (v.toolCalls && !Array.isArray(v.toolCalls)) v.toolCalls = [v.toolCalls];
  if (typeof v.thought !== 'string') v.thought = v.thought ? String(v.thought) : '';
  return v;
}
