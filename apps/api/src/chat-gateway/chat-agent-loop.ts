import { Logger } from '@nestjs/common';
import { AiSchemaError, type AiMessage, type JsonSchema } from '../ai';
import type { AgentLoopDeps } from '../autopilot/harness/agent-loop';
import type { AgentContext } from '../autopilot/autopilot.types';
import { withChatBotGate } from './chat-permissions';

const logger = new Logger('ChatAgentLoop');

const MAX_ITERATIONS = 10;

/** One turn the model emits — same ReAct shape as the autopilot loop. */
interface ChatLoopTurn {
  thought: string;
  toolCalls?: Array<{ tool: string; input: unknown; rationale: string }>;
  finish?: { reply: string };
}

const chatTurnSchema: JsonSchema = {
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
        // Only `tool` is hard-required: weaker models drop rationale/input,
        // and a schema rejection makes them regress to thought-only output.
        required: ['tool'],
        additionalProperties: true,
      },
    },
    finish: {
      type: 'object',
      properties: { reply: { type: 'string' } },
      required: ['reply'],
      additionalProperties: false,
    },
  },
  required: ['thought'],
  additionalProperties: true,
};

/** Compact record of one dispatched tool call, stored on the ChatMessage. */
export interface ChatToolCallSummary {
  tool: string;
  outcome: string;
  rationale: string;
}

export interface ChatTurnResult {
  reply: string;
  toolCalls: ChatToolCallSummary[];
  iterations: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The chat-gateway driver: a bounded ReAct loop for ONE conversational turn.
 * Unlike the autopilot loop it is not resumable — a turn is short-lived and
 * synchronous from the connector's perspective — but it reuses the same tool
 * registry, dispatcher (validation, gating, audit) and usage persistence, so
 * a chat turn is audited exactly like an autopilot cycle.
 */
export async function runChatTurn(
  ctx: AgentContext,
  opts: {
    userMessage: string;
    history: AiMessage[];
    sessionSummary: string;
    allowedTools: string[];
    platform: string;
  },
  deps: AgentLoopDeps,
): Promise<ChatTurnResult> {
  const runId = ctx.run.id;
  const messages: AiMessage[] = [
    { role: 'system', content: buildSystemPrompt(ctx, opts, deps) },
    ...opts.history,
    { role: 'user', content: opts.userMessage },
  ];

  const toolCalls: ChatToolCallSummary[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let iteration = 0;
  let stalls = 0;
  let reply: string | null = null;

  while (reply === null && iteration < MAX_ITERATIONS) {
    iteration++;

    let turnResult;
    try {
      turnResult = await deps.ai.completeJson<ChatLoopTurn>(
        messages,
        chatTurnSchema,
        // Low temperature normally; hotter after a stall so a model that
        // deterministically repeats the same thought-only output breaks free.
        { temperature: stalls > 0 ? 0.7 : 0.2, repair: repairChatTurn },
      );
    } catch (error) {
      // Failed attempts were billed too — record before surfacing.
      if (error instanceof AiSchemaError && error.usage) {
        inputTokens += error.usage.inputTokens;
        outputTokens += error.usage.outputTokens;
        await deps.audit.saveUsage(runId, inputTokens, outputTokens);
      }
      // Work already applied must not read as failure: when the provider
      // gives out AFTER successful tool calls, report what was done instead
      // of throwing the whole turn away.
      const applied = toolCalls.filter((c) => c.outcome === 'APPLIED');
      if (applied.length > 0) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Run ${runId}: provider failed after ${applied.length} applied call(s) — degrading to action summary (${reason}).`,
        );
        reply =
          `I completed these actions: ${applied.map((c) => c.tool).join(', ')}. ` +
          'The AI provider then became unavailable before I could write a proper summary — ' +
          'ask me again if you want the details.';
        break;
      }
      throw error;
    }
    const { content: turn, raw, usage } = turnResult;
    if (usage) {
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
    }

    await deps.log.business(runId, `Thinking: ${turn.thought}`);
    messages.push({ role: 'assistant', content: raw ?? '' });

    const calls = turn.toolCalls ?? [];
    if (turn.finish?.reply?.trim()) {
      reply = turn.finish.reply.trim();
      break;
    }
    if (calls.length === 0) {
      // The model mused without acting — the thought is internal reasoning
      // and must NEVER reach the operator. Nudge it to produce a real turn;
      // after repeated stalls give up gracefully instead of burning the
      // remaining iterations on identical output.
      stalls++;
      if (stalls >= 3) {
        reply =
          'I could not settle on a next step for that. Could you rephrase the request, or tell me the one detail you care about most?';
        break;
      }
      messages.push({
        role: 'user',
        content:
          'STOP deliberating. You returned neither toolCalls nor finish; your "thought" is internal and the operator sees nothing. ' +
          'Respond now with ONE of exactly these two shapes: ' +
          '{"thought":"…","toolCalls":[{"tool":"<name from the tool list>","input":{…},"rationale":"…"}]} to act, or ' +
          '{"thought":"…","finish":{"reply":"<your message to the operator>"}} to answer/ask. ' +
          'If you are unsure about config fields, call the schema tools (e.g. get_source_schema) instead of reasoning about what fields might exist.',
      });
      continue;
    }
    stalls = 0;

    const observations: unknown[] = [];
    for (const [i, call] of calls.entries()) {
      const tool =
        opts.allowedTools.includes(call.tool) && deps.registry.get(call.tool);
      if (!tool) {
        observations.push({
          tool: call.tool,
          outcome: 'FAILED',
          result: { error: `Unknown or disallowed tool "${call.tool}".` },
        });
        continue;
      }
      const dedupeKey = `chat:${iteration}:${i}:${call.tool}`;
      const result = await deps.dispatcher.dispatch(
        { ctx, audit: deps.audit, log: deps.log },
        // In chat, the bot's allowMutations flag is the mutation gate —
        // autopilot enablement settings apply to autonomous cycles only.
        withChatBotGate(tool),
        call.input,
        dedupeKey,
        call.rationale,
      );
      toolCalls.push({
        tool: call.tool,
        outcome: result.outcome,
        rationale: call.rationale,
      });
      observations.push(result);
    }

    messages.push({
      role: 'user',
      content: `Tool results:\n${JSON.stringify(observations)}`,
    });
    await deps.audit.saveUsage(runId, inputTokens, outputTokens);
  }

  if (reply === null) {
    reply =
      'I ran out of steps before I could finish that. Try narrowing the request or asking me to continue.';
  }
  await deps.audit.saveUsage(runId, inputTokens, outputTokens);

  logger.log(
    `Run ${runId}: chat turn finished in ${iteration} iteration(s), ${toolCalls.length} tool call(s).`,
  );

  return {
    reply,
    toolCalls,
    iterations: iteration,
    inputTokens,
    outputTokens,
  };
}

function buildSystemPrompt(
  ctx: AgentContext,
  opts: {
    sessionSummary: string;
    allowedTools: string[];
    platform: string;
  },
  deps: AgentLoopDeps,
): string {
  const summary = opts.sessionSummary.trim()
    ? `\n## Conversation memory (older history, compacted)\n${opts.sessionSummary.trim()}\n`
    : '';
  return [
    'You are the Classifyre assistant: the conversational interface to a data-classification platform.',
    `The operator is chatting with you over ${opts.platform}. They may ask about the state of the system ` +
      '(sources, runs, findings, detectors, cases, inquiries), ask you to change it (create or update sources ' +
      'and detectors, trigger runs) or steer the autonomous autopilot agents.',
    '',
    '## Your workflow — follow this every turn',
    "1. INFER generously: extract every value you can from the operator's message AND the whole conversation " +
      'so far. A follow-up message usually answers your previous question — combine it with the earlier ' +
      'request and continue that task; never restart or re-ask for things already given.',
    '   - "localhost:5432" → host=localhost, port=5432. "login postgres" → user=postgres. Derive a sensible ' +
      'name from the request ("Postgres localhost"). Use well-known defaults for anything conventional.',
    '2. ACT: when the request is clear, call the tools now — do not ask for permission to do what was ' +
      'already asked. Never reason about what config fields "might" exist: fetch the exact shape first ' +
      '(get_source_schema for sources, list_custom_detectors/examples for detectors), then submit your best ' +
      'config. Create/update tools validate against the JSON schema and return precise errors — fix the ' +
      'config from the error and retry (up to 3 attempts) instead of asking the operator about fields you ' +
      'can infer or default.',
    '3. ASK only as a last resort: when a required value is truly unknowable (e.g. a password you were not ' +
      'given), finish with ONE short question about at most 1–2 fields. State what you already prepared, ' +
      'then ask. Never send a wall of questions.',
    '4. REPORT: after acting, confirm in one or two sentences what happened (name/id of what you created, ' +
      'result of the run) and suggest the single most useful next step (e.g. test the connection, start a run).',
    '',
    '## Domain knowledge',
    'Detectors scan content during source runs. There are two kinds:',
    '- Built-in detectors (SECRETS, PII, YARA, BROKEN_LINKS, CODE_SECURITY) are configured PER SOURCE ' +
      'inside the source config: config field "detectors" is an array like [{"type":"PII","enabled":true}]. ' +
      'To add/enable one, call update_source with the updated detectors array (keep existing entries).',
    '- Custom detectors (regex rulesets, classifiers, entity extraction) are standalone entities: manage ' +
      'them with create_custom_detector/list_custom_detectors. Apply one to a source by adding its id to ' +
      'the source config array "custom_detectors" via update_source.',
    'After changing detectors, findings only update once a run is started (start_source_run).',
    'Investigations: a case groups related findings for a human investigation. Create one with ' +
      'cases.create (title, description, severity), add hypothesis threads with cases.add_hypothesis, ' +
      'attach findings with cases.attach_findings (finding ids from search_findings), attach assets as ' +
      'evidence with cases.add_evidence, and connect evidence/findings to a hypothesis with ' +
      'cases.link_support (SUPPORTS/CONTRADICTS). Inquiries (inquiries.create) are saved monitoring ' +
      'questions the autonomous agents keep answering.',
    '',
    '## Rules',
    'Ground every answer in tool results — never invent ids, counts or states. ' +
      'Only mutate when the operator asked for it; confirm destructive actions (delete, stop) first unless ' +
      'the request is explicit.',
    'When a mutating tool is skipped as observe-only, tell the operator this bot has mutations disabled.',
    `Keep replies short and chat-friendly: plain text with minimal Markdown that renders in ${opts.platform}, ` +
      'no headings, no tables, no JSON dumps. Summarize lists to the few most relevant items and offer to go deeper.',
    'Reply in the language the operator writes in.',
    summary,
    '## Tools you may call',
    deps.registry.catalog(opts.allowedTools),
    '',
    '## How to respond',
    'Each turn, return JSON: {"thought": "...", "toolCalls": [{"tool": "name", "input": {...}, "rationale": "why"}]}.',
    'When you have what you need, return {"thought":"...","finish":{"reply":"message to the operator"}} with toolCalls empty or omitted.',
    'The "reply" is the ONLY text the operator ever sees — your thought is internal reasoning and is never shown. ' +
      'Anything you want to tell or ask the operator MUST be in finish.reply, written to them ("I created…", "What is…?"), ' +
      'never about them ("The operator wants…"). Only call tools from the list above.',
  ].join('\n');
}

/** Tolerate common shape drift in the model's turn output. */
function repairChatTurn(value: unknown): unknown {
  if (!value || typeof value !== 'object') return { thought: String(value) };
  const v = value as Record<string, unknown>;
  if (v.toolCalls && !Array.isArray(v.toolCalls)) v.toolCalls = [v.toolCalls];
  if (Array.isArray(v.toolCalls)) {
    v.toolCalls = v.toolCalls
      .filter((item) => item && typeof item === 'object')
      .map((item: Record<string, unknown>) => {
        if (typeof item.rationale !== 'string') item.rationale = '';
        // Some models serialize the input object as a JSON string.
        if (typeof item.input === 'string') {
          try {
            item.input = JSON.parse(item.input) as unknown;
          } catch {
            /* leave as-is; the dispatcher will reject it with a clear error */
          }
        }
        return item;
      });
  }
  if (typeof v.thought !== 'string')
    v.thought = v.thought ? JSON.stringify(v.thought) : '';
  // Models sometimes emit finish as a bare string or use "summary".
  if (typeof v.finish === 'string') v.finish = { reply: v.finish };
  if (v.finish && typeof v.finish === 'object') {
    const f = v.finish as Record<string, unknown>;
    if (typeof f.reply !== 'string' && typeof f.summary === 'string') {
      f.reply = f.summary;
      delete f.summary;
    }
  }
  return v;
}
