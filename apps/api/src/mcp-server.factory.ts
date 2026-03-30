import { Injectable, NotFoundException } from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { RunnerStatus } from '@prisma/client';
import * as z from 'zod/v4';
import { AssetService } from './asset.service';
import { CliRunnerService } from './cli-runner/cli-runner.service';
import { CustomDetectorsService } from './custom-detectors.service';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';
import { FindingsService } from './findings.service';
import { MCP_CAPABILITY_GROUPS, MCP_PROMPTS } from './mcp-catalog';
import { McpOverviewService } from './mcp-overview.service';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { GlossaryService } from './semantic-layer/glossary.service';
import { MetricEngineService } from './semantic-layer/metric-engine.service';
import { MetricsService } from './semantic-layer/metrics.service';
import { SourceService } from './source.service';

const jsonObjectSchema = z.record(z.string(), z.unknown());

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
    private readonly glossaryService: GlossaryService,
    private readonly metricsService: MetricsService,
    private readonly metricEngineService: MetricEngineService,
  ) {}

  createServer(): McpServer {
    const server = new McpServer({
      name: 'classifyre-mcp',
      version: '1.0.0',
    });

    this.registerResources(server);
    this.registerPrompts(server);
    this.registerSourceTools(server);
    this.registerCustomDetectorTools(server);
    this.registerExtractionTools(server);
    this.registerRunTools(server);
    this.registerFindingTools(server);
    this.registerAssetTools(server);
    this.registerSemanticLayerTools(server);

    return server;
  }

  private registerResources(server: McpServer) {
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

  private registerPrompts(server: McpServer) {
    server.registerPrompt(
      MCP_PROMPTS[0].name,
      {
        title: MCP_PROMPTS[0].title,
        description: MCP_PROMPTS[0].description,
        argsSchema: {
          useCase: z.string(),
          dataExamples: z.string().optional(),
          preferredMethod: z
            .enum(['RULESET', 'CLASSIFIER', 'ENTITY'])
            .optional(),
        },
      },
      ({ useCase, dataExamples, preferredMethod }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Design an Classifyre custom detector for this use case: ${useCase}.\n` +
                `Prefer one of RULESET, CLASSIFIER, or ENTITY${
                  preferredMethod ? ` (${preferredMethod})` : ''
                }.\n` +
                `Return practical guidance for detector config, training data, and follow-up MCP tool calls.\n` +
                (dataExamples
                  ? `Relevant examples or patterns:\n${dataExamples}\n`
                  : ''),
            },
          },
        ],
      }),
    );
  }

  private registerSourceTools(server: McpServer) {
    server.registerTool(
      'search_sources',
      {
        title: 'Search Sources',
        description: 'Search and filter sources with latest runner summaries.',
        inputSchema: {
          filters: jsonObjectSchema.optional(),
          page: jsonObjectSchema.optional(),
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
          destructiveHint: true,
        },
      },
      async ({ id }) => {
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
      },
      async ({ sourceId, triggerType, triggeredBy }) =>
        jsonResult(
          await this.cliRunnerService.startRun(
            sourceId,
            triggerType as any,
            triggeredBy,
          ),
        ),
    );
  }

  private registerCustomDetectorTools(server: McpServer) {
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
          'Create a custom detector for ruleset, classifier, or entity methods.',
        inputSchema: {
          key: z.string().optional(),
          name: z.string(),
          description: z.string().optional(),
          method: z.enum(['RULESET', 'CLASSIFIER', 'ENTITY']),
          config: jsonObjectSchema.optional(),
          isActive: z.boolean().optional(),
        },
      },
      async (args) =>
        jsonResult(await this.mcpToolExecutor.createCustomDetector(args)),
    );

    server.registerTool(
      'update_custom_detector',
      {
        title: 'Update Custom Detector',
        description: 'Update detector metadata, config, or activation status.',
        inputSchema: {
          id: z.string().uuid(),
          key: z.string().optional(),
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          method: z.enum(['RULESET', 'CLASSIFIER', 'ENTITY']).optional(),
          config: jsonObjectSchema.optional(),
          isActive: z.boolean().optional(),
        },
      },
      async ({ id, ...rest }) =>
        jsonResult(await this.customDetectorsService.update(id, rest as any)),
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
          destructiveHint: true,
        },
      },
      async ({ id }) =>
        jsonResult(await this.customDetectorsService.delete(id)),
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
          'Create a test scenario for a custom detector. Provide expected outcome matching the detector method: RULESET={shouldMatch:bool}, CLASSIFIER={label:string,minConfidence?:number}, ENTITY={entities:[{label,text?}]}.',
        inputSchema: {
          detector_id: z.string(),
          name: z.string().describe('Short scenario name'),
          description: z.string().optional(),
          input_text: z.string().describe('Text to test against the detector'),
          expected_outcome: z
            .record(z.string(), z.unknown())
            .describe('Expected outcome — shape varies by method'),
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
      },
      async ({ detector_id }) =>
        jsonResult(
          await this.mcpToolExecutor.runDetectorTests({
            detectorId: detector_id,
            triggeredBy: 'ASSISTANT',
          }),
        ),
    );
  }

  private registerExtractionTools(server: McpServer) {
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
          populated_field: z
            .string()
            .optional()
            .describe('Only return extractions where this field is populated'),
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
          populatedField: params.populated_field,
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
        const config = detector.config;
        const extractor = config.extractor ?? null;
        const recent = await extractionsService.search({
          customDetectorId: custom_detector_id,
          take: 1,
        });
        const result = {
          extractor_config: extractor,
          recent_example: recent.items[0]?.extractedData ?? null,
          total_extractions: recent.total,
        };
        return jsonResult(result);
      },
    );
  }

  private registerRunTools(server: McpServer) {
    server.registerTool(
      'search_runs',
      {
        title: 'Search Runs',
        description: 'Search runner history with filters and pagination.',
        inputSchema: {
          filters: jsonObjectSchema.optional(),
          page: jsonObjectSchema.optional(),
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
            .enum(['PENDING', 'RUNNING', 'COMPLETED', 'ERROR'])
            .optional(),
          skip: z.number().int().min(0).optional(),
          take: z.number().int().min(1).max(200).optional(),
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
            status: status as RunnerStatus | undefined,
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
          destructiveHint: true,
        },
      },
      async ({ runnerId }) =>
        jsonResult(await this.cliRunnerService.stopRunner(runnerId)),
    );
  }

  private registerFindingTools(server: McpServer) {
    server.registerTool(
      'search_findings',
      {
        title: 'Search Findings',
        description:
          'Search findings using filters, text search, and pagination.',
        inputSchema: {
          filters: jsonObjectSchema.optional(),
          page: jsonObjectSchema.optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ filters, page }) =>
        jsonResult(
          await this.findingsService.searchFindings({
            filters: filters,
            page: page,
          } as any),
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
      },
      async ({ id, ...rest }) =>
        jsonResult(await this.findingsService.update(id, rest as any)),
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
      },
      async (args) =>
        jsonResult(await this.findingsService.bulkUpdate(args as any)),
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

  private registerAssetTools(server: McpServer) {
    server.registerTool(
      'search_assets',
      {
        title: 'Search Assets',
        description: 'Search assets and nested finding data.',
        inputSchema: {
          filters: jsonObjectSchema.optional(),
          page: jsonObjectSchema.optional(),
        },
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async ({ filters, page }) =>
        jsonResult(
          await this.assetService.searchAssets({
            filters: filters,
            page: page,
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

  private registerSemanticLayerTools(server: McpServer) {
    const filterMappingSchema = z
      .object({
        detectorTypes: z.array(z.string()).optional(),
        severities: z.array(z.string()).optional(),
        statuses: z.array(z.string()).optional(),
        findingTypes: z.array(z.string()).optional(),
        customDetectorKeys: z.array(z.string()).optional(),
      })
      .optional();

    // ── Glossary ──────────────────────────────────────────────────────────────

    server.registerTool(
      'list_glossary_terms',
      {
        title: 'List Glossary Terms',
        description:
          'List all business glossary terms with optional filtering.',
        inputSchema: {
          category: z.string().optional(),
          isActive: z.boolean().optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => jsonResult(await this.glossaryService.findAll(args)),
    );

    server.registerTool(
      'get_glossary_term',
      {
        title: 'Get Glossary Term',
        description:
          'Get a single glossary term by ID including linked metrics.',
        inputSchema: { id: z.string().uuid() },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ id }) => jsonResult(await this.glossaryService.findById(id)),
    );

    server.registerTool(
      'create_glossary_term',
      {
        title: 'Create Glossary Term',
        description:
          'Create a new business glossary term that maps a business concept to detection filters.',
        inputSchema: {
          displayName: z.string(),
          description: z.string().optional(),
          category: z.string().optional(),
          filterMapping: z.record(z.string(), z.unknown()),
          color: z.string().optional(),
          icon: z.string().optional(),
        },
        annotations: { idempotentHint: false },
      },
      async (args) =>
        jsonResult(await this.mcpToolExecutor.createGlossaryTerm(args)),
    );

    server.registerTool(
      'update_glossary_term',
      {
        title: 'Update Glossary Term',
        description: 'Update an existing glossary term.',
        inputSchema: {
          id: z.string().uuid(),
          displayName: z.string().optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          filterMapping: filterMappingSchema,
          color: z.string().optional(),
          icon: z.string().optional(),
          isActive: z.boolean().optional(),
        },
        annotations: { idempotentHint: true },
      },
      async ({ id, ...rest }) =>
        jsonResult(
          await this.mcpToolExecutor.updateGlossaryTerm(id, rest as any),
        ),
    );

    server.registerTool(
      'delete_glossary_term',
      {
        title: 'Delete Glossary Term',
        description: 'Delete a glossary term by ID.',
        inputSchema: { id: z.string().uuid() },
        annotations: { destructiveHint: true },
      },
      async ({ id }) =>
        jsonResult(await this.mcpToolExecutor.deleteGlossaryTerm(id)),
    );

    // ── Metrics ───────────────────────────────────────────────────────────────

    server.registerTool(
      'list_metrics',
      {
        title: 'List Metrics',
        description:
          'List metric definitions with optional filtering by type or status.',
        inputSchema: {
          type: z.enum(['SIMPLE', 'RATIO', 'DERIVED', 'TREND']).optional(),
          status: z.enum(['DRAFT', 'ACTIVE', 'DEPRECATED']).optional(),
          isActive: z.boolean().optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => jsonResult(await this.metricsService.findAll(args)),
    );

    server.registerTool(
      'get_metric',
      {
        title: 'Get Metric',
        description: 'Get a single metric definition by ID.',
        inputSchema: { id: z.string().uuid() },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ id }) => jsonResult(await this.metricsService.findById(id)),
    );

    server.registerTool(
      'create_metric',
      {
        title: 'Create Metric',
        description:
          'Create a new governed metric definition (starts in DRAFT status).',
        inputSchema: {
          displayName: z.string(),
          description: z.string().optional(),
          type: z.enum(['SIMPLE', 'RATIO', 'DERIVED', 'TREND']),
          definition: z.record(z.string(), z.unknown()),
          allowedDimensions: z.array(z.string()).optional(),
          glossaryTermId: z.string().uuid().optional(),
          format: z.string().optional(),
          unit: z.string().optional(),
          owner: z.string().optional(),
        },
        annotations: { idempotentHint: false },
      },
      async (args) =>
        jsonResult(
          await this.mcpToolExecutor.createMetricDefinition(args as any),
        ),
    );

    server.registerTool(
      'certify_metric',
      {
        title: 'Certify Metric',
        description:
          'Promote a metric from DRAFT to ACTIVE (certified for production use).',
        inputSchema: {
          id: z.string().uuid(),
          certifiedBy: z.string(),
        },
        annotations: { idempotentHint: true },
      },
      async ({ id, certifiedBy }) =>
        jsonResult(await this.mcpToolExecutor.certifyMetric(id, certifiedBy)),
    );

    // ── Query ─────────────────────────────────────────────────────────────────

    server.registerTool(
      'query_metric',
      {
        title: 'Query Metric',
        description:
          'Evaluate a metric and return its scalar value with optional dimension breakdown.',
        inputSchema: {
          metricId: z.string().uuid(),
          dimensions: z.array(z.string()).optional(),
          filters: z.record(z.string(), z.unknown()).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          glossaryTermId: z.string().uuid().optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ metricId, ...options }) =>
        jsonResult(
          await this.metricEngineService.evaluateMetric(
            metricId,
            options as any,
          ),
        ),
    );

    server.registerTool(
      'query_metric_timeseries',
      {
        title: 'Query Metric Time Series',
        description:
          'Evaluate a SIMPLE metric as a time series bucketed by granularity.',
        inputSchema: {
          metricId: z.string().uuid(),
          granularity: z.enum(['hour', 'day', 'week', 'month']),
          filters: z.record(z.string(), z.unknown()).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
          glossaryTermId: z.string().uuid().optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ metricId, granularity, ...options }) =>
        jsonResult(
          await this.metricEngineService.evaluateTimeSeries(
            metricId,
            granularity,
            options as any,
          ),
        ),
    );

    server.registerTool(
      'query_dashboard_metrics',
      {
        title: 'Query Dashboard Metrics',
        description: 'Batch-evaluate all metrics placed on a named dashboard.',
        inputSchema: {
          dashboard: z.string(),
          filters: z.record(z.string(), z.unknown()).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ dashboard, ...options }) =>
        jsonResult(
          await this.metricEngineService.evaluateDashboard(
            dashboard,
            options as any,
          ),
        ),
    );

    server.registerTool(
      'explore_by_glossary_term',
      {
        title: 'Explore by Glossary Term',
        description:
          'Explore detection data scoped to a glossary term, evaluating one or more metrics with optional dimension breakdown.',
        inputSchema: {
          glossaryTermId: z.string().uuid(),
          metricIds: z.array(z.string().uuid()),
          dimensions: z.array(z.string()).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ glossaryTermId, metricIds, ...options }) => {
        const results = await Promise.all(
          metricIds.map(async (id) => {
            const result = await this.metricEngineService.evaluateMetric(id, {
              glossaryTermId,
              ...options,
            } as any);
            return { metricId: id, ...result };
          }),
        );
        return jsonResult({ glossaryTermId, results });
      },
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
