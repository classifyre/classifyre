import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import {
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  assistantContexts,
  assistantUiActionSchema,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantPageContext,
  type AssistantPendingConfirmation,
  type AssistantToolCallSummary,
  type AssistantUiAction,
} from '@workspace/schemas/assistant';
import { AiClientService, type AiMessage, type JsonSchema } from './ai';
import {
  AssistantMcpService,
  type AssistantMcpTool,
} from './assistant/assistant-mcp.service';
import {
  assistantContextModules,
  contextKnowledge,
} from './assistant/context-modules';
import {
  safeJsonStringify,
  summarizeSchemaForPrompt,
} from './assistant/schema-summary';
import * as z from 'zod/v4';

export { summarizeSchemaForPrompt } from './assistant/schema-summary';

// ── Loop turn protocol ───────────────────────────────────────────────────────

const turnToolCallSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
});

const turnProposalSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  title: z.string().optional(),
  detail: z.string().optional(),
});

const loopTurnSchema = z.object({
  reply: z.string().optional(),
  toolCalls: z.array(turnToolCallSchema).default([]),
  uiActions: z.array(z.unknown()).default([]),
  proposeOperation: turnProposalSchema.nullable().default(null),
});

type LoopTurn = z.infer<typeof loopTurnSchema>;

const loopTurnJsonSchema: JsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tool: { type: 'string' },
          input: { type: 'object' },
        },
        required: ['tool'],
        additionalProperties: true,
      },
    },
    uiActions: {
      type: 'array',
      items: { type: 'object' },
    },
    proposeOperation: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            tool: { type: 'string' },
            input: { type: 'object' },
            title: { type: 'string' },
            detail: { type: 'string' },
          },
          required: ['tool', 'input'],
          additionalProperties: true,
        },
      ],
    },
  },
  required: [],
  additionalProperties: true,
};

/** Tolerate common shape drift in the model's turn output. */
function repairTurn(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    const reply =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
    return { reply };
  }
  const v = value as Record<string, unknown>;
  if (v.toolCalls && !Array.isArray(v.toolCalls)) v.toolCalls = [v.toolCalls];
  if (v.uiActions && !Array.isArray(v.uiActions)) v.uiActions = [v.uiActions];
  if (typeof v.reply !== 'string' && v.reply != null) {
    v.reply = JSON.stringify(v.reply);
  }
  if (v.proposeOperation === '' || v.proposeOperation === 'null') {
    v.proposeOperation = null;
  }
  return v;
}

const MAX_ITERATIONS = 6;
const MAX_TOOL_CALLS_PER_TURN = 5;
const MAX_OBSERVATION_CHARS = 4000;
const MAX_RECOVERY_ITERATIONS = 3;

const confirmationRegex =
  /^(confirm|yes|y|do it|go ahead|continue|run it|ship it)\b/i;
const cancellationRegex = /^(cancel|stop|never mind|no|not now)\b/i;

const ASSISTANT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ASSISTANT_UPLOAD_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.txt',
  '.md',
  '.log',
  '.json',
]);

/** Mutable state threaded through one respond() turn. */
interface LoopState {
  messages: AiMessage[];
  actions: AssistantUiAction[];
  toolCalls: AssistantToolCallSummary[];
  tools: AssistantMcpTool[];
  context: AssistantPageContext;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly aiClient: AiClientService,
    private readonly assistantMcp: AssistantMcpService,
  ) {}

  async respond(input: unknown): Promise<AssistantChatResponse> {
    const request = assistantChatRequestSchema.parse(input);

    if (request.pendingConfirmation) {
      const decision = resolveConfirmationDecision(request);
      if (decision === 'cancel') {
        return assistantChatResponseSchema.parse({
          reply: `Cancelled: ${request.pendingConfirmation.title}. Nothing was executed — tell me what to adjust.`,
          actions: [
            {
              type: 'show_toast',
              tone: 'info',
              title: 'Assistant action cancelled',
              description: request.pendingConfirmation.title,
            },
          ] satisfies AssistantUiAction[],
          pendingConfirmation: null,
          toolCalls: [],
        });
      }
      if (decision === 'confirm') {
        return this.executeConfirmedOperation(request);
      }
      // Any other message drops the pending proposal and is treated as a new
      // instruction; the loop is told about the abandoned proposal so it can
      // re-propose once the user's concern is addressed.
    }

    const state = await this.createLoopState(request);
    return this.runLoop(state, MAX_ITERATIONS);
  }

  // ── Agent loop ─────────────────────────────────────────────────────────────

  private async createLoopState(
    request: AssistantChatRequest,
  ): Promise<LoopState> {
    const module = assistantContextModules[request.context.key];
    const allTools = await this.assistantMcp.listTools();
    const tools = allTools.filter((tool) => module.tools.includes(tool.name));

    const messages: AiMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(request.context, tools),
      },
      { role: 'user', content: buildUserMessage(request) },
    ];

    return {
      messages,
      actions: [],
      toolCalls: [],
      tools,
      context: request.context,
    };
  }

  /**
   * Bounded ReAct loop: the model calls read tools freely, and the loop ends
   * on a user-facing reply, a proposed mutation (→ pendingConfirmation), or
   * budget exhaustion. Mutating tools NEVER execute inside the loop.
   */
  private async runLoop(
    state: LoopState,
    budget: number,
  ): Promise<AssistantChatResponse> {
    for (let iteration = 0; iteration < budget; iteration++) {
      const { content, raw } = await this.aiClient.completeJson<LoopTurn>(
        state.messages,
        loopTurnJsonSchema,
        { temperature: 0.2, repair: repairTurn },
      );
      const turn = loopTurnSchema.parse(content);
      state.messages.push({ role: 'assistant', content: raw ?? '' });

      const calls = turn.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN);
      if (calls.length > 0) {
        const observations: unknown[] = [];
        for (const call of calls) {
          observations.push(await this.executeReadCall(state, call));
        }
        state.messages.push({
          role: 'user',
          content: `Tool results:\n${safeJsonStringify(observations, MAX_OBSERVATION_CHARS * calls.length)}`,
        });
        continue;
      }

      // Final turn: collect UI actions and an optional mutation proposal.
      this.collectUiActions(state, turn.uiActions);
      const pendingConfirmation = this.buildPendingConfirmation(
        state,
        turn.proposeOperation,
      );

      let reply =
        turn.reply?.trim() ||
        (pendingConfirmation
          ? `I prepared "${pendingConfirmation.title}".`
          : 'Done — let me know what to do next.');
      if (pendingConfirmation) {
        reply = `${reply} Confirm to ${pendingConfirmation.detail}.`;
      }

      return assistantChatResponseSchema.parse({
        reply,
        actions: state.actions,
        pendingConfirmation,
        toolCalls: state.toolCalls,
      });
    }

    // Budget exhausted: report what happened instead of stalling silently.
    const attempted = state.toolCalls
      .map((call) => `${call.name} (${call.status})`)
      .join(', ');
    return assistantChatResponseSchema.parse({
      reply:
        `I gathered information but ran out of steps before finishing${attempted ? ` (calls: ${attempted})` : ''}. ` +
        'Tell me which part to continue with and I will pick it up from there.',
      actions: state.actions,
      pendingConfirmation: null,
      toolCalls: state.toolCalls,
    });
  }

  /** Executes one in-loop tool call; mutating tools are rejected with guidance. */
  private async executeReadCall(
    state: LoopState,
    call: { tool: string; input: Record<string, unknown> },
  ): Promise<unknown> {
    const tool = state.tools.find((entry) => entry.name === call.tool);
    if (!tool) {
      return {
        tool: call.tool,
        ok: false,
        error: `Unknown or disallowed tool "${call.tool}" for this context. Available: ${state.tools.map((entry) => entry.name).join(', ')}`,
      };
    }
    if (!tool.readOnly) {
      return {
        tool: call.tool,
        ok: false,
        error:
          'This tool mutates data and requires user confirmation. Return it as "proposeOperation" (with the full input) instead of calling it directly.',
      };
    }

    const result = await this.assistantMcp.callTool(call.tool, call.input);
    state.toolCalls.push({
      name: call.tool,
      status: result.ok ? 'success' : 'error',
      detail: safeJsonStringify(result.result, 240),
    });
    return {
      tool: call.tool,
      ok: result.ok,
      ...(result.ok ? { result: result.result } : { error: result.result }),
    };
  }

  private collectUiActions(state: LoopState, rawActions: unknown[]): void {
    const module = assistantContextModules[state.context.key];
    for (const raw of rawActions) {
      const parsed = assistantUiActionSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn(
          `Dropping malformed assistant UI action: ${safeJsonStringify(raw, 300)}`,
        );
        continue;
      }
      const action = parsed.data;
      const modelEmittable: Array<AssistantUiAction['type']> = [
        'patch_fields',
        'navigate',
        'show_toast',
      ];
      if (
        !modelEmittable.includes(action.type) ||
        !module.uiActions.includes(
          action.type as 'patch_fields' | 'navigate' | 'show_toast',
        )
      ) {
        this.logger.warn(
          `Dropping UI action "${action.type}" not allowed in context ${state.context.key}`,
        );
        continue;
      }
      state.actions.push(action);
    }
  }

  private buildPendingConfirmation(
    state: LoopState,
    proposal: LoopTurn['proposeOperation'],
  ): AssistantPendingConfirmation | null {
    if (!proposal) {
      return null;
    }
    const tool = state.tools.find((entry) => entry.name === proposal.tool);
    if (!tool) {
      this.logger.warn(
        `Dropping proposal for unknown/disallowed tool "${proposal.tool}"`,
      );
      return null;
    }
    if (tool.readOnly) {
      // Read tools never need confirmation; a proposal for one is model
      // confusion — drop it rather than bothering the user.
      return null;
    }
    return {
      tool: proposal.tool,
      input: proposal.input,
      title: proposal.title?.trim() || `Run ${proposal.tool} via MCP`,
      detail: proposal.detail?.trim() || `execute ${proposal.tool}`,
    };
  }

  // ── Confirmed execution ────────────────────────────────────────────────────

  private async executeConfirmedOperation(
    request: AssistantChatRequest,
  ): Promise<AssistantChatResponse> {
    const pending = request.pendingConfirmation;
    if (!pending) {
      throw new BadRequestException('No pending assistant confirmation found');
    }

    const module = assistantContextModules[request.context.key];
    if (!module.tools.includes(pending.tool)) {
      throw new BadRequestException(
        `Tool "${pending.tool}" is not available in context ${request.context.key}`,
      );
    }
    const tool = await this.assistantMcp.getTool(pending.tool);
    if (!tool || tool.readOnly) {
      throw new BadRequestException(
        `Tool "${pending.tool}" cannot be executed as a confirmed operation`,
      );
    }

    const result = await this.assistantMcp.callTool(
      pending.tool,
      pending.input,
    );

    // The proposal was acted on, not abandoned — don't let the prompt builder
    // describe it as such.
    const state = await this.createLoopState({
      ...request,
      pendingConfirmation: null,
    });
    state.toolCalls.push({
      name: pending.tool,
      status: result.ok ? 'success' : 'error',
      detail: safeJsonStringify(result.result, 240),
    });

    if (result.ok) {
      // Deterministic UI sync + attachments come from the server, not the
      // model, so the page state never depends on model compliance.
      state.actions.push(...buildPostOperationActions(pending.tool, result.result));
      state.messages.push({
        role: 'user',
        content: [
          `The user CONFIRMED and the tool "${pending.tool}" was executed successfully.`,
          `Tool result:\n${safeJsonStringify(result.result, MAX_OBSERVATION_CHARS)}`,
          'Write a short reply (1–3 sentences) explaining what happened and recommending the best next action.',
          'You may call read tools first if you need details, and you may propose a follow-up operation via proposeOperation.',
          'Do not re-run the operation that just succeeded.',
        ].join('\n\n'),
      });
      return this.runLoop(state, MAX_RECOVERY_ITERATIONS);
    }

    // Failure (typically schema/validation): feed the error back so the model
    // self-corrects — patch the form, fix the input, and re-propose.
    state.messages.push({
      role: 'user',
      content: [
        `The user CONFIRMED "${pending.tool}", but it FAILED. Input was:\n${safeJsonStringify(pending.input, 3000)}`,
        `Error:\n${safeJsonStringify(result.result, 3000)}`,
        'Diagnose the error. If you can fix the input: emit patch_fields uiActions so the user sees the corrections, and re-propose the operation with the corrected input via proposeOperation.',
        'If you cannot fix it without more information, explain in plain language exactly what the user must provide or change (name the exact fields).',
        'You may call read tools (e.g. schema or validation tools) to verify the corrected input before re-proposing.',
      ].join('\n\n'),
    });
    return this.runLoop(state, MAX_RECOVERY_ITERATIONS);
  }

  // ── Uploads (unchanged behavior) ───────────────────────────────────────────

  parseUploadedFile(
    fileBuffer: Buffer,
    fileName: string,
  ): Record<string, unknown> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }

    if (fileBuffer.length > ASSISTANT_UPLOAD_MAX_BYTES) {
      throw new BadRequestException(
        `File too large. Max ${Math.floor(ASSISTANT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const extension = path.extname(fileName).toLowerCase();
    if (!ASSISTANT_UPLOAD_ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        `Unsupported file type "${extension || 'unknown'}". Supported: ${Array.from(ASSISTANT_UPLOAD_ALLOWED_EXTENSIONS).join(', ')}`,
      );
    }

    const content = fileBuffer.toString('utf8').replace(/^\uFEFF/, '');
    if (content.trim().length === 0) {
      throw new BadRequestException('File has no parseable text.');
    }

    if (extension === '.csv' || extension === '.tsv') {
      const delimiter = extension === '.csv' ? ',' : '\t';
      const rows = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 400);
      const parsedRows = rows.map((line) =>
        parseDelimitedLine(line, delimiter),
      );
      const header = parsedRows[0] ?? [];
      const hasHeader =
        header.length > 1 &&
        header.every((cell) => /[a-zA-Z]/.test(cell)) &&
        new Set(header.map((cell) => cell.toLowerCase())).size ===
          header.length;
      const columns = hasHeader
        ? header
        : (parsedRows[0] ?? []).map((_, index) => `column_${index + 1}`);
      const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
      const sampleRows = dataRows
        .slice(0, 20)
        .map((row) =>
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              typeof row[index] === 'string' ? row[index] : '',
            ]),
          ),
        );

      return {
        fileName,
        fileType: extension === '.csv' ? 'csv' : 'tsv',
        bytes: fileBuffer.length,
        rowCount: dataRows.length,
        columns,
        sampleRows,
        truncated: rows.length >= 400 || dataRows.length > sampleRows.length,
        summary: `Parsed ${dataRows.length} row(s) and ${columns.length} column(s).`,
      };
    }

    if (extension === '.json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new BadRequestException('JSON file could not be parsed.');
      }

      const parsedArray = Array.isArray(parsed) ? parsed : null;
      const isArray = parsedArray !== null;
      const topLevelKeys = isArray
        ? []
        : Object.keys(parsed && typeof parsed === 'object' ? parsed : {}).slice(
            0,
            30,
          );
      const summary = isArray
        ? `Parsed JSON array with ${parsedArray.length} item(s).`
        : `Parsed JSON object with ${topLevelKeys.length} top-level key(s).`;

      return {
        fileName,
        fileType: 'json',
        bytes: fileBuffer.length,
        isArray,
        rowCount: parsedArray?.length,
        topLevelKeys,
        jsonPreview: safeJsonStringify(parsed, 6000),
        truncated: JSON.stringify(parsed).length > 6000,
        summary,
      };
    }

    const lines = content.split(/\r?\n/).length;
    return {
      fileName,
      fileType: 'text',
      bytes: fileBuffer.length,
      lineCount: lines,
      textPreview:
        content.length > 6000
          ? `${content.slice(0, 6000)}\n…(truncated)…`
          : content,
      truncated: content.length > 6000,
      summary: `Parsed text with ${lines} line(s).`,
    };
  }
}

// ── Confirmation intent ──────────────────────────────────────────────────────

function resolveConfirmationDecision(
  request: AssistantChatRequest,
): 'confirm' | 'cancel' | null {
  if (request.confirmationDecision) {
    return request.confirmationDecision;
  }
  const latest = getLatestUserMessage(request);
  if (confirmationRegex.test(latest)) {
    return 'confirm';
  }
  if (cancellationRegex.test(latest)) {
    return 'cancel';
  }
  return null;
}

function getLatestUserMessage(request: AssistantChatRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === 'user') {
      return message.content.trim();
    }
  }
  return '';
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(
  context: AssistantPageContext,
  tools: AssistantMcpTool[],
): string {
  const definition = assistantContexts[context.key];
  const module = assistantContextModules[context.key];
  const knowledge = contextKnowledge(context.key);

  const schemaSummary = summarizeSchemaForPrompt(context.schema);
  const schemaSection = schemaSummary
    ? [
        '',
        '## Form schema (exact field paths — patch these)',
        'Patch paths are dot-notation into the form. Use these EXACT paths and respect',
        'their types/enums. Fields marked (required) must be filled before any operation;',
        'fields marked (secret) hold credentials — set them only from explicit user input.',
        schemaSummary,
      ].join('\n')
    : '';

  const uiActionDocs: string[] = [];
  if (module.uiActions.includes('patch_fields')) {
    uiActionDocs.push(
      '  {"type":"patch_fields","patches":[{"path":"dot.notation.path","value":<any>}]} — update the form the user is looking at. Patch generously: everything you infer should land in the form.',
    );
  }
  if (module.uiActions.includes('navigate')) {
    uiActionDocs.push(
      '  {"type":"navigate","route":"/app-internal/path"} — send the user to another page (see the route map). Use it when the task belongs elsewhere.',
    );
  }
  uiActionDocs.push(
    '  {"type":"show_toast","tone":"info|success|error","title":"...","description":"..."} — brief notification; use sparingly.',
  );

  return [
    'You are the Classifyre assistant, embedded in the product UI. You act on behalf of the user through MCP tools and UI actions.',
    '',
    `## Current context: ${definition.title}`,
    definition.summary,
    `Page route: ${context.route}${context.entityId ? ` (entity id: ${context.entityId})` : ''}`,
    '',
    '## Response protocol — return JSON every turn',
    'Fields (all optional unless stated):',
    '  toolCalls          [{"tool":"name","input":{...}}] — read-only tools you want executed NOW. Results come back next turn. Use them to look things up before answering or proposing.',
    '  reply              string — your user-facing message. Providing it (with no toolCalls) ENDS the turn.',
    `  uiActions          array — UI effects applied when the turn ends. Allowed here:\n${uiActionDocs.join('\n')}`,
    '  proposeOperation   {"tool":"name","input":{...},"title":"short label","detail":"what confirming will do"} | null — the ONE mutating tool call you want to run. The user sees a Confirm button; the tool runs only after they confirm. Include the COMPLETE input.',
    '',
    '## Rules',
    '- Mutating tools (marked MUTATE below) can never go in toolCalls — only in proposeOperation, one at a time.',
    '- VALIDATE FIRST: when a validate_* tool is available for the thing you are about to propose, call it in toolCalls and fix every error before proposing. Never propose an operation whose input you know is invalid.',
    '- When a tool fails, read the error, fix the input, and try again (or ask the user for the one missing piece). Never repeat the identical failing call.',
    '- Keep the form in sync: when you fix or infer values, emit patch_fields so the user sees it.',
    '- Ask about at most 1–2 missing fields at a time, conversationally.',
    '- Never invent credentials or secrets; ask the user for them.',
    '- Never claim an operation ran unless its result is in this conversation.',
    schemaSection,
    knowledge ? `\n${knowledge}` : '',
    '',
    '## Tools available in this context',
    renderToolCatalog(tools),
  ]
    .filter((section) => section !== '')
    .join('\n');
}

function renderToolCatalog(tools: AssistantMcpTool[]): string {
  if (tools.length === 0) {
    return '(no tools available — answer from context only)';
  }
  return tools
    .map((tool) => {
      const marker = tool.readOnly
        ? 'read'
        : tool.destructive
          ? 'MUTATE, destructive'
          : 'MUTATE';
      const description = tool.description.split('\n')[0]?.slice(0, 180) ?? '';
      const inputSummary = summarizeSchemaForPrompt(tool.inputSchema);
      return [
        `- ${tool.name} (${marker}): ${description}`,
        inputSummary ? inputSummary : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function buildUserMessage(request: AssistantChatRequest): string {
  const conversationText = request.messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n');
  const metadataText = safeJsonStringify(request.context.metadata ?? {}, 10000);
  const { validation } = request.context;
  const missingText =
    validation.missingFields.length > 0
      ? validation.missingFields.join(', ')
      : 'none';
  const errorsText =
    validation.errors.length > 0 ? validation.errors.join('; ') : 'none';
  const abandonedProposal = request.pendingConfirmation
    ? [
        '',
        '## Abandoned proposal',
        `You previously proposed "${request.pendingConfirmation.title}" but the user replied with something else instead of confirming. Address their message; re-propose only when it makes sense.`,
      ].join('\n')
    : '';

  return [
    '## Current form values',
    safeJsonStringify(request.context.values, 8000),
    '',
    '## Client-side validation snapshot (advisory — server validation is authoritative)',
    `isValid: ${validation.isValid}`,
    `missingFields: ${missingText}`,
    `errors: ${errorsText}`,
    '',
    '## Context metadata',
    metadataText,
    abandonedProposal,
    '',
    '## Conversation (latest message last)',
    conversationText,
  ].join('\n');
}

// ── Deterministic post-operation UI sync ─────────────────────────────────────

/**
 * Server-built UI actions after a confirmed mutation succeeds. These keep the
 * page in sync with what was actually persisted, independent of the model.
 */
function buildPostOperationActions(
  toolName: string,
  result: unknown,
): AssistantUiAction[] {
  const record =
    result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;

  if (
    (toolName === 'create_source' || toolName === 'update_source') &&
    record &&
    typeof record.id === 'string'
  ) {
    const config =
      record.config && typeof record.config === 'object'
        ? (record.config as Record<string, unknown>)
        : {};
    return [
      {
        type: 'sync_source',
        sourceId: record.id,
        values: {
          name: typeof record.name === 'string' ? record.name : '',
          ...config,
        },
        schedule: {
          enabled: Boolean(record.scheduleEnabled),
          cron:
            typeof record.scheduleCron === 'string'
              ? record.scheduleCron
              : undefined,
          timezone:
            typeof record.scheduleTimezone === 'string'
              ? record.scheduleTimezone
              : undefined,
        },
      },
      {
        type: 'show_toast',
        tone: 'success',
        title:
          toolName === 'create_source'
            ? 'Source created via MCP'
            : 'Source updated via MCP',
        description: typeof record.name === 'string' ? record.name : record.id,
      },
    ];
  }

  if (
    (toolName === 'create_custom_detector' ||
      toolName === 'update_custom_detector') &&
    record &&
    typeof record.id === 'string'
  ) {
    return [
      {
        type: 'sync_detector',
        detectorId: record.id,
        values: {
          name: typeof record.name === 'string' ? record.name : '',
          key: typeof record.key === 'string' ? record.key : '',
          description:
            typeof record.description === 'string' ? record.description : '',
          isActive:
            typeof record.isActive === 'boolean' ? record.isActive : true,
          config:
            record.config && typeof record.config === 'object'
              ? (record.config as Record<string, unknown>)
              : {},
        },
      },
      {
        type: 'show_toast',
        tone: 'success',
        title:
          toolName === 'create_custom_detector'
            ? 'Detector created via MCP'
            : 'Detector updated via MCP',
        description: typeof record.name === 'string' ? record.name : record.id,
      },
    ];
  }

  if (toolName === 'test_source_connection' && record) {
    return [
      {
        type: 'attach_result',
        kind: 'source_test',
        title: 'Source connection test',
        payload: record,
      },
    ];
  }

  if (toolName === 'train_custom_detector' && record) {
    return [
      {
        type: 'attach_result',
        kind: 'detector_train',
        title: 'Detector training run',
        payload: record,
      },
    ];
  }

  if (record) {
    return [
      {
        type: 'attach_result',
        kind: 'operation',
        title: toolName,
        payload: record,
      },
    ];
  }

  return [];
}

// ── Upload parsing helpers ───────────────────────────────────────────────────

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}
