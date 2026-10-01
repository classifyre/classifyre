import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';

import * as z from 'zod';
import { AssetService } from './asset.service';
import { renderReasons } from './embedding/reason-labels';
import { CliRunnerService } from './cli-runner/cli-runner.service';
import { CustomDetectorsService } from './custom-detectors.service';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';
import { FindingsService } from './findings.service';
import { FindingBulkOperationService } from './findings-bulk/finding-bulk-operation.service';
import { RetireOutOfScopeService } from './findings-bulk/retire-out-of-scope.service';
import { MCP_CAPABILITY_GROUPS, MCP_PROMPTS } from './mcp-catalog';
import { CustomDetectorFilesService } from './custom-detector-files.service';
import { isCodeDetectorSchema } from './custom-detector-code';
import { NotebookService } from './notebook/notebook.service';
import { NotebookExecutionService } from './notebook/notebook-execution.service';
import { SourceFilesService } from './source-files.service';
import { resolveSchemaFile } from './utils/schema-path';
import {
  searchAssetsAssetFilters,
  searchAssetsFindingFilters,
  searchAssetsOptions,
  searchAssetsPage,
  searchFindingsFilters,
  searchFindingsPage,
  searchRunsFilters,
  searchRunsPage,
  searchSourcesFilters,
  searchSourcesPage,
} from './mcp-tool-schemas';
import { McpOverviewService } from './mcp-overview.service';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { SourceService } from './source.service';
import { ValidationService } from './validation.service';
import { InquiriesService } from './inquiries.service';
import { CasesService } from './cases.service';
import { CaseThreadsService } from './case-threads.service';
import { CaseActivityService } from './case-activity.service';
import { CorrelationService } from './correlation/correlation.service';
import { AgentKind, CaseActivityType, CaseThreadKind } from '@prisma/client';
import { EmbeddingService } from './embedding/embedding.service';
import { GlossaryService } from './glossary/glossary.service';
import { GlossaryRelationsService } from './glossary/glossary-relations.service';
import { GlossaryImportExportService } from './glossary/glossary-import-export.service';
import { BindingsService } from './semantic/bindings/bindings.service';
import { VocabularyService } from './semantic/vocabulary/vocabulary.service';
import { MeaningService } from './semantic/links/meaning.service';
import { GlossaryPacksService } from './semantic/packs/glossary-packs.service';
import { FindInTextService } from './semantic/find-in-text/find-in-text.service';
import { GlossaryProposalsService } from './semantic/suggestions/glossary-proposals.service';
import { SemanticSuggestionsService } from './semantic/suggestions/semantic-suggestions.service';
import { SemanticMapService } from './semantic/map/semantic-map.service';
import {
  registerSemanticMcpTools,
  type SemanticMcpServer,
} from './semantic/semantic-mcp-tools';
import { CaseLeadsService } from './case-leads.service';
import { CaseEventsService } from './case-events.service';
import { AutopilotService } from './autopilot/autopilot.service';
import { GraphService } from './graph.service';
import { CaseBoardService } from './case-board/case-board.service';
import { CaseBoardReadService } from './case-board/case-board-read.service';
import { CaseFindingFiltersService } from './cases/case-finding-filters.service';
import { CaseEscalationService } from './cases/case-escalation.service';
import { CaseCleanupService } from './cases/case-cleanup.service';
import { CaseBoardToolsService } from './case-board/case-board-tools.service';
import { TRACE_KINDS, TRACE_MAX_DEPTH } from './graph-trace';
import {
  BOARD_COLORS,
  BOARD_MAX_OPS_PER_BATCH,
  BoardOpSchema,
} from '@workspace/schemas/case-board';
import { summarizeNotebook } from './utils/notebook-summary';

const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * A JSON object, or the JSON text of one.
 *
 * Models hand a config over as a string often enough that rejecting it costs a
 * whole turn to relearn something the caller could simply have accepted. The
 * shape that reaches the tool is identical either way.
 */
const jsonObjectOrTextSchema = z.union([
  jsonObjectSchema,
  z.string().transform((text, ctx): Record<string, unknown> => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to the issue below
    }
    ctx.addIssue({
      code: 'custom',
      message: 'Expected a JSON object, or the JSON text of one.',
    });
    return z.NEVER;
  }),
]);

// Zod 4.4.x introduced a type incompatibility with @modelcontextprotocol/sdk's AnySchema.
// This adapter type uses z.ZodTypeAny (which Zod 4.4.x classic types do extend) so that
// raw shape objects can be passed to registerTool/registerPrompt without type errors.
// Tracking issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/1987
type McpZodShape = Record<string, z.ZodTypeAny>;
// Destructive tools pass a strict object so an unknown top-level key is a
// 400, never a stripped typo that widens the operation (dry_run for dryRun,
// expectedcount for expectedCount, confim for confirm). The SDK accepts a
// full schema as well as a raw shape; the args type follows whichever was
// passed.
type McpToolArgs<T> = T extends McpZodShape
  ? { [K in keyof T]: z.infer<T[K]> }
  : T extends z.ZodTypeAny
    ? z.infer<T>
    : never;
type McpServerCompat = Omit<McpServer, 'registerTool' | 'registerPrompt'> & {
  registerTool<T extends McpZodShape | z.ZodTypeAny>(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: T;
      outputSchema?: z.ZodTypeAny;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
      _meta?: Record<string, unknown>;
    },
    cb: (args: McpToolArgs<T>, extra: unknown) => unknown,
  ): unknown;
  registerPrompt<T extends McpZodShape>(
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: T;
    },
    cb: (args: { [K in keyof T]: z.infer<T[K]> }, extra: unknown) => unknown,
  ): unknown;
};

// Every tool result shares one serialized-size budget so a broad search can
// never flood the client agent's context window. Oversized payloads shrink by
// capping arrays/strings progressively, with an explicit truncation notice
// telling the agent to narrow the query instead of silently losing rows.
const MAX_RESULT_CHARS = 30_000;
const TRUNCATION_NOTICE =
  'Result truncated to fit the response budget. Narrow the query (filters, smaller take/limit, pagination cursor) to see the rest.';

function capValue(
  value: unknown,
  arrayCap: number,
  stringCap: number,
): unknown {
  if (Array.isArray(value)) {
    const capped = value
      .slice(0, arrayCap)
      .map((item) => capValue(item, arrayCap, stringCap));
    if (value.length > arrayCap) {
      capped.push(`… ${value.length - arrayCap} more items truncated`);
    }
    return capped;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        capValue(entry, arrayCap, stringCap),
      ]),
    );
  }
  if (typeof value === 'string' && value.length > stringCap) {
    return `${value.slice(0, stringCap)}…`;
  }
  return value;
}

/**
 * When a code detector is the right tool, and how to use one. Repeated in the
 * create tool's description so an agent sees it at the moment of choosing an
 * engine, not only when it happens to read a docs resource.
 */
const CODE_DETECTOR_GUIDANCE =
  'CODE_DETECTOR is a code detector: a Python notebook defining detect(asset, ctx) that yields Finding(label, value, severity=, location={row, column_name, line, ...}, fields={...}, identity=, normalized_value=). ' +
  "Choose it when the rule is a CHECK no pattern or model expresses: totals that must add up (asset.rows()), a value compared with metadata or a threshold (asset.metadata), list screening against an uploaded file (ctx.file), co-occurrence of other detectors' findings (needs_findings: true, asset.findings), checksummed identifiers, or scoring with your own model. " +
  'Prefer REGEX for a token pattern, GLINER2/LLM for meaning in prose, and TAG only when a CUSTOM connector already knows the fact. ' +
  'Rules: severity is a ceiling; give every finding a stable identity (row id, list entry) so re-runs update it instead of churning; set normalized_value only when the value should link assets in the value index; declare every key of fields; set deterministic: false if the verdict depends on anything outside the asset. ' +
  'Workflow: list_custom_detector_examples (copy a CODE_DETECTOR template and its testScenarios) -> create_custom_detector -> upload_custom_detector_file if the rule reads one -> run_custom_detector_notebook mode "preview_detect" on a real asset -> create_detector_test_scenario (input_asset fixtures) and run_detector_tests -> attach it to a source. ' +
  'Writing one needs the custom_source_code capability group.';

function jsonResult(payload: unknown) {
  let bounded = payload;
  let truncated = false;
  let text = JSON.stringify(payload, null, 2);
  for (const [arrayCap, stringCap] of [
    [100, 4000],
    [40, 2000],
    [15, 800],
    [5, 400],
  ] as const) {
    if (text.length <= MAX_RESULT_CHARS) break;
    bounded = capValue(payload, arrayCap, stringCap);
    truncated = true;
    text = JSON.stringify(bounded, null, 2);
  }
  if (text.length > MAX_RESULT_CHARS) {
    truncated = true;
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n… hard-truncated`;
  }
  if (truncated) {
    text = `NOTE: ${TRUNCATION_NOTICE}\n${text}`;
  }

  const structuredContent =
    bounded && typeof bounded === 'object' && !Array.isArray(bounded)
      ? ({
          ...(bounded as Record<string, unknown>),
          ...(truncated ? { _truncated: TRUNCATION_NOTICE } : {}),
        } as Record<string, unknown>)
      : {
          result: bounded,
          ...(truncated ? { _truncated: TRUNCATION_NOTICE } : {}),
        };

  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
    structuredContent,
  };
}

/** Turn a caught validation error into a flat list of human-readable messages. */
function errorMessageLines(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .split(/\r?\n/)
    .flatMap((line) => line.split(', '))
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeTemplateParam(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

const INVESTIGATION_GUIDE = `# Running an investigation with Classifyre

This is the intended end-to-end loop. Individual tools describe themselves; this
resource explains how they compose.

## Ground rules (from real first-use failures)
1. **Severity is not importance.** Detector severity describes the pattern that
   matched, not evidentiary value. A CRITICAL credit-card hit on repeated digits
   is usually OCR noise. Rank and triage by \`ranking.importance\` and its
   \`reasons\`, never by severity alone.
2. **Similarity is not proof.** Semantic neighbours and duplicate clusters are
   retrieval aids. Before claiming a connection, verify against the source text
   (get_asset / get_finding context).
3. **Coverage before conclusions.** A source with empty text extraction looks
   healthy while missing content. Check run text coverage (get_run) before
   concluding "nothing found".
4. **Unverified memory is a hypothesis.** Agent-written summaries and profiles
   must be re-checked against live state before being treated as fact.

## The loop
1. **Survey coverage** — search_sources, get_run / get_run_logs: did scans
   complete, and did text extraction actually produce text (textCoverage)?
2. **Triage ranked evidence** — search_findings with ranking=importance (the
   default): read each row's ranking.reasons. Strong: cross_document_recurrence,
   readable unique evidence. Weak: ocr_fragment, duplicate_group, common_value.
   Use find_boilerplate_clusters per source to identify repeated noise wholesale,
   and explain_finding on anything you intend to act on.
3. **Explore hypotheses** — search_findings with semantic_query (hybrid mode)
   for meaning-based retrieval; find_similar_findings to expand a confirmed lead
   across sources; get_value_occurrences for exact value recurrence.
4. **Monitor with inquiries** — create_inquiry with matchers for the evidence
   class you care about; list_inquiry_matches to review; rematch_inquiry after
   new scans. Archive noisy inquiries instead of letting them accumulate matches.
5. **Build a case** — create_case (or pull_case_from_inquiry), attach verified
   findings (attach_case_findings), add evidence and hypotheses as threads
   (create_case_thread), and link support/contradiction per thread entry
   (link_case_thread_support); set a hypothesis's verdict and confidence
   with update_case_thread. The timeline (get_case_timeline) shows history.
   The board is where analysts arrange the case: read it with get_case_board
   (a labelled summary), change it with apply_case_board_ops (notes, frames,
   links between findings, stances on hypothesis cards), give new items a
   spot with place_case_board_items, group them with frame_case_board_items,
   and see what the evidence connects to beyond the board with
   trace_case_connections. Keep noise out with finding filters
   (preview_case_finding_filters, then add_case_finding_filters) and let the
   case clean itself up (preview_case_cleanup, then update_case).
6. **Conclude honestly** — close_case with a conclusion the evidence actually
   supports. An empty or speculative case should be closed as such, not
   escalated.
`;

@Injectable()
export class McpServerFactoryService {
  constructor(
    private readonly sourceService: SourceService,
    private readonly customDetectorsService: CustomDetectorsService,
    private readonly customDetectorExtractionsService: CustomDetectorExtractionsService,
    private readonly cliRunnerService: CliRunnerService,
    private readonly schedulerService: SchedulerService,
    private readonly findingsService: FindingsService,
    private readonly assetService: AssetService,
    private readonly mcpOverviewService: McpOverviewService,
    private readonly mcpToolExecutor: McpToolExecutorService,
    private readonly validationService: ValidationService,
    private readonly inquiriesService: InquiriesService,
    private readonly casesService: CasesService,
    private readonly caseThreadsService: CaseThreadsService,
    private readonly caseActivityService: CaseActivityService,
    private readonly correlationService: CorrelationService,
    private readonly embeddingService: EmbeddingService,
    private readonly glossaryService: GlossaryService,
    private readonly caseLeadsService: CaseLeadsService,
    private readonly caseEventsService: CaseEventsService,
    private readonly autopilotService: AutopilotService,
    private readonly notebookService: NotebookService,
    private readonly notebookExecutionService: NotebookExecutionService,
    private readonly sourceFilesService: SourceFilesService,
    private readonly graphService: GraphService,
    private readonly findingBulkOperations: FindingBulkOperationService,
    private readonly retireOutOfScope: RetireOutOfScopeService,
    private readonly caseBoardService: CaseBoardService,
    private readonly caseBoardRead: CaseBoardReadService,
    private readonly caseFindingFilters: CaseFindingFiltersService,
    private readonly caseEscalation: CaseEscalationService,
    private readonly caseCleanup: CaseCleanupService,
    private readonly caseBoardTools: CaseBoardToolsService,
    private readonly customDetectorFiles: CustomDetectorFilesService,
    private readonly glossaryRelations: GlossaryRelationsService,
    private readonly glossaryTransfer: GlossaryImportExportService,
    private readonly bindingsService: BindingsService,
    private readonly vocabularyService: VocabularyService,
    private readonly meaningService: MeaningService,
    private readonly glossaryPacks: GlossaryPacksService,
    private readonly findInText: FindInTextService,
    private readonly glossaryProposals: GlossaryProposalsService,
    private readonly semanticSuggestions: SemanticSuggestionsService,
    private readonly semanticMap: SemanticMapService,
  ) {}

  /**
   * Build the MCP server. `toolGroupIds` restricts which tools an authorized
   * token can see/call: null (the default) is unrestricted, an array is an
   * explicit allowlist of {@link MCP_CAPABILITY_GROUPS} ids.
   *
   * Every tool is still registered either way -- restricting is a post-pass
   * that disables the disallowed ones -- so {@link McpToolsCatalogService},
   * which introspects an unrestricted server for the settings UI, and this
   * enforcement path read the exact same name<->group mapping and can never
   * drift apart.
   */
  createServer(options?: { toolGroupIds?: string[] | null }): McpServer {
    const server = new McpServer({
      name: 'classifyre-mcp',
      version: '1.0.0',
    });

    const srv = server as unknown as McpServerCompat;
    this.registerResources(srv);
    this.registerPrompts(srv);
    this.registerSourceTools(srv);
    this.registerNotebookTools(srv);
    this.registerLineageTools(srv);
    this.registerCustomDetectorTools(srv, options?.toolGroupIds ?? null);
    this.registerExtractionTools(srv);
    this.registerRunTools(srv);
    this.registerFindingTools(srv);
    this.registerAssetTools(srv);
    this.registerInquiryTools(srv);
    this.registerCaseTools(srv);
    this.registerCaseBoardTools(srv);
    this.registerCorrelationTools(srv);
    this.registerGlossaryTools(srv);
    this.registerCaseLeadTools(srv);
    this.registerAutopilotTools(srv);

    if (options?.toolGroupIds) {
      this.restrictToGroups(server, options.toolGroupIds);
    }

    return server;
  }

  /** Disable every registered tool that is not in an allowed group. Fails
   * closed: a tool with no group is disabled like any other disallowed tool,
   * not left always-visible, because every tool is expected to carry a group
   * (enforced by a spec that diffs MCP_CAPABILITY_GROUPS against the live
   * registry) -- a scoped token must never see a tool that slipped through
   * ungrouped. */
  private restrictToGroups(server: McpServer, allowedGroupIds: string[]): void {
    const allowed = new Set<string>();
    for (const group of MCP_CAPABILITY_GROUPS) {
      if (allowedGroupIds.includes(group.id)) {
        for (const toolName of group.toolNames) {
          allowed.add(toolName);
        }
      }
    }

    const registered = (
      server as unknown as {
        _registeredTools: Record<string, { disable(): void }>;
      }
    )._registeredTools;

    for (const [name, tool] of Object.entries(registered)) {
      if (!allowed.has(name)) {
        tool.disable();
      }
    }
  }

  private registerAutopilotTools(server: McpServerCompat) {
    const agentKinds = Object.values(AgentKind) as [string, ...string[]];
    const toggleableKinds = [
      'INQUIRY',
      'CASE',
      'CONFIG',
      'DETECTOR_AUTHOR',
      'ESCALATION',
    ] as [string, ...string[]];

    server.registerTool(
      'list_autopilot_agents',
      {
        title: 'List Autopilot Agents',
        description:
          'List every AI-autopilot agent with its configuration: kind, whether it is ' +
          'enabled for scan cycles, its goal (default + any override), iteration budget, ' +
          'and assigned tools. INQUIRY/CASE/CONFIG/DETECTOR_AUTHOR/ESCALATION are ' +
          'toggleable; DUPLICATES (deterministic fingerprinting) and DREAM (scheduled ' +
          'memory consolidation) always run and cannot be toggled.',
        inputSchema: {},
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => jsonResult(await this.autopilotService.getAgents()),
    );

    server.registerTool(
      'update_autopilot_agent',
      {
        title: 'Update Autopilot Agent',
        description:
          'Enable/disable an autopilot agent for scan cycles, or override its goal or ' +
          'iteration budget. Only INQUIRY, CASE, CONFIG, DETECTOR_AUTHOR and ESCALATION ' +
          'accept enable/disable. Pass goal: null or max_iterations: null to reset to ' +
          'the factory default.',
        inputSchema: {
          kind: z.enum(toggleableKinds).describe('Agent kind to update'),
          enabled: z
            .boolean()
            .optional()
            .describe('Enable or disable the agent on scan cycles'),
          goal: z
            .string()
            .nullable()
            .optional()
            .describe('Goal override; null resets to the factory default'),
          max_iterations: z
            .number()
            .int()
            .min(1)
            .max(50)
            .nullable()
            .optional()
            .describe(
              'Iteration budget override (1-50); null resets to default',
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ kind, enabled, goal, max_iterations }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.autopilotService.updateAgent(kind as AgentKind, {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(goal !== undefined ? { goal } : {}),
            ...(max_iterations !== undefined
              ? { maxIterations: max_iterations }
              : {}),
          }),
        );
      },
    );

    server.registerTool(
      'list_autopilot_runs',
      {
        title: 'List Autopilot Runs',
        description:
          'List AI-autopilot agent runs (newest first) with status, trigger, summary ' +
          'and error. Filter by agent kind, source, case, status, trigger origin ' +
          '(scan_completed | manual | schedule), free-text search, or time window.',
        inputSchema: {
          agent_kind: z.enum(agentKinds).optional(),
          source_id: z
            .string()
            .optional()
            .describe('Only runs for this source'),
          case_id: z
            .string()
            .optional()
            .describe('Only runs focused on this case'),
          status: z
            .enum([
              'PENDING',
              'RUNNING',
              'COMPLETED',
              'FAILED',
              'SKIPPED',
              'CANCELLED',
            ])
            .optional(),
          trigger: z
            .string()
            .optional()
            .describe('scan_completed | manual | schedule'),
          search: z
            .string()
            .optional()
            .describe('Substring search over summary, instruction and error'),
          since: z.string().optional().describe('ISO time lower bound'),
          until: z.string().optional().describe('ISO time upper bound'),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) =>
        jsonResult(
          await this.autopilotService.listRuns({
            agentKind: args.agent_kind as AgentKind | undefined,
            sourceId: args.source_id,
            caseId: args.case_id,
            status: args.status as any,
            trigger: args.trigger,
            search: args.search,
            since: args.since,
            until: args.until,
            skip: args.skip ?? 0,
            limit: args.limit ?? 50,
          }),
        ),
    );

    server.registerTool(
      'get_autopilot_run',
      {
        title: 'Get Autopilot Run',
        description:
          'Full detail of one autopilot agent run, including every decision it made ' +
          '(action, outcome, target entity, rationale, payload).',
        inputSchema: {
          id: z.string().describe('Agent run ID'),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ id }) => jsonResult(await this.autopilotService.getRun(id)),
    );

    server.registerTool(
      'get_autopilot_run_logs',
      {
        title: 'Get Autopilot Run Logs',
        description:
          'Step-by-step logs of one autopilot run. channel BUSINESS is the analyst ' +
          'narrative; TECHNICAL includes mechanics and raw model I/O.',
        inputSchema: {
          run_id: z.string().describe('Agent run ID'),
          channel: z.enum(['BUSINESS', 'TECHNICAL']).optional(),
          level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
          search: z
            .string()
            .optional()
            .describe('Substring search over the message'),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ run_id, channel, level, search }) =>
        jsonResult(
          await this.autopilotService.listLogs(run_id, {
            channel: channel as any,
            level: level as any,
            search,
          }),
        ),
    );

    server.registerTool(
      'list_autopilot_activity',
      {
        title: 'List Autopilot Activity',
        description:
          'Cross-run timeline of autopilot decisions (what each agent did, to which ' +
          'entity, with what outcome and rationale). This is the audit surface for ' +
          '"what did the AI change?" — filter by agent kind, action, outcome, entity ' +
          'type (inquiry | case | source | detector | memory | system | asset), ' +
          'rationale search, or time window.',
        inputSchema: {
          agent_kind: z.enum(agentKinds).optional(),
          entity_type: z
            .string()
            .optional()
            .describe(
              'inquiry | case | source | detector | memory | system | asset',
            ),
          search: z
            .string()
            .optional()
            .describe('Substring search over the rationale'),
          since: z.string().optional().describe('ISO time lower bound'),
          until: z.string().optional().describe('ISO time upper bound'),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) =>
        jsonResult(
          await this.autopilotService.listActivity({
            agentKind: args.agent_kind as AgentKind | undefined,
            entityType: args.entity_type,
            search: args.search,
            since: args.since,
            until: args.until,
            skip: args.skip ?? 0,
            limit: args.limit ?? 50,
          }),
        ),
    );

    server.registerTool(
      'list_autopilot_memory',
      {
        title: 'List Autopilot Memory',
        description:
          "List the autopilot agents' persistent memory entries (glossary terms, " +
          'decision precedents, source profiles, detector lessons). Higher weight = ' +
          'recalled first.',
        inputSchema: {
          search: z
            .string()
            .optional()
            .describe('Substring search over key and content'),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) =>
        jsonResult(
          await this.autopilotService.listMemory({
            search: args.search,
            skip: args.skip ?? 0,
            limit: args.limit ?? 50,
          }),
        ),
    );

    server.registerTool(
      'get_autopilot_stats',
      {
        title: 'Get Autopilot Stats',
        description:
          'Aggregate autopilot health: runs by status and agent kind, recent ' +
          'failures, decision counts.',
        inputSchema: {},
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => jsonResult(await this.autopilotService.getStats()),
    );

    server.registerTool(
      'trigger_autopilot',
      {
        title: 'Trigger Autopilot',
        description:
          'Manually enqueue an autopilot cycle. Pipeline agents (INQUIRY, CASE, ' +
          'CONFIG, DETECTOR_AUTHOR, ESCALATION) run in canonical order; pass ' +
          'agent_kinds to run a subset, source_id to focus on one source, case_id to ' +
          'focus the CASE agent on one case, and instruction to steer the cycle.',
        inputSchema: {
          instruction: z
            .string()
            .max(4000)
            .optional()
            .describe('Highest-priority steering prompt for this cycle'),
          source_id: z
            .string()
            .optional()
            .describe('Limit the review to one source; omit for all sources'),
          agent_kinds: z
            .array(z.enum(agentKinds))
            .optional()
            .describe('Which agents to run; omit for the full pipeline'),
          case_id: z
            .string()
            .optional()
            .describe('Focus the CASE agent on one case'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ instruction, source_id, agent_kinds, case_id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.autopilotService.trigger({
            instruction,
            sourceId: source_id,
            agentKinds: agent_kinds as AgentKind[] | undefined,
            caseId: case_id,
          }),
        );
      },
    );

    server.registerTool(
      'cancel_autopilot_run',
      {
        title: 'Cancel Autopilot Run',
        description:
          'Cancel a pending or running autopilot agent run. The runtime aborts ' +
          'before its next step.',
        inputSchema: {
          id: z.string().describe('Agent run ID to cancel'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.autopilotService.cancelRun(id));
      },
    );
  }

  private registerCaseLeadTools(server: McpServerCompat) {
    server.registerTool(
      'list_case_leads',
      {
        title: 'List Case Leads',
        description:
          "List a case's lead queue: ranked candidates awaiting accept/dismiss review, plus reviewed history. Origins: SEMANTIC_NEIGHBOR (similar to evidence; details.sameValue when it is the very same value), INQUIRY (important answer of a linked watch), DUPLICATE (a look-alike document from the duplicates engine — an ASSET lead with findingId null), AUTOPILOT, MANUAL. Each lead names what it hangs off (viaFindingId / viaAssetId / viaInquiryId, viaLabel) and where it is (assetName, sourceName). For PROPOSED leads, state OPEN waits for review; IN_CASE and GONE are settled by the next refresh.",
        inputSchema: {
          caseId: z.string().uuid(),
          status: z.enum(['PROPOSED', 'ACCEPTED', 'DISMISSED']).optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ caseId, status }) =>
        jsonResult(await this.caseLeadsService.list(caseId, status)),
    );

    server.registerTool(
      'propose_case_lead',
      {
        title: 'Propose Case Lead',
        description:
          'Propose a finding as a lead for a case (instead of attaching it as evidence directly). Leads are reviewed by a human; a dismissed lead is never re-proposed.',
        inputSchema: {
          caseId: z.string().uuid(),
          findingId: z.string().uuid(),
          rationale: z.string().min(1).max(2000),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ caseId, findingId, rationale }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseLeadsService.propose(caseId, {
            findingId,
            rationale,
            origin: 'MANUAL',
            proposedBy: 'mcp',
          }),
        );
      },
    );

    server.registerTool(
      'generate_case_leads',
      {
        title: 'Generate Case Leads',
        description:
          'Refresh leads for a case now from its own evidence: findings similar to it, high-importance answers of its linked watches, and look-alike documents the duplicates engine pairs with its evidence (pairs rejected or split in Duplicate review are never suggested). The case also refreshes its leads by itself whenever its evidence or watches change, so this is only needed for an immediate refresh. Bounded (per-kind quotas, at most 60 waiting) and idempotent (existing/dismissed leads are skipped).',
        inputSchema: { caseId: z.string().uuid() },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ caseId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.caseLeadsService.generate(caseId, 'mcp'));
      },
    );

    server.registerTool(
      'review_case_lead',
      {
        title: 'Review Case Lead',
        description:
          'Accept a lead into case evidence (a finding lead attaches its finding; an asset lead adds the document) or dismiss it. Dismissals are remembered as precedents so agents stop re-proposing the finding or document.',
        inputSchema: {
          caseId: z.string().uuid(),
          leadId: z.string().uuid(),
          action: z.enum(['ACCEPT', 'DISMISS']),
          reason: z.string().max(1000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ caseId, leadId, action, reason }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseLeadsService.review(
            caseId,
            leadId,
            action,
            'mcp',
            reason,
          ),
        );
      },
    );

    server.registerTool(
      'list_case_events',
      {
        title: 'List Case Events',
        description:
          'List the case chronology: dated real-world events reconstructed from evidence, ordered by date. Distinct from get_case_timeline (the app activity/audit log).',
        inputSchema: { caseId: z.string().uuid() },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ caseId }) =>
        jsonResult(await this.caseEventsService.list(caseId)),
    );

    server.registerTool(
      'create_case_event',
      {
        title: 'Create Case Event',
        description:
          'Add a dated real-world event to the case chronology. Cite the findingIds/evidenceIds the date came from; unsupported dates do not belong in a chronology.',
        inputSchema: {
          caseId: z.string().uuid(),
          occurredAt: z.string().describe('ISO date or datetime'),
          precision: z.enum(['DAY', 'MONTH', 'YEAR']).optional(),
          title: z.string().min(1).max(300),
          description: z.string().max(4000).optional(),
          confidence: z.number().min(0).max(1).optional(),
          findingIds: z.array(z.string()).optional(),
          evidenceIds: z.array(z.string()).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ caseId, occurredAt, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const when = new Date(occurredAt);
        if (Number.isNaN(when.getTime())) {
          throw new NotFoundException(`Invalid occurredAt: ${occurredAt}`);
        }
        return jsonResult(
          await this.caseEventsService.create(
            caseId,
            { ...rest, occurredAt: when },
            'mcp',
            'OPERATOR',
          ),
        );
      },
    );

    server.registerTool(
      'delete_case_event',
      {
        title: 'Delete Case Event',
        description: 'Remove an event from the case chronology.',
        inputSchema: z.strictObject({
          caseId: z.string().uuid(),
          eventId: z.string().uuid(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ caseId, eventId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseEventsService.remove(caseId, eventId, 'mcp'),
        );
      },
    );
  }

  private registerGlossaryTools(server: McpServerCompat) {
    registerSemanticMcpTools(
      server as unknown as SemanticMcpServer,
      {
        glossary: this.glossaryService,
        relations: this.glossaryRelations,
        transfer: this.glossaryTransfer,
        bindings: this.bindingsService,
        vocabulary: this.vocabularyService,
        meaning: this.meaningService,
        packs: this.glossaryPacks,
        findInText: this.findInText,
        proposals: this.glossaryProposals,
        suggestions: this.semanticSuggestions,
        map: this.semanticMap,
      },
      {
        json: jsonResult,
        assertNotDemoMode: () => this.mcpToolExecutor.assertNotDemoMode(),
      },
    );
  }

  private registerResources(server: McpServerCompat) {
    server.registerResource(
      'classifyre-overview',
      'classifyre://overview',
      {
        title: 'Classifyre MCP Overview',
        description: 'Capabilities, prompts, and connection guidance.',
        mimeType: 'application/json',
      },
      () => ({
        contents: [
          {
            uri: 'classifyre://overview',
            text: JSON.stringify(
              this.mcpOverviewService.getOverview(),
              null,
              2,
            ),
          },
        ],
      }),
    );

    server.registerResource(
      'classifyre-investigation-guide',
      'classifyre://investigation-guide',
      {
        title: 'How to run an investigation with Classifyre',
        description:
          'End-to-end workflow narrative for agents: coverage → ranked findings → inquiries → cases → threads → conclusion, with the evidence-judgment ground rules.',
        mimeType: 'text/markdown',
      },
      () => ({
        contents: [
          {
            uri: 'classifyre://investigation-guide',
            text: INVESTIGATION_GUIDE,
          },
        ],
      }),
    );

    server.registerResource(
      'classifyre-capability-group',
      new ResourceTemplate('classifyre://capabilities/{groupId}', {
        list: () => ({
          resources: MCP_CAPABILITY_GROUPS.map((group) => ({
            uri: `classifyre://capabilities/${group.id}`,
            name: group.title,
          })),
        }),
      }),
      {
        title: 'Classifyre MCP Capability Group',
        description: 'Detailed MCP capability grouping for a single domain.',
        mimeType: 'application/json',
      },
      (_uri, { groupId }) => {
        const normalizedGroupId = normalizeTemplateParam(groupId);
        const group = MCP_CAPABILITY_GROUPS.find(
          (entry) => entry.id === normalizedGroupId,
        );
        if (!group) {
          throw new NotFoundException(
            `Unknown capability group: ${normalizedGroupId}`,
          );
        }

        return {
          contents: [
            {
              uri: `classifyre://capabilities/${group.id}`,
              text: JSON.stringify(group, null, 2),
            },
          ],
        };
      },
    );
  }

  private registerPrompts(server: McpServerCompat) {
    server.registerPrompt(
      MCP_PROMPTS[0].name,
      {
        title: MCP_PROMPTS[0].title,
        description: MCP_PROMPTS[0].description,
        argsSchema: {
          useCase: z.string(),
          dataExamples: z.string().optional(),
        },
      },
      ({ useCase, dataExamples }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Design a Classifyre GLiNER2 pipeline detector for this use case: ${useCase}.\n` +
                `The detector uses a unified GLiNER2 pipeline schema with three optional sections:\n` +
                `- entities: named entities to extract (label → {description, required})\n` +
                `- classification: zero-shot tasks (task → {labels, multi_label})\n` +
                `- validation: post-processing rules (confidence_threshold, regex rules)\n` +
                `Return a complete pipeline_schema JSON and follow-up MCP tool calls to create the detector.\n` +
                (dataExamples
                  ? `Relevant examples or patterns:\n${dataExamples}\n`
                  : ''),
            },
          },
        ],
      }),
    );
  }

  private registerSourceTools(server: McpServerCompat) {
    server.registerTool(
      'list_source_types',
      {
        title: 'List Source Types',
        description:
          'List every source type that can be created (type id + label). Call this before create_source when unsure of the exact type id.',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      () => jsonResult(this.validationService.listSourceTypes()),
    );

    server.registerTool(
      'get_source_schema',
      {
        title: 'Get Source Config Schema',
        description:
          'The full JSON Schema for one source type config — exact field names, required/masked/optional sections, defaults and enums. Call this before create_source/update_source and build the config to match.',
        inputSchema: {
          type: z
            .string()
            .describe('Source type id from list_source_types, e.g. POSTGRESQL'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      ({ type }) =>
        jsonResult(this.validationService.getSourceTypeSchema(type)),
    );

    server.registerTool(
      'search_sources',
      {
        title: 'Search Sources',
        description: 'Search and filter sources with latest runner summaries.',
        inputSchema: {
          filters: searchSourcesFilters.optional(),
          page: searchSourcesPage.optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ filters, page }) =>
        jsonResult(
          await this.sourceService.searchSources({
            filters: filters,
            page: page,
          } as any),
        ),
    );

    server.registerTool(
      'get_source',
      {
        title: 'Get Source',
        description:
          "Fetch a single source by ID. A CUSTOM source's notebook cells are " +
          'summarised rather than inlined — the whole connector program would ' +
          'otherwise land in context on every read. Pass include_notebook when ' +
          'you actually need the code, or use get_notebook.',
        inputSchema: {
          id: z.string().uuid(),
          include_notebook: z
            .boolean()
            .optional()
            .describe(
              'Inline the notebook cells instead of just { revision, cellCount }',
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, include_notebook }) => {
        const source = await this.sourceService.source({ id });
        if (!source) {
          throw new NotFoundException(`Source with ID ${id} not found`);
        }
        return jsonResult(
          include_notebook === true ? source : summarizeNotebook(source),
        );
      },
    );

    server.registerTool(
      'create_source',
      {
        title: 'Create Source',
        description:
          'Create a new source after validating the config against the source JSON Schema.',
        inputSchema: {
          type: z.string(),
          name: z.string().min(1).max(255).optional(),
          config: jsonObjectSchema,
          scheduleEnabled: z.boolean().optional(),
          scheduleCron: z.string().optional(),
          scheduleTimezone: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async ({
        type,
        name,
        config,
        scheduleEnabled,
        scheduleCron,
        scheduleTimezone,
      }) =>
        jsonResult(
          await this.mcpToolExecutor.createSource({
            type,
            name,
            config,
            scheduleEnabled,
            scheduleCron,
            scheduleTimezone,
          }),
        ),
    );

    server.registerTool(
      'update_source',
      {
        title: 'Update Source',
        description:
          'Update a source and optionally its schedule. Source configs are revalidated before save.',
        inputSchema: {
          id: z.string().uuid(),
          type: z.string().optional(),
          name: z.string().min(1).max(255).optional(),
          config: jsonObjectSchema.optional(),
          scheduleEnabled: z.boolean().optional(),
          scheduleCron: z.string().optional(),
          scheduleTimezone: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({
        id,
        type,
        name,
        config,
        scheduleEnabled,
        scheduleCron,
        scheduleTimezone,
      }) =>
        jsonResult(
          await this.mcpToolExecutor.updateSource({
            id,
            type,
            name,
            config,
            scheduleEnabled,
            scheduleCron,
            scheduleTimezone,
          }),
        ),
    );

    server.registerTool(
      'delete_source',
      {
        title: 'Delete Source',
        description: 'Delete a source and its associated schedules and data.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        await this.requireSource(id);
        await this.schedulerService.removeSchedule(id);
        await this.sourceService.deleteSource({ id });
        return jsonResult({ deleted: true, sourceId: id });
      },
    );

    server.registerTool(
      'test_source_connection',
      {
        title: 'Test Source Connection',
        description: 'Run a lightweight connectivity test for a source.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
        },
      },
      async ({ id }) =>
        jsonResult(await this.mcpToolExecutor.testSourceConnection(id)),
    );

    server.registerTool(
      'start_source_run',
      {
        title: 'Start Source Run',
        description: 'Trigger a new ingestion run for a source.',
        inputSchema: {
          sourceId: z.string().uuid(),
          triggerType: z
            .enum(['MANUAL', 'SCHEDULED', 'WEBHOOK', 'API'])
            .optional(),
          triggeredBy: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ sourceId, triggerType, triggeredBy }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.cliRunnerService.startRun(
            sourceId,
            triggerType,
            triggeredBy,
          ),
        );
      },
    );

    server.registerTool(
      'validate_source_config',
      {
        title: 'Validate Source Config',
        description:
          'Dry-run validate a source config against its JSON Schema without creating anything. Returns normalized config on success or a list of validation errors on failure.',
        inputSchema: {
          type: z.string(),
          config: jsonObjectOrTextSchema,
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      ({ type, config }) => {
        try {
          // `name`, `description` and the detector selection travel with the
          // form the caller copied this from, but they are not part of a source
          // *config* and the schema forbids unknown keys. Dropping them here
          // turns a confusing "must NOT have additional properties" into a
          // validation that answers the question actually being asked.
          const { name, description, ...configFields } = config;
          void name;
          void description;
          const normalizedConfig = this.validationService.validate(
            type,
            configFields,
          );
          return jsonResult({ valid: true, normalizedConfig });
        } catch (error) {
          return jsonResult({
            valid: false,
            errors: errorMessageLines(error),
          });
        }
      },
    );
  }

  /**
   * The Python notebook behind a CUSTOM source: cells, packages, local
   * folders, and uploaded files live in `source.config` (cells under
   * `required.notebook`, packages/local_folders under `optional`), so cell
   * edits go through {@link NotebookService} while packages/folders go
   * through the generic source-config path ({@link McpToolExecutorService}),
   * which re-validates the whole config against the CUSTOM JSON Schema.
   */
  private registerNotebookTools(server: McpServerCompat) {
    // Which notebook a tool addresses. Defaults to `connector` so every
    // existing call keeps its meaning; `augmentation` addresses the per-asset
    // enrichment notebook any source type may carry.
    const scopeSchema = z
      .enum(['connector', 'augmentation'])
      .default('connector')
      .describe(
        'Which notebook: the CUSTOM source’s connector notebook, or the per-asset augmentation notebook.',
      );
    server.registerTool(
      'get_notebook',
      {
        title: 'Get Notebook',
        description:
          'Read a source’s notebook: cells, revision, variables, secret keys, packages, and local folders.',
        inputSchema: {
          sourceId: z.string().uuid(),
          scope: scopeSchema,
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceId, scope = 'connector' }) => {
        const notebook = await this.notebookService.get(sourceId, scope);
        const section = await this.notebookConfigSection(sourceId, scope);
        return jsonResult({
          ...notebook,
          packages: section.packages ?? [],
          localFolders: section.local_folders ?? [],
        });
      },
    );

    server.registerTool(
      'add_notebook_cell',
      {
        title: 'Add Notebook Cell',
        description:
          'Insert a new cell into a notebook. Appended at the end unless afterCellId is given.',
        inputSchema: {
          sourceId: z.string().uuid(),
          scope: scopeSchema,
          baseRevision: z.number().int().min(1),
          cellId: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,64}$/)
            .optional()
            .describe('Defaults to a generated id if omitted.'),
          type: z.enum(['code', 'markdown']).default('code'),
          source: z.string(),
          afterCellId: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({
        sourceId,
        scope = 'connector',
        baseRevision,
        cellId,
        type,
        source,
        afterCellId,
      }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const notebook = await this.notebookService.get(sourceId, scope);
        const newCell = {
          id: cellId ?? `cell-${Date.now().toString(36)}`,
          type,
          source,
        };
        if (notebook.cells.some((cell) => cell.id === newCell.id)) {
          throw new BadRequestException(
            `Cell id '${newCell.id}' already exists.`,
          );
        }
        const cells = [...notebook.cells];
        const insertAt = afterCellId
          ? cells.findIndex((cell) => cell.id === afterCellId) + 1
          : cells.length;
        if (afterCellId && insertAt === 0) {
          throw new NotFoundException(
            `No cell with id '${afterCellId}' to insert after.`,
          );
        }
        cells.splice(insertAt, 0, newCell);
        const result = await this.notebookService.update(
          sourceId,
          {
            baseRevision,
            cells,
          },
          scope,
        );
        return jsonResult({ ...result, cellId: newCell.id });
      },
    );

    server.registerTool(
      'update_notebook_cell',
      {
        title: 'Update Notebook Cell',
        description: 'Replace one cell’s source (and optionally its type).',
        inputSchema: {
          sourceId: z.string().uuid(),
          scope: scopeSchema,
          baseRevision: z.number().int().min(1),
          cellId: z.string(),
          source: z.string(),
          type: z.enum(['code', 'markdown']).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({
        sourceId,
        scope = 'connector',
        baseRevision,
        cellId,
        source,
        type,
      }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const notebook = await this.notebookService.get(sourceId, scope);
        const index = notebook.cells.findIndex((cell) => cell.id === cellId);
        if (index === -1) {
          throw new NotFoundException(`No cell with id '${cellId}'.`);
        }
        const cells = [...notebook.cells];
        cells[index] = { ...cells[index], source, ...(type ? { type } : {}) };
        const result = await this.notebookService.update(
          sourceId,
          {
            baseRevision,
            cells,
          },
          scope,
        );
        return jsonResult(result);
      },
    );

    server.registerTool(
      'delete_notebook_cell',
      {
        title: 'Delete Notebook Cell',
        description: 'Remove one cell from a notebook.',
        inputSchema: z.strictObject({
          sourceId: z.string().uuid(),
          scope: scopeSchema,
          baseRevision: z.number().int().min(1),
          cellId: z.string(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ sourceId, scope = 'connector', baseRevision, cellId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const notebook = await this.notebookService.get(sourceId, scope);
        if (!notebook.cells.some((cell) => cell.id === cellId)) {
          throw new NotFoundException(`No cell with id '${cellId}'.`);
        }
        const cells = notebook.cells.filter((cell) => cell.id !== cellId);
        const result = await this.notebookService.update(
          sourceId,
          {
            baseRevision,
            cells,
          },
          scope,
        );
        return jsonResult(result);
      },
    );

    server.registerTool(
      'set_notebook_packages',
      {
        title: 'Set Notebook Packages',
        description:
          'Replace the Python packages installed into the notebook’s run environment before any cell executes. Call list_notebook_runtime_packages first — the base image’s own dependencies do not need listing.',
        inputSchema: {
          sourceId: z.string().uuid(),
          scope: scopeSchema,
          packages: z.array(
            z.object({ name: z.string(), version: z.string().optional() }),
          ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ sourceId, scope = 'connector', packages }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.updateNotebookConfigSection(sourceId, scope, { packages }),
        );
      },
    );

    server.registerTool(
      'set_notebook_local_folders',
      {
        title: 'Set Notebook Local Folders',
        description:
          'Replace the local folders a notebook reads with ctx.folder("name"). Needs a deployment that exposes host folders to scans: the all-in-one Docker image (bind-mount them) or a Kubernetes chart with api.localFolders configured. Otherwise upload files to the source instead (upload_notebook_file).',
        inputSchema: {
          sourceId: z.string().uuid(),
          scope: scopeSchema,
          folders: z.array(z.object({ name: z.string(), path: z.string() })),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ sourceId, scope = 'connector', folders }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.updateNotebookConfigSection(sourceId, scope, {
            local_folders: folders,
          }),
        );
      },
    );

    server.registerTool(
      'list_notebook_runtime_packages',
      {
        title: 'List Notebook Runtime Packages',
        description:
          'Python packages already baked into the notebook runtime image — do not declare these again with set_notebook_packages.',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      () => {
        const path = resolveSchemaFile(
          __dirname,
          'notebook_runtime_packages.json',
        );
        return jsonResult(JSON.parse(fs.readFileSync(path, 'utf8')));
      },
    );

    server.registerTool(
      'upload_notebook_file',
      {
        title: 'Upload Notebook File',
        description:
          'Upload a file for the notebook to read via ctx.files. Stored in Postgres and deduplicated by content hash.',
        inputSchema: {
          sourceId: z.string().uuid(),
          fileName: z.string(),
          contentBase64: z.string().describe('File bytes, base64-encoded.'),
          mimeType: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ sourceId, fileName, contentBase64, mimeType }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const file = await this.sourceFilesService.create({
          sourceId,
          fileName,
          declaredMimeType: mimeType ?? 'application/octet-stream',
          data: Buffer.from(contentBase64, 'base64'),
        });
        return jsonResult(file);
      },
    );

    server.registerTool(
      'list_notebook_files',
      {
        title: 'List Notebook Files',
        description: 'List files uploaded to a CUSTOM source.',
        inputSchema: {
          sourceId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceId }) =>
        jsonResult(await this.sourceFilesService.list(sourceId)),
    );

    server.registerTool(
      'delete_notebook_file',
      {
        title: 'Delete Notebook File',
        description: 'Delete one uploaded file from a CUSTOM source.',
        inputSchema: z.strictObject({
          sourceId: z.string().uuid(),
          fileId: z.string().uuid(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ sourceId, fileId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        await this.sourceFilesService.delete(sourceId, fileId);
        return jsonResult({ deleted: true, fileId });
      },
    );

    server.registerTool(
      'run_notebook',
      {
        title: 'Run Notebook',
        description:
          'Start a notebook execution and return immediately — poll get_notebook_execution for the result. Modes: "cell" runs one cell (requires targetCellId), "test_connection" is the connection/auth smoke test, "preview_extract" samples a few assets end-to-end, "preview_augment" runs the augmentation notebook over a sample of real assets and reports per-asset diffs, "all" replays every cell in order (the closest thing to a full local test of the whole connector).',
        inputSchema: {
          sourceId: z.string().uuid(),
          scope: scopeSchema,
          mode: z.enum([
            'cell',
            'all',
            'test_connection',
            'preview_extract',
            'preview_augment',
          ]),
          targetCellId: z
            .string()
            .optional()
            .describe('Required when mode is "cell".'),
          maxAssets: z.number().int().min(1).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({
        sourceId,
        scope = 'connector',
        mode,
        targetCellId,
        maxAssets,
      }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const notebook = await this.notebookService.get(sourceId, scope);
        const execution = await this.notebookExecutionService.create(
          sourceId,
          { revision: notebook.revision, mode, scope, targetCellId, maxAssets },
          'mcp',
        );
        return jsonResult(this.notebookExecutionService.toDto(execution));
      },
    );

    server.registerTool(
      'get_notebook_execution',
      {
        title: 'Get Notebook Execution',
        description:
          'Poll one notebook execution: status, per-cell outputs, and structured error/failedCellId once it finishes.',
        inputSchema: {
          executionId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ executionId }) =>
        jsonResult(
          this.notebookExecutionService.toDto(
            await this.notebookService.getExecution(executionId),
          ),
        ),
    );

    server.registerTool(
      'list_notebook_executions',
      {
        title: 'List Notebook Executions',
        description: 'Recent notebook executions for a source, newest first.',
        inputSchema: {
          sourceId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceId, limit }) => {
        const executions = await this.notebookService.listExecutions(
          sourceId,
          limit,
        );
        return jsonResult(
          executions.map((execution) =>
            this.notebookExecutionService.toDto(execution),
          ),
        );
      },
    );

    server.registerTool(
      'cancel_notebook_execution',
      {
        title: 'Cancel Notebook Execution',
        description:
          'Stop a running notebook execution. Cells cannot be interrupted from inside Python, so this ends the process or deletes the Job.',
        inputSchema: {
          executionId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ executionId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.notebookExecutionService.cancel(executionId),
        );
      },
    );
  }

  /** Packages and local folders live beside their notebook in source config:
   * `optional.*` for the connector (see the CustomOptional schema),
   * `augmentation.*` for the augmentation notebook. */
  private async notebookConfigSection(
    sourceId: string,
    scope: 'connector' | 'augmentation' = 'connector',
  ): Promise<Record<string, any>> {
    const source = await this.requireSource(sourceId);
    const config = this.sourceService.decryptSourceConfig(source.config);
    if (scope === 'augmentation') {
      return ((config.augmentation ?? {}) as Record<string, any>) ?? {};
    }
    return (config.optional ?? {}) as Record<string, any>;
  }

  private async updateNotebookConfigSection(
    sourceId: string,
    scope: 'connector' | 'augmentation' = 'connector',
    patch: Record<string, unknown>,
  ) {
    const source = await this.requireSource(sourceId);
    const config = this.sourceService.decryptSourceConfig(source.config);
    const key = scope === 'augmentation' ? 'augmentation' : 'optional';
    const merged = {
      ...config,
      [key]: {
        ...((config[key] as Record<string, unknown>) ?? {}),
        ...patch,
      },
    };
    const updated = await this.mcpToolExecutor.updateSource({
      id: sourceId,
      config: merged,
    });
    return updated;
  }

  /**
   * The `edges` table has no direct MCP surface -- only the hydrated graph
   * views (`GraphService.lineage`/`getRelationTypes`) do. That is deliberate:
   * an edge row alone is meaningless without the node it points at, and the
   * hydrated view is what the web graph explorer itself renders, so an agent
   * verifying a stitched lineage path sees exactly what a human would.
   */
  private registerLineageTools(server: McpServerCompat) {
    server.registerTool(
      'get_asset_lineage',
      {
        title: 'Get Asset Lineage',
        description:
          "Trace an asset's FLOW lineage (where its data came from / what depends on it), walking edges up to `depth` hops. Returns the same hydrated node/edge graph the web graph explorer renders, so this is how to verify a stitched cross-source lineage edge (e.g. two assets linked by a shared external URN) without a browser.",
        inputSchema: {
          assetId: z.string().uuid(),
          direction: z.enum(['up', 'down', 'both']).optional(),
          depth: z.number().int().min(1).max(3).optional(),
          collapseContainers: z.boolean().optional(),
          mergeIdentity: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({
        assetId,
        direction,
        depth,
        collapseContainers,
        mergeIdentity,
      }) =>
        jsonResult(
          await this.graphService.lineage({
            assetId,
            direction,
            depth,
            collapseContainers,
            mergeIdentity,
          }),
        ),
    );

    server.registerTool(
      'get_relation_types',
      {
        title: 'Get Relation Types',
        description:
          'Edge relation types actually in use, plus builtin suggestions, each classified as FLOW | CONTAINMENT | IDENTITY | REFERENCE | USAGE. Call before get_asset_lineage to know what a relationType on a returned edge means.',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => jsonResult(await this.graphService.getRelationTypes()),
    );
  }

  private registerCustomDetectorTools(
    server: McpServerCompat,
    toolGroupIds: string[] | null = null,
  ) {
    /**
     * A code detector carries Python that runs inside every scan it is
     * attached to, so writing one is authoring code, not configuration: a
     * token scoped to custom_detectors alone may create a regex, not a
     * program. Unscoped tokens (null) keep full access.
     */
    const assertMayWriteCode = (schema: unknown) => {
      if (
        isCodeDetectorSchema(schema) &&
        toolGroupIds !== null &&
        !toolGroupIds.includes('custom_source_code')
      ) {
        throw new Error(
          'Writing a CODE_DETECTOR (code) detector needs the custom_source_code ' +
            'capability group on this MCP token, because the notebook runs in every ' +
            'scan the detector is attached to.',
        );
      }
    };
    server.registerTool(
      'list_custom_detectors',
      {
        title: 'List Custom Detectors',
        description: 'List custom detectors and usage statistics.',
        inputSchema: {
          includeInactive: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ includeInactive }) =>
        jsonResult(
          await this.customDetectorsService.list({
            includeInactive,
          } as any),
        ),
    );

    server.registerTool(
      'get_custom_detector',
      {
        title: 'Get Custom Detector',
        description: 'Fetch a single custom detector.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) =>
        jsonResult(await this.customDetectorsService.getById(id)),
    );

    server.registerTool(
      'list_custom_detector_examples',
      {
        title: 'List Custom Detector Examples',
        description:
          'Return starter examples for every engine: rulesets, classifiers, entity detectors, AI (LLM) detectors and code detectors (CODE_DETECTOR). Code-detector templates include their notebook and ready-made testScenarios -- copy both when creating one.',
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      () => jsonResult(this.customDetectorsService.listExamples()),
    );

    server.registerTool(
      'create_custom_detector',
      {
        title: 'Create Custom Detector',
        description:
          'Create a custom detector. The pipeline_schema.type selects the engine: GLINER2 (default), REGEX, LLM (AI), TEXT_CLASSIFICATION, IMAGE_CLASSIFICATION, OBJECT_DETECTION, TAG or CODE_DETECTOR. GLiNER2 needs at least one entity or classification task. LLM detectors require aiProviderConfigId and a system_prompt. TAG is a placeholder that runs nothing: it exists so a CUSTOM connector notebook can assert a fact it already knows with Asset(tags={"<key>": "<value>"}), and it is not selectable on a source. ' +
          CODE_DETECTOR_GUIDANCE,
        inputSchema: {
          key: z.string().optional(),
          name: z.string(),
          description: z.string().optional(),
          aiProviderConfigId: z
            .string()
            .uuid()
            .optional()
            .describe(
              'AI provider credential ID. Required for LLM (AI) detectors.',
            ),
          pipeline_schema: jsonObjectSchema.describe(
            'Pipeline schema. GLiNER2 example: { type: "GLINER2", entities: { order_id: { description: "Order ID like ORD-123", required: true } }, classification: { intent: { labels: ["refund", "bug"], multi_label: false } } }. LLM (AI) example: { type: "LLM", system_prompt: "Classify the sentiment of the text.", labels: [{ name: "good" }, { name: "bad" }, { name: "violent" }], severity_map: [{ pattern: "violent", severity: "critical" }], output_fields: [{ name: "language", type: "string" }] }. TAG example: { type: "TAG", label: "Cardholder data", severity: "high" }. CODE_DETECTOR example: { type: "CODE_DETECTOR", notebook: { cells: [{ id: "c1", type: "code", source: "def detect(asset, ctx):\\n    for i, row in enumerate(asset.rows()):\\n        if row[\'total\'] != row[\'a\'] + row[\'b\']:\\n            yield Finding(label=\'total_mismatch\', value=str(row[\'total\']), identity=f\'row-{i}\', location={\'row\': i})\\n" }] }, severity: "high", category: "QUALITY", fields: [{ name: "expected", type: "number" }], variables: {}, secrets: {}, needs_findings: false }',
          ),
          isActive: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ pipeline_schema, ...rest }) => {
        assertMayWriteCode(pipeline_schema);
        return jsonResult(
          await this.mcpToolExecutor.createCustomDetector({
            ...rest,
            pipelineSchema: pipeline_schema,
          }),
        );
      },
    );

    server.registerTool(
      'update_custom_detector',
      {
        title: 'Update Custom Detector',
        description:
          'Update detector metadata, pipeline schema, AI provider credential, or activation status. For a CODE_DETECTOR, send the whole pipeline_schema (notebook included); `secrets` is a patch -- a string sets a key, null deletes it, and omitting `secrets` keeps every stored secret (values are never returned, only secretKeys). Saving a changed notebook bumps notebook.revision.',
        inputSchema: {
          id: z.string().uuid(),
          key: z.string().optional(),
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          aiProviderConfigId: z
            .string()
            .uuid()
            .optional()
            .describe(
              'AI provider credential ID. Required for LLM (AI) detectors.',
            ),
          pipeline_schema: jsonObjectSchema
            .optional()
            .describe('Updated pipeline schema (any supported type).'),
          isActive: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        assertMayWriteCode((rest as any).pipeline_schema);
        if (!(rest as any).pipeline_schema) {
          // A rename or activation flip carries no schema, but changing a
          // rule that runs Python in every scan is still a code-affecting
          // write: check the stored detector too.
          const stored = await this.customDetectorsService.getById(id);
          assertMayWriteCode((stored as any)?.pipelineSchema);
        }
        return jsonResult(
          await this.customDetectorsService.update(id, {
            ...rest,
            pipelineSchema: (rest as any).pipeline_schema,
          } as any),
        );
      },
    );

    server.registerTool(
      'delete_custom_detector',
      {
        title: 'Delete Custom Detector',
        description: 'Delete a custom detector.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const stored = await this.customDetectorsService.getById(id);
        assertMayWriteCode((stored as any)?.pipelineSchema);
        return jsonResult(await this.customDetectorsService.delete(id));
      },
    );

    server.registerTool(
      'retire_out_of_scope_findings',
      {
        title: 'Retire Out-of-Scope Findings',
        description:
          'Resolve OPEN findings a custom detector can no longer produce because ' +
          'its scope.asset_kinds was narrowed or regex patterns were removed — ' +
          'a rescan never resolves those. Two steps, each a background operation ' +
          '(follow the returned id with get_findings_bulk_operation): ' +
          '(1) dryRun (default) changes nothing and reports, under counts: ' +
          'candidates, byReason, citedByCase, watchedByInquiries, inquiries, ' +
          'wouldRetire and notProvable. ' +
          '(2) dryRun: false with fromOperationId (that COMPLETED dry run), ' +
          'expectedCount (its wouldRetire) and confirm: true. It never retires ' +
          'more than expectedCount. Findings a case cites or an ACTIVE inquiry ' +
          'watches are never retired by this tool. Retired findings are RESOLVED ' +
          'without detector feedback; widening the scope again lets re-detection ' +
          'reopen them.',
        inputSchema: z.strictObject({
          customDetectorId: z.string().uuid(),
          dryRun: z.boolean().optional().describe('Default true: count only.'),
          sourceIds: z
            .array(z.string())
            .max(100)
            .optional()
            .describe('Dry run only: restrict to these sources.'),
          fromOperationId: z
            .string()
            .uuid()
            .optional()
            .describe('Retire only: the completed dry run operation id.'),
          expectedCount: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Retire only: the dry run's counts.wouldRetire."),
          confirm: z
            .literal(true)
            .optional()
            .describe('Retire only: required.'),
        }),
        annotations: {
          readOnlyHint: false,
          // Resolved findings leave inquiries, correlation and duplicate review.
          destructiveHint: true,
        },
      },
      async ({
        customDetectorId,
        dryRun,
        sourceIds,
        fromOperationId,
        expectedCount,
        confirm,
      }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const operation =
          dryRun === false
            ? await this.retireOutOfScope.startRetire(
                customDetectorId,
                { fromOperationId, expectedCount, confirm, createdBy: 'mcp' },
                // Emptying what an investigation watches is an operator call.
                { allowInquiryOverride: false },
              )
            : await this.retireOutOfScope.startDryRun(customDetectorId, {
                sourceIds,
                createdBy: 'mcp',
              });
        return jsonResult(this.findingBulkOperations.toDto(operation));
      },
    );

    server.registerTool(
      'train_custom_detector',
      {
        title: 'Train Custom Detector',
        description:
          'Trigger custom detector training, optionally scoped to a single source.',
        inputSchema: {
          id: z.string().uuid(),
          sourceId: z.string().uuid().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, sourceId }) =>
        jsonResult(
          await this.mcpToolExecutor.trainCustomDetector({ id, sourceId }),
        ),
    );

    server.registerTool(
      'get_custom_detector_training_history',
      {
        title: 'Get Custom Detector Training History',
        description: 'List recent training runs for a detector.',
        inputSchema: {
          id: z.string().uuid(),
          take: z.number().int().min(1).max(100).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, take }) =>
        jsonResult(
          await this.customDetectorsService.getTrainingHistory(id, take ?? 20),
        ),
    );

    server.registerTool(
      'list_detector_test_scenarios',
      {
        title: 'List Detector Test Scenarios',
        description: 'List all test scenarios for a custom detector.',
        inputSchema: {
          detector_id: z.string().describe('Custom detector ID'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ detector_id }) =>
        jsonResult(
          await this.mcpToolExecutor.listDetectorTestScenarios(detector_id),
        ),
    );

    server.registerTool(
      'create_detector_test_scenario',
      {
        title: 'Create Detector Test Scenario',
        description:
          'Create a test scenario for a custom detector. Expected outcome shapes by detector type: ' +
          'REGEX/RULESET {"shouldMatch": true|false}; classifier/LLM {"label": "...", "minConfidence": 0.6}; ' +
          'entity {"entities": [{"label": "PersonName", "text": "Ostap"}]}. ' +
          'The nested pipeline-output shape ({"classification": {task: {label, confidence}}} / ' +
          '{"entities": {label: [{value}]}}) is also accepted. ' +
          'Labels compare case-insensitively with underscores treated as spaces, so ' +
          '"market_gaming_instruction" matches "Market gaming instruction". ' +
          'CODE_DETECTOR (code) detectors: expected {"findings": [{"label": "total_mismatch", "identity": "row-2", "severity": "high", "count": 1}], "match": "subset"|"exact"} or {"shouldMatch": false}; ' +
          'and instead of input_text they may take input_asset, a whole asset: ' +
          '{"name": "t.csv", "kind": "table", "mime_type": "text/csv", "metadata": {...}, "rows": [{...}], "pages": ["..."], "text": "..."}.',
        inputSchema: {
          detector_id: z.string(),
          name: z.string().describe('Short scenario name'),
          description: z.string().optional(),
          input_text: z
            .string()
            .optional()
            .describe(
              'Text to test against the detector (or give input_asset)',
            ),
          input_asset: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'CODE_DETECTOR only: an asset fixture { name, kind?, mime_type?, metadata?, text?, pages?, rows? }',
            ),
          expected_outcome: z
            .record(z.string(), z.unknown())
            .describe(
              'Expected outcome — see tool description for the per-detector-type shapes',
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({
        detector_id,
        name,
        description,
        input_text,
        input_asset,
        expected_outcome,
      }) =>
        jsonResult(
          await this.mcpToolExecutor.createDetectorTestScenario({
            detectorId: detector_id,
            name,
            description,
            inputText: input_text,
            inputAsset: input_asset,
            expectedOutcome: expected_outcome,
          }),
        ),
    );

    server.registerTool(
      'run_detector_tests',
      {
        title: 'Run Detector Tests',
        description:
          'Run test scenarios for a custom detector and return a pass/fail matrix. ' +
          'Pass scenario_ids to re-run only specific scenarios (avoids re-running every ' +
          'scenario — each LLM-detector scenario costs a model call); omit to run all. ' +
          'FAIL results include an expected-vs-actual explanation in errorMessage.',
        inputSchema: {
          detector_id: z.string(),
          scenario_ids: z
            .array(z.string())
            .optional()
            .describe(
              'Optional scenario IDs to run; omit to run every scenario for the detector',
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ detector_id, scenario_ids }) =>
        jsonResult(
          await this.mcpToolExecutor.runDetectorTests({
            detectorId: detector_id,
            triggeredBy: 'ASSISTANT',
            scenarioIds: scenario_ids,
          }),
        ),
    );

    server.registerTool(
      'delete_detector_test_scenario',
      {
        title: 'Delete Detector Test Scenario',
        description:
          'Delete a test scenario (and its past results) from a custom detector.',
        inputSchema: z.strictObject({
          detector_id: z.string().describe('Custom detector ID'),
          scenario_id: z.string().describe('Test scenario ID to delete'),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ detector_id, scenario_id }) =>
        jsonResult(
          await this.mcpToolExecutor.deleteDetectorTestScenario(
            detector_id,
            scenario_id,
          ),
        ),
    );

    server.registerTool(
      'run_custom_detector_notebook',
      {
        title: 'Run Code Detector Notebook',
        description:
          "Run a CODE_DETECTOR (code) detector's notebook and return immediately -- poll get_notebook_execution for the result. " +
          '"cell" runs one cell (targetCellId) and "all" replays every cell, with the detector\'s variables, secrets and files but no asset: use them to debug helpers with print(). ' +
          '"preview_detect" runs setup() and detect() exactly as a scan would on a real asset of sourceId (assetId), or on a small sample of that source when assetId is omitted, and reports the findings it WOULD record (outputs.assets[].findings, outputs.result.logs) without writing anything. ' +
          'Always preview on a real asset before attaching a new rule to a source. The revision is read from the detector, so save (update_custom_detector) first.',
        inputSchema: z.strictObject({
          detectorId: z.string().uuid(),
          mode: z.enum(['cell', 'all', 'preview_detect']),
          targetCellId: z.string().optional().describe('Required for "cell".'),
          sourceId: z
            .string()
            .uuid()
            .optional()
            .describe('Required for "preview_detect".'),
          assetId: z
            .string()
            .uuid()
            .optional()
            .describe('preview_detect: one asset of sourceId; omit to sample.'),
          maxAssets: z.number().int().min(1).max(10).optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({
        detectorId,
        mode,
        targetCellId,
        sourceId,
        assetId,
        maxAssets,
      }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const detector = await this.customDetectorsService.getById(detectorId);
        const notebook = (detector.pipelineSchema as Record<string, any>)
          ?.notebook;
        const execution = await this.notebookExecutionService.createForDetector(
          detectorId,
          {
            revision: Number.isInteger(notebook?.revision)
              ? notebook.revision
              : 1,
            mode,
            targetCellId,
            sourceId,
            assetId,
            maxAssets,
          },
          'mcp',
        );
        return jsonResult(this.notebookExecutionService.toDto(execution));
      },
    );

    server.registerTool(
      'list_custom_detector_files',
      {
        title: 'List Code Detector Files',
        description:
          'Files uploaded to a CODE_DETECTOR detector (lists, models, reference tables); the rule opens them with ctx.file(name).',
        inputSchema: z.strictObject({ detectorId: z.string().uuid() }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ detectorId }) =>
        jsonResult(await this.customDetectorFiles.list(detectorId)),
    );

    server.registerTool(
      'upload_custom_detector_file',
      {
        title: 'Upload Code Detector File',
        description:
          'Upload a file a CODE_DETECTOR detector reads with ctx.file(fileName) -- a sanctions list CSV, a joblib/ONNX model, a lookup table. A file with the same name is replaced, and the detector version is bumped so the next scan re-runs the rule.',
        inputSchema: z.strictObject({
          detectorId: z.string().uuid(),
          fileName: z.string().min(1),
          contentBase64: z.string().describe('File bytes, base64-encoded.'),
          mimeType: z.string().optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      async ({ detectorId, fileName, contentBase64, mimeType }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.customDetectorFiles.create({
            customDetectorId: detectorId,
            fileName,
            declaredMimeType: mimeType ?? 'application/octet-stream',
            data: Buffer.from(contentBase64, 'base64'),
          }),
        );
      },
    );

    server.registerTool(
      'delete_custom_detector_file',
      {
        title: 'Delete Code Detector File',
        description: 'Delete one file from a CODE_DETECTOR detector.',
        inputSchema: z.strictObject({
          detectorId: z.string().uuid(),
          fileId: z.string().uuid(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ detectorId, fileId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        await this.customDetectorFiles.delete(detectorId, fileId);
        return jsonResult({ deleted: true, fileId });
      },
    );

    server.registerTool(
      'validate_detector_config',
      {
        title: 'Validate Detector Config',
        description:
          'Dry-run validate a custom detector pipeline schema against both the JSON Schema and the detector-specific validation rules, without creating anything.',
        inputSchema: {
          pipelineSchema: jsonObjectSchema,
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      ({ pipelineSchema }) => {
        const errors: string[] = [];
        const detectorType =
          typeof pipelineSchema.type === 'string'
            ? pipelineSchema.type
            : 'GLINER2';
        try {
          this.validationService.validateDetectorConfig(
            detectorType,
            pipelineSchema,
          );
        } catch (error) {
          errors.push(...errorMessageLines(error));
        }
        try {
          this.customDetectorsService.validatePipelineSchema(pipelineSchema);
        } catch (error) {
          errors.push(...errorMessageLines(error));
        }
        if (errors.length > 0) {
          return jsonResult({ valid: false, errors });
        }
        return jsonResult({ valid: true });
      },
    );
  }

  private registerExtractionTools(server: McpServerCompat) {
    const extractionsService = this.customDetectorExtractionsService;
    const customDetectorsService = this.customDetectorsService;

    server.registerTool(
      'get_finding_extraction',
      {
        title: 'Get Finding Extraction',
        description: 'Get structured extraction data for a specific finding.',
        inputSchema: {
          finding_id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ finding_id }) => {
        const result = await extractionsService.getByFinding(finding_id);
        return jsonResult(result);
      },
    );

    server.registerTool(
      'search_extractions',
      {
        title: 'Search Extractions',
        description:
          'Search structured extraction records across custom detector findings.',
        inputSchema: {
          custom_detector_key: z.string().optional(),
          custom_detector_id: z.string().uuid().optional(),
          source_id: z.string().uuid().optional(),
          take: z.number().int().min(1).max(200).default(50).optional(),
          skip: z.number().int().min(0).default(0).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (params) => {
        const result = await extractionsService.search({
          customDetectorKey: params.custom_detector_key,
          customDetectorId: params.custom_detector_id,
          sourceId: params.source_id,
          take: params.take,
          skip: params.skip,
        });
        return jsonResult(result);
      },
    );

    server.registerTool(
      'get_extraction_coverage',
      {
        title: 'Get Extraction Coverage',
        description:
          "Get field-level coverage statistics for a custom detector's extractions.",
        inputSchema: {
          custom_detector_id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ custom_detector_id }) => {
        const result = await extractionsService.getCoverage(custom_detector_id);
        return jsonResult(result);
      },
    );

    server.registerTool(
      'list_extractor_schema',
      {
        title: 'List Extractor Schema',
        description:
          'Show the extractor field schema for a custom detector plus a recent extraction example.',
        inputSchema: {
          custom_detector_id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ custom_detector_id }) => {
        const detector =
          await customDetectorsService.getById(custom_detector_id);
        const recent = await extractionsService.search({
          customDetectorId: custom_detector_id,
          take: 1,
        });
        const result = {
          pipeline_schema: detector.pipelineSchema,
          recent_pipeline_result: recent.items[0]?.pipelineResult ?? null,
          total_extractions: recent.total,
        };
        return jsonResult(result);
      },
    );
  }

  private registerRunTools(server: McpServerCompat) {
    server.registerTool(
      'search_runs',
      {
        title: 'Search Runs',
        description: 'Search runner history with filters and pagination.',
        inputSchema: {
          filters: searchRunsFilters.optional(),
          page: searchRunsPage.optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ filters, page }) =>
        jsonResult(
          await this.cliRunnerService.searchRunners({
            filters: filters,
            page: page,
          } as any),
        ),
    );

    server.registerTool(
      'list_source_runs',
      {
        title: 'List Source Runs',
        description: 'List runs for a single source.',
        inputSchema: {
          sourceId: z.string().uuid(),
          status: z
            .enum([
              'PENDING',
              'RUNNING',
              'COMPLETED',
              'WARNING',
              'ERROR',
              'STOPPED',
            ])
            .optional()
            .describe('Filter to runs in this status.'),
          skip: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Offset. Defaults to 0.'),
          take: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe('Max results (1–200).'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceId, status, skip, take }) =>
        jsonResult(
          await this.cliRunnerService.listRunners({
            sourceId,
            status: status,
            skip,
            take,
          }),
        ),
    );

    server.registerTool(
      'get_run',
      {
        title: 'Get Run',
        description: 'Fetch a single runner record.',
        inputSchema: {
          runnerId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ runnerId }) =>
        jsonResult(await this.cliRunnerService.getRunnerStatus(runnerId)),
    );

    server.registerTool(
      'get_run_logs',
      {
        title: 'Get Run Logs',
        description: 'Fetch paginated runner logs for debugging.',
        inputSchema: {
          runnerId: z.string().uuid(),
          cursor: z.string().optional(),
          take: z.number().int().min(1).max(500).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ runnerId, cursor, take }) =>
        jsonResult(
          await this.cliRunnerService.getRunnerLogs({
            runnerId,
            cursor,
            take,
          }),
        ),
    );

    server.registerTool(
      'stop_run',
      {
        title: 'Stop Run',
        description:
          'Stop a running scan or cancel a queued (PENDING) one. Both end STOPPED.',
        inputSchema: z.strictObject({
          runnerId: z.string().uuid(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ runnerId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.cliRunnerService.stopRunner(runnerId));
      },
    );
  }

  private registerFindingTools(server: McpServerCompat) {
    server.registerTool(
      'search_findings',
      {
        title: 'Search Findings',
        description:
          'Search findings using filters, text search, and pagination.',
        inputSchema: {
          filters: searchFindingsFilters.optional(),
          page: searchFindingsPage.optional(),
          semantic_query: z
            .string()
            .max(500)
            .optional()
            .describe(
              'Natural-language query. Uses hybrid lexical + semantic ranking and returns score reasons.',
            ),
          semantic_mode: z
            .enum(['hybrid', 'vector', 'off'])
            .optional()
            .describe('Semantic ranking mode. Defaults to hybrid.'),
          ranking: z
            .enum(['importance', 'newest', 'severity'])
            .optional()
            .describe(
              'Corpus browsing order when semantic_query is omitted. Defaults to importance.',
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ filters, page, semantic_query, semantic_mode, ranking }) =>
        jsonResult(
          await this.findingsService.searchFindings({
            filters: filters,
            page: page,
            semantic: semantic_query
              ? { query: semantic_query, mode: semantic_mode ?? 'hybrid' }
              : undefined,
            ranking: { sort: ranking ?? 'importance' },
          } as any),
        ),
    );

    server.registerTool(
      'find_similar_findings',
      {
        title: 'Find Similar Findings',
        description:
          'Return semantic neighbours for one finding, including similarity, duplicate/noise signals, and ranking explanations.',
        inputSchema: {
          findingId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ findingId, limit }) =>
        jsonResult(
          await this.embeddingService.similarFindings(findingId, limit ?? 20),
        ),
    );

    server.registerTool(
      'find_boilerplate_clusters',
      {
        title: 'Find Boilerplate Clusters',
        description:
          'Find repeated or near-duplicate finding groups, ordered by cluster size. Omit sourceIds to scan the whole corpus — clusters spanning multiple sources (sourceCount > 1) are the same content circulating between systems, which can itself be a lead. Use this to separate bulk boilerplate from distinctive evidence.',
        inputSchema: {
          sourceIds: z.array(z.string().uuid()).optional(),
          threshold: z.number().min(0.8).max(1).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceIds, threshold, limit }) =>
        jsonResult(
          await this.embeddingService.boilerplateClusters({
            sourceIds,
            threshold,
            limit,
          }),
        ),
    );

    server.registerTool(
      'get_finding',
      {
        title: 'Get Finding',
        description: 'Fetch a single finding with asset and source context.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) => {
        const finding = await this.findingsService.findOne(id);
        if (!finding) {
          throw new NotFoundException(`Finding with ID ${id} not found`);
        }
        return jsonResult(finding);
      },
    );

    server.registerTool(
      'explain_finding',
      {
        title: 'Explain Finding',
        description:
          'One-call evidence explanation for a finding: importance/quality ranking with its reasons and raw signals, duplicate-group size, top semantic neighbours, and the detector severity/confidence kept as a separate axis. Use before escalating or attaching a finding as case evidence. Similarity and importance are triage signals, not proof.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) => {
        const finding = await this.findingsService.findOne(id);
        if (!finding) {
          throw new NotFoundException(`Finding with ID ${id} not found`);
        }
        const analysis = finding.evidenceAnalysis;
        const [duplicateGroupSize, similar] = await Promise.all([
          analysis?.duplicateGroupHash
            ? this.findingsService.countDuplicateGroup(
                analysis.duplicateGroupHash,
              )
            : Promise.resolve(1),
          this.embeddingService
            .similarFindings(id, 5)
            .catch(() => [] as never[]),
        ]);
        return jsonResult({
          findingId: finding.id,
          findingType: finding.findingType,
          matchedContent: finding.matchedContent,
          asset: finding.asset,
          source: finding.source,
          detector: {
            severity: finding.severity,
            confidence: Number(finding.confidence),
            note: 'Detector severity/confidence describe the pattern match, not investigative importance.',
          },
          ranking: analysis
            ? {
                importance: analysis.importanceScore,
                quality: analysis.qualityScore,
                semanticOutlier: analysis.semanticOutlier,
                similarCount: analysis.similarCount,
                duplicateGroupSize,
                reasons: renderReasons(analysis.reasons),
                signals: analysis.signals,
                coverage: 'analyzed',
              }
            : {
                coverage:
                  'pending — importance is not yet computed for this finding; do not read that as unimportant',
              },
          similarFindings: (
            similar as Array<{
              id: string;
              matchedContent: string;
              similarity: number;
              sourceId: string;
              assetId: string;
            }>
          ).map((neighbor) => ({
            findingId: neighbor.id,
            value: neighbor.matchedContent,
            similarity: neighbor.similarity,
            sourceId: neighbor.sourceId,
            assetId: neighbor.assetId,
          })),
        });
      },
    );

    server.registerTool(
      'update_finding',
      {
        title: 'Update Finding',
        description:
          'Update finding status, severity, or resolution context for a single finding.',
        inputSchema: {
          id: z.string().uuid(),
          status: z
            .enum(['OPEN', 'RESOLVED', 'FALSE_POSITIVE', 'IGNORED'])
            .optional(),
          severity: z
            .enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
            .optional(),
          changeReason: z.string().optional(),
          comment: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.findingsService.update(id, rest));
      },
    );

    server.registerTool(
      'bulk_update_findings',
      {
        title: 'Bulk Update Findings',
        description:
          'Bulk update findings by IDs (at most 1,000) or by filters, including ' +
          'status, severity, and comment. Filters use the same keys as ' +
          'search_findings; an unknown key is an error, never a wider match. ' +
          'Run with dryRun: true first — it returns the exact count ' +
          '(wouldUpdate) and whether the filters narrow the corpus — then pass ' +
          'that count as expectedCount: if more findings match when the update ' +
          'runs, nothing is written. Filters that narrow nothing beyond status ' +
          'require confirm: true. A selection over 2,000 findings is queued as a ' +
          'background operation: the result carries operationId — follow it with ' +
          'get_findings_bulk_operation.',
        inputSchema: z.strictObject({
          ids: z.array(z.string().uuid()).max(1000).optional(),
          filters: searchFindingsFilters.optional(),
          status: z
            .enum(['OPEN', 'RESOLVED', 'FALSE_POSITIVE', 'IGNORED'])
            .optional(),
          severity: z
            .enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
            .optional(),
          comment: z.string().optional(),
          dryRun: z
            .boolean()
            .optional()
            .describe('Count what would be updated without writing anything.'),
          expectedCount: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              'The dryRun count. If more findings match at update time, the ' +
                'update is refused (409) and nothing is written.',
            ),
          confirm: z
            .boolean()
            .optional()
            .describe(
              'Required (true) when the filters narrow nothing beyond status, ' +
                'includeResolved and excludeIds — the update would apply to ' +
                'every finding in the namespace.',
            ),
        }),
        annotations: {
          readOnlyHint: false,
          // A status change rewrites the evidence base: resolved findings leave
          // inquiries, correlation and the review queue.
          destructiveHint: true,
        },
      },
      async (args) => {
        this.mcpToolExecutor.assertNotDemoMode();
        // zod carries the filter dates as ISO strings where the DTO declares
        // Date; Prisma takes either for a DateTime comparison, as search does.
        return jsonResult(
          await this.findingsService.bulkUpdate(
            args as unknown as Parameters<FindingsService['bulkUpdate']>[0],
          ),
        );
      },
    );

    server.registerTool(
      'get_findings_bulk_operation',
      {
        title: 'Get Findings Bulk Operation',
        description:
          'Progress of a background bulk finding operation — the operationId ' +
          'bulk_update_findings returns when a selection is too large to change ' +
          'in one request, and the id retire_out_of_scope_findings returns for ' +
          'its dry run and its retire. Reports status (PENDING, RUNNING, ' +
          'COMPLETED, FAILED, CANCELLED), how many findings were examined, ' +
          'changed and exempted, percent, and operation-specific counts (a ' +
          'retire dry run puts wouldRetire and its exemptions there).',
        inputSchema: { operationId: z.string().uuid() },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ operationId }) =>
        jsonResult(
          this.findingBulkOperations.toDto(
            await this.findingBulkOperations.get(operationId),
          ),
        ),
    );

    server.registerTool(
      'cancel_findings_bulk_operation',
      {
        title: 'Cancel Findings Bulk Operation',
        description:
          'Stop a background bulk finding operation. A queued one is cancelled ' +
          'outright; a running one stops after its current page. Findings it ' +
          'already changed stay changed — this stops the operation, it does not ' +
          'undo it.',
        inputSchema: { operationId: z.string().uuid() },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async ({ operationId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          this.findingBulkOperations.toDto(
            await this.findingBulkOperations.requestCancel(operationId),
          ),
        );
      },
    );

    server.registerTool(
      'get_findings_discovery',
      {
        title: 'Get Findings Discovery',
        description:
          'Return discovery totals, review-state mix, activity, and top assets ' +
          'for findings. Severity is a priority level, not a threat level — it says ' +
          'how much a finding matters, not how dangerous it is.',
        inputSchema: {
          // The rollup is keyed to these three windows and the HTTP DTO
          // validates them; the MCP path bypasses that validator, so an
          // arbitrary number here would silently produce a window nothing else
          // in the product can reproduce.
          windowDays: z
            .union([z.literal(7), z.literal(30), z.literal(90)])
            .optional(),
          includeResolved: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ windowDays, includeResolved }) =>
        jsonResult(
          await this.findingsService.getDiscoveryOverview({
            windowDays,
            includeResolved,
          } as any),
        ),
    );

    server.registerTool(
      'purge_source_findings',
      {
        title: 'Purge Source Findings',
        description:
          'Permanently delete EVERY finding of a source — all statuses, including ' +
          'resolved and false-positive. Irreversible; finding history is lost. Case ' +
          'evidence snapshots survive by design, and correlation fingerprints are ' +
          'recomputed in the background afterwards. Useful when iterating on detector ' +
          'configurations and the accumulated findings are pure noise. To clean up ' +
          'only findings from removed/disabled detectors, rely instead on the ' +
          'cleanup_removed_detector_findings source option (default on) and rescan.',
        inputSchema: z.strictObject({
          source_id: z.string().describe('Source whose findings to purge'),
          confirm: z
            .literal(true)
            .describe('Must be true — acknowledges the purge is irreversible'),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ source_id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.sourceService.purgeFindings(source_id));
      },
    );

    server.registerTool(
      'purge_source_assets',
      {
        title: 'Purge Source Assets',
        description:
          'Permanently delete assets of a source, and with them every finding, ' +
          'extraction, correlation value and chunk derived from those assets. ' +
          'Heavier than purge_source_findings: it removes the ingested material ' +
          'itself, so the source must be re-scanned before anything from it can be ' +
          'examined again. Correlation fingerprints are recomputed afterwards.\n\n' +
          'With no filter this deletes EVERY asset of the source. The filters exist ' +
          'for the case a scan can never resolve on its own: when a connector narrows ' +
          'its scope, the assets it used to produce are stranded, because retirement ' +
          'requires a run that saw the whole scope and found them gone — and a ' +
          'rotating-sample connector never has one. ALWAYS call once with dry_run ' +
          'first and report what it matched before deleting.',
        inputSchema: z.strictObject({
          source_id: z.string().describe('Source whose assets to purge'),
          confirm: z
            .literal(true)
            .describe('Must be true — acknowledges the purge is irreversible'),
          external_id_prefix: z
            .string()
            .optional()
            .describe(
              "Only assets whose connector-assigned id (metadata.external_id) starts with this, e.g. 'fin-'",
            ),
          asset_kind: z
            .string()
            .optional()
            .describe(
              'Only assets of this catalog kind: record | document | page | file | table',
            ),
          name_prefix: z
            .string()
            .optional()
            .describe('Only assets whose display name starts with this'),
          urn_prefix: z
            .string()
            .optional()
            .describe('Only assets whose URN starts with this'),
          not_scanned_since: z
            .string()
            .optional()
            .describe(
              'ISO-8601 timestamp; only assets last scanned before it, plus assets never scanned',
            ),
          dry_run: z
            .boolean()
            .optional()
            .describe('Report what matches and delete nothing'),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({
        source_id,
        external_id_prefix,
        asset_kind,
        name_prefix,
        urn_prefix,
        not_scanned_since,
        dry_run,
      }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.sourceService.purgeAssets(source_id, {
            externalIdPrefix: external_id_prefix,
            assetKind: asset_kind,
            namePrefix: name_prefix,
            urnPrefix: urn_prefix,
            notScannedSince: not_scanned_since,
            dryRun: dry_run === true,
          }),
        );
      },
    );
  }

  private registerAssetTools(server: McpServerCompat) {
    server.registerTool(
      'search_assets',
      {
        title: 'Search Assets',
        description:
          'Search assets and their nested findings. Narrow by asset attributes (assets), by the findings attached to each asset (findings), or both.',
        inputSchema: {
          assets: searchAssetsAssetFilters.optional(),
          findings: searchAssetsFindingFilters.optional(),
          page: searchAssetsPage.optional(),
          options: searchAssetsOptions.optional(),
          semantic_query: z
            .string()
            .min(1)
            .max(500)
            .optional()
            .describe('Meaning-based query over extracted asset text chunks.'),
          semantic_mode: z
            .enum(['off', 'hybrid', 'vector'])
            .optional()
            .describe(
              'Hybrid combines asset-name and semantic rank. Defaults to hybrid.',
            ),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({
        assets,
        findings,
        page,
        options,
        semantic_query,
        semantic_mode,
      }) =>
        jsonResult(
          await this.assetService.searchAssets({
            assets,
            findings,
            page,
            options,
            semantic: semantic_query
              ? { query: semantic_query, mode: semantic_mode ?? 'hybrid' }
              : undefined,
          } as any),
        ),
    );

    server.registerTool(
      'get_asset',
      {
        title: 'Get Asset',
        description: 'Fetch a single asset by ID.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) => {
        const asset = await this.assetService.getAssetById(id);
        if (!asset) {
          throw new NotFoundException(`Asset with ID ${id} not found`);
        }
        return jsonResult(asset);
      },
    );

    server.registerTool(
      'list_source_assets',
      {
        title: 'List Source Assets',
        description: 'List assets belonging to a single source.',
        inputSchema: {
          sourceId: z.string().uuid(),
          skip: z.number().int().min(0).optional(),
          take: z.number().int().min(1).max(500).optional(),
          assetType: z
            .enum([
              'TXT',
              'IMAGE',
              'VIDEO',
              'AUDIO',
              'URL',
              'TABLE',
              'BINARY',
              'OTHER',
            ])
            .optional(),
          status: z.enum(['NEW', 'UPDATED', 'UNCHANGED']).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceId, ...rest }) => {
        await this.requireSource(sourceId);
        return jsonResult(
          await this.assetService.listAssets({ sourceId, ...rest } as any),
        );
      },
    );

    server.registerTool(
      'list_asset_finding_summaries',
      {
        title: 'List Asset Finding Summaries',
        description:
          'Return asset-level finding summaries and rollups for remediation workflows.',
        inputSchema: {
          sourceId: z.string().uuid().optional(),
          assetId: z.string().uuid().optional(),
          runnerId: z.string().uuid().optional(),
          detectorType: z.string().optional(),
          findingType: z.string().optional(),
          severity: z.string().optional(),
          status: z.string().optional(),
          includeResolved: z.boolean().optional(),
          sort: z
            .enum(['LATEST', 'MOST_FINDINGS', 'HIGHEST_SEVERITY'])
            .optional(),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(500).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args) =>
        jsonResult(await this.findingsService.listAssetSummaries(args as any)),
    );
  }

  private registerInquiryTools(server: McpServerCompat) {
    const matcherShape = {
      matchAllSources: z
        .boolean()
        .optional()
        .describe('Match findings from any source (ignores sourceIds)'),
      sourceIds: z.array(z.string()).optional(),
      detectorTypes: z
        .array(
          z.enum([
            'SECRETS',
            'PII',
            'YARA',
            'BROKEN_LINKS',
            'CODE_SECURITY',
            'CUSTOM',
          ]),
        )
        .optional()
        .describe('Empty = any detector'),
      customDetectorKeys: z.array(z.string()).optional(),
      findingTypes: z.array(z.string()).optional(),
      findingTypeRegex: z.array(z.string()).optional(),
      findingValueRegex: z.array(z.string()).optional(),
      termKeys: z
        .array(z.string())
        .max(50)
        .optional()
        .describe(
          'Glossary term keys: the finding must be evidence of one of these concepts (an APPROVED binding of its output, or a manual link). Prefer this over a value regex when a concept exists. Unknown keys are rejected.',
        ),
      termsIncludeNarrower: z
        .boolean()
        .optional()
        .describe('Include the narrower concepts of termKeys.'),
    };

    server.registerTool(
      'list_inquiries',
      {
        title: 'List Inquiries',
        description:
          'List saved questions (standing finding queries) with pagination and filters.',
        inputSchema: {
          search: z.string().optional(),
          status: z.array(z.enum(['ACTIVE', 'ARCHIVED'])).optional(),
          caseId: z
            .string()
            .optional()
            .describe('Filter to a linked case, or "none" for unlinked'),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (query) =>
        jsonResult(await this.inquiriesService.list(query as any)),
    );

    server.registerTool(
      'get_inquiry',
      {
        title: 'Get Inquiry',
        description: 'Fetch a single saved question by ID.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) => {
        const inquiry = await this.inquiriesService.findOne(id);
        if (!inquiry) {
          throw new NotFoundException(`Inquiry with ID ${id} not found`);
        }
        return jsonResult(inquiry);
      },
    );

    server.registerTool(
      'create_inquiry',
      {
        title: 'Create Inquiry',
        description:
          'Create a saved question (a standing finding query). Matches are computed immediately.',
        inputSchema: {
          title: z.string().max(500),
          description: z.string().optional(),
          createdBy: z.string().optional(),
          ...matcherShape,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async (dto) => jsonResult(await this.inquiriesService.create(dto as any)),
    );

    server.registerTool(
      'update_inquiry',
      {
        title: 'Update Inquiry',
        description:
          'Update a saved question. Matches are recomputed if any matcher field is provided.',
        inputSchema: {
          id: z.string().uuid(),
          title: z.string().max(500).optional(),
          description: z.string().optional(),
          status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
          aiMode: z.enum(['INHERIT', 'MANAGED', 'OBSERVE_ONLY']).optional(),
          ...matcherShape,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.inquiriesService.update(id, rest));
      },
    );

    server.registerTool(
      'delete_inquiry',
      {
        title: 'Delete Inquiry',
        description: 'Delete a saved question.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        await this.inquiriesService.remove(id);
        return jsonResult({ deleted: true, inquiryId: id });
      },
    );

    server.registerTool(
      'list_inquiry_matches',
      {
        title: 'List Inquiry Matches',
        description:
          'Findings currently matching a saved question (live query, never ' +
          "persisted). NEW means the latest completed run of the finding's " +
          'source created it; GONE means that run retired it, so it answers ' +
          'the question but no longer exists. Defaults to NEW and ONGOING — ' +
          'ask for GONE by name.',
        inputSchema: {
          id: z.string().uuid(),
          search: z.string().optional(),
          severity: z
            .array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']))
            .optional(),
          state: z.array(z.enum(['NEW', 'ONGOING', 'GONE'])).optional(),
          onlyNew: z.boolean().optional(),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, ...query }) =>
        jsonResult(await this.inquiriesService.listMatches(id, query as any)),
    );

    server.registerTool(
      'rematch_inquiry',
      {
        title: 'Rematch Inquiry',
        description:
          'Recompute the persisted match count for a saved question on demand.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.inquiriesService.rematch(id));
      },
    );

    server.registerTool(
      'preview_inquiry_matchers',
      {
        title: 'Preview Inquiry Matchers',
        description:
          'Preview what a matcher configuration currently selects, before saving a question.',
        inputSchema: {
          ...matcherShape,
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (dto) =>
        jsonResult(await this.inquiriesService.preview(dto as any)),
    );

    server.registerTool(
      'get_inquiry_match_options',
      {
        title: 'Get Inquiry Match Options',
        description:
          'Filter options for building a question: sources, custom detectors, and distinct finding types.',
        inputSchema: {
          sourceIds: z
            .array(z.string())
            .optional()
            .describe('Scope finding type counts to these sources'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceIds }) =>
        jsonResult(await this.inquiriesService.matchOptions(sourceIds)),
    );
  }

  private registerCaseTools(server: McpServerCompat) {
    server.registerTool(
      'search_cases',
      {
        title: 'Search Cases',
        description: 'Search cases with filters and pagination.',
        inputSchema: {
          search: z.string().optional(),
          status: z
            .array(z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED']))
            .optional(),
          severity: z
            .array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']))
            .optional(),
          skip: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (query) => jsonResult(await this.casesService.list(query as any)),
    );

    server.registerTool(
      'get_case',
      {
        title: 'Get Case',
        description:
          'Fetch a single case with evidence, findings, and linked questions.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) => {
        const found = await this.casesService.findOne(id);
        if (!found) {
          throw new NotFoundException(`Case with ID ${id} not found`);
        }
        return jsonResult(found);
      },
    );

    server.registerTool(
      'create_case',
      {
        title: 'Create Case',
        description:
          'Create an investigation case, optionally linking questions.',
        inputSchema: {
          title: z.string().max(300),
          description: z.string().optional(),
          status: z
            .enum(['OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED'])
            .optional(),
          severity: z
            .enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
            .optional(),
          assignee: z.string().optional(),
          createdBy: z.string().optional(),
          inquiryIds: z.array(z.string()).optional(),
          removeGoneFindings: z
            .boolean()
            .optional()
            .describe(
              'Clean-up: findings the scans no longer see (retired by a run, or deleted) leave the case by themselves',
            ),
          removeResolvedFindings: z
            .boolean()
            .optional()
            .describe('Clean-up: findings someone resolved leave the case'),
          removeGoneAssets: z
            .boolean()
            .optional()
            .describe(
              'Clean-up: assets deleted from their source leave the case, with their findings',
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async (dto) => jsonResult(await this.casesService.create(dto as any)),
    );

    const cleanupSwitches = {
      removeGoneFindings: z
        .boolean()
        .optional()
        .describe(
          'Clean-up: findings the scans no longer see (retired by a run, or deleted) leave the case by themselves',
        ),
      removeResolvedFindings: z
        .boolean()
        .optional()
        .describe('Clean-up: findings someone resolved leave the case'),
      removeGoneAssets: z
        .boolean()
        .optional()
        .describe(
          'Clean-up: assets deleted from their source leave the case, with their findings',
        ),
    };

    server.registerTool(
      'update_case',
      {
        title: 'Update Case',
        description:
          'Update case metadata, status, severity, AI mode, or its clean-up ' +
          'switches. Switching a clean-up rule on applies it right away: what it ' +
          'takes out is reported in `cleanup` and written on the case timeline — ' +
          'run preview_case_cleanup first to see how much that is. Closing a ' +
          'case goes through close_case (it needs a conclusion and snapshots ' +
          'the board), not through status here.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
          title: z.string().max(300).optional(),
          description: z.string().optional(),
          status: z
            .enum(['OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED'])
            .optional(),
          severity: z
            .enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
            .optional(),
          assignee: z.string().optional(),
          conclusion: z.string().optional(),
          aiMode: z.enum(['INHERIT', 'MANAGED', 'OBSERVE_ONLY']).optional(),
          ...cleanupSwitches,
        }),
        annotations: {
          readOnlyHint: false,
          // Turning a clean-up switch on takes findings and assets out.
          destructiveHint: true,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.update(id, rest, 'mcp'));
      },
    );

    server.registerTool(
      'preview_case_cleanup',
      {
        title: 'Preview Case Clean-up',
        description:
          "What a case's automatic clean-up would take out right now, without " +
          'changing anything: findings the scans no longer see ' +
          '(removeGoneFindings), findings someone resolved ' +
          '(removeResolvedFindings), and assets deleted from their source, with ' +
          'their findings (removeGoneAssets). Name the switches to preview, or ' +
          'leave them all out to preview all three. Returns a count per switch ' +
          'and a sample. Switching one on (update_case) applies it at once.',
        inputSchema: {
          id: z.string().uuid(),
          ...cleanupSwitches,
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({
        id,
        removeGoneFindings,
        removeResolvedFindings,
        removeGoneAssets,
      }) => {
        const found = await this.casesService.findOne(id);
        if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
        const named =
          removeGoneFindings !== undefined ||
          removeResolvedFindings !== undefined ||
          removeGoneAssets !== undefined;
        const rules = {
          removeGoneFindings: named ? removeGoneFindings === true : true,
          removeResolvedFindings: named
            ? removeResolvedFindings === true
            : true,
          removeGoneAssets: named ? removeGoneAssets === true : true,
        };
        return jsonResult({
          previewed: rules,
          current: {
            removeGoneFindings: found.removeGoneFindings,
            removeResolvedFindings: found.removeResolvedFindings,
            removeGoneAssets: found.removeGoneAssets,
          },
          ...(await this.caseCleanup.previewRules(id, rules)),
        });
      },
    );

    server.registerTool(
      'close_case',
      {
        title: 'Close Case',
        description:
          'Close a case with a conclusion. Linked questions are archived unless they drive another open case, or keepInquiries is true (use it when the questions are standing checks that should keep running after the case is answered).',
        inputSchema: {
          id: z.string().uuid(),
          conclusion: z.string(),
          closedBy: z.string().optional(),
          keepInquiries: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.close(id, rest));
      },
    );

    server.registerTool(
      'reopen_case',
      {
        title: 'Reopen Case',
        description:
          'Reopen a closed/archived case and reactivate the questions that were archived alongside it.',
        inputSchema: {
          id: z.string().uuid(),
          note: z.string().optional(),
          reopenedBy: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.reopen(id, rest));
      },
    );

    server.registerTool(
      'add_case_evidence',
      {
        title: 'Add Case Evidence',
        description: 'Attach an asset as evidence to a case.',
        inputSchema: {
          id: z.string().uuid(),
          entityType: z.string().describe('Must be "asset"'),
          entityId: z.string().describe('Asset UUID'),
          note: z.string().optional(),
          addedBy: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.addEvidence(id, rest));
      },
    );

    server.registerTool(
      'attach_case_findings',
      {
        title: 'Attach Case Findings',
        description:
          'Batch-attach findings to a case by ID. Asset evidence rows are created automatically.',
        inputSchema: {
          id: z.string().uuid(),
          findingIds: z.array(z.string().uuid()),
          addedBy: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.attachFindings(id, rest));
      },
    );

    server.registerTool(
      'pull_case_from_inquiry',
      {
        title: 'Pull Case From Inquiry',
        description:
          "Pull a linked question's current matches into the case as evidence and findings.",
        inputSchema: {
          id: z.string().uuid(),
          inquiryId: z.string(),
          findingIds: z
            .array(z.string())
            .optional()
            .describe('Specific finding IDs (omit = all current matches)'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.pullFromInquiry(id, rest));
      },
    );

    server.registerTool(
      'link_case_inquiries',
      {
        title: 'Link Case Inquiries',
        description:
          'Link additional questions to a case. Already-linked ones are ' +
          'ignored. Ids also named in autoPullInquiryIds will pull their new ' +
          'matches into the case by themselves as later scans land them.',
        inputSchema: {
          id: z.string().uuid(),
          inquiryIds: z.array(z.string()),
          autoPullInquiryIds: z.array(z.string()).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, inquiryIds, autoPullInquiryIds }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.casesService.linkInquiries(id, {
            inquiryIds,
            autoPullInquiryIds,
          }),
        );
      },
    );

    server.registerTool(
      'set_case_inquiry_auto_pull',
      {
        title: 'Set Case Watch Auto-add',
        description:
          "Turn automatic pulling of a linked question's new matches into a " +
          "case on or off (the watch's auto-add). On: matches that later scans " +
          "land join the case by themselves, subject to the case's filters. " +
          'Off: they wait for pull_case_from_inquiry — escalation rules still ' +
          'bring matching answers in. The question must be linked already ' +
          '(link_case_inquiries).',
        inputSchema: {
          id: z.string().uuid(),
          inquiryId: z.string(),
          autoPull: z.boolean(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async ({ id, inquiryId, autoPull }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.casesService.setInquiryAutoPull(
            id,
            inquiryId,
            autoPull === true || String(autoPull) === 'true',
            'mcp',
          ),
        );
      },
    );

    server.registerTool(
      'unlink_case_inquiry',
      {
        title: 'Unlink Case Watch',
        description:
          'Unlink a question (a watch) from a case: the case stops following ' +
          'it. The question itself and the evidence it already brought in stay; ' +
          'the filters and escalation rules scoped to that watch are dropped ' +
          'with the link. To end a case and archive its questions, use ' +
          'close_case instead.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
          inquiryId: z.string(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id, inquiryId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.casesService.unlinkInquiry(id, inquiryId, 'mcp'),
        );
      },
    );

    server.registerTool(
      'list_case_finding_filters',
      {
        title: 'List Case Finding Filters',
        description:
          "A case's finding rules, case-wide (inquiryId null) or for one linked " +
          'question: filters (action EXCLUDE — kinds of finding it does not want) ' +
          'and escalations (action ESCALATE — kinds that need attention). A ' +
          'FINDING_TYPE rule names a finding type exactly; a VALUE_PATTERN rule is ' +
          'a regular expression over the matched value. includeOptions also lists ' +
          'the finding types the case holds and its questions answer, which is ' +
          'what a FINDING_TYPE rule can pick from.',
        inputSchema: {
          id: z.string().uuid(),
          includeOptions: z.boolean().optional(),
          inquiryId: z
            .string()
            .optional()
            .describe('With includeOptions: the types of this one question'),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, includeOptions, inquiryId }) => {
        const filters = await this.caseFindingFilters.list(id);
        if (!includeOptions) return jsonResult({ filters });
        return jsonResult({
          filters,
          options: await this.caseFindingFilters.options(id, inquiryId ?? null),
        });
      },
    );

    server.registerTool(
      'add_case_finding_filters',
      {
        title: 'Add Case Finding Rules',
        description:
          'Add finding rules to a case: filters (action EXCLUDE, the default) or ' +
          'escalations (action ESCALATE). A filter keeps a kind of finding out: ' +
          'matches in the case are detached right away (the timeline lists them), ' +
          "and pulls from the case's questions — automatic ones and pull-everything " +
          '— skip them from then on; attaching one by hand still works. An ' +
          'escalation marks a kind of finding that needs attention: matches already ' +
          'in the case are marked escalated now, and a question brings in new ' +
          'matching answers by itself (even with auto-add off) and raises a ' +
          'notification; filters win over escalations. Scope: omit inquiryId for ' +
          'the whole case, or give a linked question to apply to its answers only. ' +
          'removeEmptiedAssets (filters only) also takes out every asset the filter leaves ' +
          'without a finding in the case. ' +
          'Run with dryRun first: it reports how many findings would be detached or escalated ' +
          '(and emptiedAssets: how many assets would be left without findings).',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
          action: z.enum(['EXCLUDE', 'ESCALATE']).optional(),
          inquiryId: z.string().nullable().optional(),
          rules: z
            .array(
              z.strictObject({
                kind: z.enum(['FINDING_TYPE', 'VALUE_PATTERN']),
                pattern: z.string().min(1).max(500),
                description: z.string().max(1000).optional(),
              }),
            )
            .min(1)
            .max(50),
          removeEmptiedAssets: z.boolean().optional(),
          dryRun: z.boolean().optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id, action, inquiryId, rules, removeEmptiedAssets, dryRun }) => {
        if (dryRun) {
          return jsonResult({
            dryRun: true,
            ...(await this.caseFindingFilters.preview(id, {
              action,
              inquiryId: inquiryId ?? null,
              rules,
            })),
          });
        }
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseFindingFilters.add(
            id,
            {
              action,
              inquiryId: inquiryId ?? null,
              rules,
              removeEmptiedAssets,
            },
            'mcp',
          ),
        );
      },
    );

    server.registerTool(
      'clear_case_escalations',
      {
        title: 'Clear Case Escalations',
        description:
          'Take the escalation mark off findings of a case once a person has ' +
          'dealt with them (all escalated findings when findingIds is omitted). ' +
          'The findings stay in the case; the timeline records the clearing.',
        inputSchema: {
          id: z.string().uuid(),
          findingIds: z
            .array(z.string().uuid())
            .optional()
            .describe('Finding ids (not case-finding ids); omit for all'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, findingIds }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseEscalation.clear(id, findingIds, 'mcp'),
        );
      },
    );

    server.registerTool(
      'remove_case_finding_filter',
      {
        title: 'Remove Case Finding Rule',
        description:
          'Remove one finding rule (filter or escalation) from a case. Findings ' +
          'a filter detached stay detached, and findings an escalation marked stay ' +
          'marked (clear_case_escalations clears them); the questions simply stop ' +
          'applying the rule.',
        inputSchema: {
          id: z.string().uuid(),
          filterId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, filterId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult({
          filters: await this.caseFindingFilters.remove(id, filterId, 'mcp'),
        });
      },
    );

    const findingRuleSchema = z.strictObject({
      kind: z.enum(['FINDING_TYPE', 'VALUE_PATTERN']),
      pattern: z.string().min(1).max(500),
      description: z.string().max(1000).optional(),
    });

    server.registerTool(
      'preview_case_finding_filters',
      {
        title: 'Preview Case Finding Rules',
        description:
          'What unsaved finding rules would do to a case right now, without ' +
          'saving anything: how many findings in the case a filter (action ' +
          'EXCLUDE, the default) would take out or an escalation (ESCALATE) ' +
          'would mark — in total and per rule — with a sample, why a rule ' +
          'could not be saved (`problems`, per rule), and for filters how many ' +
          'assets would be left without a finding in the case (emptiedAssets). ' +
          'Same rules as add_case_finding_filters; also use it to try a new ' +
          'pattern before update_case_finding_filter.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
          action: z.enum(['EXCLUDE', 'ESCALATE']).optional(),
          inquiryId: z
            .string()
            .nullable()
            .optional()
            .describe(
              'A linked question to scope the rules to; omit for the whole case',
            ),
          rules: z.array(findingRuleSchema).min(1).max(50),
        }),
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, action, inquiryId, rules }) =>
        jsonResult(
          await this.caseFindingFilters.preview(id, {
            action,
            inquiryId: inquiryId ?? null,
            rules,
          }),
        ),
    );

    server.registerTool(
      'update_case_finding_filter',
      {
        title: 'Update Case Finding Rule',
        description:
          'Change one finding rule of a case (a filter or an escalation): its ' +
          'pattern and/or description. A new pattern applies at once — a filter ' +
          'takes out the findings it now matches (removeEmptiedAssets also takes ' +
          'out assets left without a finding in the case), an escalation marks ' +
          'them — and the timeline records the change. Try the new pattern with ' +
          "preview_case_finding_filters first. A rule's kind, action and scope " +
          'cannot change: remove it (remove_case_finding_filter) and add another.',
        inputSchema: z.strictObject({
          id: z.string().uuid(),
          filterId: z.string().uuid(),
          pattern: z.string().min(1).max(500).optional(),
          description: z.string().max(1000).nullable().optional(),
          removeEmptiedAssets: z.boolean().optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id, filterId, pattern, description, removeEmptiedAssets }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseFindingFilters.update(
            id,
            filterId,
            { pattern, description, removeEmptiedAssets },
            'mcp',
          ),
        );
      },
    );

    server.registerTool(
      'get_inquiry_timeline',
      {
        title: 'Get Inquiry Timeline',
        description:
          "A saved question's own history: matcher changes, and what each run " +
          "landed or retired. The durable record — a match's NEW state is " +
          'live and expires the next time its source runs, but the run that ' +
          'produced it stays here.',
        inputSchema: {
          id: z.string().uuid(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, cursor, limit }) =>
        jsonResult(await this.inquiriesService.timeline(id, cursor, limit)),
    );

    server.registerTool(
      'get_case_graph',
      {
        title: 'Get Case Graph',
        description: 'Get the evidence neighbourhood graph for a case.',
        inputSchema: {
          id: z.string().uuid(),
          depth: z.number().int().min(1).max(5).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id, depth }) =>
        jsonResult(await this.casesService.getGraph(id, depth ?? 1)),
    );

    server.registerTool(
      'get_case_timeline',
      {
        title: 'Get Case Timeline',
        description:
          'Paginated unified case activity feed (newest first). Narrow it with `types` (e.g. FINDINGS_ESCALATED, FINDINGS_AUTO_REMOVED) or to one linked watch with `inquiryId`.',
        inputSchema: {
          caseId: z.string().uuid(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          types: z
            .array(
              z.enum(Object.values(CaseActivityType) as [string, ...string[]]),
            )
            .max(20)
            .optional()
            .describe('Only these activity types'),
          inquiryId: z.string().uuid().optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId, cursor, limit, types, inquiryId }) =>
        jsonResult(
          await this.caseActivityService.getTimeline(
            caseId,
            cursor,
            limit ?? 50,
            { types: types as CaseActivityType[] | undefined, inquiryId },
          ),
        ),
    );

    server.registerTool(
      'list_case_threads',
      {
        title: 'List Case Threads',
        description: 'List threads (hypothesis + discussion) for a case.',
        inputSchema: {
          caseId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId }) =>
        jsonResult(await this.caseThreadsService.list(caseId)),
    );

    server.registerTool(
      'create_case_thread',
      {
        title: 'Create Case Thread',
        description:
          'Create a thread on a case: a HYPOTHESIS (with status/confidence) or a DISCUSSION.',
        inputSchema: {
          caseId: z.string().uuid(),
          kind: z
            .enum(['HYPOTHESIS', 'DISCUSSION'])
            .optional()
            .describe('Defaults to HYPOTHESIS'),
          title: z.string().describe('Hypothesis name or discussion topic'),
          statement: z
            .string()
            .optional()
            .describe('Initial statement body (hypothesis threads)'),
          status: z
            .enum(['PROPOSED', 'SUPPORTED', 'REFUTED', 'INCONCLUSIVE'])
            .optional(),
          confidence: z.number().min(0).max(1).optional(),
          createdBy: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ caseId, kind, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseThreadsService.create(caseId, {
            kind: kind ?? CaseThreadKind.HYPOTHESIS,
            ...rest,
          }),
        );
      },
    );

    server.registerTool(
      'add_case_thread_entry',
      {
        title: 'Add Case Thread Entry',
        description:
          "Add an entry to a thread's log. NOTE is commentary and leaves the " +
          'title alone; STATEMENT revises the claim itself, and the thread ' +
          'title becomes the first 200 characters of its body. STATUS_CHANGE ' +
          'and CONFIDENCE_CHANGE entries only record a remark — they do not ' +
          "change the thread: use update_case_thread to change a hypothesis's " +
          'status or confidence (it logs the change itself).',
        inputSchema: {
          threadId: z.string().uuid(),
          entryType: z.enum([
            'NOTE',
            'STATEMENT',
            'STATUS_CHANGE',
            'CONFIDENCE_CHANGE',
          ]),
          body: z.string().optional(),
          author: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ threadId, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseThreadsService.addEntry(threadId, rest),
        );
      },
    );

    server.registerTool(
      'update_case_thread',
      {
        title: 'Update Case Thread',
        description:
          'Update a hypothesis or discussion thread: its title, its colour on ' +
          'the board, its verdict (status PROPOSED, SUPPORTED, REFUTED or ' +
          'INCONCLUSIVE), its confidence (0–1) or its testable predicate. A ' +
          "status or confidence change is written into the thread's log " +
          '(STATUS_CHANGE / CONFIDENCE_CHANGE) and on the case timeline, so ' +
          'the evolution of a hypothesis stays on record. To revise the claim ' +
          'itself, add a STATEMENT entry (add_case_thread_entry) instead.',
        inputSchema: z.strictObject({
          threadId: z.string().uuid(),
          title: z.string().min(1).max(200).optional(),
          status: z
            .enum(['PROPOSED', 'SUPPORTED', 'REFUTED', 'INCONCLUSIVE'])
            .optional(),
          confidence: z.number().min(0).max(1).optional(),
          color: z
            .string()
            .max(32)
            .nullable()
            .optional()
            .describe('A CSS colour such as #3b82f6; null for the default'),
          testablePredicate: z.string().max(2000).nullable().optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async ({ threadId, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseThreadsService.update(threadId, {
            ...rest,
            actor: 'mcp',
          }),
        );
      },
    );

    server.registerTool(
      'link_case_thread_support',
      {
        title: 'Link Case Thread Support',
        description:
          'Link evidence or a finding to a thread as supporting/contradicting/neutral.',
        inputSchema: {
          threadId: z.string().uuid(),
          targetType: z.enum(['evidence', 'finding']),
          targetId: z.string(),
          stance: z.enum(['SUPPORTS', 'CONTRADICTS', 'NEUTRAL']).optional(),
          weight: z.number().min(0).max(1).optional(),
          note: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ threadId, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseThreadsService.linkSupport(threadId, rest),
        );
      },
    );
  }

  /**
   * The case board: the canvas a case is arranged on (its own token scope,
   * `case_board`). Reads come as a labelled summary; every write is ops
   * through CaseBoardService.applyOps, the board's only write path, so the
   * timeline, version and live push behave as for a person's edit.
   */
  private registerCaseBoardTools(server: McpServerCompat) {
    const endpointHint =
      'An endpoint is {itemId, findingId?}: a board item, optionally one ' +
      'finding of an EVIDENCE item.';

    server.registerTool(
      'get_case_board',
      {
        title: 'Get Case Board',
        description:
          "Read a case's board, the canvas the case is arranged on. By default " +
          'a labelled summary: every item with what it stands for — EVIDENCE ' +
          '(the asset, and the findings the case holds on it with their state: ' +
          'open, new, gone, resolved, dismissed or deleted), HYPOTHESIS (title, ' +
          'status, confidence, stance counts), NOTE (its text), FRAME (title, ' +
          'number of members) and COMMENT pins (latest text, what they are ' +
          'pinned to) — plus the links drawn between items or single findings, ' +
          'hypothesis stances, the platform relations between the evidence ' +
          '(lineage, duplicates: drawn by the board, not editable) and threads ' +
          'not on the board. x/y of an item with a parentId (inside a frame, or ' +
          'a comment pin) are relative to that parent; `unplaced` items have no ' +
          'position yet (place_case_board_items gives them one). board.version ' +
          'is the baseVersion for apply_case_board_ops. view "full" returns the ' +
          'raw board payload instead (large; the neighbourhood graph only with ' +
          'includeGraph). snapshotId reads a snapshot (list_case_board_snapshots) ' +
          'in the same shape: the board exactly as it was captured.',
        inputSchema: {
          caseId: z.string().uuid(),
          view: z.enum(['summary', 'full']).optional(),
          includeGraph: z
            .boolean()
            .optional()
            .describe('view "full" only: include the neighbourhood graph'),
          snapshotId: z.string().uuid().optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId, view, includeGraph, snapshotId }) =>
        jsonResult(
          await this.caseBoardTools.view(caseId, {
            view,
            includeGraph,
            snapshotId,
          }),
        ),
    );

    // opId only labels an op in `applied` / `rejected`; making it optional
    // spares a client a UUID per op. Every op object stays strict.
    const opOptions = BoardOpSchema.options.map((option) =>
      option.extend({ opId: z.string().min(1).max(100).optional() }),
    );
    const mcpBoardOp = z.discriminatedUnion(
      'type',
      opOptions as unknown as [
        (typeof opOptions)[number],
        ...(typeof opOptions)[number][],
      ],
    );

    server.registerTool(
      'apply_case_board_ops',
      {
        title: 'Apply Case Board Ops',
        description: [
          "Change a case's board with a batch of ops, applied in order in one",
          'transaction; each op succeeds or is rejected on its own (`rejected`,',
          'with a reason and a code such as NOT_FOUND, STALE or ALREADY_ON_BOARD).',
          'Read the board first (get_case_board) for item ids, and pass its',
          'board.version as baseVersion. Ids of new things are yours: give every',
          'new item or link a fresh UUID (id / itemId), so a resent batch is',
          'harmless and later ops of the same batch can refer to it. opId is',
          `optional (op-1, op-2, … in the result). ${endpointHint}`,
          'Ops: item.create (NOTE with content.text, FRAME with content.title),',
          'item.update (x, y, width, height, z, parentId — a FRAME to put the item',
          'in, null to take it out —, collapsed, style: color, highlight,',
          'rowHighlights per finding, findingPositions; content), item.delete and',
          'item.restore (notes, frames, comment pins and hypothesis cards: a card',
          'leaves the board, its thread stays; never evidence),',
          'link.create/update/delete/restore (kind such as related_to,',
          'same_entity, communicates_with, derived_from, contradicts, precedes or',
          'your own; certainty CONFIRMED or SUSPECTED; confidence 0–1),',
          'link.promote (copies a link between evidence into the global graph,',
          'for every case), evidence.add (an asset, or a finding, which brings its',
          'asset) and evidence.remove, finding.attach/detach, hypothesis.create',
          '(optionally with supports), stance.set/remove (SUPPORTS, CONTRADICTS,',
          'NEUTRAL), comment.create/resolve and thread.place. x/y may be left out',
          'of evidence.add, hypothesis.create, comment.create and thread.place:',
          'then call place_case_board_items to give them a spot. x/y inside a',
          'frame are relative to the frame. Every delete can be undone with the',
          'matching restore. Closed cases are read-only.',
        ].join(' '),
        inputSchema: z.strictObject({
          caseId: z.string().uuid(),
          baseVersion: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              'board.version you read; defaults to the current version',
            ),
          ops: z.array(mcpBoardOp).min(1).max(BOARD_MAX_OPS_PER_BATCH),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId, baseVersion, ops }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const version =
          baseVersion ?? (await this.caseBoardRead.currentVersion(caseId));
        return jsonResult(
          await this.caseBoardService.applyOps(
            caseId,
            {
              clientId: randomUUID(),
              baseVersion: version,
              ops: ops.map((op, i) => ({
                ...op,
                opId: op.opId ?? `op-${i + 1}`,
              })),
            },
            'mcp',
          ),
        );
      },
    );

    server.registerTool(
      'place_case_board_items',
      {
        title: 'Place Case Board Items',
        description:
          "Give every item on a case's board that has no position yet — " +
          'evidence, hypotheses or comments added without x/y, by an agent, a ' +
          'watch or a lead — a spot next to what it connects to: what the board ' +
          'does by itself when someone opens it, done now. Comment pins go by ' +
          'the item they annotate; items with nothing on the board to sit next ' +
          'to go into one block right of the board; a board with nothing placed ' +
          'gets one layered layout. Never moves an item that already has a ' +
          'position. Returns each placed item with its position, and the new ' +
          'board version.',
        inputSchema: {
          caseId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async ({ caseId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.caseBoardTools.place(caseId, 'mcp'));
      },
    );

    server.registerTool(
      'tidy_case_board',
      {
        title: 'Tidy Up Case Board',
        description:
          "Tidy up a case's board, like the board's own Tidy up: lay everything " +
          'at the top level out again, left to right along its relations (what ' +
          'feeds or supports something sits left of it), each connected group ' +
          'together and the groups packed side by side; items in a frame move ' +
          'with their frame, dragged findings go back to their spots around ' +
          'their asset, and items without a position get one. This replaces the ' +
          'arrangement people made: run it with dryRun first to see the moves, ' +
          'prefer place_case_board_items when only new items need a spot, and ' +
          'take_case_board_snapshot first if the current arrangement matters. ' +
          'Every move says where the item was (`from`); to walk a tidy back, ' +
          'send those positions as item.update ops (apply_case_board_ops).',
        inputSchema: z.strictObject({
          caseId: z.string().uuid(),
          dryRun: z.boolean().optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId, dryRun }) => {
        if (!dryRun) this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseBoardTools.tidy(caseId, { dryRun }, 'mcp'),
        );
      },
    );

    server.registerTool(
      'frame_case_board_items',
      {
        title: 'Frame Case Board Items',
        description:
          "Group items on a case's board into a frame, a named box whose members " +
          'move with it. Pass `title` (and optionally `color`) for a new frame, ' +
          'or `frameId` for one already on the board (a `title` then renames ' +
          'it). A new frame lays its members out anew inside, relations left to ' +
          'right, where they were and clear of everything else (arrangement ' +
          '"compact", the default); "keep" wraps them where they stand. Into an ' +
          'existing frame each item takes the next free spot and the frame grows ' +
          'to fit. Items in another frame move over; comment pins stay with the ' +
          'item they annotate. Returns the frame, where each member landed (x/y ' +
          'relative to the frame, and where it was), and what was skipped and why.',
        inputSchema: {
          caseId: z.string().uuid(),
          itemIds: z.array(z.string().uuid()).min(1).max(100),
          title: z.string().trim().min(1).max(200).optional(),
          frameId: z.string().uuid().optional(),
          color: z.enum(BOARD_COLORS).optional(),
          arrangement: z.enum(['compact', 'keep']).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ caseId, itemIds, title, frameId, color, arrangement }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseBoardTools.frame(
            caseId,
            { itemIds, title, frameId, color, arrangement },
            'mcp',
          ),
        );
      },
    );

    server.registerTool(
      'trace_case_connections',
      {
        title: 'Trace Case Connections',
        description:
          'Show connections: what the assets of a case connect to beyond its ' +
          'board, hop by hop through the global graph — upstream (what feeds ' +
          'them: lineage), downstream (what they feed) and alongside ' +
          '(duplicates, look-alikes, drawn links). Traces from every asset in ' +
          'the case unless assetIds names some. kinds narrows which relations ' +
          'are followed; depth is hops (1–6, 6 meaning as far as it goes; ' +
          'default 2); limit caps the nodes returned (default 150, at most ' +
          '300), and `truncated` says when it was hit. Each node says whether ' +
          'it is in the case already (inCase, with its board itemId), which ' +
          'side it is on and which node it was reached from (via). Add one to ' +
          'the case with apply_case_board_ops evidence.add.',
        inputSchema: {
          caseId: z.string().uuid(),
          assetIds: z.array(z.string().min(1).max(200)).max(500).optional(),
          direction: z.enum(['up', 'down', 'both']).optional(),
          depth: z.number().int().min(1).max(TRACE_MAX_DEPTH).optional(),
          kinds: z.array(z.enum(TRACE_KINDS)).min(1).max(4).optional(),
          limit: z.number().int().min(1).max(300).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId, assetIds, direction, depth, kinds, limit }) =>
        jsonResult(
          await this.caseBoardTools.trace(caseId, {
            assetIds,
            direction,
            depth,
            kinds,
            limit,
          }),
        ),
    );

    server.registerTool(
      'list_case_board_snapshots',
      {
        title: 'List Case Board Snapshots',
        description:
          "A case board's snapshots, newest first: frozen copies of the board " +
          'taken when the case closed (reason CASE_CLOSED) or on request ' +
          '(MANUAL). Read one with get_case_board and its snapshotId.',
        inputSchema: {
          caseId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId }) =>
        jsonResult({
          snapshots: await this.caseBoardRead.listSnapshots(caseId),
        }),
    );

    server.registerTool(
      'take_case_board_snapshot',
      {
        title: 'Take Case Board Snapshot',
        description:
          "Capture a case's board as it is now in an immutable snapshot (kept " +
          'for good; the case timeline records it). Take one before a big ' +
          'rearrangement (tidy_case_board) or before handing a case over, so ' +
          'the arrangement a conclusion was drawn from survives later edits.',
        inputSchema: {
          caseId: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ caseId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.caseBoardRead.takeSnapshot(caseId, 'MANUAL', 'mcp'),
        );
      },
    );
  }

  private registerCorrelationTools(server: McpServerCompat) {
    server.registerTool(
      'get_correlation_config',
      {
        title: 'Get Correlation Config',
        description:
          'Correlation tuning: per-label weights (dynamic) plus related/duplicate match thresholds.',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async () => jsonResult(await this.correlationService.getConfig()),
    );

    server.registerTool(
      'save_correlation_config',
      {
        title: 'Save Correlation Config',
        description:
          'Update correlation tuning (weights/thresholds/exclusions) and schedule a background recompute.',
        inputSchema: {
          defaultWeight: z.number().int().min(0).max(100).optional(),
          relatedMin: z.number().min(0).max(1).optional(),
          duplicateMin: z.number().min(0).max(1).optional(),
          labelWeights: z
            .record(z.string(), z.number())
            .optional()
            .describe('Per-label weight overrides'),
          exclusions: z
            .array(
              z.object({
                id: z.string().optional(),
                mode: z.enum(['value', 'regex', 'label']),
                label: z.string().nullable().optional(),
                value: z.string().nullable().optional(),
              }),
            )
            .optional()
            .describe('Full replacement list of exclusion rules'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async (dto) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const saved = await this.correlationService.saveConfig(dto);
        // The status below promised this; nothing scheduled it (field report P6).
        await this.correlationService.scheduleFullRecompute(
          'correlation config updated (MCP)',
        );
        // Re-read so `recompute` describes what actually happens — including
        // "nothing, duplicate detection is off".
        const config = await this.correlationService.getConfig(saved.recompute);
        return jsonResult({
          config,
          status: config.enabled
            ? 'Config saved; a background recompute has been scheduled.'
            : `Config saved. ${config.recompute.note}`,
        });
      },
    );

    server.registerTool(
      'add_correlation_exclusion',
      {
        title: 'Add Correlation Exclusion',
        description:
          'Add a correlation exclusion rule (ignore a noisy value/regex/label) and schedule a background recompute.',
        inputSchema: {
          mode: z.enum(['value', 'regex', 'label']),
          label: z.string().nullable().optional(),
          value: z.string().nullable().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ mode, label, value }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const config = await this.correlationService.addExclusion({
          mode,
          label: label ?? null,
          value: value ?? null,
        });
        await this.correlationService.scheduleFullRecompute(
          'correlation exclusion added (MCP)',
        );
        return jsonResult({
          config,
          status: config.enabled
            ? 'Exclusion added; a background recompute has been scheduled.'
            : `Exclusion added. ${config.recompute.note}`,
        });
      },
    );

    server.registerTool(
      'remove_correlation_exclusion',
      {
        title: 'Remove Correlation Exclusion',
        description:
          'Remove a correlation exclusion rule by ID and schedule a background recompute.',
        inputSchema: {
          id: z.string(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        const config = await this.correlationService.removeExclusion(id);
        await this.correlationService.scheduleFullRecompute(
          'correlation exclusion removed (MCP)',
        );
        return jsonResult({
          config,
          status: config.enabled
            ? 'Exclusion removed; a background recompute has been scheduled.'
            : `Exclusion removed. ${config.recompute.note}`,
        });
      },
    );

    server.registerTool(
      'recompute_correlation',
      {
        title: 'Recompute Correlation',
        description:
          'Recompute correlation. Pass assetId to recompute a single asset synchronously; omit it to schedule a full background recompute (avoids blocking on large instances).',
        inputSchema: {
          assetId: z
            .string()
            .uuid()
            .optional()
            .describe('Recompute just this asset synchronously'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ assetId }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        // Explicit request: say why nothing happens rather than report a
        // recompute that the switched-off scheduler silently refused.
        await this.correlationService.assertEnabled();
        if (assetId) {
          const summary =
            await this.correlationService.recomputeForAsset(assetId);
          return jsonResult({ scheduled: false, summary });
        }
        await this.correlationService.scheduleFullRecompute(
          'MCP recompute request',
          true,
        );
        return jsonResult({
          scheduled: true,
          status: 'Full correlation recompute scheduled in the background.',
        });
      },
    );

    server.registerTool(
      'get_value_occurrences',
      {
        title: 'Get Value Occurrences',
        description:
          'Where else a normalized finding value appears across assets (reverse index).',
        inputSchema: {
          label: z.string().optional(),
          value: z.string().optional(),
          valueHash: z.string().optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args) =>
        jsonResult(await this.correlationService.getValueOccurrences(args)),
    );
  }

  private async requireSource(id: string) {
    const source = await this.sourceService.source({ id });
    if (!source) {
      throw new NotFoundException(`Source with ID ${id} not found`);
    }
    return source;
  }
}
