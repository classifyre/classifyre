import { Injectable, NotFoundException } from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';

import * as z from 'zod';
import { AssetService } from './asset.service';
import { CliRunnerService } from './cli-runner/cli-runner.service';
import { CustomDetectorsService } from './custom-detectors.service';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';
import { FindingsService } from './findings.service';
import { MCP_CAPABILITY_GROUPS, MCP_PROMPTS } from './mcp-catalog';
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
import { PgBossService } from './scheduler/pg-boss.service';
import { CORRELATION_QUEUE } from './correlation/correlation.constants';
import { CaseThreadKind } from '@prisma/client';
import { EmbeddingService } from './embedding/embedding.service';

const jsonObjectSchema = z.record(z.string(), z.unknown());

// Zod 4.4.x introduced a type incompatibility with @modelcontextprotocol/sdk's AnySchema.
// This adapter type uses z.ZodTypeAny (which Zod 4.4.x classic types do extend) so that
// raw shape objects can be passed to registerTool/registerPrompt without type errors.
// Tracking issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/1987
type McpZodShape = Record<string, z.ZodTypeAny>;
type McpServerCompat = Omit<McpServer, 'registerTool' | 'registerPrompt'> & {
  registerTool<T extends McpZodShape>(
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
    cb: (args: { [K in keyof T]: z.infer<T[K]> }, extra: unknown) => unknown,
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

function jsonResult(payload: unknown) {
  const structuredContent =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : { result: payload };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
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
    private readonly pgBossService: PgBossService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  createServer(): McpServer {
    const server = new McpServer({
      name: 'classifyre-mcp',
      version: '1.0.0',
    });

    const srv = server as unknown as McpServerCompat;
    this.registerResources(srv);
    this.registerPrompts(srv);
    this.registerSourceTools(srv);
    this.registerCustomDetectorTools(srv);
    this.registerExtractionTools(srv);
    this.registerRunTools(srv);
    this.registerFindingTools(srv);
    this.registerAssetTools(srv);
    this.registerInquiryTools(srv);
    this.registerCaseTools(srv);
    this.registerCorrelationTools(srv);
    return server;
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
        description: 'Fetch a single source by ID.',
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ id }) => {
        const source = await this.sourceService.source({ id });
        if (!source) {
          throw new NotFoundException(`Source with ID ${id} not found`);
        }
        return jsonResult(source);
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
        inputSchema: {
          id: z.string().uuid(),
        },
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
          config: jsonObjectSchema,
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      ({ type, config }) => {
        try {
          const normalizedConfig = this.validationService.validate(
            type,
            config,
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

  private registerCustomDetectorTools(server: McpServerCompat) {
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
          'Return starter examples for ruleset, classifier, and entity detector authoring.',
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
          'Create a custom detector. The pipeline_schema.type selects the engine: GLINER2 (default), REGEX, LLM (AI), TEXT_CLASSIFICATION, IMAGE_CLASSIFICATION, or OBJECT_DETECTION. GLiNER2 needs at least one entity or classification task. LLM detectors require aiProviderConfigId and a system_prompt.',
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
            'Pipeline schema. GLiNER2 example: { type: "GLINER2", entities: { order_id: { description: "Order ID like ORD-123", required: true } }, classification: { intent: { labels: ["refund", "bug"], multi_label: false } } }. LLM (AI) example: { type: "LLM", system_prompt: "Classify the sentiment of the text.", labels: [{ name: "good" }, { name: "bad" }, { name: "violent" }], severity_map: [{ pattern: "violent", severity: "critical" }], output_fields: [{ name: "language", type: "string" }] }',
          ),
          isActive: z.boolean().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ pipeline_schema, ...rest }) =>
        jsonResult(
          await this.mcpToolExecutor.createCustomDetector({
            ...rest,
            pipelineSchema: pipeline_schema,
          }),
        ),
    );

    server.registerTool(
      'update_custom_detector',
      {
        title: 'Update Custom Detector',
        description:
          'Update detector metadata, pipeline schema, AI provider credential, or activation status.',
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
        inputSchema: {
          id: z.string().uuid(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
        },
      },
      async ({ id }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.customDetectorsService.delete(id));
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
          'Create a test scenario for a custom detector. Expected outcome mirrors the unified pipeline output: { entities: { label: [{value, confidence}] }, classification: { task: {label, confidence} } }.',
        inputSchema: {
          detector_id: z.string(),
          name: z.string().describe('Short scenario name'),
          description: z.string().optional(),
          input_text: z.string().describe('Text to test against the detector'),
          expected_outcome: z
            .record(z.string(), z.unknown())
            .describe('Expected outcome — shape varies by method'),
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
        expected_outcome,
      }) =>
        jsonResult(
          await this.mcpToolExecutor.createDetectorTestScenario({
            detectorId: detector_id,
            name,
            description,
            inputText: input_text,
            expectedOutcome: expected_outcome,
          }),
        ),
    );

    server.registerTool(
      'run_detector_tests',
      {
        title: 'Run Detector Tests',
        description:
          'Run all test scenarios for a custom detector and return a pass/fail matrix.',
        inputSchema: {
          detector_id: z.string(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ detector_id }) =>
        jsonResult(
          await this.mcpToolExecutor.runDetectorTests({
            detectorId: detector_id,
            triggeredBy: 'ASSISTANT',
          }),
        ),
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
            .enum(['PENDING', 'RUNNING', 'COMPLETED', 'WARNING', 'ERROR'])
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
        description: 'Stop a currently running job.',
        inputSchema: {
          runnerId: z.string().uuid(),
        },
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
          'Find repeated or near-duplicate finding groups in a source, ordered by cluster size. Use this to separate bulk boilerplate from distinctive evidence.',
        inputSchema: {
          sourceId: z.string().uuid(),
          threshold: z.number().min(0.8).max(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ sourceId, threshold, limit }) =>
        jsonResult(
          await this.embeddingService.boilerplateClusters(
            sourceId,
            threshold ?? 0.95,
            limit ?? 50,
          ),
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
          'Bulk update findings by IDs or by filters, including status, severity, and comment.',
        inputSchema: {
          ids: z.array(z.string().uuid()).optional(),
          filters: jsonObjectSchema.optional(),
          status: z
            .enum(['OPEN', 'RESOLVED', 'FALSE_POSITIVE', 'IGNORED'])
            .optional(),
          severity: z
            .enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
            .optional(),
          comment: z.string().optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async (args) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.findingsService.bulkUpdate(args));
      },
    );

    server.registerTool(
      'get_findings_discovery',
      {
        title: 'Get Findings Discovery',
        description:
          'Return discovery totals, activity, and top assets for findings.',
        inputSchema: {
          windowDays: z.number().int().min(1).max(365).optional(),
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
        inputSchema: {
          id: z.string().uuid(),
        },
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
          'Findings currently matching a saved question (live query, never persisted).',
        inputSchema: {
          id: z.string().uuid(),
          search: z.string().optional(),
          severity: z
            .array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']))
            .optional(),
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
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async (dto) => jsonResult(await this.casesService.create(dto as any)),
    );

    server.registerTool(
      'update_case',
      {
        title: 'Update Case',
        description: 'Update case metadata, status, severity, or AI mode.',
        inputSchema: {
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
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, ...rest }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(await this.casesService.update(id, rest));
      },
    );

    server.registerTool(
      'close_case',
      {
        title: 'Close Case',
        description:
          'Close a case with a conclusion. Linked questions are archived unless they drive another open case.',
        inputSchema: {
          id: z.string().uuid(),
          conclusion: z.string(),
          closedBy: z.string().optional(),
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
          'Link additional questions to a case. Already-linked ones are ignored.',
        inputSchema: {
          id: z.string().uuid(),
          inquiryIds: z.array(z.string()),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ id, inquiryIds }) => {
        this.mcpToolExecutor.assertNotDemoMode();
        return jsonResult(
          await this.casesService.linkInquiries(id, { inquiryIds }),
        );
      },
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
        description: 'Paginated unified case activity feed (newest first).',
        inputSchema: {
          caseId: z.string().uuid(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ caseId, cursor, limit }) =>
        jsonResult(
          await this.caseActivityService.getTimeline(
            caseId,
            cursor,
            limit ?? 50,
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
          'Add a note, statement revision, or status entry to a thread.',
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

  private registerCorrelationTools(server: McpServerCompat) {
    /** Recompute everything in the background; mirrors CorrelationController's private helper. */
    const scheduleRecompute = async (): Promise<void> => {
      try {
        const boss = await this.pgBossService.getBossAsync();
        await boss.send(
          CORRELATION_QUEUE,
          { recomputeAll: true },
          {
            singletonKey: 'correlation:recompute-all',
            expireInSeconds: 6 * 3600,
          },
        );
      } catch {
        // Non-fatal: config is saved; it will apply on the next scan recompute.
      }
    };

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
        const config = await this.correlationService.saveConfig(dto);
        await scheduleRecompute();
        return jsonResult({
          config,
          status: 'Config saved; a background recompute has been scheduled.',
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
        await scheduleRecompute();
        return jsonResult({
          config,
          status: 'Exclusion added; a background recompute has been scheduled.',
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
        await scheduleRecompute();
        return jsonResult({
          config,
          status:
            'Exclusion removed; a background recompute has been scheduled.',
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
        if (assetId) {
          const summary =
            await this.correlationService.recomputeForAsset(assetId);
          return jsonResult({ scheduled: false, summary });
        }
        await scheduleRecompute();
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
