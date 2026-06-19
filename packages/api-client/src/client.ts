import { Configuration } from "./generated/src/runtime";
import {
  SearchFindingsFiltersInputDtoSeverityEnum,
  SearchFindingsFiltersInputDtoStatusEnum,
  SearchFindingsFiltersInputDtoDetectorTypeEnum,
} from "./generated/src/models";
import type { TrainingExampleDto, TrainingExampleItem } from "./types";
export type { TrainingExampleDto, TrainingExampleItem } from "./types";
import type {
  AiMessageDto,
  AiCompleteRequestDto,
  AiCompleteResponseDto,
  FindingResponseDto as GeneratedFindingResponseDto,
  SearchAssetsChartsRequestDto as GeneratedSearchAssetsChartsRequestDto,
  SearchAssetsChartsResponseDto as GeneratedSearchAssetsChartsResponseDto,
  SearchAssetsPageDto as GeneratedSearchAssetsPageDto,
  SearchAssetsRequestDto as GeneratedSearchAssetsRequestDto,
  SearchAssetsResponseDto as GeneratedSearchAssetsResponseDto,
  SearchFindingsChartsRequestDto as GeneratedSearchFindingsChartsRequestDto,
  SearchFindingsChartsResponseDto as GeneratedSearchFindingsChartsResponseDto,
  SearchSourcesRequestDto as GeneratedSearchSourcesRequestDto,
  SearchSourcesResponseDto as GeneratedSearchSourcesResponseDto,
  RunnersChartsTimelineBucketDto,
} from "./generated/src/models";

// Import APIs individually to avoid naming conflicts
export { SourcesApi } from "./generated/src/apis/SourcesApi";
export { AssetsApi } from "./generated/src/apis/AssetsApi";
export { HealthApi } from "./generated/src/apis/HealthApi";
export { RunnersApi } from "./generated/src/apis/RunnersApi";
export { FindingsApi } from "./generated/src/apis/FindingsApi";
export { NotificationsApi } from "./generated/src/apis/NotificationsApi";
export { SandboxApi } from "./generated/src/apis/SandboxApi";
export { InstanceSettingsApi } from "./generated/src/apis/InstanceSettingsApi";
export { AIProviderConfigsApi } from "./generated/src/apis/AIProviderConfigsApi";
export { CasesApi } from "./generated/src/apis/CasesApi";
export { InquiriesApi } from "./generated/src/apis/InquiriesApi";
export { GraphApi } from "./generated/src/apis/GraphApi";
export { HypothesesApi } from "./generated/src/apis/HypothesesApi";
export { ThreadsApi } from "./generated/src/apis/ThreadsApi";
export { AutopilotApi } from "./generated/src/apis/AutopilotApi";
export { CorrelationApi } from "./generated/src/apis/CorrelationApi";
export type {
  AgentRunDto,
  AgentRunDetailDto,
  AgentRunListResponseDto,
  AgentDecisionDto,
  AgentLogDto,
  AgentLogListResponseDto,
  AgentMemoryDto,
  AgentMemoryListResponseDto,
  CreateAgentMemoryDto,
  UpdateAgentMemoryDto,
  TriggerAutopilotDto,
  TriggerAutopilotResponseDto,
} from "./generated/src/models";

// Investigation (cases / inquiries / graph / hypotheses) model types
export type {
  CreateCaseDto,
  UpdateCaseDto,
  CaseResponseDto,
  CaseListResponseDto,
  CaseEvidenceDto,
  CaseFindingDto,
  CaseLinkedInquiryDto,
  EvidenceEntityDto,
  AddEvidenceDto,
  AddFindingDto,
  UpdateEvidenceNoteDto,
  UpdateCaseFindingNoteDto,
  PullFromInquiryDto,
  PullFromInquiryResponseDto,
  CreateInquiryDto,
  UpdateInquiryDto,
  InquiryResponseDto,
  InquiryListResponseDto,
  InquiryMatchDto,
  InquiryMatchListResponseDto,
  PreviewInquiryDto,
  PreviewResponseDto,
  MatchOptionsResponseDto,
  CreateHypothesisDto,
  UpdateHypothesisDto,
  HypothesisResponseDto,
  HypothesisSupportLinkDto,
  LinkSupportDto,
  CreateThreadDto,
  UpdateThreadDto,
  ThreadResponseDto,
  ThreadEntryDto,
  ThreadSupportLinkDto,
  ThreadEntriesResponseDto,
  AddThreadEntryDto,
  LinkThreadSupportDto,
  CaseActivityDto,
  CaseTimelineResponseDto,
  ExpandGraphDto,
  GraphNodeDto,
  GraphEdgeDto,
  GraphResponseDto,
  RebuildEdgesResponseDto,
  CreateManualEdgeDto,
  UpdateEdgeDto,
  EdgeDetailDto,
  RelationTypesResponseDto,
  PivotGraphDto,
  BulkIngestEdgesDto,
  BulkIngestEdgesResponseDto,
} from "./generated/src/models";
export { PivotGraphDtoPivotEnum } from "./generated/src/models";
export {
  CaseResponseDtoStatusEnum,
  CaseResponseDtoSeverityEnum,
} from "./generated/src/models";
export {
  ThreadResponseDtoKindEnum,
  ThreadResponseDtoStatusEnum,
  CreateThreadDtoKindEnum,
  ThreadEntryDtoEntryTypeEnum,
  AddThreadEntryDtoEntryTypeEnum,
  LinkThreadSupportDtoTargetTypeEnum,
  LinkThreadSupportDtoStanceEnum,
} from "./generated/src/models";
export {
  CasesControllerListStatusEnum,
  CasesControllerListSeverityEnum,
} from "./generated/src/apis/CasesApi";
export {
  InquiriesControllerListStatusEnum,
  InquiriesControllerListMatchesSeverityEnum,
} from "./generated/src/apis/InquiriesApi";
export {
  SandboxControllerListRunsContentTypeEnum,
  SandboxControllerListRunsDetectorTypeEnum,
  SandboxControllerListRunsSortByEnum,
  SandboxControllerListRunsSortOrderEnum,
  SandboxControllerListRunsStatusEnum,
} from "./generated/src/apis/SandboxApi";

export { TriggerAutopilotDtoAgentKindEnum } from "./generated/src/models/TriggerAutopilotDto";

// Re-export types from generated models
export type {
  CreateSourceDto,
  CreateMcpTokenDto,
  UpdateSourceDto,
  UpdateMcpTokenDto,
  SourceResponseDto as CreateSourceResponse,
  SourceResponseDto as UpdateSourceResponse,
  SourceResponseDto as SourceListItem,
  SourceResponseDto as SourcesControllerListSources200ResponseInner,
  SourceResponseDto as SourceResponse,
  SourceResponseDto,
  SearchSourcesRequestDto,
  SearchSourcesResponseDto,
  SearchSourceItemDto,
  SearchSourcesTotalsDto,
  LatestRunnerSummaryDto,
  BulkIngestAssetsDto,
  RunnerDto,
  RunnerAssetProgressDto,
  ListRunnersResponseDto,
  DeleteRunnerResponseDto,
  RunnerLogEntryDto,
  RunnerLogsResponseDto,
  SearchRunnerLogsBodyDto,
  SourceInfoDto,
  StopRunnerResponseDto,
  StartRunnerDto,
  SearchAssetFindingDto,
  SearchAssetItemDto,
  SearchAssetsChartsOptionsDto,
  SearchAssetsChartsRequestDto,
  SearchAssetsChartsResponseDto,
  SearchAssetsChartsTopAssetDto,
  SearchAssetsChartsTopSourceDto,
  SearchAssetsChartsTotalsDto,
  SearchAssetsFiltersDto,
  SearchAssetsOptionsDto,
  SearchAssetsResponseDto,
  SearchFindingsFiltersDto,
  FindingsDiscoveryActivityDto,
  FindingsDiscoveryResponseDto,
  FindingsDiscoverySeverityBreakdownDto,
  FindingsDiscoveryStatusBreakdownDto,
  FindingsDiscoveryTopAssetDto,
  FindingsDiscoveryTotalsDto,
  SearchFindingsRequestDto,
  SearchFindingsResponseDto,
  SearchFindingsChartsRequestDto,
  SearchFindingsChartsResponseDto,
  SearchFindingsChartsOptionsDto,
  FindingsChartsTotalsDto,
  FindingsChartsTimelineBucketDto,
  FindingsChartsTopAssetDto,
  AssetFindingDetectorCountDto,
  AssetFindingSeverityCountDto,
  AssetFindingStatusCountDto,
  AssetFindingTypeCountDto,
  AssetFindingSummaryDto,
  AssetFindingSummaryListResponseDto,
  CreateFindingDto,
  UpdateFindingDto,
  BulkUpdateFindingsDto,
  BulkUpdateFindingsResponseDto,
  SearchFindingsFiltersInputDto,
  FindingLocationDto,
  MarkAllReadDto,
  NotificationResponseDto,
  NotificationListResponseDto,
  InstanceSettingsResponseDto,
  AiProviderConfigResponseDto,
  CreateAiProviderConfigDto,
  UpdateAiProviderConfigDto,
  AiProviderConfigTestResultDto,
  AiCompleteRequestDto,
  AiCompleteResponseDto,
  AiMessageDto,
  McpCapabilityGroupDto,
  McpOverviewResponseDto,
  McpPromptSummaryDto,
  McpTokenCreatedResponseDto,
  McpTokenResponseDto,
  UpdateInstanceSettingsDto,
  UpdateNotificationImportanceDto,
  SandboxRunDto,
  SandboxRunListResponseDto,
  // Asset list types used by web app directly
  AssetListItemDto,
  // Correlation / duplicate detection
  ValueOccurrencesResponseDto,
  ValueOccurrenceAssetDto,
  RecomputeCorrelationResponseDto,
  CorrelationGraphResponseDto,
  AssetSimilarityDto,
  CorrelationConfigResponseDto,
  CorrelationLabelWeightDto,
  UpdateCorrelationConfigDto,
  ExclusionRuleDto,
  AddExclusionDto,
  CaseActionRequestDto,
  CaseActionResponseDto,
} from "./generated/src/models";

export { RunnerDtoFromJSON } from "./generated/src/models/RunnerDto";

// Augmented FindingResponseDto: adds metadata field not present in the generated type.
// The API returns metadata (detector-specific structured context) but the generated
// OpenAPI client doesn't include it. We extend the type here so consumers get it typed.
export type FindingResponseDto = GeneratedFindingResponseDto & {
  metadata?: Record<string, unknown> | null;
};

export {
  AssetListItemDtoSourceTypeEnum,
  AssetListItemDtoStatusEnum,
} from "./generated/src/models";

export {
  BulkUpdateFindingsDtoStatusEnum,
  BulkUpdateFindingsDtoSeverityEnum,
  NotificationResponseDtoSeverityEnum,
  NotificationResponseDtoTypeEnum,
  InstanceSettingsResponseDtoLanguageEnum,
  InstanceSettingsResponseDtoTimeFormatEnum,
  UpdateInstanceSettingsDtoLanguageEnum,
  UpdateInstanceSettingsDtoTimeFormatEnum,
  AiProviderConfigResponseDtoProviderEnum,
  CreateAiProviderConfigDtoProviderEnum,
  UpdateAiProviderConfigDtoProviderEnum,
  SandboxRunDtoContentTypeEnum,
  SandboxRunDtoStatusEnum,
  RunnerLogEntryDtoLevelEnum,
  // Finding enums used by web components
  FindingResponseDtoDetectorTypeEnum,
  FindingResponseDtoSeverityEnum,
  FindingResponseDtoStatusEnum,
  SearchAssetFindingDtoDetectorTypeEnum,
  SearchAssetFindingDtoStatusEnum,
  SearchAssetsFiltersDtoStatusEnum,
  SearchFindingsFiltersDtoDetectorTypeEnum,
  SearchFindingsFiltersDtoSeverityEnum,
  SearchFindingsFiltersInputDtoDetectorTypeEnum,
  SearchFindingsFiltersInputDtoSeverityEnum,
  SearchFindingsFiltersInputDtoStatusEnum,
} from "./generated/src/models";

export const SearchAssetsSortByEnum = {
  Name: "NAME",
  SourceId: "SOURCE_ID",
  AssetType: "ASSET_TYPE",
  Status: "STATUS",
  LastScannedAt: "LAST_SCANNED_AT",
  UpdatedAt: "UPDATED_AT",
  CreatedAt: "CREATED_AT",
} as const;
export type SearchAssetsSortBy =
  (typeof SearchAssetsSortByEnum)[keyof typeof SearchAssetsSortByEnum];

export const SearchAssetsSortOrderEnum = {
  Asc: "ASC",
  Desc: "DESC",
} as const;
export type SearchAssetsSortOrder =
  (typeof SearchAssetsSortOrderEnum)[keyof typeof SearchAssetsSortOrderEnum];

export const SearchSourcesSortByEnum = {
  Name: "NAME",
  Type: "TYPE",
  Status: "STATUS",
  CreatedAt: "CREATED_AT",
  UpdatedAt: "UPDATED_AT",
  LastRunAt: "LAST_RUN_AT",
} as const;
export type SearchSourcesSortBy =
  (typeof SearchSourcesSortByEnum)[keyof typeof SearchSourcesSortByEnum];

export const SearchSourcesSortOrderEnum = {
  Asc: "ASC",
  Desc: "DESC",
} as const;
export type SearchSourcesSortOrder =
  (typeof SearchSourcesSortOrderEnum)[keyof typeof SearchSourcesSortOrderEnum];

export type SearchAssetsPageInputDto = GeneratedSearchAssetsPageDto & {
  sortBy?: SearchAssetsSortBy;
  sortOrder?: SearchAssetsSortOrder;
};

export type SearchAssetsRequestInputDto = Omit<
  GeneratedSearchAssetsRequestDto,
  "page"
> & {
  page?: SearchAssetsPageInputDto;
};

export type SearchAssetsChartsRequestInputDto =
  GeneratedSearchAssetsChartsRequestDto;

export type SearchFindingsChartsRequestInputDto =
  GeneratedSearchFindingsChartsRequestDto;

export type SearchRunnersStatus = "PENDING" | "RUNNING" | "COMPLETED" | "WARNING" | "ERROR";
export type SearchRunnersTriggerType =
  | "MANUAL"
  | "SCHEDULED"
  | "WEBHOOK"
  | "API";

export const SearchRunnersSortByEnum = {
  TriggeredAt: "TRIGGERED_AT",
  Status: "STATUS",
  SourceName: "SOURCE_NAME",
  DurationMs: "DURATION_MS",
  TotalFindings: "TOTAL_FINDINGS",
} as const;
export type SearchRunnersSortBy =
  (typeof SearchRunnersSortByEnum)[keyof typeof SearchRunnersSortByEnum];

export const SearchRunnersSortOrderEnum = {
  Asc: "ASC",
  Desc: "DESC",
} as const;
export type SearchRunnersSortOrder =
  (typeof SearchRunnersSortOrderEnum)[keyof typeof SearchRunnersSortOrderEnum];

export type SearchRunnersFiltersInputDto = {
  search?: string;
  sourceId?: string[];
  sourceType?: string[];
  status?: SearchRunnersStatus[];
  triggerType?: SearchRunnersTriggerType[];
  triggeredBy?: string[];
  triggeredAfter?: string | Date;
  triggeredBefore?: string | Date;
};

export type SearchRunnersPageInputDto = {
  skip?: number;
  limit?: number;
  sortBy?: SearchRunnersSortBy;
  sortOrder?: SearchRunnersSortOrder;
};

export type SearchRunnersRequestInputDto = {
  filters?: SearchRunnersFiltersInputDto;
  page?: SearchRunnersPageInputDto;
};

export type SearchRunnersResponseDto = {
  items: import("./generated/src/models").RunnerDto[];
  total: number;
  skip: number;
  limit: number;
};

export type SearchRunnersChartsRequestInputDto = {
  filters?: SearchRunnersFiltersInputDto;
  windowDays?: 7 | 30 | 90;
  options?: {
    topSourcesLimit?: number;
  };
};

// ── Runner Assets search ──────────────────────────────────────────────────────

export type RunnerAssetStatus =
  | "PENDING"
  | "PROCESSING"
  | "PROCESSED"
  | "ERROR";

export const RunnerAssetStatusEnum = {
  Pending: "PENDING",
  Processing: "PROCESSING",
  Processed: "PROCESSED",
  Error: "ERROR",
} as const;

export const SearchRunnerAssetsSortByEnum = {
  CreatedAt: "CREATED_AT",
  Status: "STATUS",
  StatusPriority: "STATUS_PRIORITY",
  AssetHash: "ASSET_HASH",
  CompletedAt: "COMPLETED_AT",
  FindingsTotal: "FINDINGS_TOTAL",
} as const;
export type SearchRunnerAssetsSortBy =
  (typeof SearchRunnerAssetsSortByEnum)[keyof typeof SearchRunnerAssetsSortByEnum];

export const SearchRunnerAssetsSortOrderEnum = {
  Asc: "ASC",
  Desc: "DESC",
} as const;
export type SearchRunnerAssetsSortOrder =
  (typeof SearchRunnerAssetsSortOrderEnum)[keyof typeof SearchRunnerAssetsSortOrderEnum];

export type SearchRunnerAssetsFiltersInputDto = {
  runnerId: string;
  status?: RunnerAssetStatus[];
  search?: string;
};

export type SearchRunnerAssetsPageInputDto = {
  skip?: number;
  limit?: number;
  sortBy?: SearchRunnerAssetsSortBy;
  sortOrder?: SearchRunnerAssetsSortOrder;
};

export type SearchRunnerAssetsRequestInputDto = {
  filters: SearchRunnerAssetsFiltersInputDto;
  page?: SearchRunnerAssetsPageInputDto;
};

export type RunnerAssetItemDto = {
  runnerId: string;
  assetHash: string;
  status: RunnerAssetStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  findingsTotal: number | null;
  findingsBySeverity: Record<string, number> | null;
  findingsByDetector: Record<string, Record<string, number>> | null;
  asset: import("./generated/src/models").AssetListItemDto | null;
};

export type SearchRunnerAssetsResponseDto = {
  items: RunnerAssetItemDto[];
  total: number;
  skip: number;
  limit: number;
};

// ─────────────────────────────────────────────────────────────────────────────

export type AssistantContextKey =
  | "source.create"
  | "source.edit"
  | "detector.create";

export type AssistantOperation =
  | "create_source"
  | "update_source"
  | "test_source_connection"
  | "create_custom_detector"
  | "train_custom_detector";

export type AssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantValidationState = {
  isValid: boolean;
  missingFields: string[];
  errors: string[];
};

export type AssistantPageContext = {
  key: AssistantContextKey;
  route: string;
  title: string;
  entityId?: string | null;
  values: Record<string, unknown>;
  schema?: Record<string, unknown> | null;
  validation: AssistantValidationState;
  metadata?: Record<string, unknown>;
  supportedOperations: AssistantOperation[];
};

export type AssistantPendingConfirmation = {
  operation: AssistantOperation;
  title: string;
  detail: string;
};

export type AssistantFieldPatch = {
  path: string;
  value: unknown;
};

export type AssistantUiAction =
  | {
      type: "show_toast";
      tone?: "info" | "success" | "error";
      title: string;
      description?: string;
    }
  | {
      type: "patch_fields";
      patches: AssistantFieldPatch[];
    }
  | {
      type: "sync_source";
      sourceId: string;
      values: Record<string, unknown>;
      schedule?: {
        enabled: boolean;
        cron?: string;
        timezone?: string;
      };
    }
  | {
      type: "sync_detector";
      detectorId: string;
      values: Record<string, unknown>;
    }
  | {
      type: "sync_metric";
      metricId: string;
      values: Record<string, unknown>;
    }
  | {
      type: "attach_result";
      kind: "source_test" | "detector_train" | "operation";
      title: string;
      payload: Record<string, unknown>;
    };

export type AssistantToolCallSummary = {
  name: string;
  status: "success" | "error";
  detail: string;
};

export type AssistantChatRequest = {
  messages: AssistantChatMessage[];
  context: AssistantPageContext;
  pendingConfirmation?: AssistantPendingConfirmation | null;
};

export type AssistantChatResponse = {
  reply: string;
  actions: AssistantUiAction[];
  pendingConfirmation: AssistantPendingConfirmation | null;
  toolCalls: AssistantToolCallSummary[];
};

export type AssistantParsedUpload = {
  fileName: string;
  fileType: string;
  bytes: number;
  summary: string;
  truncated: boolean;
  rowCount?: number;
  lineCount?: number;
  columns?: string[];
  sampleRows?: Record<string, string>[];
  topLevelKeys?: string[];
  jsonPreview?: string;
  textPreview?: string;
};

export type RunnersChartsTotalsDto = {
  totalRuns: number;
  running: number;
  queued: number;
  completed: number;
  warning: number;
  failed: number;
};

export type RunnersChartsTopSourceDto = {
  sourceId: string;
  sourceName: string;
  runs: number;
  findings: number;
  assets: number;
};

export type SearchRunnersChartsResponseDto = {
  totals: RunnersChartsTotalsDto;
  timeline: RunnersChartsTimelineBucketDto[];
  topSources: RunnersChartsTopSourceDto[];
};

export type SourceScheduleDto = {
  enabled: boolean;
  cron: string | null;
  timezone: string | null;
};

export const CustomDetectorMethodEnum = {
  Ruleset: "RULESET",
  Classifier: "CLASSIFIER",
  Entity: "ENTITY",
} as const;
export type CustomDetectorMethod =
  (typeof CustomDetectorMethodEnum)[keyof typeof CustomDetectorMethodEnum];

export const CustomDetectorTrainingStatusEnum = {
  Pending: "PENDING",
  Running: "RUNNING",
  Succeeded: "SUCCEEDED",
  Failed: "FAILED",
} as const;
export type CustomDetectorTrainingStatus =
  (typeof CustomDetectorTrainingStatusEnum)[keyof typeof CustomDetectorTrainingStatusEnum];

export const ExtractionMethodEnum = {
  Regex: "REGEX",
  Gliner: "GLINER",
  ClassifierGliner: "CLASSIFIER_GLINER",
} as const;
export type ExtractionMethod =
  (typeof ExtractionMethodEnum)[keyof typeof ExtractionMethodEnum];

export type CustomDetectorTrainingRunDto = {
  id: string;
  customDetectorId: string;
  sourceId?: string | null;
  status: CustomDetectorTrainingStatus;
  strategy?: string | null;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  trainedExamples?: number | null;
  positiveExamples?: number | null;
  negativeExamples?: number | null;
  metrics?: Record<string, unknown> | null;
  modelArtifactPath?: string | null;
  configHash?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomDetectorResponseDto = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  method: CustomDetectorMethod;
  isActive: boolean;
  version: number;
  config: Record<string, unknown>;
  lastTrainedAt?: string | null;
  lastTrainingSummary?: Record<string, unknown> | null;
  aiProviderConfigId?: string | null;
  latestTrainingRun?: CustomDetectorTrainingRunDto | null;
  findingsCount: number;
  sourcesUsingCount: number;
  sourcesWithFindingsCount: number;
  recentSourceNames: string[];
  sourcesUsing: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomDetectorDto = {
  name: string;
  key?: string;
  description?: string;
  method: CustomDetectorMethod;
  isActive?: boolean;
  config: Record<string, unknown>;
};

export type UpdateCustomDetectorDto = {
  name?: string;
  key?: string;
  description?: string;
  method?: CustomDetectorMethod;
  isActive?: boolean;
  config?: Record<string, unknown>;
};

export type TrainCustomDetectorDto = {
  sourceId?: string;
};

export type CustomDetectorExampleDto = {
  name: string;
  description: string;
  method: CustomDetectorMethod;
  config: Record<string, unknown>;
};

export type ParsedTrainingExampleDto = {
  label: string;
  text: string;
  accepted: boolean;
  source: string;
  lineNumber?: number;
};

export type ParseTrainingExamplesResponseDto = {
  format: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  warnings: string[];
  examples: ParsedTrainingExampleDto[];
  availableColumns?: string[];
  detectedLabelColumn?: string;
  detectedTextColumn?: string;
  skippedReasons?: { missingLabel: number; missingText: number; duplicates: number };
};

export type CustomDetectorExtractionDto = {
  id: string;
  findingId: string;
  customDetectorId: string | null;
  customDetectorKey: string;
  sourceId: string | null;
  assetId: string | null;
  runnerId: string | null;
  extractionMethod: ExtractionMethod;
  detectorVersion: number | null;
  fieldCount: number;
  populatedFields: string[];
  extractedData: Record<string, unknown>;
  extractedAt: string;
  createdAt: string;
};

export type ExtractionFieldCoverageDto = {
  field: string;
  total: number;
  populated: number;
  rate: number;
};

export type ExtractionCoverageDto = {
  customDetectorId: string;
  totalExtractions?: number;
  fields?: ExtractionFieldCoverageDto[];
  customDetectorKey?: string;
  totalFindings?: number;
  findingsWithExtraction?: number;
  coverageRate?: number;
  fieldCoverage?: ExtractionFieldCoverageDto[];
};

export type SearchExtractionsParamsDto = {
  sourceId?: string;
  assetId?: string;
  populatedField?: string;
  skip?: number;
  limit?: number;
};

export type SearchExtractionsResponseDto = {
  items: CustomDetectorExtractionDto[];
  total: number;
};

// ── Test Scenarios ──────────────────────────────────────────────────────────

export type TestResultStatus = "PASS" | "FAIL" | "ERROR";
export type TestTrigger = "MANUAL" | "CI" | "ASSISTANT";

export type TestResultDto = {
  id: string;
  scenarioId: string;
  status: TestResultStatus;
  actualOutput: Record<string, unknown>;
  errorMessage?: string | null;
  durationMs?: number | null;
  detectorVersion: number;
  triggeredBy: TestTrigger;
  createdAt: string;
};

export type TestScenarioDto = {
  id: string;
  detectorId: string;
  name: string;
  description?: string | null;
  inputText: string;
  expectedOutcome: Record<string, unknown>;
  lastResult: TestResultDto | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTestScenarioDto = {
  name: string;
  description?: string;
  inputText: string;
  expectedOutcome: Record<string, unknown>;
};

export type RunTestsResponseDto = {
  detectorId: string;
  triggeredBy: TestTrigger;
  results: Array<{
    scenario: TestScenarioDto;
    result: TestResultDto;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
  };
};

// Import API classes for the client
import { SourcesApi } from "./generated/src/apis/SourcesApi";
import { AssetsApi } from "./generated/src/apis/AssetsApi";
import { HealthApi } from "./generated/src/apis/HealthApi";
import { RunnersApi } from "./generated/src/apis/RunnersApi";
import { FindingsApi } from "./generated/src/apis/FindingsApi";
import { NotificationsApi } from "./generated/src/apis/NotificationsApi";
import { SandboxApi } from "./generated/src/apis/SandboxApi";
import { InstanceSettingsApi } from "./generated/src/apis/InstanceSettingsApi";
import { AIProviderConfigsApi } from "./generated/src/apis/AIProviderConfigsApi";
import { CasesApi } from "./generated/src/apis/CasesApi";
import { InquiriesApi } from "./generated/src/apis/InquiriesApi";
import { GraphApi } from "./generated/src/apis/GraphApi";
import { HypothesesApi } from "./generated/src/apis/HypothesesApi";
import { ThreadsApi } from "./generated/src/apis/ThreadsApi";
import { AutopilotApi } from "./generated/src/apis/AutopilotApi";
import { CorrelationApi } from "./generated/src/apis/CorrelationApi";

// Determine the correct base URL
// In browser: use relative path /api which is proxied by Next.js
// In Node.js (SSR): use direct API URL
function normalizeAbsoluteUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/+$/, "") : null;
}

function getServerApiBaseUrl(): string {
  const configured =
    normalizeAbsoluteUrl(process.env.INTERNAL_API_URL) ||
    normalizeAbsoluteUrl(process.env.API_URL) ||
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_API_URL);

  return configured || "http://127.0.0.1:8000";
}

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    const desktop = (window as any).__CLASSIFYRE_DESKTOP__;
    if (desktop?.apiBaseUrl) return desktop.apiBaseUrl as string;
    return process.env.NEXT_PUBLIC_API_URL || "/api";
  }

  return getServerApiBaseUrl();
}

// API configuration
function createConfiguration(baseUrl?: string): Configuration {
  const basePath = baseUrl || getBaseUrl();

  return new Configuration({
    basePath,
  });
}

// API client singleton
class ApiClient {
  private config: Configuration;

  public sources: SourcesApi;
  public assets: AssetsApi;
  public health: HealthApi;
  public runners: RunnersApi;
  public findings: FindingsApi;
  public notifications: NotificationsApi;
  public sandbox: SandboxApi;
  public instanceSettings: InstanceSettingsApi;
  public aiProviderConfigs: AIProviderConfigsApi;
  public cases: CasesApi;
  public inquiries: InquiriesApi;
  public graph: GraphApi;
  public hypotheses: HypothesesApi;
  public threads: ThreadsApi;
  public autopilot: AutopilotApi;
  public correlation: CorrelationApi;

  constructor(baseUrl?: string) {
    this.config = createConfiguration(baseUrl);

    this.sources = new SourcesApi(this.config);
    this.assets = new AssetsApi(this.config);
    this.health = new HealthApi(this.config);
    this.runners = new RunnersApi(this.config);
    this.findings = new FindingsApi(this.config);
    this.notifications = new NotificationsApi(this.config);
    this.sandbox = new SandboxApi(this.config);
    this.instanceSettings = new InstanceSettingsApi(this.config);
    this.aiProviderConfigs = new AIProviderConfigsApi(this.config);
    this.cases = new CasesApi(this.config);
    this.inquiries = new InquiriesApi(this.config);
    this.graph = new GraphApi(this.config);
    this.hypotheses = new HypothesesApi(this.config);
    this.threads = new ThreadsApi(this.config);
    this.autopilot = new AutopilotApi(this.config);
    this.correlation = new CorrelationApi(this.config);
  }

  async searchAssets(
    request: SearchAssetsRequestInputDto,
  ): Promise<GeneratedSearchAssetsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/assets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/assets failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as GeneratedSearchAssetsResponseDto;
  }

  async searchAssetsCharts(
    request: SearchAssetsChartsRequestInputDto = {},
  ): Promise<GeneratedSearchAssetsChartsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/assets/charts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/assets/charts failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as GeneratedSearchAssetsChartsResponseDto;
  }

  async searchFindingsCharts(
    request: GeneratedSearchFindingsChartsRequestDto = {},
  ): Promise<GeneratedSearchFindingsChartsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/findings/charts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/findings/charts failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as GeneratedSearchFindingsChartsResponseDto;
  }

  async searchSources(
    request: GeneratedSearchSourcesRequestDto = {},
  ): Promise<GeneratedSearchSourcesResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/sources failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as GeneratedSearchSourcesResponseDto;
  }

  async searchRunners(
    request: SearchRunnersRequestInputDto = {},
  ): Promise<SearchRunnersResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/runners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/runners failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as SearchRunnersResponseDto;
  }

  async searchRunnersCharts(
    request: SearchRunnersChartsRequestInputDto = {},
  ): Promise<SearchRunnersChartsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/runners/charts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/runners/charts failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as SearchRunnersChartsResponseDto;
  }

  async searchRunnerAssets(
    request: SearchRunnerAssetsRequestInputDto,
  ): Promise<SearchRunnerAssetsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/search/runner-assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `search/runner-assets failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as SearchRunnerAssetsResponseDto;
  }

  async listCustomDetectors(params?: {
    includeInactive?: boolean;
  }): Promise<CustomDetectorResponseDto[]> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const query = new URLSearchParams();
    if (params?.includeInactive) {
      query.set("includeInactive", "true");
    }

    const url = query.size
      ? `${basePath}/custom-detectors?${query.toString()}`
      : `${basePath}/custom-detectors`;
    const response = await fetch(url);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorResponseDto[];
  }

  async listCustomDetectorExamples(): Promise<CustomDetectorExampleDto[]> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/custom-detectors/examples`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/examples GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorExampleDto[];
  }

  async getCustomDetector(id: string): Promise<CustomDetectorResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/custom-detectors/${id}`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${id} GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorResponseDto;
  }

  async createCustomDetector(
    payload: CreateCustomDetectorDto,
  ): Promise<CustomDetectorResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/custom-detectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors POST failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorResponseDto;
  }

  async updateCustomDetector(
    id: string,
    payload: UpdateCustomDetectorDto,
  ): Promise<CustomDetectorResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/custom-detectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${id} PATCH failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorResponseDto;
  }

  async trainCustomDetector(
    id: string,
    payload: TrainCustomDetectorDto = {},
  ): Promise<CustomDetectorTrainingRunDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/custom-detectors/${id}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${id}/train POST failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorTrainingRunDto;
  }

  async parseCustomDetectorTrainingExamples(
    file: File | Blob,
    fileName?: string,
    opts: { labelColumn?: string; textColumn?: string } = {},
  ): Promise<ParseTrainingExamplesResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const formData = new FormData();
    const fallbackName =
      fileName ??
      ("name" in file && typeof file.name === "string" && file.name.length > 0
        ? file.name
        : "training-data.txt");
    formData.set("file", file, fallbackName);
    if (opts.labelColumn) formData.set("labelColumn", opts.labelColumn);
    if (opts.textColumn) formData.set("textColumn", opts.textColumn);

    const response = await fetch(
      `${basePath}/custom-detectors/training-examples/parse`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/training-examples/parse POST failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as ParseTrainingExamplesResponseDto;
  }

  async listCustomDetectorTrainingHistory(
    id: string,
    take = 20,
  ): Promise<CustomDetectorTrainingRunDto[]> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${id}/training-history?take=${take}`,
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${id}/training-history GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as CustomDetectorTrainingRunDto[];
  }

  async getFindingExtraction(
    findingId: string,
  ): Promise<CustomDetectorExtractionDto | null> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/findings/${findingId}/extraction`,
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `findings/${findingId}/extraction GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
    return (await response.json()) as CustomDetectorExtractionDto;
  }

  async searchDetectorExtractions(
    detectorId: string,
    params: SearchExtractionsParamsDto = {},
  ): Promise<SearchExtractionsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const query = new URLSearchParams();
    if (params.sourceId) query.set("sourceId", params.sourceId);
    if (params.assetId) query.set("assetId", params.assetId);
    if (params.populatedField)
      query.set("populatedField", params.populatedField);
    if (params.skip !== undefined) query.set("skip", String(params.skip));
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const url = query.size
      ? `${basePath}/custom-detectors/${detectorId}/extractions?${query.toString()}`
      : `${basePath}/custom-detectors/${detectorId}/extractions`;
    const response = await fetch(url);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${detectorId}/extractions GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
    return (await response.json()) as SearchExtractionsResponseDto;
  }

  async getExtractionCoverage(
    detectorId: string,
  ): Promise<ExtractionCoverageDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/extractions/coverage`,
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${detectorId}/extractions/coverage GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
    return (await response.json()) as ExtractionCoverageDto;
  }

  async getSchedule(sourceId: string): Promise<SourceScheduleDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/sources/${sourceId}/schedule`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `sources/${sourceId}/schedule GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as SourceScheduleDto;
  }

  async aiComplete(messages: AiMessageDto[]): Promise<AiCompleteResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/ai/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages } satisfies AiCompleteRequestDto),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `ai/complete failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as AiCompleteResponseDto;
  }

  async assistantRespond(
    payload: AssistantChatRequest,
  ): Promise<AssistantChatResponse> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/assistant/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `assistant/respond failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as AssistantChatResponse;
  }

  async assistantParseUpload(
    file: File | Blob,
    fileName?: string,
  ): Promise<AssistantParsedUpload> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const formData = new FormData();
    const fallbackName =
      fileName ??
      ("name" in file && typeof file.name === "string" && file.name.length > 0
        ? file.name
        : "upload.txt");
    formData.set("file", file, fallbackName);

    const response = await fetch(`${basePath}/assistant/parse-upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `assistant/parse-upload failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as AssistantParsedUpload;
  }

  async listTestScenarios(detectorId: string): Promise<TestScenarioDto[]> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/test-scenarios`,
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${detectorId}/test-scenarios GET failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
    return (await response.json()) as TestScenarioDto[];
  }

  async createTestScenario(
    detectorId: string,
    payload: CreateTestScenarioDto,
  ): Promise<TestScenarioDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/test-scenarios`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${detectorId}/test-scenarios POST failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
    return (await response.json()) as TestScenarioDto;
  }

  async deleteTestScenario(
    detectorId: string,
    scenarioId: string,
  ): Promise<void> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/test-scenarios/${scenarioId}`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 204) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${detectorId}/test-scenarios/${scenarioId} DELETE failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
  }

  async runTestScenarios(
    detectorId: string,
    triggeredBy: TestTrigger = "MANUAL",
  ): Promise<RunTestsResponseDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/test-scenarios/run?triggeredBy=${triggeredBy}`,
      { method: "POST" },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${detectorId}/test-scenarios/run POST failed (${response.status}): ${message || "Unknown error"}`,
      );
    }
    return (await response.json()) as RunTestsResponseDto;
  }

  async deleteCustomDetector(id: string): Promise<{ deleted: true }> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/custom-detectors/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `custom-detectors/${id} DELETE failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as { deleted: true };
  }

  async listTrainingExamples(detectorId: string): Promise<TrainingExampleDto[]> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/training-examples`,
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`training-examples GET failed (${response.status}): ${message}`);
    }
    return (await response.json()) as TrainingExampleDto[];
  }

  async saveTrainingExamples(
    detectorId: string,
    examples: TrainingExampleItem[],
    clearExisting = false,
  ): Promise<{ saved: number }> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/training-examples`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examples, clearExisting }),
      },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`training-examples POST failed (${response.status}): ${message}`);
    }
    return (await response.json()) as { saved: number };
  }

  async deleteTrainingExample(
    detectorId: string,
    exampleId: string,
  ): Promise<{ deleted: true }> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/training-examples/${exampleId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`training-example DELETE failed (${response.status}): ${message}`);
    }
    return (await response.json()) as { deleted: true };
  }

  async clearTrainingExamples(detectorId: string): Promise<{ deleted: number }> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(
      `${basePath}/custom-detectors/${detectorId}/training-examples`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`training-examples DELETE failed (${response.status}): ${message}`);
    }
    return (await response.json()) as { deleted: number };
  }

  async updateSchedule(
    sourceId: string,
    schedule: {
      enabled: boolean;
      scheduleCron?: string;
      scheduleTimezone?: string;
    },
  ): Promise<SourceScheduleDto> {
    const basePath = this.config.basePath.replace(/\/$/, "");
    const response = await fetch(`${basePath}/sources/${sourceId}/schedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `sources/${sourceId}/schedule PATCH failed (${response.status}): ${message || "Unknown error"}`,
      );
    }

    return (await response.json()) as SourceScheduleDto;
  }
}

// Default API instance
export const api = new ApiClient();

// Factory function for creating custom API instances
export function createApiClient(baseUrl?: string): ApiClient {
  return new ApiClient(baseUrl);
}
