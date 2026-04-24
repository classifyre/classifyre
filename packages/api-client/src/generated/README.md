# @workspace/api-client@0.0.1

A TypeScript SDK client for the localhost API.

## Usage

First, install the SDK from npm.

```bash
npm install @workspace/api-client --save
```

Next, try it out.


```ts
import {
  Configuration,
  AIApi,
} from '@workspace/api-client';
import type { AiControllerCompleteRequest } from '@workspace/api-client';

async function example() {
  console.log("🚀 Testing @workspace/api-client SDK...");
  const api = new AIApi();

  const body = {
    // AiCompleteRequestDto
    aiCompleteRequestDto: ...,
  } satisfies AiControllerCompleteRequest;

  try {
    const data = await api.aiControllerComplete(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```


## Documentation

### API Endpoints

All URIs are relative to *http://localhost*

| Class | Method | HTTP request | Description
| ----- | ------ | ------------ | -------------
*AIApi* | [**aiControllerComplete**](docs/AIApi.md#aicontrollercomplete) | **POST** /ai/complete | Generate a text completion
*AssetsApi* | [**assetsControllerGetAsset**](docs/AssetsApi.md#assetscontrollergetasset) | **GET** /assets/{id} | Get asset by ID
*AssetsApi* | [**searchAssetsControllerSearchAssets**](docs/AssetsApi.md#searchassetscontrollersearchassets) | **POST** /search/assets | Search assets with findings
*AssetsApi* | [**searchAssetsControllerSearchAssetsCharts**](docs/AssetsApi.md#searchassetscontrollersearchassetscharts) | **POST** /search/assets/charts | Search assets charts overview
*AssetsApi* | [**searchAssetsControllerSearchFindings**](docs/AssetsApi.md#searchassetscontrollersearchfindings) | **POST** /search/findings | Search findings
*AssetsApi* | [**searchAssetsControllerSearchFindingsCharts**](docs/AssetsApi.md#searchassetscontrollersearchfindingscharts) | **POST** /search/findings/charts | Findings charts overview
*AssetsApi* | [**searchAssetsControllerSearchFindingsCustomDetectors**](docs/AssetsApi.md#searchassetscontrollersearchfindingscustomdetectors) | **POST** /search/findings/custom-detectors | List custom detector filter options
*AssetsApi* | [**sourceAssetsControllerBulkIngest**](docs/AssetsApi.md#sourceassetscontrollerbulkingest) | **POST** /sources/{sourceId}/assets/bulk | Bulk ingest assets
*AssetsApi* | [**sourceAssetsControllerFinalizeIngest**](docs/AssetsApi.md#sourceassetscontrollerfinalizeingest) | **POST** /sources/{sourceId}/assets/finalize | Finalize ingest run
*AssetsApi* | [**sourceAssetsControllerListSourceAssets**](docs/AssetsApi.md#sourceassetscontrollerlistsourceassets) | **GET** /sources/{sourceId}/assets | List assets for a source
*AssistantApi* | [**assistantControllerParseUpload**](docs/AssistantApi.md#assistantcontrollerparseupload) | **POST** /assistant/parse-upload | Parse assistant chat upload
*AssistantApi* | [**assistantControllerRespond**](docs/AssistantApi.md#assistantcontrollerrespondoperation) | **POST** /assistant/respond | Respond to a contextual assistant turn
*CustomDetectorExtractionsApi* | [**customDetectorExtractionsControllerCoverage**](docs/CustomDetectorExtractionsApi.md#customdetectorextractionscontrollercoverage) | **GET** /custom-detectors/{id}/extractions/coverage | 
*CustomDetectorExtractionsApi* | [**customDetectorExtractionsControllerGetByFinding**](docs/CustomDetectorExtractionsApi.md#customdetectorextractionscontrollergetbyfinding) | **GET** /findings/{findingId}/extraction | 
*CustomDetectorExtractionsApi* | [**customDetectorExtractionsControllerSearch**](docs/CustomDetectorExtractionsApi.md#customdetectorextractionscontrollersearch) | **GET** /custom-detectors/{id}/extractions | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerCreate**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollercreate) | **POST** /custom-detectors/{detectorId}/test-scenarios | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerDelete**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollerdelete) | **DELETE** /custom-detectors/{detectorId}/test-scenarios/{scenarioId} | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerList**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollerlist) | **GET** /custom-detectors/{detectorId}/test-scenarios | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerRun**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollerrun) | **POST** /custom-detectors/{detectorId}/test-scenarios/run | 
*CustomDetectorsApi* | [**customDetectorsControllerCreate**](docs/CustomDetectorsApi.md#customdetectorscontrollercreate) | **POST** /custom-detectors | Create custom detector
*CustomDetectorsApi* | [**customDetectorsControllerDelete**](docs/CustomDetectorsApi.md#customdetectorscontrollerdelete) | **DELETE** /custom-detectors/{id} | Delete custom detector
*CustomDetectorsApi* | [**customDetectorsControllerGetById**](docs/CustomDetectorsApi.md#customdetectorscontrollergetbyid) | **GET** /custom-detectors/{id} | Get custom detector by ID
*CustomDetectorsApi* | [**customDetectorsControllerList**](docs/CustomDetectorsApi.md#customdetectorscontrollerlist) | **GET** /custom-detectors | List custom detectors
*CustomDetectorsApi* | [**customDetectorsControllerListExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollerlistexamples) | **GET** /custom-detectors/examples | List custom detector starter examples
*CustomDetectorsApi* | [**customDetectorsControllerParseTrainingExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollerparsetrainingexamples) | **POST** /custom-detectors/training-examples/parse | Parse uploaded training examples file
*CustomDetectorsApi* | [**customDetectorsControllerTrain**](docs/CustomDetectorsApi.md#customdetectorscontrollertrain) | **POST** /custom-detectors/{id}/train | Trigger custom detector training
*CustomDetectorsApi* | [**customDetectorsControllerTrainingHistory**](docs/CustomDetectorsApi.md#customdetectorscontrollertraininghistory) | **GET** /custom-detectors/{id}/training-history | List training history for custom detector
*CustomDetectorsApi* | [**customDetectorsControllerUpdate**](docs/CustomDetectorsApi.md#customdetectorscontrollerupdate) | **PATCH** /custom-detectors/{id} | Update custom detector
*FindingsApi* | [**findingsControllerBulkUpdate**](docs/FindingsApi.md#findingscontrollerbulkupdate) | **POST** /findings/bulk-update | Bulk update findings
*FindingsApi* | [**findingsControllerCreate**](docs/FindingsApi.md#findingscontrollercreate) | **POST** /findings/create | Create a new finding
*FindingsApi* | [**findingsControllerFindOne**](docs/FindingsApi.md#findingscontrollerfindone) | **GET** /findings/{id} | Get a finding by ID
*FindingsApi* | [**findingsControllerGetDiscoveryOverview**](docs/FindingsApi.md#findingscontrollergetdiscoveryoverview) | **GET** /findings/discovery | Get discovery dashboard overview data
*FindingsApi* | [**findingsControllerGetStats**](docs/FindingsApi.md#findingscontrollergetstats) | **GET** /findings/stats | Get finding statistics
*FindingsApi* | [**findingsControllerListAssetSummaries**](docs/FindingsApi.md#findingscontrollerlistassetsummaries) | **GET** /findings/assets | List asset finding summaries with optional filters
*FindingsApi* | [**findingsControllerUpdate**](docs/FindingsApi.md#findingscontrollerupdate) | **PATCH** /findings/{id} | Update a finding
*HealthApi* | [**healthControllerGetHealth**](docs/HealthApi.md#healthcontrollergethealth) | **GET** / | Health check
*HealthApi* | [**healthControllerPing**](docs/HealthApi.md#healthcontrollerping) | **GET** /ping | Ping endpoint
*InstanceSettingsApi* | [**aiProviderConfigControllerGetConfig**](docs/InstanceSettingsApi.md#aiproviderconfigcontrollergetconfig) | **GET** /instance-settings/ai-provider | Get AI provider configuration
*InstanceSettingsApi* | [**aiProviderConfigControllerUpdateConfig**](docs/InstanceSettingsApi.md#aiproviderconfigcontrollerupdateconfig) | **PUT** /instance-settings/ai-provider | Update AI provider configuration
*InstanceSettingsApi* | [**instanceSettingsControllerGetSettings**](docs/InstanceSettingsApi.md#instancesettingscontrollergetsettings) | **GET** /instance-settings | Get instance settings
*InstanceSettingsApi* | [**instanceSettingsControllerUpdateSettings**](docs/InstanceSettingsApi.md#instancesettingscontrollerupdatesettings) | **PUT** /instance-settings | Update instance settings
*InstanceSettingsApi* | [**mcpSettingsControllerCreateToken**](docs/InstanceSettingsApi.md#mcpsettingscontrollercreatetoken) | **POST** /instance-settings/mcp/tokens | Create MCP access token
*InstanceSettingsApi* | [**mcpSettingsControllerDeleteToken**](docs/InstanceSettingsApi.md#mcpsettingscontrollerdeletetoken) | **DELETE** /instance-settings/mcp/tokens/{id} | Delete MCP access token
*InstanceSettingsApi* | [**mcpSettingsControllerGetOverview**](docs/InstanceSettingsApi.md#mcpsettingscontrollergetoverview) | **GET** /instance-settings/mcp/overview | Get MCP server overview
*InstanceSettingsApi* | [**mcpSettingsControllerListTokens**](docs/InstanceSettingsApi.md#mcpsettingscontrollerlisttokens) | **GET** /instance-settings/mcp/tokens | List MCP access tokens
*InstanceSettingsApi* | [**mcpSettingsControllerUpdateToken**](docs/InstanceSettingsApi.md#mcpsettingscontrollerupdatetoken) | **PATCH** /instance-settings/mcp/tokens/{id} | Update MCP access token
*NotificationsApi* | [**notificationsControllerDeleteNotification**](docs/NotificationsApi.md#notificationscontrollerdeletenotification) | **DELETE** /notifications/{id} | Delete a notification
*NotificationsApi* | [**notificationsControllerListNotifications**](docs/NotificationsApi.md#notificationscontrollerlistnotifications) | **GET** /notifications | List notifications
*NotificationsApi* | [**notificationsControllerMarkAllRead**](docs/NotificationsApi.md#notificationscontrollermarkallread) | **PATCH** /notifications/mark-all-read | Mark all notifications as read
*NotificationsApi* | [**notificationsControllerMarkRead**](docs/NotificationsApi.md#notificationscontrollermarkread) | **PATCH** /notifications/{id}/read | Mark a notification as read
*NotificationsApi* | [**notificationsControllerSetImportant**](docs/NotificationsApi.md#notificationscontrollersetimportant) | **PATCH** /notifications/{id}/important | Set notification importance
*RunnersApi* | [**cliRunnerControllerCreateExternalRunner**](docs/RunnersApi.md#clirunnercontrollercreateexternalrunner) | **POST** /sources/{sourceId}/runners/external | Create runner record for external CLI REST ingestion
*RunnersApi* | [**cliRunnerControllerDeleteRunner**](docs/RunnersApi.md#clirunnercontrollerdeleterunner) | **DELETE** /runners/{runnerId} | Delete runner metadata and cleanup filesystem logs for this runner
*RunnersApi* | [**cliRunnerControllerGetRunner**](docs/RunnersApi.md#clirunnercontrollergetrunner) | **GET** /runners/{runnerId} | Get runner status and details
*RunnersApi* | [**cliRunnerControllerListRunners**](docs/RunnersApi.md#clirunnercontrollerlistrunners) | **GET** /runners | List all runners
*RunnersApi* | [**cliRunnerControllerListSourceRunners**](docs/RunnersApi.md#clirunnercontrollerlistsourcerunners) | **GET** /sources/{sourceId}/runners | List runners for source
*RunnersApi* | [**cliRunnerControllerSearchRunnerLogs**](docs/RunnersApi.md#clirunnercontrollersearchrunnerlogs) | **POST** /runners/{runnerId}/logs | Search runner logs with server-side filtering, full-text search, and sort
*RunnersApi* | [**cliRunnerControllerStartRunner**](docs/RunnersApi.md#clirunnercontrollerstartrunner) | **POST** /sources/{sourceId}/run | Start CLI runner for source
*RunnersApi* | [**cliRunnerControllerStopRunner**](docs/RunnersApi.md#clirunnercontrollerstoprunner) | **PATCH** /runners/{runnerId}/stop | Stop running CLI process
*RunnersApi* | [**cliRunnerControllerUpdateRunnerStatus**](docs/RunnersApi.md#clirunnercontrollerupdaterunnerstatusoperation) | **PATCH** /runners/{runnerId}/status | Update runner status
*RunnersApi* | [**searchRunnersControllerSearchRunners**](docs/RunnersApi.md#searchrunnerscontrollersearchrunners) | **POST** /search/runners | Search runners
*RunnersApi* | [**searchRunnersControllerSearchRunnersCharts**](docs/RunnersApi.md#searchrunnerscontrollersearchrunnerscharts) | **POST** /search/runners/charts | Runners charts overview
*SandboxApi* | [**sandboxControllerCreateRun**](docs/SandboxApi.md#sandboxcontrollercreaterun) | **POST** /sandbox/runs | Upload a file and run detectors on it
*SandboxApi* | [**sandboxControllerDeleteRun**](docs/SandboxApi.md#sandboxcontrollerdeleterun) | **DELETE** /sandbox/runs/{id} | Delete a sandbox run
*SandboxApi* | [**sandboxControllerGetRun**](docs/SandboxApi.md#sandboxcontrollergetrun) | **GET** /sandbox/runs/{id} | Get a sandbox run by ID
*SandboxApi* | [**sandboxControllerListRuns**](docs/SandboxApi.md#sandboxcontrollerlistruns) | **GET** /sandbox/runs | List sandbox runs (paginated)
*SemanticLayerGlossaryApi* | [**glossaryControllerCreate**](docs/SemanticLayerGlossaryApi.md#glossarycontrollercreate) | **POST** /semantic/glossary | Create a new glossary term
*SemanticLayerGlossaryApi* | [**glossaryControllerDelete**](docs/SemanticLayerGlossaryApi.md#glossarycontrollerdelete) | **DELETE** /semantic/glossary/{id} | Delete a glossary term
*SemanticLayerGlossaryApi* | [**glossaryControllerFindAll**](docs/SemanticLayerGlossaryApi.md#glossarycontrollerfindall) | **GET** /semantic/glossary | List all glossary terms
*SemanticLayerGlossaryApi* | [**glossaryControllerFindById**](docs/SemanticLayerGlossaryApi.md#glossarycontrollerfindbyid) | **GET** /semantic/glossary/{id} | Get a glossary term by id
*SemanticLayerGlossaryApi* | [**glossaryControllerPreview**](docs/SemanticLayerGlossaryApi.md#glossarycontrollerpreview) | **POST** /semantic/glossary/{id}/preview | Preview the number of findings matching this glossary term
*SemanticLayerGlossaryApi* | [**glossaryControllerUpdate**](docs/SemanticLayerGlossaryApi.md#glossarycontrollerupdate) | **PUT** /semantic/glossary/{id} | Update a glossary term
*SemanticLayerMetricsApi* | [**metricsControllerCertify**](docs/SemanticLayerMetricsApi.md#metricscontrollercertify) | **POST** /semantic/metrics/{id}/certify | Certify a metric (DRAFT → ACTIVE)
*SemanticLayerMetricsApi* | [**metricsControllerCreate**](docs/SemanticLayerMetricsApi.md#metricscontrollercreate) | **POST** /semantic/metrics | Create a new metric definition
*SemanticLayerMetricsApi* | [**metricsControllerDelete**](docs/SemanticLayerMetricsApi.md#metricscontrollerdelete) | **DELETE** /semantic/metrics/{id} | Delete a metric definition
*SemanticLayerMetricsApi* | [**metricsControllerFindAll**](docs/SemanticLayerMetricsApi.md#metricscontrollerfindall) | **GET** /semantic/metrics | List all metric definitions
*SemanticLayerMetricsApi* | [**metricsControllerFindById**](docs/SemanticLayerMetricsApi.md#metricscontrollerfindbyid) | **GET** /semantic/metrics/{id} | Get a metric definition by id
*SemanticLayerMetricsApi* | [**metricsControllerUpdate**](docs/SemanticLayerMetricsApi.md#metricscontrollerupdate) | **PUT** /semantic/metrics/{id} | Update a metric definition
*SemanticLayerQueryApi* | [**metricQueryControllerExplore**](docs/SemanticLayerQueryApi.md#metricquerycontrollerexplore) | **POST** /semantic/query/explore | Explore detection data through a glossary term with metric breakdown
*SemanticLayerQueryApi* | [**metricQueryControllerQueryDashboard**](docs/SemanticLayerQueryApi.md#metricquerycontrollerquerydashboard) | **POST** /semantic/query/dashboard | Batch-evaluate all metrics placed on a dashboard
*SemanticLayerQueryApi* | [**metricQueryControllerQueryMetric**](docs/SemanticLayerQueryApi.md#metricquerycontrollerquerymetric) | **POST** /semantic/query | Evaluate a metric with optional dimensions and filters
*SemanticLayerQueryApi* | [**metricQueryControllerQueryTimeSeries**](docs/SemanticLayerQueryApi.md#metricquerycontrollerquerytimeseries) | **POST** /semantic/query/timeseries | Evaluate a metric as a time series
*SourcesApi* | [**searchSourcesControllerSearchSources**](docs/SourcesApi.md#searchsourcescontrollersearchsources) | **POST** /search/sources | Search data sources
*SourcesApi* | [**sourceAssetsControllerBulkIngest**](docs/SourcesApi.md#sourceassetscontrollerbulkingest) | **POST** /sources/{sourceId}/assets/bulk | Bulk ingest assets
*SourcesApi* | [**sourceAssetsControllerFinalizeIngest**](docs/SourcesApi.md#sourceassetscontrollerfinalizeingest) | **POST** /sources/{sourceId}/assets/finalize | Finalize ingest run
*SourcesApi* | [**sourceAssetsControllerListSourceAssets**](docs/SourcesApi.md#sourceassetscontrollerlistsourceassets) | **GET** /sources/{sourceId}/assets | List assets for a source
*SourcesApi* | [**sourcesControllerCreateSource**](docs/SourcesApi.md#sourcescontrollercreatesource) | **POST** /sources | Create a new data source
*SourcesApi* | [**sourcesControllerDeleteSource**](docs/SourcesApi.md#sourcescontrollerdeletesource) | **DELETE** /sources/{id} | Delete a data source
*SourcesApi* | [**sourcesControllerGetSchedule**](docs/SourcesApi.md#sourcescontrollergetschedule) | **GET** /sources/{id}/schedule | Get source schedule
*SourcesApi* | [**sourcesControllerGetSource**](docs/SourcesApi.md#sourcescontrollergetsource) | **GET** /sources/{id} | Get source by ID
*SourcesApi* | [**sourcesControllerListSources**](docs/SourcesApi.md#sourcescontrollerlistsources) | **GET** /sources | List all data sources
*SourcesApi* | [**sourcesControllerStartRun**](docs/SourcesApi.md#sourcescontrollerstartrun) | **POST** /sources/{id}/runs | Start a new ingestion run
*SourcesApi* | [**sourcesControllerTestConnection**](docs/SourcesApi.md#sourcescontrollertestconnection) | **POST** /sources/{id}/test | Test source connection
*SourcesApi* | [**sourcesControllerUpdateSource**](docs/SourcesApi.md#sourcescontrollerupdatesource) | **PUT** /sources/{id} | Update a data source
*SourcesApi* | [**sourcesControllerUpdateStatus**](docs/SourcesApi.md#sourcescontrollerupdatestatusoperation) | **PATCH** /sources/{id}/status | Update runner status


### Models

- [AiCompleteRequestDto](docs/AiCompleteRequestDto.md)
- [AiCompleteResponseDto](docs/AiCompleteResponseDto.md)
- [AiMessageDto](docs/AiMessageDto.md)
- [AiProviderConfigResponseDto](docs/AiProviderConfigResponseDto.md)
- [AssetFindingDetectorCountDto](docs/AssetFindingDetectorCountDto.md)
- [AssetFindingSeverityCountDto](docs/AssetFindingSeverityCountDto.md)
- [AssetFindingStatusCountDto](docs/AssetFindingStatusCountDto.md)
- [AssetFindingSummaryDto](docs/AssetFindingSummaryDto.md)
- [AssetFindingSummaryListResponseDto](docs/AssetFindingSummaryListResponseDto.md)
- [AssetFindingTypeCountDto](docs/AssetFindingTypeCountDto.md)
- [AssetListItemDto](docs/AssetListItemDto.md)
- [AssetListResponseDto](docs/AssetListResponseDto.md)
- [AssetResponseDto](docs/AssetResponseDto.md)
- [AssistantControllerRespond200Response](docs/AssistantControllerRespond200Response.md)
- [AssistantControllerRespondRequest](docs/AssistantControllerRespondRequest.md)
- [AssistantControllerRespondRequestMessagesInner](docs/AssistantControllerRespondRequestMessagesInner.md)
- [BulkIngestAssetsDto](docs/BulkIngestAssetsDto.md)
- [BulkUpdateFindingsDto](docs/BulkUpdateFindingsDto.md)
- [BulkUpdateFindingsResponseDto](docs/BulkUpdateFindingsResponseDto.md)
- [CliRunnerControllerUpdateRunnerStatusRequest](docs/CliRunnerControllerUpdateRunnerStatusRequest.md)
- [CreateCustomDetectorDto](docs/CreateCustomDetectorDto.md)
- [CreateExternalRunnerDto](docs/CreateExternalRunnerDto.md)
- [CreateFindingDto](docs/CreateFindingDto.md)
- [CreateGlossaryTermDto](docs/CreateGlossaryTermDto.md)
- [CreateMcpTokenDto](docs/CreateMcpTokenDto.md)
- [CreateMetricDefinitionDto](docs/CreateMetricDefinitionDto.md)
- [CreateSourceDto](docs/CreateSourceDto.md)
- [CustomDetectorExampleDto](docs/CustomDetectorExampleDto.md)
- [CustomDetectorResponseDto](docs/CustomDetectorResponseDto.md)
- [CustomDetectorResponseDtoSourcesUsingInner](docs/CustomDetectorResponseDtoSourcesUsingInner.md)
- [CustomDetectorTrainingRunDto](docs/CustomDetectorTrainingRunDto.md)
- [DeleteRunnerResponseDto](docs/DeleteRunnerResponseDto.md)
- [DiscoveryRecentRunDto](docs/DiscoveryRecentRunDto.md)
- [DiscoveryRunSourceDto](docs/DiscoveryRunSourceDto.md)
- [FinalizeIngestRunDto](docs/FinalizeIngestRunDto.md)
- [FindingHistoryEntryDto](docs/FindingHistoryEntryDto.md)
- [FindingLocationDto](docs/FindingLocationDto.md)
- [FindingResponseDto](docs/FindingResponseDto.md)
- [FindingsChartsTimelineBucketDto](docs/FindingsChartsTimelineBucketDto.md)
- [FindingsChartsTopAssetDto](docs/FindingsChartsTopAssetDto.md)
- [FindingsChartsTotalsDto](docs/FindingsChartsTotalsDto.md)
- [FindingsDiscoveryActivityDto](docs/FindingsDiscoveryActivityDto.md)
- [FindingsDiscoveryResponseDto](docs/FindingsDiscoveryResponseDto.md)
- [FindingsDiscoverySeverityBreakdownDto](docs/FindingsDiscoverySeverityBreakdownDto.md)
- [FindingsDiscoveryStatusBreakdownDto](docs/FindingsDiscoveryStatusBreakdownDto.md)
- [FindingsDiscoveryTopAssetDto](docs/FindingsDiscoveryTopAssetDto.md)
- [FindingsDiscoveryTotalsDto](docs/FindingsDiscoveryTotalsDto.md)
- [GlossaryFilterMappingDto](docs/GlossaryFilterMappingDto.md)
- [HealthControllerGetHealth200Response](docs/HealthControllerGetHealth200Response.md)
- [InstanceSettingsResponseDto](docs/InstanceSettingsResponseDto.md)
- [LatestRunnerSummaryDto](docs/LatestRunnerSummaryDto.md)
- [ListRunnersResponseDto](docs/ListRunnersResponseDto.md)
- [LocationDto](docs/LocationDto.md)
- [MarkAllReadDto](docs/MarkAllReadDto.md)
- [McpCapabilityGroupDto](docs/McpCapabilityGroupDto.md)
- [McpOverviewResponseDto](docs/McpOverviewResponseDto.md)
- [McpPromptSummaryDto](docs/McpPromptSummaryDto.md)
- [McpTokenCreatedResponseDto](docs/McpTokenCreatedResponseDto.md)
- [McpTokenResponseDto](docs/McpTokenResponseDto.md)
- [NotificationListResponseDto](docs/NotificationListResponseDto.md)
- [NotificationResponseDto](docs/NotificationResponseDto.md)
- [NotificationsControllerDeleteNotification200Response](docs/NotificationsControllerDeleteNotification200Response.md)
- [NotificationsControllerMarkAllRead200Response](docs/NotificationsControllerMarkAllRead200Response.md)
- [ParseTrainingExamplesResponseDto](docs/ParseTrainingExamplesResponseDto.md)
- [ParseTrainingExamplesSkippedReasonsDto](docs/ParseTrainingExamplesSkippedReasonsDto.md)
- [ParsedTrainingExampleDto](docs/ParsedTrainingExampleDto.md)
- [QueryDashboardMetricsDto](docs/QueryDashboardMetricsDto.md)
- [QueryMetricDto](docs/QueryMetricDto.md)
- [QueryMetricTimeSeriesDto](docs/QueryMetricTimeSeriesDto.md)
- [RunnerDto](docs/RunnerDto.md)
- [RunnerLogEntryDto](docs/RunnerLogEntryDto.md)
- [RunnerLogsResponseDto](docs/RunnerLogsResponseDto.md)
- [RunnersChartsTimelineBucketDto](docs/RunnersChartsTimelineBucketDto.md)
- [RunnersChartsTopSourceDto](docs/RunnersChartsTopSourceDto.md)
- [RunnersChartsTotalsDto](docs/RunnersChartsTotalsDto.md)
- [SandboxRunDto](docs/SandboxRunDto.md)
- [SandboxRunListResponseDto](docs/SandboxRunListResponseDto.md)
- [SearchAssetFindingDto](docs/SearchAssetFindingDto.md)
- [SearchAssetItemDto](docs/SearchAssetItemDto.md)
- [SearchAssetsChartsOptionsDto](docs/SearchAssetsChartsOptionsDto.md)
- [SearchAssetsChartsRequestDto](docs/SearchAssetsChartsRequestDto.md)
- [SearchAssetsChartsResponseDto](docs/SearchAssetsChartsResponseDto.md)
- [SearchAssetsChartsTopAssetDto](docs/SearchAssetsChartsTopAssetDto.md)
- [SearchAssetsChartsTopSourceDto](docs/SearchAssetsChartsTopSourceDto.md)
- [SearchAssetsChartsTotalsDto](docs/SearchAssetsChartsTotalsDto.md)
- [SearchAssetsFiltersDto](docs/SearchAssetsFiltersDto.md)
- [SearchAssetsOptionsDto](docs/SearchAssetsOptionsDto.md)
- [SearchAssetsPageDto](docs/SearchAssetsPageDto.md)
- [SearchAssetsRequestDto](docs/SearchAssetsRequestDto.md)
- [SearchAssetsResponseDto](docs/SearchAssetsResponseDto.md)
- [SearchFindingsChartsOptionsDto](docs/SearchFindingsChartsOptionsDto.md)
- [SearchFindingsChartsRequestDto](docs/SearchFindingsChartsRequestDto.md)
- [SearchFindingsChartsResponseDto](docs/SearchFindingsChartsResponseDto.md)
- [SearchFindingsCustomDetectorOptionDto](docs/SearchFindingsCustomDetectorOptionDto.md)
- [SearchFindingsFiltersDto](docs/SearchFindingsFiltersDto.md)
- [SearchFindingsFiltersInputDto](docs/SearchFindingsFiltersInputDto.md)
- [SearchFindingsPageDto](docs/SearchFindingsPageDto.md)
- [SearchFindingsRequestDto](docs/SearchFindingsRequestDto.md)
- [SearchFindingsResponseDto](docs/SearchFindingsResponseDto.md)
- [SearchRunnerItemDto](docs/SearchRunnerItemDto.md)
- [SearchRunnerLogsBodyDto](docs/SearchRunnerLogsBodyDto.md)
- [SearchRunnersChartsOptionsDto](docs/SearchRunnersChartsOptionsDto.md)
- [SearchRunnersChartsRequestDto](docs/SearchRunnersChartsRequestDto.md)
- [SearchRunnersChartsResponseDto](docs/SearchRunnersChartsResponseDto.md)
- [SearchRunnersFiltersInputDto](docs/SearchRunnersFiltersInputDto.md)
- [SearchRunnersPageDto](docs/SearchRunnersPageDto.md)
- [SearchRunnersRequestDto](docs/SearchRunnersRequestDto.md)
- [SearchRunnersResponseDto](docs/SearchRunnersResponseDto.md)
- [SearchSourceItemDto](docs/SearchSourceItemDto.md)
- [SearchSourcesFiltersDto](docs/SearchSourcesFiltersDto.md)
- [SearchSourcesPageDto](docs/SearchSourcesPageDto.md)
- [SearchSourcesRequestDto](docs/SearchSourcesRequestDto.md)
- [SearchSourcesResponseDto](docs/SearchSourcesResponseDto.md)
- [SearchSourcesTotalsDto](docs/SearchSourcesTotalsDto.md)
- [SourceAssetsControllerBulkIngest201Response](docs/SourceAssetsControllerBulkIngest201Response.md)
- [SourceInfoDto](docs/SourceInfoDto.md)
- [SourceResponseDto](docs/SourceResponseDto.md)
- [SourcesControllerGetSchedule200Response](docs/SourcesControllerGetSchedule200Response.md)
- [SourcesControllerUpdateStatusRequest](docs/SourcesControllerUpdateStatusRequest.md)
- [StartRunnerDto](docs/StartRunnerDto.md)
- [StopRunnerResponseDto](docs/StopRunnerResponseDto.md)
- [TestConnectionResponseDto](docs/TestConnectionResponseDto.md)
- [TrainCustomDetectorDto](docs/TrainCustomDetectorDto.md)
- [UpdateAiProviderConfigDto](docs/UpdateAiProviderConfigDto.md)
- [UpdateCustomDetectorDto](docs/UpdateCustomDetectorDto.md)
- [UpdateFindingDto](docs/UpdateFindingDto.md)
- [UpdateGlossaryTermDto](docs/UpdateGlossaryTermDto.md)
- [UpdateInstanceSettingsDto](docs/UpdateInstanceSettingsDto.md)
- [UpdateMcpTokenDto](docs/UpdateMcpTokenDto.md)
- [UpdateMetricDefinitionDto](docs/UpdateMetricDefinitionDto.md)
- [UpdateNotificationImportanceDto](docs/UpdateNotificationImportanceDto.md)
- [UpdateSourceDto](docs/UpdateSourceDto.md)

### Authorization

Endpoints do not require authorization.


## About

This TypeScript SDK client supports the [Fetch API](https://fetch.spec.whatwg.org/)
and is automatically generated by the
[OpenAPI Generator](https://openapi-generator.tech) project:

- API version: `1.0.0`
- Package version: `0.0.1`
- Generator version: `7.19.0`
- Build package: `org.openapitools.codegen.languages.TypeScriptFetchClientCodegen`

The generated npm module supports the following:

- Environments
  * Node.js
  * Webpack
  * Browserify
- Language levels
  * ES5 - you must have a Promises/A+ library installed
  * ES6
- Module systems
  * CommonJS
  * ES6 module system

For more information, please visit [https://github.com/unstructured/classifyre](https://github.com/unstructured/classifyre)

## Development

### Building

To build the TypeScript source code, you need to have Node.js and npm installed.
After cloning the repository, navigate to the project directory and run:

```bash
npm install
npm run build
```

### Publishing

Once you've built the package, you can publish it to npm:

```bash
npm publish
```

## License

[MIT](https://opensource.org/licenses/MIT)
