import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import * as path from 'path';
import {
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  assistantContexts,
  assistantFieldPatchSchema,
  assistantOperationSchema,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantOperation,
  type AssistantPageContext,
  type AssistantPendingConfirmation,
  type AssistantToolCallSummary,
  type AssistantUiAction,
} from '@workspace/schemas/assistant';
import { AiClientService } from './ai';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import * as z from 'zod/v4';

const assistantDecisionSchema = z.object({
  assistantMessage: z.string().min(1),
  patches: z.array(assistantFieldPatchSchema).default([]),
  requestedOperation: assistantOperationSchema.nullable().default(null),
});

type AssistantDecision = z.infer<typeof assistantDecisionSchema>;

const assistantDecisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assistantMessage', 'patches', 'requestedOperation'],
  properties: {
    assistantMessage: {
      type: 'string',
      minLength: 1,
    },
    patches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'value'],
        properties: {
          path: {
            type: 'string',
            minLength: 1,
          },
          value: {},
        },
      },
    },
    // anyOf avoids the AJV quirk with type:["string","null"] + enum containing null
    requestedOperation: {
      anyOf: [
        { type: 'null' },
        {
          type: 'string',
          enum: [
            'create_source',
            'update_source',
            'test_source_connection',
            'create_custom_detector',
            'train_custom_detector',
          ],
        },
      ],
    },
  },
} as const;

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

@Injectable()
export class AssistantService {
  constructor(
    private readonly aiClient: AiClientService,
    private readonly mcpToolExecutor: McpToolExecutorService,
  ) {}

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

  async respond(input: unknown): Promise<AssistantChatResponse> {
    const request = assistantChatRequestSchema.parse(input);
    const latestUserMessage = getLatestUserMessage(request);

    if (request.pendingConfirmation) {
      if (confirmationRegex.test(latestUserMessage)) {
        return this.executeConfirmedOperation(request);
      }

      if (cancellationRegex.test(latestUserMessage)) {
        return assistantChatResponseSchema.parse({
          reply: `Cancelled ${formatOperationLabel(request.pendingConfirmation.operation)}.`,
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
    }

    const decision = await this.planAssistantReply(request);
    const actions: AssistantUiAction[] = [];

    if (decision.patches.length > 0) {
      actions.push({
        type: 'patch_fields',
        patches: decision.patches,
      });
    }

    const pendingConfirmation = this.buildPendingConfirmation(
      request.context,
      decision.requestedOperation,
    );

    let reply = decision.assistantMessage;

    if (decision.requestedOperation && !pendingConfirmation) {
      reply = appendSentence(
        reply,
        'I can patch the draft now, but that operation is not ready yet because the required context is incomplete.',
      );
    } else if (pendingConfirmation) {
      reply = appendSentence(
        reply,
        `Confirm to ${pendingConfirmation.detail}.`,
      );
    }

    return assistantChatResponseSchema.parse({
      reply,
      actions,
      pendingConfirmation,
      toolCalls: [],
    });
  }

  private async planAssistantReply(
    request: AssistantChatRequest,
  ): Promise<AssistantDecision> {
    const contextDefinition = assistantContexts[request.context.key];
    const messages = [
      {
        role: 'system' as const,
        content: buildSystemPrompt(contextDefinition, request.context),
      },
      {
        role: 'user' as const,
        content: buildUserMessage(request),
      },
    ];

    const decision = await this.aiClient.completeJson<AssistantDecision>(
      messages,
      assistantDecisionJsonSchema,
    );

    return assistantDecisionSchema.parse(decision.content);
  }

  private buildPendingConfirmation(
    context: AssistantPageContext,
    operation: AssistantOperation | null,
  ): AssistantPendingConfirmation | null {
    if (!operation || !context.supportedOperations.includes(operation)) {
      return null;
    }

    if (
      (operation === 'create_source' || operation === 'update_source') &&
      context.validation.missingFields.length > 0
    ) {
      return null;
    }

    if (
      (operation === 'create_custom_detector' ||
        operation === 'train_custom_detector') &&
      context.validation.errors.length > 0
    ) {
      return null;
    }

    if (
      (operation === 'update_source' ||
        operation === 'test_source_connection') &&
      !context.entityId
    ) {
      return null;
    }

    if (operation === 'train_custom_detector' && !context.entityId) {
      return null;
    }

    return {
      operation,
      title: confirmationTitle(operation),
      detail: confirmationDetail(operation, context),
    };
  }

  private async executeConfirmedOperation(
    request: AssistantChatRequest,
  ): Promise<AssistantChatResponse> {
    const operation = request.pendingConfirmation?.operation;
    if (!operation) {
      throw new BadRequestException('No pending assistant confirmation found');
    }

    const toolCalls: AssistantToolCallSummary[] = [];
    const actions: AssistantUiAction[] = [];

    switch (operation) {
      case 'create_source': {
        const args = buildCreateSourceArgs(request.context);
        const source = ensureRecord(
          await this.mcpToolExecutor.createSource(args),
          'create_source',
        );
        toolCalls.push(successToolCall('create_source', source.id));
        actions.push({
          type: 'sync_source',
          sourceId: ensureString(source.id, 'source.id'),
          values: extractSourceValues(source),
          schedule: extractSourceSchedule(source),
        });
        actions.push({
          type: 'show_toast',
          tone: 'success',
          title: 'Source created via MCP',
          description: ensureString(source.name, 'source.name'),
        });
        const fallbackReply = `Created source "${ensureString(source.name, 'source.name')}". You can keep refining the draft here or run a connection test next.`;
        const reply = await this.composePostOperationReply(
          request,
          operation,
          source,
          fallbackReply,
        );

        return assistantChatResponseSchema.parse({
          reply,
          actions,
          pendingConfirmation: null,
          toolCalls,
        });
      }
      case 'update_source': {
        const args = buildUpdateSourceArgs(request.context);
        const source = ensureRecord(
          await this.mcpToolExecutor.updateSource(args),
          'update_source',
        );
        toolCalls.push(successToolCall('update_source', source.id));
        actions.push({
          type: 'sync_source',
          sourceId: ensureString(source.id, 'source.id'),
          values: extractSourceValues(source),
          schedule: extractSourceSchedule(source),
        });
        actions.push({
          type: 'show_toast',
          tone: 'success',
          title: 'Source updated via MCP',
          description: ensureString(source.name, 'source.name'),
        });
        const fallbackReply = `Updated source "${ensureString(source.name, 'source.name')}".`;
        const reply = await this.composePostOperationReply(
          request,
          operation,
          source,
          fallbackReply,
        );

        return assistantChatResponseSchema.parse({
          reply,
          actions,
          pendingConfirmation: null,
          toolCalls,
        });
      }
      case 'test_source_connection': {
        const sourceId = request.context.entityId;
        if (!sourceId) {
          throw new BadRequestException(
            'Source connection testing requires a saved source ID',
          );
        }
        const payload = ensureRecord(
          await this.mcpToolExecutor.testSourceConnection(sourceId),
          'test_source_connection',
        );
        toolCalls.push(
          successToolCall(
            'test_source_connection',
            ensureString(payload.status ?? 'UNKNOWN', 'test status'),
          ),
        );
        actions.push({
          type: 'attach_result',
          kind: 'source_test',
          title: 'Source connection test',
          payload,
        });
        actions.push({
          type: 'show_toast',
          tone:
            toDisplayString(payload.status)?.toUpperCase() === 'SUCCESS'
              ? 'success'
              : 'info',
          title: 'Source test finished',
          description:
            typeof payload.message === 'string'
              ? payload.message
              : `Status: ${toDisplayString(payload.status) ?? 'UNKNOWN'}`,
        });

        const testStatus = toDisplayString(payload.status) ?? 'UNKNOWN';
        const fallbackReply = `Finished the source connection test with status ${testStatus}.`;
        const reply = await this.composePostOperationReply(
          request,
          operation,
          payload,
          fallbackReply,
        );
        return assistantChatResponseSchema.parse({
          reply,
          actions,
          pendingConfirmation: null,
          toolCalls,
        });
      }
      case 'create_custom_detector': {
        const args = buildCreateDetectorArgs(request.context);
        let detector: Record<string, unknown>;

        try {
          detector = ensureRecord(
            await this.mcpToolExecutor.createCustomDetector(args),
            'create_custom_detector',
          );
        } catch (error) {
          if (error instanceof ConflictException) {
            // Key already exists — auto-generate a unique suffix and retry once
            const uniqueKey = `${args.key ?? slugify(args.name)}_${randomSuffix()}`;
            detector = ensureRecord(
              await this.mcpToolExecutor.createCustomDetector({
                ...args,
                key: uniqueKey,
              }),
              'create_custom_detector (retry)',
            );
            actions.push({
              type: 'show_toast',
              tone: 'info',
              title: 'Key already existed — used unique key',
              description: uniqueKey,
            });
          } else {
            throw error;
          }
        }

        toolCalls.push(successToolCall('create_custom_detector', detector.id));
        actions.push({
          type: 'sync_detector',
          detectorId: ensureString(detector.id, 'detector.id'),
          values: extractDetectorValues(detector),
        });
        actions.push({
          type: 'show_toast',
          tone: 'success',
          title: 'Detector created via MCP',
          description: ensureString(detector.name, 'detector.name'),
        });
        const fallbackReply = `Created detector "${ensureString(
          detector.name,
          'detector.name',
        )}". You can keep editing it here or trigger training next.`;
        const reply = await this.composePostOperationReply(
          request,
          operation,
          detector,
          fallbackReply,
        );

        return assistantChatResponseSchema.parse({
          reply,
          actions,
          pendingConfirmation: null,
          toolCalls,
        });
      }
      case 'train_custom_detector': {
        const detectorId = request.context.entityId;
        if (!detectorId) {
          throw new BadRequestException(
            'Detector training requires a created detector ID',
          );
        }
        const payload = ensureRecord(
          await this.mcpToolExecutor.trainCustomDetector({
            id: detectorId,
          }),
          'train_custom_detector',
        );
        toolCalls.push(
          successToolCall(
            'train_custom_detector',
            ensureString(payload.id ?? detectorId, 'training run id'),
          ),
        );
        actions.push({
          type: 'attach_result',
          kind: 'detector_train',
          title: 'Detector training run',
          payload,
        });
        actions.push({
          type: 'show_toast',
          tone: 'success',
          title: 'Detector training started',
          description: ensureString(
            payload.status ?? 'PENDING',
            'detector training status',
          ),
        });

        const trainingStatus = toDisplayString(payload.status) ?? 'PENDING';
        const fallbackReply = `Started detector training with status ${trainingStatus}.`;
        const reply = await this.composePostOperationReply(
          request,
          operation,
          payload,
          fallbackReply,
        );
        return assistantChatResponseSchema.parse({
          reply,
          actions,
          pendingConfirmation: null,
          toolCalls,
        });
      }

      default:
        throw new BadRequestException(
          `Unsupported assistant operation: ${String(operation)}`,
        );
    }
  }

  private async composePostOperationReply(
    request: AssistantChatRequest,
    operation: AssistantOperation,
    operationResult: Record<string, unknown>,
    fallbackReply: string,
  ): Promise<string> {
    const contextDefinition = assistantContexts[request.context.key];
    const conversationText = request.messages
      .map((message) => `[${message.role}]: ${message.content}`)
      .join('\n');
    const serializedResult = safeJsonStringify(operationResult, 8000);

    try {
      const completion = await this.aiClient.completeText([
        {
          role: 'system',
          content: [
            'You are the Classifyre MCP assistant.',
            'An MCP operation was just executed successfully.',
            'Write the next assistant message for the same chat in 1-3 concise sentences.',
            'Use the MCP result to explain what happened and recommend the best next action.',
            'Do not claim that you executed any additional operation.',
            'Do not output markdown, JSON, or code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Context title: ${contextDefinition.title}`,
            `Context summary: ${contextDefinition.summary}`,
            `Operation: ${operation}`,
            'Current form values:',
            JSON.stringify(request.context.values, null, 2),
            'Conversation so far:',
            conversationText || '(empty)',
            'MCP operation response:',
            serializedResult,
          ].join('\n\n'),
        },
      ]);

      const reply = completion.content.trim();
      return reply.length > 0 ? reply : fallbackReply;
    } catch {
      return fallbackReply;
    }
  }
}

// ── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Builds the system prompt for the LLM assistant.
 * Centralised here so it's easy to iterate on without touching service logic.
 */
function buildSystemPrompt(
  contextDefinition: { title: string; summary: string },
  context: AssistantPageContext,
): string {
  const opsAllowed = context.supportedOperations.join(', ');
  const missingList =
    context.validation.missingFields.length > 0
      ? context.validation.missingFields.join(', ')
      : 'none — all required fields are populated';
  const errorList =
    context.validation.errors.length > 0
      ? context.validation.errors.join('; ')
      : 'none';

  const schemaSummary = summarizeSchemaForPrompt(context.schema);
  const schemaSection = schemaSummary
    ? [
        '',
        '## Form schema (exact field paths — patch these)',
        'Patch paths are dot-notation into the form. Use these EXACT paths and respect',
        'their types/enums. Fields marked (required) must be filled before any operation;',
        'fields marked (secret) hold credentials — set them only from explicit user input.',
        schemaSummary,
      ]
    : [];

  const isDetectorContext = context.key === 'detector.create';
  const detectorKnowledge = isDetectorContext
    ? [
        '',
        '## Detector domain knowledge',
        'There are three detector methods. Choose based on user intent:',
        '',
        'RULESET — deterministic regex/keyword matching. No training required.',
        '  Use when: the signal is a fixed pattern or keyword list.',
        '  Good for: IBANs, GDPR keyword density, "Vertraulich" markers, financial amounts.',
        '  regex_rules items MUST have exactly: { id (string), name (string), pattern (string), flags? (string, e.g. "i"), severity? ("critical"|"high"|"medium"|"low"|"info") }',
        '  keyword_rules items MUST have exactly: { id (string), name (string), keywords (string[]), case_sensitive? (boolean), severity? }',
        '  NO other properties allowed (no label, no weight, no flag_threshold — these do not exist).',
        '  Severity controls alerting, not a numeric score.',
        '  Example regex_rules: [{"id":"Ostap_mention","name":"Ostap mention","pattern":"\\\\b(Ostap|Bender|andri)\\\\b","flags":"i","severity":"medium"}]',
        '',
        'CLASSIFIER — semantic document-level label assignment. Zero-shot, fine-tunable.',
        '  Use when: you need to categorize by topic, tone, intent, or risk level.',
        '  Good for: financial advice vs. information vs. opinion, toxicity, hate speech, spam.',
        '  classifier.labels items MUST have exactly: { id (string), name (string), description? (string) }',
        '  classifier.labels is an array of OBJECTS, never plain strings.',
        '  Example labels: [{"id":"advice","name":"Financial Advice"},{"id":"information","name":"Information"},{"id":"opinion","name":"Opinion"}]',
        '  classifier.training_examples items: { text (string), label (string) }',
        '',
        'ENTITY — named span extraction (NER) via GLiNER2. Multilingual and schema-driven.',
        '  Use when: you need to extract named spans: names, IBANs, phone numbers, addresses.',
        '  entity.entity_labels is a flat array of plain strings (the label names in English).',
        '  Example: ["PersonName","IBAN","PhoneNumber","Email"]',
        '  Optional entity.entity_descriptions lets you explain labels to GLiNER2, e.g. { "IBAN": "bank account number" }.',
        '  NO "labels" field — the field is called entity_labels.',
        '  entity.model (string, default "fastino/gliner2-base-v1") is optional.',
        '',
        '## Key naming — ALWAYS derive from name, never leave as default',
        'The key must be a unique snake_case slug. Default "cust_detector" is a placeholder — ALWAYS replace it.',
        'Rule: whenever you patch "name", IMMEDIATELY also patch "key" with a slug derived from the name.',
        'Derivation: lowercase, replace spaces/special chars with underscores, prefix with method abbreviation.',
        '  "Ostap Name Mention" + RULESET  → key = "ruleset_Ostap_name_mention"',
        '  "Financial Advice Classifier"   → key = "classifier_financial_advice"',
        '  "DACH PII Entity"               → key = "entity_dach_pii"',
        '  "GDPR Keyword Ruleset"          → key = "ruleset_gdpr_keywords"',
        'The key is immutable once findings are recorded — choose it carefully.',
        '',
        '## EXACT patch paths — use these, nothing else',
        '  name                                           → string',
        '  key                                            → string (snake_case slug)',
        '  method                                         → "RULESET" | "CLASSIFIER" | "ENTITY"',
        '  config.ruleset.regex_rules                     → [{id,name,pattern,flags?,severity?}]',
        '  config.ruleset.keyword_rules                   → [{id,name,keywords:[],case_sensitive?,severity?}]',
        '  config.classifier.labels                       → [{id,name,description?}]  ← OBJECTS not strings',
        '  config.classifier.training_examples            → [{text,label}]',
        '  config.entity.entity_labels                    → ["string",...]  ← flat strings, field = entity_labels',
        '  config.entity.entity_descriptions              → {"Label":"description",...}  ← optional GLiNER2 hints',
        '  config.confidence_threshold                    → number (0–1)',
        '  config.languages                               → ["de","en",...]',
        '',
        '',
        '## Test scenarios (use proactively)',
        'You can create and run test scenarios for custom detectors to verify they work.',
        'Use list_detector_test_scenarios to check existing tests.',
        'Use create_detector_test_scenario to add a test — always add at least one positive and one negative case.',
        'Use run_detector_tests to execute all tests and show the matrix.',
        'Expected outcome format:',
        '  RULESET:    { "shouldMatch": true/false }',
        '  CLASSIFIER: { "label": "advice", "minConfidence": 0.6 }',
        '  ENTITY:     { "entities": [{ "label": "PersonName", "text": "Ostap" }] }',
        '',
        '## Validation errors — fix before creating',
        'If validationErrors is non-empty, you MUST patch the config to fix them before proposing create_custom_detector.',
        'Common errors and fixes:',
        '  "must NOT have additional properties" on regex_rules items → remove any label/weight fields, keep only id/name/pattern/flags/severity',
        '  "must be array" on ruleset.regex_rules → patch config.ruleset.regex_rules with a proper array',
        '  "must NOT have additional properties" on classifier.labels items → labels must be {id,name} objects, remove extra fields',
        '  entity_labels wrong → use config.entity.entity_labels (not config.entity.labels)',
        'Always re-check the current validationErrors list and emit corrective patches even if the user has already said "yes" or "create".',
      ]
    : [];

  return [
    'You are the Classifyre MCP assistant, embedded in a product UI.',
    'You MUST return a JSON object with exactly three fields: assistantMessage, patches, requestedOperation.',
    '',
    '## Response fields',
    '  assistantMessage   string (required) — Your conversational reply to the user.',
    '  patches            array             — Form field updates to apply immediately.',
    '                                         Each item: { "path": "dot.notation.path", "value": <any> }',
    '                                         Examples: "name", "required.host", "config.ruleset.regex_rules", "schedule.cron"',
    `  requestedOperation string|null       — Allowed values: ${opsAllowed}, null`,
    '                                         Use null (never "", never "none") when not proposing an operation.',
    '',
    '## Your workflow — follow this every turn',
    "1. INFER & PATCH: From the user's message, infer as many field values as possible and return them as patches.",
    '   CRITICAL: always patch both "name" AND "key" together. Never leave key as "cust_detector".',
    '   - "create MongoDB Atlas source"          → name="MongoDB Atlas", key="mongodb_atlas"',
    '   - "Russian letter classifier"            → name="Russian Letter Classifier", key="classifier_russian_letters", method="CLASSIFIER", config.classifier.labels=[{id:"russian",name:"Russian"},{id:"other",name:"Other"}]',
    '   - "IBAN detector"                        → name="IBAN Detector", key="entity_iban", method="ENTITY", config.entity.entity_labels=["IBAN","BIC"]',
    '   - "GDPR keyword ruleset"                 → name="GDPR Keyword Ruleset", key="ruleset_gdpr_keywords", method="RULESET", config.ruleset.keyword_rules=[{id:"gdpr_terms",name:"GDPR Terms",keywords:["Datenschutz","DSGVO","Einwilligung"],case_sensitive:false,severity:"medium"}]',
    '   - "financial advice classifier"          → name="Financial Advice Classifier", key="classifier_financial_advice", method="CLASSIFIER", config.classifier.labels=[{id:"advice",name:"Financial Advice"},{id:"information",name:"Information"},{id:"opinion",name:"Opinion"}]',
    '   - "detect Ostap or Bender"           → name="Ostap Name Mention", key="ruleset_Ostap_name_mention", method="RULESET", config.ruleset.regex_rules=[{id:"name_mention",name:"Name Mention",pattern:"\\\\b(Ostap|Bender|andri)\\\\b",flags:"i",severity:"medium"}]',
    '   - "scan every 6 hours"                   → patch schedule.enabled=true, schedule.cron="0 */6 * * *"',
    '   - Be generous — patch anything you can reasonably infer.',
    '2. GUIDE: After patching, if required fields are still missing, ask the user for them conversationally.',
    '   - Ask about 1–2 fields at a time, not a long list.',
    '   - Tell the user what you just filled in, then ask for the next piece.',
    '   - Example: "I\'ve set this up as a RULESET detector for GDPR keywords. Should I add a flag_threshold of 3 (flag when 3+ GDPR terms appear)?"',
    '3. CONFIRM: Once missing fields will be resolved by your patches (missingFields becomes empty), propose the operation.',
    '   - Only propose operations from the supportedOperations list.',
    ...schemaSection,
    ...detectorKnowledge,
    '',
    '## Fix validation before proposing an operation',
    '- If "Required fields missing" is non-empty: emit patches that set those exact paths.',
    '- If "Validation errors" is non-empty: emit corrective patches for the referenced',
    '  paths BEFORE proposing any operation.',
    '- Re-issue corrective patches every turn until both lists are empty, even if the',
    '  user already said "create"/"yes".',
    '- Only propose an operation from supportedOperations once both lists are empty.',
    '',
    '## Current page context',
    `Context: ${contextDefinition.title}`,
    `Summary: ${contextDefinition.summary}`,
    `Required fields missing right now: ${missingList}`,
    `Validation errors: ${errorList}`,
    '',
    '## Decision rule for requestedOperation',
    'Propose the operation ONLY when:',
    '  - missingFields will be empty after your patches apply, AND',
    '  - there are no validation errors.',
    'Otherwise use null and continue guiding the user.',
    'Never claim an operation already ran — only propose it for confirmation.',
  ].join('\n');
}

/**
 * Formats the user-facing portion of the prompt: current form state + conversation.
 */
function buildUserMessage(request: AssistantChatRequest): string {
  const conversationText = request.messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n');
  const metadataText = safeJsonStringify(request.context.metadata ?? {}, 10000);
  const { validation } = request.context;
  const missingText =
    validation.missingFields.length > 0
      ? validation.missingFields.join(', ')
      : 'none — all required fields are populated';
  const errorsText =
    validation.errors.length > 0 ? validation.errors.join('; ') : 'none';

  return [
    '## Current form values',
    JSON.stringify(request.context.values, null, 2),
    '',
    '## Validation snapshot',
    `isValid: ${validation.isValid}`,
    `missingFields: ${missingText}`,
    `errors: ${errorsText}`,
    '',
    '## Context metadata',
    metadataText,
    '',
    '## Conversation (latest message last)',
    conversationText,
  ].join('\n');
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

function getAssistantMetadata(
  context: AssistantPageContext,
): Record<string, unknown> {
  return context.metadata ?? {};
}

function buildCreateSourceArgs(context: AssistantPageContext) {
  const metadata = getAssistantMetadata(context);
  const sourceType = ensureString(
    metadata.sourceType,
    'context.metadata.sourceType',
  );
  const { name, ...configValues } = context.values;
  const detectors = metadata.detectors;
  const customDetectorIds = metadata.customDetectorIds;
  const schedule = ensureRecord(
    metadata.schedule ?? {},
    'context.metadata.schedule',
  );

  const config: Record<string, unknown> = {
    type: sourceType,
    ...configValues,
  };

  if (Array.isArray(detectors) && detectors.length > 0) {
    config.detectors = detectors;
  }

  if (Array.isArray(customDetectorIds) && customDetectorIds.length > 0) {
    config.custom_detectors = customDetectorIds;
  }

  return {
    type: sourceType,
    name: ensureString(name, 'context.values.name'),
    config,
    scheduleEnabled: Boolean(schedule.enabled),
    scheduleCron:
      typeof schedule.cron === 'string' && schedule.cron.length > 0
        ? schedule.cron
        : undefined,
    scheduleTimezone:
      typeof schedule.timezone === 'string' && schedule.timezone.length > 0
        ? schedule.timezone
        : undefined,
  };
}

function buildUpdateSourceArgs(context: AssistantPageContext) {
  const sourceId = ensureString(context.entityId, 'context.entityId');
  const base = buildCreateSourceArgs(context);

  return {
    id: sourceId,
    type: base.type,
    name: base.name,
    config: base.config,
    scheduleEnabled: base.scheduleEnabled,
    scheduleCron: base.scheduleCron,
    scheduleTimezone: base.scheduleTimezone,
  };
}

function buildCreateDetectorArgs(context: AssistantPageContext) {
  const metadata = getAssistantMetadata(context);
  const pipelineSchema = ensureRecord(
    metadata.pipeline_schema ?? metadata.pipelineSchema,
    'context.metadata.pipeline_schema',
  );

  return {
    name: ensureString(metadata.name, 'context.metadata.name'),
    key: ensureString(metadata.key, 'context.metadata.key'),
    description:
      typeof metadata.description === 'string' &&
      metadata.description.length > 0
        ? metadata.description
        : undefined,
    isActive: typeof metadata.isActive === 'boolean' ? metadata.isActive : true,
    pipelineSchema,
  };
}

function extractSourceValues(source: Record<string, unknown>) {
  const config = ensureRecord(source.config ?? {}, 'source.config');
  return {
    name: ensureString(source.name, 'source.name'),
    ...config,
  };
}

function extractSourceSchedule(source: Record<string, unknown>) {
  const enabled = Boolean(source.scheduleEnabled);
  return {
    enabled,
    cron:
      typeof source.scheduleCron === 'string' ? source.scheduleCron : undefined,
    timezone:
      typeof source.scheduleTimezone === 'string'
        ? source.scheduleTimezone
        : undefined,
  };
}

function extractDetectorValues(detector: Record<string, unknown>) {
  return {
    name: ensureString(detector.name, 'detector.name'),
    key: ensureString(detector.key, 'detector.key'),
    description:
      typeof detector.description === 'string' ? detector.description : '',
    method: ensureString(detector.method, 'detector.method'),
    isActive: typeof detector.isActive === 'boolean' ? detector.isActive : true,
    config: ensureRecord(detector.config ?? {}, 'detector.config'),
  };
}

function ensureRecord(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new BadRequestException(`${label} must be an object`);
}

function ensureString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  throw new BadRequestException(`${label} must be a non-empty string`);
}

function toDisplayString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function confirmationTitle(operation: AssistantOperation) {
  switch (operation) {
    case 'create_source':
      return 'Create source via MCP';
    case 'update_source':
      return 'Update source via MCP';
    case 'test_source_connection':
      return 'Test source connection via MCP';
    case 'create_custom_detector':
      return 'Create detector via MCP';
    case 'train_custom_detector':
      return 'Train detector via MCP';
    default:
      return String(operation);
  }
}

function confirmationDetail(
  operation: AssistantOperation,
  context: AssistantPageContext,
) {
  const values = context.values;
  switch (operation) {
    case 'create_source':
      return `create the source "${toDisplayString(values.name) ?? 'Untitled source'}"`;
    case 'update_source':
      return `update source ${context.entityId}`;
    case 'test_source_connection':
      return `run a connection test for source ${context.entityId}`;
    case 'create_custom_detector':
      return `create the detector "${toDisplayString(getAssistantMetadata(context).name) ?? 'Untitled detector'}"`;
    case 'train_custom_detector':
      return `start training for detector ${context.entityId}`;
  }
}

function formatOperationLabel(operation: AssistantOperation) {
  return confirmationTitle(operation).toLowerCase();
}

function appendSentence(base: string, addition: string) {
  return `${base.trim()} ${addition}`.trim();
}

function safeJsonStringify(value: unknown, maxChars: number): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length <= maxChars) {
      return json;
    }
    return `${json.slice(0, maxChars)}\n…(truncated)…`;
  } catch {
    return String(value);
  }
}

const SCHEMA_SUMMARY_MAX_DEPTH = 4;
const SCHEMA_SUMMARY_MAX_CHARS = 3000;
const SCHEMA_SUMMARY_MAX_ENUMS = 12;
const SCHEMA_SECRET_KEY_RE =
  /(mask|secret|password|token|credential|api[_-]?key)/i;

function describeSchemaType(node: Record<string, unknown>): string {
  if (Array.isArray(node.enum)) {
    const values = node.enum
      .slice(0, SCHEMA_SUMMARY_MAX_ENUMS)
      .map((value) => String(value));
    const suffix = node.enum.length > SCHEMA_SUMMARY_MAX_ENUMS ? '|…' : '';
    return `enum[${values.join('|')}${suffix}]`;
  }
  if (node.const !== undefined) {
    return `const(${JSON.stringify(node.const)})`;
  }
  if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
    return 'oneOf';
  }
  if (typeof node.type === 'string') {
    return node.type;
  }
  if (Array.isArray(node.type)) {
    return node.type.join('|');
  }
  return 'unknown';
}

/**
 * Produces a compact, token-efficient summary of an already-resolved JSON schema
 * so the LLM knows the exact dot-notation field paths, types, enums, required
 * flags, and which fields are secrets. Walks `properties` directly — the schema
 * arriving from the web app is already $ref/allOf/oneOf-resolved.
 */
export function summarizeSchemaForPrompt(
  schema: Record<string, unknown> | null | undefined,
): string {
  if (!schema || typeof schema !== 'object') {
    return '';
  }

  const lines: string[] = [];

  const walk = (
    node: Record<string, unknown>,
    pathPrefix: string,
    depth: number,
    inheritedSecret: boolean,
  ): void => {
    if (depth > SCHEMA_SUMMARY_MAX_DEPTH) {
      return;
    }

    const properties =
      node.properties && typeof node.properties === 'object'
        ? (node.properties as Record<string, unknown>)
        : null;
    if (!properties) {
      return;
    }

    const requiredKeys = new Set(
      Array.isArray(node.required) ? (node.required as string[]) : [],
    );

    for (const [key, rawChild] of Object.entries(properties)) {
      if (!rawChild || typeof rawChild !== 'object') {
        continue;
      }
      const child = rawChild as Record<string, unknown>;
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const isRequired = requiredKeys.has(key);
      const isSecret =
        inheritedSecret ||
        SCHEMA_SECRET_KEY_RE.test(key) ||
        child.format === 'password' ||
        child.writeOnly === true;

      const childType = typeof child.type === 'string' ? child.type : undefined;
      const childProps =
        child.properties && typeof child.properties === 'object'
          ? (child.properties as Record<string, unknown>)
          : null;

      // Nested object → recurse, do not emit a leaf line for the container.
      if (childType === 'object' || childProps) {
        walk(child, path, depth + 1, isSecret);
        continue;
      }

      // Array of objects → recurse into items with a [] marker.
      if (childType === 'array') {
        const items =
          child.items && typeof child.items === 'object'
            ? (child.items as Record<string, unknown>)
            : null;
        if (items && items.properties) {
          walk(items, `${path}[]`, depth + 1, isSecret);
          continue;
        }
        const itemType = items ? describeSchemaType(items) : 'any';
        lines.push(
          formatSchemaLine(
            path,
            `array<${itemType}>`,
            isRequired,
            isSecret,
            child,
          ),
        );
        continue;
      }

      lines.push(
        formatSchemaLine(
          path,
          describeSchemaType(child),
          isRequired,
          isSecret,
          child,
        ),
      );
    }
  };

  walk(schema, '', 0, false);

  if (lines.length === 0) {
    return '';
  }

  const joined = lines.join('\n');
  if (joined.length <= SCHEMA_SUMMARY_MAX_CHARS) {
    return joined;
  }
  return `${joined.slice(0, SCHEMA_SUMMARY_MAX_CHARS)}\n…(truncated)…`;
}

function formatSchemaLine(
  path: string,
  typeLabel: string,
  isRequired: boolean,
  isSecret: boolean,
  node: Record<string, unknown>,
): string {
  const flags = [isRequired ? '(required)' : '', isSecret ? '(secret)' : '']
    .filter(Boolean)
    .join(' ');
  const description =
    typeof node.description === 'string' && node.description.trim().length > 0
      ? ` — ${node.description.trim().slice(0, 120)}`
      : '';
  return `  ${path} : ${typeLabel}${flags ? ` ${flags}` : ''}${description}`;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'cust_detector'
  );
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

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

function successToolCall(
  name: string,
  detail: unknown,
): AssistantToolCallSummary {
  return {
    name,
    status: 'success',
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  };
}
