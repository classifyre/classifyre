import { Logger } from '@nestjs/common';
import {
  AiClientService,
  AiSchemaError,
  type AiMessage,
  type JsonSchema,
} from '../../ai';
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

// ── Transcript budget ────────────────────────────────────────────────────────
//
// The transcript is quadratic by construction: every iteration appends its tool
// results and every iteration resends the whole thing. Unbounded, a single
// `findings.search` over a large corpus could put hundreds of kilobytes into
// turn 2 and then pay for it again on turns 3…16, and the same array is written
// to AgentRun.stepState after every iteration. So results are capped on the way
// in, and older ones are reduced to their header once newer turns exist.
//
// Both limits are in characters rather than tokens: the transcript is JSON, the
// ratio is stable enough (~3.5 chars/token), and counting tokens here would
// mean a tokenizer per provider for a budget that only has to be approximately
// right.

/** Largest a single tool result may be in the transcript. */
const MAX_OBSERVATION_CHARS = 8_000;
/** Largest one turn's whole observation message may be, across all its calls. */
const MAX_TURN_OBSERVATION_CHARS = 24_000;
/** Floor per call, so a turn with many calls still shows something of each. */
const MIN_OBSERVATION_CHARS = 1_000;
/**
 * How many turns of tool results stay verbatim. Older ones keep their header
 * line — which names every tool called and its outcome — and lose the payload.
 * Three is enough for the "read, then act on what you read" pattern every
 * mission follows, while a decision made ten iterations ago is represented by
 * the model's own `thought` for it, which is never elided.
 */
const VERBATIM_OBSERVATION_TURNS = 3;

/** Marks a user message as tool output, for capping and eliding. */
const OBSERVATION_HEADER = 'Tool results';
const ELIDED_NOTE =
  '(full results elided to stay within the context budget — re-call the tool if you need them again)';

/** One turn the model emits in the ReAct loop. */
export interface LoopTurn {
  thought: string;
  toolCalls: Array<{ tool: string; input: unknown; rationale: string }>;
  finish?: { summary: string };
}

export const loopTurnSchema: JsonSchema = {
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
  /**
   * LLM token consumption of this run so far (summed over every model call).
   * Optional because progress persisted before token tracking lacks them —
   * readers must default to 0.
   */
  inputTokens?: number;
  outputTokens?: number;
  /** Mutations performed. Each one has a persisted decision row. */
  applied: number;
  /**
   * Successful read tools. Counted separately from `applied` so a run that
   * only looked around cannot report having changed anything.
   * Optional: progress persisted before this existed lacks it — default to 0.
   */
  readOk?: number;
  skippedObserveOnly: number;
  failed: number;
  createdInquiries: Array<{ id: string; title: string }>;
  createdCases: Array<{ id: string; title: string }>;
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
  opts: {
    systemBrief?: string;
    allowedTools?: string[];
    missionPrimer?: string;
  } = {},
): Promise<AgentLoopResult> {
  const runId = ctx.run.id;
  const allowed = opts.allowedTools ?? mission.allowedTools;
  const progress = loadProgress(
    ctx,
    mission,
    deps.registry,
    opts.systemBrief,
    allowed,
    opts.missionPrimer,
  );

  while (!progress.done && progress.iteration < mission.maxIterations) {
    if (await deps.audit.isCancelled(runId)) {
      throw new AgentRunCancelledError(runId);
    }
    progress.iteration++;

    let turnResult;
    try {
      turnResult = await deps.ai.completeJson<LoopTurn>(
        progress.messages,
        loopTurnSchema,
        { temperature: 0.2, repair: repairTurn },
      );
    } catch (error) {
      // Failed attempts were billed too — record their tokens before the
      // run is failed, so FAILED runs don't under-report real spend.
      if (error instanceof AiSchemaError && error.usage) {
        progress.inputTokens =
          (progress.inputTokens ?? 0) + error.usage.inputTokens;
        progress.outputTokens =
          (progress.outputTokens ?? 0) + error.usage.outputTokens;
        await persist(ctx, deps.audit, progress);
      }
      throw error;
    }
    const { content: turn, raw, usage } = turnResult;
    if (usage) {
      progress.inputTokens = (progress.inputTokens ?? 0) + usage.inputTokens;
      progress.outputTokens = (progress.outputTokens ?? 0) + usage.outputTokens;
    }

    await deps.log.business(runId, `Thinking: ${turn.thought}`);
    progress.messages.push({ role: 'assistant', content: raw ?? '' });

    const calls = turn.toolCalls ?? [];
    if (calls.length === 0 || turn.finish) {
      progress.done = true;
      progress.summary = turn.finish?.summary ?? turn.thought;
      await persist(ctx, deps.audit, progress);
      break;
    }

    const observations: Observation[] = [];
    for (const [i, call] of calls.entries()) {
      const tool = allowed.includes(call.tool) && deps.registry.get(call.tool);
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
      content: renderObservations(progress.iteration, observations),
    });
    // Reduce older turns to their headers before persisting, so both what we
    // resend and what we store stay bounded.
    elideOldObservations(progress.messages);
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
      readOk: progress.readOk ?? 0,
      skippedObserveOnly: progress.skippedObserveOnly,
      failed: progress.failed,
      createdInquiries: progress.createdInquiries,
      createdCases: progress.createdCases,
      // Carried so a cycle that deliberately changed nothing can say why,
      // rather than reporting as "0 applied" and reading like a failure.
      finishSummary: progress.summary,
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
  systemBrief: string | undefined,
  allowed: string[],
  missionPrimer: string | undefined,
): LoopProgress {
  const existing = ctx.state[PROGRESS_KEY] as LoopProgress | undefined;
  if (existing && Array.isArray(existing.messages)) return existing;
  return {
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(
          ctx,
          mission,
          registry,
          systemBrief,
          allowed,
          missionPrimer,
        ),
      },
      { role: 'user', content: buildUserPrompt(ctx, mission) },
    ],
    iteration: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    applied: 0,
    readOk: 0,
    skippedObserveOnly: 0,
    failed: 0,
    createdInquiries: [],
    createdCases: [],
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
  // Mirror the running token totals onto the run row (absolute values, so a
  // resumed run never double-counts) alongside the step state — independent
  // writes, so they run concurrently.
  await Promise.all([
    audit.saveStep(ctx.run.id, 'reason-act', ctx.state),
    audit.saveUsage(
      ctx.run.id,
      progress.inputTokens ?? 0,
      progress.outputTokens ?? 0,
    ),
  ]);
}

/** One tool's result as it is fed back to the model. */
export interface Observation {
  tool: string;
  outcome: string;
  result: unknown;
}

/**
 * Serialize one turn's tool results for the transcript, within budget.
 *
 * The first line is a header naming every call and its outcome. That line is
 * load-bearing: it is what survives {@link elideOldObservations}, so the model
 * can still see that it already called `inquiries.list` on iteration 2 and what
 * came back, long after the payload is gone. Exported so the capability probes
 * feed models the same shape the loop does — a probe built on a copy of this
 * would stop testing the harness the moment either side changed.
 */
export function renderObservations(
  iteration: number,
  observations: Observation[],
): string {
  const header = `${OBSERVATION_HEADER} (iteration ${iteration}): ${
    observations.map((o) => `${o.tool} → ${o.outcome}`).join('; ') || 'none'
  }`;
  // Share the turn budget evenly rather than first-come-first-served: a single
  // huge read must not leave the four calls after it with nothing.
  const share = observations.length
    ? Math.floor(MAX_TURN_OBSERVATION_CHARS / observations.length)
    : MAX_OBSERVATION_CHARS;
  const budget = Math.min(
    MAX_OBSERVATION_CHARS,
    Math.max(MIN_OBSERVATION_CHARS, share),
  );
  const capped = observations.map((o) => ({
    tool: o.tool,
    outcome: o.outcome,
    result: capResult(o.result, budget),
  }));
  return `${header}\n${JSON.stringify(capped)}`;
}

/**
 * Keep a result under `budget` characters, telling the model plainly that it
 * was cut and by how much — a silently truncated list reads as a complete one,
 * and an agent that believes it has seen every finding will say so.
 */
function capResult(result: unknown, budget: number): unknown {
  let json: string;
  try {
    json = JSON.stringify(result) ?? 'null';
  } catch {
    // A tool handed back something JSON cannot express (a cycle, a BigInt).
    // Return its string form: the alternative is throwing here and failing a
    // turn over a result the model could still have made some use of.
    return { unserializable: true, value: String(result) };
  }
  if (json.length <= budget) return result;
  return {
    truncated: true,
    originalChars: json.length,
    shownChars: budget,
    note:
      'This result was too large for the context budget and is cut off mid-value. ' +
      'Narrow the query (fewer items, a specific source, a tighter filter) rather ' +
      'than treating what you see as the whole result.',
    preview: json.slice(0, budget),
  };
}

/**
 * Reduce every observation message older than the last
 * {@link VERBATIM_OBSERVATION_TURNS} to its header line.
 *
 * Applied to the persisted array itself, so it bounds the AgentRun.stepState
 * write as well as the prompt. Idempotent: a message already elided is left
 * alone, and the assistant's own reasoning turns are never touched.
 */
export function elideOldObservations(messages: AiMessage[]): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    if (!message.content.startsWith(OBSERVATION_HEADER)) continue;
    seen++;
    if (seen <= VERBATIM_OBSERVATION_TURNS) continue;
    if (message.content.endsWith(ELIDED_NOTE)) continue;
    const header = message.content.split('\n', 1)[0] ?? OBSERVATION_HEADER;
    messages[i] = { role: 'user', content: `${header}\n${ELIDED_NOTE}` };
  }
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
    case 'READ_OK':
      progress.readOk = (progress.readOk ?? 0) + 1;
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
      into.push({
        id: r.id,
        title: typeof r.title === 'string' ? r.title : r.id,
      });
  }
}

function buildSystemPrompt(
  ctx: AgentContext,
  mission: Mission,
  registry: ToolRegistry,
  systemBrief: string | undefined,
  allowed: string[],
  missionPrimer: string | undefined,
): string {
  const guidance = ctx.instruction
    ? `\n\nOperator instruction for this run:\n${ctx.instruction}`
    : '';
  const brief = systemBrief?.trim() ? `\n${systemBrief.trim()}\n` : '';
  const primer = missionPrimer?.trim()
    ? `\n## Detector type registry\n${missionPrimer.trim()}\n`
    : '';
  return [
    mission.goal,
    primer,
    brief,
    guidance,
    '\n## Tools you may call',
    registry.catalog(allowed),
    ...RESPONSE_PROTOCOL,
  ].join('\n');
}

/**
 * The turn contract every model driving this loop must obey. Exported so the
 * assistant capability probes exercise the SAME text the harness sends — a
 * probe suite that tested a copy of this would silently stop being a test of
 * the harness the moment either side was edited.
 */
export const RESPONSE_PROTOCOL: readonly string[] = [
  '\n## How to respond',
  'Each turn, return JSON: {"thought": "...", "toolCalls": [{"tool": "name", "input": {...}, "rationale": "why"}]}.',
  'Call read tools to gather what you need before mutating. When you are done, return {"thought":"...","finish":{"summary":"what you did"}} with an empty or omitted toolCalls.',
  'Finishing without having called a single mutating tool is a valid and often correct outcome. When that is the right answer, say so in the summary and give the reason ("read N findings across 3 sources; all boilerplate; nothing warranted an inquiry") rather than acting to have acted.',
  'Only call tools from the list above. Keep rationale short and specific.',
  'Tool results come back under a header naming every call and its outcome. A very large result ' +
    'is cut off and says so ("truncated": true) — narrow the query instead of assuming you saw all ' +
    'of it. Older turns keep only that header line, so if you need a payload again, call the tool ' +
    'again rather than guessing at what it said.',
];

function buildUserPrompt(ctx: AgentContext, mission: Mission): string {
  const scope = ctx.sourceId
    ? `source "${ctx.sourceName}" (id ${ctx.sourceId})`
    : 'all sources';
  const mode = ctx.manual
    ? 'This is a manual review of existing open data.'
    : 'This is a post-scan review of the latest findings.';

  const lines = [`Mission: ${mission.kind}.`, `Scope: ${scope}. ${mode}`];

  // Name the batch explicitly. A coalesced cycle covers every source scanned
  // since the last one, and an agent told only "all sources" would reasonably
  // read that as the whole corpus.
  const batch = ctx.batchSources ?? [];
  if (batch.length > 0) {
    const names = batch
      .slice(0, 20)
      .map((s) => s.name)
      .join(', ');
    lines.push(
      `Scanned since the last cycle (${batch.length}): ${names}${batch.length > 20 ? ', …' : ''}. ` +
        'These are what is NEW — not the whole corpus. Call corpus.coverage for that.',
    );
  }
  if (ctx.expressReason) {
    lines.push(
      `This cycle was expedited rather than batched because: ${ctx.expressReason}.`,
    );
  }
  if (ctx.evidenceAnalysisPending) {
    lines.push(
      'WARNING: evidence analysis has not finished. Importance scores are incomplete, ' +
        'and an unscored finding is indistinguishable from an unimportant one. Treat ' +
        'findings.ranked as partial and prefer deferring to concluding.',
    );
  }

  lines.push(
    'Begin by observing the relevant state, then take the minimal correct actions.',
  );
  return lines.join('\n');
}

/** Tolerate common shape drift in the model's turn output. */
export function repairTurn(value: unknown): unknown {
  if (!value || typeof value !== 'object') return { thought: String(value) };
  const v = value as Record<string, unknown>;
  if (v.toolCalls && !Array.isArray(v.toolCalls)) v.toolCalls = [v.toolCalls];
  if (typeof v.thought !== 'string')
    v.thought = v.thought ? JSON.stringify(v.thought) : '';
  return v;
}
