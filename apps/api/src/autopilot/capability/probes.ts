import type { AiMessage } from '../../ai';
import {
  RESPONSE_PROTOCOL,
  renderObservations,
  type LoopTurn,
  type Observation,
} from '../harness/agent-loop';
import { INQUIRY_MISSION } from '../harness/missions';
import {
  normalizeAgainstSchema,
  validateAgainstSchema,
} from '../../ai/schema-validate';
import type {
  LlmProbe,
  ProbeBuildContext,
  ProbeGrade,
} from './capability.types';

/**
 * The tool subset every probe advertises. Deliberately a real slice of
 * INQUIRY_MISSION (not invented names): the probes must grade arguments against
 * the same JSON Schemas the dispatcher validates against in production, so a
 * pass here means the same input would survive ToolDispatcherService.
 */
export const PROBE_TOOLS = [
  'findings.ranked',
  'findings.explain',
  'findings.search',
  'inquiries.list',
  'inquiries.archived',
  'inquiries.create',
  'inquiries.reactivate',
  'memory.write',
];

/** Ids used in synthetic observations. Distinctive so a hallucination is obvious. */
const TOP_FINDING_ID = 'f-9c41ab7e';
const DECOY_FINDING_ID = 'f-2b77cc10';
const NOISY_CRITICAL_ID = 'f-crit-ocr-001';
const IMPORTANT_MEDIUM_ID = 'f-med-recur-002';
const ARCHIVED_INQUIRY_ID = 'inq-4471';

/**
 * The real harness system prompt, minus the per-run brief and operator
 * instruction. Composed exactly as buildSystemPrompt does — same mission goal
 * (including TRIAGE_DOCTRINE and the wind-down rules the judgment probes
 * grade against), same catalog rendering, same response protocol.
 */
function systemPrompt(ctx: ProbeBuildContext): AiMessage {
  return {
    role: 'system',
    content: [
      INQUIRY_MISSION.goal,
      '\n## Tools you may call',
      ctx.catalog,
      ...RESPONSE_PROTOCOL,
    ].join('\n'),
  };
}

/**
 * Render a synthetic tool observation exactly as the agent loop feeds it back —
 * same header, same per-result capping. Shared rather than copied so a change
 * to the loop's transcript format cannot leave the probes testing a shape no
 * model is ever sent.
 */
function observation(results: Observation[], iteration = 1): AiMessage {
  return { role: 'user', content: renderObservations(iteration, results) };
}

/** A scripted prior model turn, serialized the way the loop persists it. */
function priorTurn(turn: LoopTurn): AiMessage {
  return { role: 'assistant', content: JSON.stringify(turn) };
}

function calls(turn: LoopTurn) {
  return Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
}

function firstCall(turn: LoopTurn) {
  return calls(turn)[0];
}

function named(turn: LoopTurn, name: string) {
  return calls(turn).find((c) => c?.tool === name);
}

function pass(reason: string): ProbeGrade {
  return { status: 'PASS', reason };
}

function fail(reason: string): ProbeGrade {
  return { status: 'FAIL', reason };
}

/** Compact description of what the model actually did, for failure reasons. */
function describe(turn: LoopTurn): string {
  const list = calls(turn);
  if (turn.finish) return 'it finished the run instead';
  if (list.length === 0) return 'it made no tool calls';
  return `it called ${list.map((c) => `"${c?.tool ?? '?'}"`).join(', ')}`;
}

export const LLM_PROBES: LlmProbe[] = [
  // ── Tier 1: PROTOCOL ──────────────────────────────────────────────────────
  {
    id: 'json.strict',
    tier: 'PROTOCOL',
    title: 'Strict JSON on the first attempt',
    whatItProves:
      'The loop parses every turn with completeJson. A model that needs retries to emit clean JSON multiplies the token bill of every run.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content: [
            'Mission: INQUIRY.',
            'Scope: source "vendor-exports". This is a post-scan review of the latest findings.',
            'Begin by observing the relevant state, then take the minimal correct actions.',
          ].join('\n'),
        },
      ],
      // No retries: this probe measures first-shot compliance, because the
      // harness pays real tokens for every correction round-trip.
      maxRetries: 0,
    }),
    grade: (turn) =>
      typeof turn.thought === 'string' && turn.thought.trim().length > 0
        ? pass('Returned a schema-valid turn on the first attempt.')
        : fail(
            'Turn validated but carried an empty "thought" — the loop logs this as the agent’s reasoning.',
          ),
  },
  {
    id: 'json.recovery',
    tier: 'PROTOCOL',
    title: 'Recovers after a correction turn',
    whatItProves:
      'When first-shot JSON fails, completeJson appends a correction turn and retries twice. If recovery also fails the run dies with AiSchemaError.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". Observe the finding landscape before acting.',
        },
      ],
      maxRetries: 2,
    }),
    grade: (turn) =>
      typeof turn.thought === 'string'
        ? pass(
            'Produced a valid turn within the retry budget — runs will succeed, but at 2–3× the token cost of a compliant model.',
          )
        : fail('Even with retries the turn was unusable.'),
  },
  {
    id: 'react.turn_shape',
    tier: 'PROTOCOL',
    title: 'Emits a well-formed ReAct turn',
    whatItProves:
      'Every tool call needs a string "tool", an object "input" and a "rationale" — the dispatcher and the audit trail both read these fields.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content: [
            'Mission: INQUIRY. Scope: source "vendor-exports".',
            'You have not observed anything yet. Take your first observation step now.',
          ].join('\n'),
        },
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const list = calls(turn);
      if (list.length === 0) {
        return fail(
          `Made no tool calls on the opening turn — ${describe(turn)}. An agent that finishes before observing does no work.`,
        );
      }
      const broken = list.filter(
        (c) =>
          !c ||
          typeof c.tool !== 'string' ||
          !c.tool.trim() ||
          typeof c.rationale !== 'string' ||
          (c.input !== undefined &&
            (typeof c.input !== 'object' ||
              c.input === null ||
              Array.isArray(c.input))),
      );
      return broken.length === 0
        ? pass(`Emitted ${list.length} well-formed tool call(s).`)
        : fail(
            `${broken.length} of ${list.length} tool call(s) were malformed (missing tool/rationale, or a non-object "input"). The dispatcher rejects these before the handler runs.`,
          );
    },
  },
  {
    id: 'finish.termination',
    tier: 'PROTOCOL',
    title: 'Stops when the work is done',
    whatItProves:
      'The loop only exits on a finish block or an empty toolCalls array. A model that never finishes burns its entire iteration budget every run.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". Review the open findings.',
        },
        priorTurn({
          thought: 'Rank the findings to see what matters.',
          toolCalls: [
            {
              tool: 'findings.ranked',
              input: { sourceId: 'src-1' },
              rationale: 'Survey importance.',
            },
          ],
        }),
        observation([
          {
            tool: 'findings.ranked',
            outcome: 'READ_OK',
            result: { findings: [], note: 'No open findings in scope.' },
          },
        ]),
        {
          role: 'user',
          content:
            'There is nothing further to observe and nothing that warrants an inquiry. Conclude this run.',
        },
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const list = calls(turn);
      const summary = turn.finish?.summary;
      if (list.length > 0) {
        return fail(
          `Kept calling tools after being told the run was over (${describe(turn)}). This model will hit the "reached the iteration budget without finishing" path on most runs.`,
        );
      }
      return typeof summary === 'string' && summary.trim().length > 0
        ? pass(
            'Returned a finish block with a summary and no further tool calls.',
          )
        : pass(
            'Stopped calling tools, but wrote no finish.summary — the run narrative falls back to the raw thought.',
          );
    },
  },

  // ── Tier 2: TOOL_USE ──────────────────────────────────────────────────────
  {
    id: 'tool.selection',
    tier: 'TOOL_USE',
    title: 'Picks the right tool from the catalog',
    whatItProves:
      'The catalog is the only description a model gets. Reading it correctly is the difference between an agent that investigates and one that thrashes.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content: [
            'Mission: INQUIRY. Scope: source "vendor-exports".',
            'You need the corpus-relative importance ranking of the open findings, with the reasons behind each score, before you decide anything.',
            'Take exactly that one step.',
          ].join('\n'),
        },
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const call = firstCall(turn);
      if (!call) return fail(`Took no action — ${describe(turn)}.`);
      if (call.tool === 'findings.ranked') {
        return pass(
          'Chose findings.ranked, the tool whose description matches the request.',
        );
      }
      if (call.tool === 'findings.search') {
        return fail(
          'Chose findings.search (raw severity listing) over findings.ranked (importance with reasons). Per TRIAGE DOCTRINE this is how agents end up investigating noise.',
        );
      }
      return fail(
        `Chose "${call.tool}" for a request that plainly describes findings.ranked. Tool descriptions are not being read carefully.`,
      );
    },
  },
  {
    id: 'tool.args_schema',
    tier: 'TOOL_USE',
    title: 'Arguments survive the dispatcher',
    whatItProves:
      'ToolDispatcherService validates every input against the tool’s JSON Schema before the handler runs. Bad arguments mean FAILED on every call.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content: [
            'Mission: INQUIRY. Scope: source "vendor-exports".',
            'Findings show AWS access keys recurring across unrelated CSV exports from three departments.',
            'Create one inquiry that monitors this, titled "Recurring AWS access keys in CSV exports".',
          ].join('\n'),
        },
      ],
      maxRetries: 0,
    }),
    grade: (turn, ctx) => {
      const list = calls(turn);
      if (list.length === 0) return fail(`Took no action — ${describe(turn)}.`);

      const problems: string[] = [];
      for (const call of list) {
        const tool = ctx.registry.get(call.tool);
        if (!tool) {
          problems.push(`"${call.tool}" is not a registered tool`);
          continue;
        }
        try {
          // Grade with the SAME mode the dispatcher applies to this tool, on a
          // clone — lenient normalization mutates the value it validates.
          const input = structuredClone(call.input ?? {});
          if (tool.lenientInput === false) {
            validateAgainstSchema(input, tool.inputSchema);
          } else {
            normalizeAgainstSchema(input, tool.inputSchema);
          }
        } catch (error) {
          problems.push(
            `${call.tool}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return problems.length === 0
        ? pass(
            `All ${list.length} tool input(s) validated against the real tool schemas — the dispatcher would accept them.`,
          )
        : fail(
            `The dispatcher would reject these calls — ${problems.join(' | ')}`,
          );
    },
  },
  {
    id: 'tool.no_hallucination',
    tier: 'TOOL_USE',
    title: 'Does not invent tools',
    whatItProves:
      'The loop rejects any name outside the allowed list. A model that invents tools when the catalog falls short wastes a full iteration each time.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content: [
            'Mission: INQUIRY. Scope: source "vendor-exports".',
            'The operator wants the source "vendor-exports" deleted outright and the compliance team emailed about it.',
            'Do what you can with the tools you have.',
          ].join('\n'),
        },
      ],
      maxRetries: 0,
    }),
    grade: (turn, ctx) => {
      const invented = calls(turn)
        .map((c) => c?.tool)
        .filter((name): name is string => typeof name === 'string')
        .filter((name) => !ctx.allowedTools.includes(name));
      return invented.length === 0
        ? pass(
            'Stayed inside the catalog when asked for operations no tool provides (no source deletion, no email tool).',
          )
        : fail(
            `Invented ${invented.length} tool name(s): ${invented.map((n) => `"${n}"`).join(', ')}. Each becomes an "Unknown or disallowed tool" observation and a wasted iteration.`,
          );
    },
  },

  // ── Tier 3: CHAINING ──────────────────────────────────────────────────────
  {
    id: 'chain.two_step',
    tier: 'CHAINING',
    title: 'Carries an id from an observation into the next call',
    whatItProves:
      'This is the whole harness in one behaviour: tool results come back as a JSON user turn, and the next call must be grounded in them rather than invented.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". Rank the findings, then explain the single most important one before deciding anything.',
        },
        priorTurn({
          thought: 'Rank the open findings by evidence importance.',
          toolCalls: [
            {
              tool: 'findings.ranked',
              input: { sourceId: 'src-1' },
              rationale: 'Survey importance.',
            },
          ],
        }),
        // Decoy ordering: the lower-importance finding is listed first, so a
        // model that grabs the first id rather than reading the scores fails.
        observation([
          {
            tool: 'findings.ranked',
            outcome: 'READ_OK',
            result: {
              findings: [
                {
                  findingId: DECOY_FINDING_ID,
                  importance: 0.34,
                  detector: 'PII',
                  reasons: ['common_value'],
                },
                {
                  findingId: TOP_FINDING_ID,
                  importance: 0.91,
                  detector: 'SECRETS',
                  reasons: [
                    'cross_document_recurrence',
                    'unique_readable_evidence',
                  ],
                },
              ],
            },
          },
        ]),
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const call = named(turn, 'findings.explain');
      if (!call) {
        return fail(
          `Did not follow up with findings.explain — ${describe(turn)}. The chain from observation to dependent action is broken.`,
        );
      }
      const used = (call.input as { findingId?: unknown } | undefined)
        ?.findingId;
      if (used === TOP_FINDING_ID) {
        return pass(
          `Read the observation and passed the highest-importance id (${TOP_FINDING_ID}, importance 0.91) even though it was listed second.`,
        );
      }
      if (used === DECOY_FINDING_ID) {
        return fail(
          `Passed ${DECOY_FINDING_ID} (importance 0.34, listed first) instead of ${TOP_FINDING_ID} (0.91). It is taking the first id it sees rather than reading the observation.`,
        );
      }
      return fail(
        `Passed findingId ${JSON.stringify(used)}, which appears nowhere in the observation. This model fabricates ids — every dependent call in a real run would fail.`,
      );
    },
  },
  {
    id: 'chain.error_recovery',
    tier: 'CHAINING',
    title: 'Corrects itself after a FAILED observation',
    whatItProves:
      'Rejected calls come back as a FAILED observation carrying the validator’s message. A model that cannot act on it repeats the same error until the budget runs out.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". Open an inquiry for the recurring AWS access keys found across CSV exports.',
        },
        priorTurn({
          thought: 'Create the inquiry.',
          toolCalls: [
            {
              tool: 'inquiries.create',
              input: { detector: 'SECRETS', severity: 'CRITICAL' },
              rationale: 'Monitor recurring AWS keys.',
            },
          ],
        }),
        observation([
          {
            tool: 'inquiries.create',
            outcome: 'FAILED',
            result: {
              error:
                "Schema validation failed: (root) must have required property 'title'",
            },
          },
        ]),
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const call = named(turn, 'inquiries.create');
      if (!call) {
        return fail(
          `Abandoned the task instead of fixing the input — ${describe(turn)}. A single validation error should not end the work.`,
        );
      }
      const title = (call.input as { title?: unknown } | undefined)?.title;
      return typeof title === 'string' && title.trim().length > 0
        ? pass(
            `Read the validator message and retried with the missing field (title: "${title.trim().slice(0, 60)}").`,
          )
        : fail(
            'Retried inquiries.create without adding the "title" the error named. This produces an identical failure every iteration until the budget is exhausted.',
          );
    },
  },
  {
    id: 'chain.no_thrash',
    tier: 'CHAINING',
    title: 'Makes progress instead of re-reading',
    whatItProves:
      'Each iteration costs a full model call. Re-issuing a read that already succeeded is the most common way a run exhausts its budget having achieved nothing.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". Review the findings and act on anything that warrants an inquiry.',
        },
        priorTurn({
          thought: 'Rank the open findings.',
          toolCalls: [
            {
              tool: 'findings.ranked',
              input: { sourceId: 'src-1' },
              rationale: 'Survey importance.',
            },
          ],
        }),
        observation([
          {
            tool: 'findings.ranked',
            outcome: 'READ_OK',
            result: {
              findings: [
                {
                  findingId: TOP_FINDING_ID,
                  importance: 0.91,
                  detector: 'SECRETS',
                  evidence:
                    'AKIA… key repeated in 6 exports from 3 departments',
                  reasons: [
                    'cross_document_recurrence',
                    'unique_readable_evidence',
                  ],
                },
              ],
            },
          },
        ]),
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const repeat = calls(turn).find(
        (c) =>
          c?.tool === 'findings.ranked' &&
          JSON.stringify(
            (c.input as { sourceId?: unknown } | undefined)?.sourceId,
          ) === JSON.stringify('src-1'),
      );
      if (repeat) {
        return fail(
          'Re-issued findings.ranked with the identical input it had just received an answer to. Runs will spin until the iteration budget is spent.',
        );
      }
      return calls(turn).length > 0 || turn.finish
        ? pass('Moved forward from the observation rather than re-reading it.')
        : fail(
            `Produced neither a next action nor a finish — ${describe(turn)}.`,
          );
    },
  },

  // ── Tier 4: JUDGMENT ──────────────────────────────────────────────────────
  {
    id: 'judgment.triage',
    tier: 'JUDGMENT',
    title: 'Follows TRIAGE DOCTRINE over raw severity',
    whatItProves:
      'The mission prompt states that detector severity is not importance. A model that ignores it builds investigations on OCR fragments and duplicate noise.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". Decide which single finding genuinely matters, and call findings.explain on that one before going further.',
        },
        priorTurn({
          thought: 'Rank the open findings by evidence importance.',
          toolCalls: [
            {
              tool: 'findings.ranked',
              input: { sourceId: 'src-1' },
              rationale: 'Survey importance.',
            },
          ],
        }),
        observation([
          {
            tool: 'findings.ranked',
            outcome: 'READ_OK',
            result: {
              findings: [
                {
                  findingId: NOISY_CRITICAL_ID,
                  severity: 'CRITICAL',
                  importance: 0.12,
                  detector: 'PII',
                  evidence: '000000000000',
                  reasons: ['ocr_fragment', 'common_value', 'duplicate_group'],
                },
                {
                  findingId: IMPORTANT_MEDIUM_ID,
                  severity: 'MEDIUM',
                  importance: 0.88,
                  detector: 'SECRETS',
                  evidence:
                    'AKIA… key repeated in 6 exports from 3 departments',
                  reasons: [
                    'cross_document_recurrence',
                    'unique_readable_evidence',
                  ],
                },
              ],
            },
          },
        ]),
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      const call = named(turn, 'findings.explain');
      if (!call) {
        return fail(
          `Did not call findings.explain as instructed — ${describe(turn)}.`,
        );
      }
      const used = (call.input as { findingId?: unknown } | undefined)
        ?.findingId;
      if (used === IMPORTANT_MEDIUM_ID) {
        return pass(
          'Picked the MEDIUM finding with cross-document recurrence over the CRITICAL OCR fragment — it is applying the triage doctrine, not the severity label.',
        );
      }
      if (used === NOISY_CRITICAL_ID) {
        return fail(
          'Picked the CRITICAL finding whose only reasons are ocr_fragment/common_value/duplicate_group. It is ranking by severity label despite the doctrine in its own system prompt — expect inquiries and cases built on noise.',
        );
      }
      return fail(`Passed an unrecognised findingId ${JSON.stringify(used)}.`);
    },
  },
  {
    id: 'judgment.negative_constraint',
    tier: 'JUDGMENT',
    title: 'Respects operator decisions',
    whatItProves:
      'The mission forbids reviving topics an operator archived. A model that ignores negative constraints recreates dismissed work every single cycle.',
    build: (ctx) => ({
      messages: [
        systemPrompt(ctx),
        {
          role: 'user',
          content:
            'Mission: INQUIRY. Scope: source "vendor-exports". New findings arrived for AWS access keys in CSV exports. Check the archived inquiries first, then decide what to do.',
        },
        priorTurn({
          thought: 'Check whether this topic was already handled.',
          toolCalls: [
            {
              tool: 'inquiries.archived',
              input: {},
              rationale: 'Look for precedents.',
            },
          ],
        }),
        observation([
          {
            tool: 'inquiries.archived',
            outcome: 'READ_OK',
            result: {
              inquiries: [
                {
                  id: ARCHIVED_INQUIRY_ID,
                  title: 'Exposed AWS keys in CSV exports',
                  archivedBy: 'operator',
                  archivedReason:
                    'Operator archived: these are vendor-approved sandbox keys, not live credentials. Do not raise again.',
                },
              ],
            },
          },
        ]),
      ],
      maxRetries: 0,
    }),
    grade: (turn) => {
      if (named(turn, 'inquiries.create')) {
        return fail(
          `Created a new inquiry for a topic the operator archived as a known false positive (${ARCHIVED_INQUIRY_ID}). This model will recreate dismissed work every cycle and train your operators to ignore it.`,
        );
      }
      if (named(turn, 'inquiries.reactivate')) {
        return fail(
          `Reactivated ${ARCHIVED_INQUIRY_ID} despite an archive reason that explicitly says not to raise it again. Reactivation is for genuine recurrence, not for operator-dismissed topics.`,
        );
      }
      return pass(
        'Declined to recreate or reactivate the operator-archived topic — negative constraints in the mission prompt are being honoured.',
      );
    },
  },
];
