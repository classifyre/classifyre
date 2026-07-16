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
*AIProviderConfigsApi* | [**aiProviderConfigControllerCreate**](docs/AIProviderConfigsApi.md#aiproviderconfigcontrollercreate) | **POST** /ai-provider-configs | Create an AI provider configuration
*AIProviderConfigsApi* | [**aiProviderConfigControllerGet**](docs/AIProviderConfigsApi.md#aiproviderconfigcontrollerget) | **GET** /ai-provider-configs/{id} | Get a single AI provider configuration
*AIProviderConfigsApi* | [**aiProviderConfigControllerList**](docs/AIProviderConfigsApi.md#aiproviderconfigcontrollerlist) | **GET** /ai-provider-configs | List AI provider configurations
*AIProviderConfigsApi* | [**aiProviderConfigControllerRemove**](docs/AIProviderConfigsApi.md#aiproviderconfigcontrollerremove) | **DELETE** /ai-provider-configs/{id} | Delete an AI provider configuration
*AIProviderConfigsApi* | [**aiProviderConfigControllerTest**](docs/AIProviderConfigsApi.md#aiproviderconfigcontrollertest) | **POST** /ai-provider-configs/{id}/test | Test an AI provider configuration
*AIProviderConfigsApi* | [**aiProviderConfigControllerUpdate**](docs/AIProviderConfigsApi.md#aiproviderconfigcontrollerupdate) | **PUT** /ai-provider-configs/{id} | Update an AI provider configuration
*AssetsApi* | [**assetsControllerGetAsset**](docs/AssetsApi.md#assetscontrollergetasset) | **GET** /assets/{id} | Get asset by ID
*AssetsApi* | [**searchAssetsControllerExportAssets**](docs/AssetsApi.md#searchassetscontrollerexportassets) | **GET** /search/assets/export | Export assets (with findings) as CSV
*AssetsApi* | [**searchAssetsControllerExportFindings**](docs/AssetsApi.md#searchassetscontrollerexportfindings) | **GET** /search/findings/export | Export findings as CSV
*AssetsApi* | [**searchAssetsControllerQueryAssets**](docs/AssetsApi.md#searchassetscontrollerqueryassets) | **GET** /search/assets/query | Query assets with findings (cursor-paginated JSON)
*AssetsApi* | [**searchAssetsControllerQueryFindings**](docs/AssetsApi.md#searchassetscontrollerqueryfindings) | **GET** /search/findings/query | Query findings (cursor-paginated JSON)
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
*AutopilotApi* | [**autopilotControllerCancelRun**](docs/AutopilotApi.md#autopilotcontrollercancelrun) | **POST** /autopilot/runs/{id}/cancel | Stop a pending/running agent run (it aborts before its next step)
*AutopilotApi* | [**autopilotControllerCreateMemory**](docs/AutopilotApi.md#autopilotcontrollercreatememory) | **POST** /autopilot/memory | Add (or overwrite) a memory entry to steer the agent
*AutopilotApi* | [**autopilotControllerDeleteMemory**](docs/AutopilotApi.md#autopilotcontrollerdeletememory) | **DELETE** /autopilot/memory/{id} | Delete a memory entry the agent learned
*AutopilotApi* | [**autopilotControllerGetAgents**](docs/AutopilotApi.md#autopilotcontrollergetagents) | **GET** /autopilot/agents | Per-agent configuration: enable flag, goal, iteration budget and assigned built-in/MCP tools
*AutopilotApi* | [**autopilotControllerGetRun**](docs/AutopilotApi.md#autopilotcontrollergetrun) | **GET** /autopilot/runs/{id} | Get one autopilot run with all decisions and rationales
*AutopilotApi* | [**autopilotControllerGetStats**](docs/AutopilotApi.md#autopilotcontrollergetstats) | **GET** /autopilot/stats | Mission-control counters (runs, decisions, memory, brief version)
*AutopilotApi* | [**autopilotControllerGetSystemBrief**](docs/AutopilotApi.md#autopilotcontrollergetsystembrief) | **GET** /autopilot/system-brief | The living system brief the autopilot maintains and injects
*AutopilotApi* | [**autopilotControllerGetTools**](docs/AutopilotApi.md#autopilotcontrollergettools) | **GET** /autopilot/tools | The harness capability map — every registered tool (read/mutate, domain) and the missions that use them
*AutopilotApi* | [**autopilotControllerGetUsage**](docs/AutopilotApi.md#autopilotcontrollergetusage) | **GET** /autopilot/usage | LLM token/cost usage per day and agent (for the harness usage charts) — filter by agent kind and time range
*AutopilotApi* | [**autopilotControllerListActivity**](docs/AutopilotApi.md#autopilotcontrollerlistactivity) | **GET** /autopilot/activity | Cross-run activity feed (the business timeline) — server-side filter by kind, action, outcome, entity, text and time
*AutopilotApi* | [**autopilotControllerListLogs**](docs/AutopilotApi.md#autopilotcontrollerlistlogs) | **GET** /autopilot/runs/{id}/logs | Execution log of a run — filter by channel (BUSINESS narrative vs TECHNICAL mechanics/raw model output)
*AutopilotApi* | [**autopilotControllerListMemory**](docs/AutopilotApi.md#autopilotcontrollerlistmemory) | **GET** /autopilot/memory | List the agent memory (glossary, precedents, topic map)
*AutopilotApi* | [**autopilotControllerListRuns**](docs/AutopilotApi.md#autopilotcontrollerlistruns) | **GET** /autopilot/runs | List autopilot agent runs (newest first)
*AutopilotApi* | [**autopilotControllerRerunRun**](docs/AutopilotApi.md#autopilotcontrollerrerunrun) | **POST** /autopilot/runs/{id}/rerun | Re-execute one specific agent run from scratch under its original cycle identity
*AutopilotApi* | [**autopilotControllerTrigger**](docs/AutopilotApi.md#autopilotcontrollertrigger) | **POST** /autopilot/trigger | Manually trigger an autopilot cycle over existing data, with an optional steering instruction
*AutopilotApi* | [**autopilotControllerTriggerDream**](docs/AutopilotApi.md#autopilotcontrollertriggerdream) | **POST** /autopilot/dream | Trigger a dream cycle now (memory consolidation — dedupe, prune noise, distill notes)
*AutopilotApi* | [**autopilotControllerUpdateAgent**](docs/AutopilotApi.md#autopilotcontrollerupdateagent) | **PATCH** /autopilot/agents/{kind} | Retune one agent — toggle it, edit its goal/iterations, or reassign its built-in tools
*AutopilotApi* | [**autopilotControllerUpdateMemory**](docs/AutopilotApi.md#autopilotcontrollerupdatememory) | **PATCH** /autopilot/memory/{id} | Edit a memory entry (content, tags, weight)
*AutopilotApi* | [**autopilotControllerUpdateSystemBrief**](docs/AutopilotApi.md#autopilotcontrollerupdatesystembrief) | **PUT** /autopilot/system-brief | Create or rewrite the system-brief narrative
*AutopilotApi* | [**mcpServersControllerCreate**](docs/AutopilotApi.md#mcpserverscontrollercreate) | **POST** /autopilot/mcp-servers | Add an external MCP server
*AutopilotApi* | [**mcpServersControllerList**](docs/AutopilotApi.md#mcpserverscontrollerlist) | **GET** /autopilot/mcp-servers | List configured external MCP servers
*AutopilotApi* | [**mcpServersControllerRefresh**](docs/AutopilotApi.md#mcpserverscontrollerrefresh) | **POST** /autopilot/mcp-servers/refresh | Reconnect all enabled servers and rediscover tools
*AutopilotApi* | [**mcpServersControllerRemove**](docs/AutopilotApi.md#mcpserverscontrollerremove) | **DELETE** /autopilot/mcp-servers/{id} | Remove an MCP server
*AutopilotApi* | [**mcpServersControllerTest**](docs/AutopilotApi.md#mcpserverscontrollertest) | **POST** /autopilot/mcp-servers/{id}/test | Probe a server: connect and list its tools
*AutopilotApi* | [**mcpServersControllerUpdate**](docs/AutopilotApi.md#mcpserverscontrollerupdate) | **PATCH** /autopilot/mcp-servers/{id} | Update an MCP server
*CasesApi* | [**caseTimelineControllerGetTimeline**](docs/CasesApi.md#casetimelinecontrollergettimeline) | **GET** /cases/{caseId}/timeline | Paginated unified case activity feed (newest first)
*CasesApi* | [**casesControllerAddEvidence**](docs/CasesApi.md#casescontrolleraddevidence) | **POST** /cases/{id}/evidence | Attach an asset as evidence
*CasesApi* | [**casesControllerAddFinding**](docs/CasesApi.md#casescontrolleraddfinding) | **POST** /cases/{id}/evidence/{evidenceId}/findings | Attach a finding to a piece of evidence
*CasesApi* | [**casesControllerAttachFindings**](docs/CasesApi.md#casescontrollerattachfindings) | **POST** /cases/{id}/findings | Batch-attach findings (asset evidence rows are created as needed)
*CasesApi* | [**casesControllerClose**](docs/CasesApi.md#casescontrollerclose) | **POST** /cases/{id}/close | Close a case with a conclusion (archives linked inquiries)
*CasesApi* | [**casesControllerCreate**](docs/CasesApi.md#casescontrollercreate) | **POST** /cases | Create a case (optionally linking questions)
*CasesApi* | [**casesControllerFindOne**](docs/CasesApi.md#casescontrollerfindone) | **GET** /cases/{id} | Get a case with evidence, findings and linked questions
*CasesApi* | [**casesControllerGraph**](docs/CasesApi.md#casescontrollergraph) | **GET** /cases/{id}/graph | Get the evidence neighbourhood graph for a case
*CasesApi* | [**casesControllerLinkInquiries**](docs/CasesApi.md#casescontrollerlinkinquiries) | **POST** /cases/{id}/inquiries | Link inquiries to a case (already-linked ones are ignored)
*CasesApi* | [**casesControllerList**](docs/CasesApi.md#casescontrollerlist) | **GET** /cases | List cases
*CasesApi* | [**casesControllerPatchEvidenceNote**](docs/CasesApi.md#casescontrollerpatchevidencenote) | **PATCH** /cases/{id}/evidence/{evidenceId} | Update the note on an evidence row
*CasesApi* | [**casesControllerPatchFindingNote**](docs/CasesApi.md#casescontrollerpatchfindingnote) | **PATCH** /cases/{id}/findings/{caseFindingId} | Update the note on a case finding
*CasesApi* | [**casesControllerPull**](docs/CasesApi.md#casescontrollerpull) | **POST** /cases/{id}/pull | Pull a question\&#39;s matches into the case as evidence
*CasesApi* | [**casesControllerRemove**](docs/CasesApi.md#casescontrollerremove) | **DELETE** /cases/{id} | Delete a case (its questions become standalone)
*CasesApi* | [**casesControllerRemoveEvidence**](docs/CasesApi.md#casescontrollerremoveevidence) | **DELETE** /cases/{id}/evidence/{evidenceId} | Remove evidence from the case
*CasesApi* | [**casesControllerRemoveFinding**](docs/CasesApi.md#casescontrollerremovefinding) | **DELETE** /cases/{id}/findings/{caseFindingId} | Remove a finding from the case
*CasesApi* | [**casesControllerUnlinkInquiry**](docs/CasesApi.md#casescontrollerunlinkinquiry) | **DELETE** /cases/{id}/inquiries/{inquiryId} | Unlink an inquiry from a case (the inquiry is untouched)
*CasesApi* | [**casesControllerUpdate**](docs/CasesApi.md#casescontrollerupdate) | **PATCH** /cases/{id} | Update a case
*ChatBotsApi* | [**chatBotsControllerCreate**](docs/ChatBotsApi.md#chatbotscontrollercreate) | **POST** /instance-settings/chat/bots | Create a chat bot
*ChatBotsApi* | [**chatBotsControllerDiagnostics**](docs/ChatBotsApi.md#chatbotscontrollerdiagnostics) | **GET** /instance-settings/chat/bots/{id}/diagnostics | Chat bot diagnostics
*ChatBotsApi* | [**chatBotsControllerList**](docs/ChatBotsApi.md#chatbotscontrollerlist) | **GET** /instance-settings/chat/bots | List chat bots
*ChatBotsApi* | [**chatBotsControllerRemove**](docs/ChatBotsApi.md#chatbotscontrollerremove) | **DELETE** /instance-settings/chat/bots/{id} | Delete a chat bot
*ChatBotsApi* | [**chatBotsControllerSimulate**](docs/ChatBotsApi.md#chatbotscontrollersimulate) | **POST** /instance-settings/chat/bots/{id}/simulate | Send a test message to a chat bot
*ChatBotsApi* | [**chatBotsControllerTest**](docs/ChatBotsApi.md#chatbotscontrollertest) | **POST** /instance-settings/chat/bots/{id}/test | Test chat bot connection
*ChatBotsApi* | [**chatBotsControllerUpdate**](docs/ChatBotsApi.md#chatbotscontrollerupdate) | **PATCH** /instance-settings/chat/bots/{id} | Update a chat bot
*CorrelationApi* | [**correlationControllerAddExclusion**](docs/CorrelationApi.md#correlationcontrolleraddexclusion) | **POST** /correlation/exclusions | Add an exclusion rule (ignore noisy values) and recompute
*CorrelationApi* | [**correlationControllerCaseAction**](docs/CorrelationApi.md#correlationcontrollercaseaction) | **POST** /correlation/case-action | Create a case (or add to one) from assets selected in the fingerprints graph
*CorrelationApi* | [**correlationControllerGetConfig**](docs/CorrelationApi.md#correlationcontrollergetconfig) | **GET** /correlation/config | Correlation tuning: per-label weights (dynamic) + match thresholds
*CorrelationApi* | [**correlationControllerGraph**](docs/CorrelationApi.md#correlationcontrollergraph) | **GET** /correlation/graph | Correlation (\&quot;evidence fingerprints\&quot;) graph: assets linked through the findings they share
*CorrelationApi* | [**correlationControllerLinksGraph**](docs/CorrelationApi.md#correlationcontrollerlinksgraph) | **GET** /correlation/links-graph | A source\&#39;s assets connected by their links (hash references)
*CorrelationApi* | [**correlationControllerOccurrences**](docs/CorrelationApi.md#correlationcontrolleroccurrences) | **GET** /findings/occurrences | Where else a normalized finding value appears (reverse index)
*CorrelationApi* | [**correlationControllerRecompute**](docs/CorrelationApi.md#correlationcontrollerrecompute) | **POST** /assets/{id}/recompute-correlation | Recompute correlation for a single asset (on demand)
*CorrelationApi* | [**correlationControllerRemoveExclusion**](docs/CorrelationApi.md#correlationcontrollerremoveexclusion) | **DELETE** /correlation/exclusions/{id} | Remove an exclusion rule and recompute
*CorrelationApi* | [**correlationControllerUpdateConfig**](docs/CorrelationApi.md#correlationcontrollerupdateconfig) | **PUT** /correlation/config | Update correlation tuning and schedule a full recompute (logged)
*CustomDetectorExtractionsApi* | [**customDetectorExtractionsControllerCoverage**](docs/CustomDetectorExtractionsApi.md#customdetectorextractionscontrollercoverage) | **GET** /custom-detectors/{id}/extractions/coverage | 
*CustomDetectorExtractionsApi* | [**customDetectorExtractionsControllerGetByFinding**](docs/CustomDetectorExtractionsApi.md#customdetectorextractionscontrollergetbyfinding) | **GET** /findings/{findingId}/extraction | 
*CustomDetectorExtractionsApi* | [**customDetectorExtractionsControllerSearch**](docs/CustomDetectorExtractionsApi.md#customdetectorextractionscontrollersearch) | **GET** /custom-detectors/{id}/extractions | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerCreate**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollercreate) | **POST** /custom-detectors/{detectorId}/test-scenarios | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerDelete**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollerdelete) | **DELETE** /custom-detectors/{detectorId}/test-scenarios/{scenarioId} | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerList**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollerlist) | **GET** /custom-detectors/{detectorId}/test-scenarios | 
*CustomDetectorTestsApi* | [**customDetectorTestsControllerRun**](docs/CustomDetectorTestsApi.md#customdetectortestscontrollerrun) | **POST** /custom-detectors/{detectorId}/test-scenarios/run | 
*CustomDetectorsApi* | [**customDetectorsControllerClearTrainingExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollercleartrainingexamples) | **DELETE** /custom-detectors/{id}/training-examples | Delete all training examples for a detector
*CustomDetectorsApi* | [**customDetectorsControllerCreate**](docs/CustomDetectorsApi.md#customdetectorscontrollercreate) | **POST** /custom-detectors | Create custom detector
*CustomDetectorsApi* | [**customDetectorsControllerDelete**](docs/CustomDetectorsApi.md#customdetectorscontrollerdelete) | **DELETE** /custom-detectors/{id} | Delete custom detector
*CustomDetectorsApi* | [**customDetectorsControllerDeleteTrainingExample**](docs/CustomDetectorsApi.md#customdetectorscontrollerdeletetrainingexample) | **DELETE** /custom-detectors/{id}/training-examples/{exampleId} | Delete a single training example
*CustomDetectorsApi* | [**customDetectorsControllerGetById**](docs/CustomDetectorsApi.md#customdetectorscontrollergetbyid) | **GET** /custom-detectors/{id} | Get custom detector by ID
*CustomDetectorsApi* | [**customDetectorsControllerList**](docs/CustomDetectorsApi.md#customdetectorscontrollerlist) | **GET** /custom-detectors | List custom detectors
*CustomDetectorsApi* | [**customDetectorsControllerListExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollerlistexamples) | **GET** /custom-detectors/examples | List custom detector starter examples
*CustomDetectorsApi* | [**customDetectorsControllerListTrainingExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollerlisttrainingexamples) | **GET** /custom-detectors/{id}/training-examples | List stored training examples for a detector
*CustomDetectorsApi* | [**customDetectorsControllerParseTrainingExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollerparsetrainingexamples) | **POST** /custom-detectors/training-examples/parse | Parse uploaded training examples file
*CustomDetectorsApi* | [**customDetectorsControllerSaveTrainingExamples**](docs/CustomDetectorsApi.md#customdetectorscontrollersavetrainingexamples) | **POST** /custom-detectors/{id}/training-examples | Save training examples for a detector
*CustomDetectorsApi* | [**customDetectorsControllerTrain**](docs/CustomDetectorsApi.md#customdetectorscontrollertrain) | **POST** /custom-detectors/{id}/train | Trigger custom detector training
*CustomDetectorsApi* | [**customDetectorsControllerTrainingExamplesStats**](docs/CustomDetectorsApi.md#customdetectorscontrollertrainingexamplesstats) | **GET** /custom-detectors/{id}/training-examples/stats | Get training example counts grouped by label
*CustomDetectorsApi* | [**customDetectorsControllerTrainingHistory**](docs/CustomDetectorsApi.md#customdetectorscontrollertraininghistory) | **GET** /custom-detectors/{id}/training-history | List training history for custom detector
*CustomDetectorsApi* | [**customDetectorsControllerUpdate**](docs/CustomDetectorsApi.md#customdetectorscontrollerupdate) | **PATCH** /custom-detectors/{id} | Update custom detector
*EmbeddingsApi* | [**embeddingControllerChunks**](docs/EmbeddingsApi.md#embeddingcontrollerchunks) | **POST** /sources/{sourceId}/embeddings/chunks | Store asset chunk-to-content mappings
*EmbeddingsApi* | [**embeddingControllerSimilar**](docs/EmbeddingsApi.md#embeddingcontrollersimilar) | **GET** /findings/{findingId}/similar | Find semantically similar findings with ranking evidence
*EmbeddingsApi* | [**embeddingControllerStatus**](docs/EmbeddingsApi.md#embeddingcontrollerstatus) | **GET** /embeddings/status | Get semantic storage and search capability
*FindingsApi* | [**findingsControllerBulkUpdate**](docs/FindingsApi.md#findingscontrollerbulkupdate) | **POST** /findings/bulk-update | Bulk update findings
*FindingsApi* | [**findingsControllerCreate**](docs/FindingsApi.md#findingscontrollercreate) | **POST** /findings/create | Create a new finding
*FindingsApi* | [**findingsControllerFindOne**](docs/FindingsApi.md#findingscontrollerfindone) | **GET** /findings/{id} | Get a finding by ID
*FindingsApi* | [**findingsControllerGetDiscoveryOverview**](docs/FindingsApi.md#findingscontrollergetdiscoveryoverview) | **GET** /findings/discovery | Get discovery dashboard overview data
*FindingsApi* | [**findingsControllerGetStats**](docs/FindingsApi.md#findingscontrollergetstats) | **GET** /findings/stats | Get finding statistics
*FindingsApi* | [**findingsControllerListAssetSummaries**](docs/FindingsApi.md#findingscontrollerlistassetsummaries) | **GET** /findings/assets | List asset finding summaries with optional filters
*FindingsApi* | [**findingsControllerUpdate**](docs/FindingsApi.md#findingscontrollerupdate) | **PATCH** /findings/{id} | Update a finding
*GraphApi* | [**graphControllerCreateManualEdge**](docs/GraphApi.md#graphcontrollercreatemanualedge) | **POST** /graph/edges/manual | Create a manual edge between two entities (user-defined relation type)
*GraphApi* | [**graphControllerDeleteEdge**](docs/GraphApi.md#graphcontrollerdeleteedge) | **DELETE** /graph/edges/{id} | Delete an edge
*GraphApi* | [**graphControllerExpand**](docs/GraphApi.md#graphcontrollerexpand) | **POST** /graph/expand | Expand the graph around a seed entity (recursive traversal)
*GraphApi* | [**graphControllerIngestEdges**](docs/GraphApi.md#graphcontrolleringestedges) | **POST** /graph/edges | Bulk-upsert source-derived edges from a connector. Idempotent.
*GraphApi* | [**graphControllerPivot**](docs/GraphApi.md#graphcontrollerpivot) | **POST** /graph/pivot | Named pivot question on a node (e.g. who_touched, upstream_lineage, emails)
*GraphApi* | [**graphControllerRebuildEdges**](docs/GraphApi.md#graphcontrollerrebuildedges) | **POST** /graph/rebuild-edges | Rebuild all inferred edges from existing assets and findings
*GraphApi* | [**graphControllerRelationTypes**](docs/GraphApi.md#graphcontrollerrelationtypes) | **GET** /graph/relation-types | Get all relation types in use + vocabulary suggestions
*GraphApi* | [**graphControllerUpdateEdge**](docs/GraphApi.md#graphcontrollerupdateedge) | **PATCH** /graph/edges/{id} | Rename an edge relation type
*HealthApi* | [**healthControllerGetHealth**](docs/HealthApi.md#healthcontrollergethealth) | **GET** / | Health check
*HealthApi* | [**healthControllerPing**](docs/HealthApi.md#healthcontrollerping) | **GET** /ping | Ping endpoint
*InquiriesApi* | [**inquiriesControllerCreate**](docs/InquiriesApi.md#inquiriescontrollercreate) | **POST** /inquiries | Create an inquiry (a saved query) and seed its matches
*InquiriesApi* | [**inquiriesControllerFindOne**](docs/InquiriesApi.md#inquiriescontrollerfindone) | **GET** /inquiries/{id} | Get an inquiry
*InquiriesApi* | [**inquiriesControllerList**](docs/InquiriesApi.md#inquiriescontrollerlist) | **GET** /inquiries | List inquiries (with match counts)
*InquiriesApi* | [**inquiriesControllerListMatches**](docs/InquiriesApi.md#inquiriescontrollerlistmatches) | **GET** /inquiries/{id}/matches | List the findings currently matching this inquiry (paginated)
*InquiriesApi* | [**inquiriesControllerMarkSeen**](docs/InquiriesApi.md#inquiriescontrollermarkseen) | **POST** /inquiries/{id}/seen | Mark the current matches as seen (clears the \&quot;new\&quot; badge)
*InquiriesApi* | [**inquiriesControllerMatchOptions**](docs/InquiriesApi.md#inquiriescontrollermatchoptions) | **GET** /inquiries/match-options | Sources, custom detectors and distinct finding types for the matcher form
*InquiriesApi* | [**inquiriesControllerPreview**](docs/InquiriesApi.md#inquiriescontrollerpreview) | **POST** /inquiries/preview | Preview findings a matcher config currently selects (no save)
*InquiriesApi* | [**inquiriesControllerRematch**](docs/InquiriesApi.md#inquiriescontrollerrematch) | **POST** /inquiries/{id}/rematch | Recompute matches against all current findings
*InquiriesApi* | [**inquiriesControllerRemove**](docs/InquiriesApi.md#inquiriescontrollerremove) | **DELETE** /inquiries/{id} | Delete an inquiry
*InquiriesApi* | [**inquiriesControllerUpdate**](docs/InquiriesApi.md#inquiriescontrollerupdate) | **PATCH** /inquiries/{id} | Update an inquiry (matchers change → matches recomputed)
*InstanceSettingsApi* | [**instanceSettingsControllerGetSettings**](docs/InstanceSettingsApi.md#instancesettingscontrollergetsettings) | **GET** /instance-settings | Get instance settings
*InstanceSettingsApi* | [**instanceSettingsControllerUpdateSettings**](docs/InstanceSettingsApi.md#instancesettingscontrollerupdatesettings) | **PUT** /instance-settings | Update instance settings
*InstanceSettingsApi* | [**mcpSettingsControllerCreateToken**](docs/InstanceSettingsApi.md#mcpsettingscontrollercreatetoken) | **POST** /instance-settings/mcp/tokens | Create MCP access token
*InstanceSettingsApi* | [**mcpSettingsControllerDeleteToken**](docs/InstanceSettingsApi.md#mcpsettingscontrollerdeletetoken) | **DELETE** /instance-settings/mcp/tokens/{id} | Delete MCP access token
*InstanceSettingsApi* | [**mcpSettingsControllerGetOverview**](docs/InstanceSettingsApi.md#mcpsettingscontrollergetoverview) | **GET** /instance-settings/mcp/overview | Get MCP server overview
*InstanceSettingsApi* | [**mcpSettingsControllerGetTools**](docs/InstanceSettingsApi.md#mcpsettingscontrollergettools) | **GET** /instance-settings/mcp/tools | List MCP tools
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
*RunnersApi* | [**cliRunnerControllerGetRunnerAssetProgress**](docs/RunnersApi.md#clirunnercontrollergetrunnerassetprogress) | **GET** /runners/{runnerId}/assets/progress | Get runner asset processing progress
*RunnersApi* | [**cliRunnerControllerListRunners**](docs/RunnersApi.md#clirunnercontrollerlistrunners) | **GET** /runners | List all runners
*RunnersApi* | [**cliRunnerControllerListSourceRunners**](docs/RunnersApi.md#clirunnercontrollerlistsourcerunners) | **GET** /sources/{sourceId}/runners | List runners for source
*RunnersApi* | [**cliRunnerControllerRegisterDiscoveredAssets**](docs/RunnersApi.md#clirunnercontrollerregisterdiscoveredassets) | **POST** /runners/{runnerId}/assets/discover | Register discovered asset hashes for a runner
*RunnersApi* | [**cliRunnerControllerSearchRunnerLogs**](docs/RunnersApi.md#clirunnercontrollersearchrunnerlogs) | **POST** /runners/{runnerId}/logs | Search runner logs with server-side filtering, full-text search, and sort
*RunnersApi* | [**cliRunnerControllerStartRunner**](docs/RunnersApi.md#clirunnercontrollerstartrunner) | **POST** /sources/{sourceId}/run | Start CLI runner for source
*RunnersApi* | [**cliRunnerControllerStopRunner**](docs/RunnersApi.md#clirunnercontrollerstoprunner) | **PATCH** /runners/{runnerId}/stop | Stop running CLI process
*RunnersApi* | [**cliRunnerControllerUpdateRunnerAssetStatuses**](docs/RunnersApi.md#clirunnercontrollerupdaterunnerassetstatuses) | **PATCH** /runners/{runnerId}/assets/status | Update processing status of runner assets
*RunnersApi* | [**cliRunnerControllerUpdateRunnerStatus**](docs/RunnersApi.md#clirunnercontrollerupdaterunnerstatusoperation) | **PATCH** /runners/{runnerId}/status | Update runner status
*RunnersApi* | [**searchRunnersControllerExportRunnerAssets**](docs/RunnersApi.md#searchrunnerscontrollerexportrunnerassets) | **GET** /search/runner-assets/export | Export runner assets as CSV
*RunnersApi* | [**searchRunnersControllerQueryRunnerAssets**](docs/RunnersApi.md#searchrunnerscontrollerqueryrunnerassets) | **GET** /search/runner-assets/query | Query runner assets (cursor-paginated JSON)
*RunnersApi* | [**searchRunnersControllerSearchRunnerAssets**](docs/RunnersApi.md#searchrunnerscontrollersearchrunnerassets) | **POST** /search/runner-assets | Search runner assets
*RunnersApi* | [**searchRunnersControllerSearchRunners**](docs/RunnersApi.md#searchrunnerscontrollersearchrunners) | **POST** /search/runners | Search runners
*RunnersApi* | [**searchRunnersControllerSearchRunnersCharts**](docs/RunnersApi.md#searchrunnerscontrollersearchrunnerscharts) | **POST** /search/runners/charts | Runners charts overview
*SandboxApi* | [**sandboxControllerClearFindings**](docs/SandboxApi.md#sandboxcontrollerclearfindings) | **DELETE** /sandbox/runs/{id}/findings | Clear all findings for a run
*SandboxApi* | [**sandboxControllerCreateRun**](docs/SandboxApi.md#sandboxcontrollercreaterun) | **POST** /sandbox/runs | Upload a file and run detectors on it
*SandboxApi* | [**sandboxControllerDeleteRun**](docs/SandboxApi.md#sandboxcontrollerdeleterun) | **DELETE** /sandbox/runs/{id} | Delete a sandbox run
*SandboxApi* | [**sandboxControllerGetRun**](docs/SandboxApi.md#sandboxcontrollergetrun) | **GET** /sandbox/runs/{id} | Get a sandbox run by ID
*SandboxApi* | [**sandboxControllerGetRunInput**](docs/SandboxApi.md#sandboxcontrollergetruninput) | **GET** /sandbox/runs/{id}/input | Download the staged input file for an in-flight sandbox run
*SandboxApi* | [**sandboxControllerListRuns**](docs/SandboxApi.md#sandboxcontrollerlistruns) | **GET** /sandbox/runs | List sandbox runs (paginated)
*SandboxApi* | [**sandboxControllerRerunRun**](docs/SandboxApi.md#sandboxcontrollerrerunrun) | **POST** /sandbox/runs/{id}/rerun | Re-scan a run with different detectors (appends findings)
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
*ThreadsApi* | [**caseThreadsControllerAddEntry**](docs/ThreadsApi.md#casethreadscontrolleraddentry) | **POST** /threads/{id}/entries | Add a note, statement revision, or status entry to a thread
*ThreadsApi* | [**caseThreadsControllerCreate**](docs/ThreadsApi.md#casethreadscontrollercreate) | **POST** /cases/{caseId}/threads | Create a thread (hypothesis or discussion)
*ThreadsApi* | [**caseThreadsControllerGetEntries**](docs/ThreadsApi.md#casethreadscontrollergetentries) | **GET** /threads/{id}/entries | Paginated thread entry history
*ThreadsApi* | [**caseThreadsControllerLinkSupport**](docs/ThreadsApi.md#casethreadscontrollerlinksupport) | **POST** /threads/{id}/support | Link evidence or finding to a thread
*ThreadsApi* | [**caseThreadsControllerList**](docs/ThreadsApi.md#casethreadscontrollerlist) | **GET** /cases/{caseId}/threads | List threads (hypothesis + discussion) for a case
*ThreadsApi* | [**caseThreadsControllerRemove**](docs/ThreadsApi.md#casethreadscontrollerremove) | **DELETE** /threads/{id} | Delete a thread
*ThreadsApi* | [**caseThreadsControllerUnlinkSupport**](docs/ThreadsApi.md#casethreadscontrollerunlinksupport) | **DELETE** /threads/{id}/support/{linkId} | Unlink evidence or finding from a thread
*ThreadsApi* | [**caseThreadsControllerUpdate**](docs/ThreadsApi.md#casethreadscontrollerupdate) | **PATCH** /threads/{id} | Update thread title / status / confidence / color


### Models

- [AddEvidenceDto](docs/AddEvidenceDto.md)
- [AddExclusionDto](docs/AddExclusionDto.md)
- [AddFindingDto](docs/AddFindingDto.md)
- [AddThreadEntryDto](docs/AddThreadEntryDto.md)
- [AgentActivityItemDto](docs/AgentActivityItemDto.md)
- [AgentActivityListResponseDto](docs/AgentActivityListResponseDto.md)
- [AgentConfigDto](docs/AgentConfigDto.md)
- [AgentConfigListResponseDto](docs/AgentConfigListResponseDto.md)
- [AgentDecisionDto](docs/AgentDecisionDto.md)
- [AgentLogDto](docs/AgentLogDto.md)
- [AgentLogListResponseDto](docs/AgentLogListResponseDto.md)
- [AgentMemoryDto](docs/AgentMemoryDto.md)
- [AgentMemoryListResponseDto](docs/AgentMemoryListResponseDto.md)
- [AgentRunDetailDto](docs/AgentRunDetailDto.md)
- [AgentRunDto](docs/AgentRunDto.md)
- [AgentRunListResponseDto](docs/AgentRunListResponseDto.md)
- [AgentSystemBriefDto](docs/AgentSystemBriefDto.md)
- [AgentUsageBucketDto](docs/AgentUsageBucketDto.md)
- [AgentUsageResponseDto](docs/AgentUsageResponseDto.md)
- [AgentUsageTotalsDto](docs/AgentUsageTotalsDto.md)
- [AiCompleteRequestDto](docs/AiCompleteRequestDto.md)
- [AiCompleteResponseDto](docs/AiCompleteResponseDto.md)
- [AiMessageDto](docs/AiMessageDto.md)
- [AiProviderConfigResponseDto](docs/AiProviderConfigResponseDto.md)
- [AiProviderConfigTestResultDto](docs/AiProviderConfigTestResultDto.md)
- [AssetChunkDto](docs/AssetChunkDto.md)
- [AssetFindingDetectorCountDto](docs/AssetFindingDetectorCountDto.md)
- [AssetFindingSeverityCountDto](docs/AssetFindingSeverityCountDto.md)
- [AssetFindingStatusCountDto](docs/AssetFindingStatusCountDto.md)
- [AssetFindingSummaryDto](docs/AssetFindingSummaryDto.md)
- [AssetFindingSummaryListResponseDto](docs/AssetFindingSummaryListResponseDto.md)
- [AssetFindingTypeCountDto](docs/AssetFindingTypeCountDto.md)
- [AssetListItemDto](docs/AssetListItemDto.md)
- [AssetListResponseDto](docs/AssetListResponseDto.md)
- [AssetResponseDto](docs/AssetResponseDto.md)
- [AssetSimilarityDto](docs/AssetSimilarityDto.md)
- [AssistantControllerRespond200Response](docs/AssistantControllerRespond200Response.md)
- [AssistantControllerRespondRequest](docs/AssistantControllerRespondRequest.md)
- [AssistantControllerRespondRequestMessagesInner](docs/AssistantControllerRespondRequestMessagesInner.md)
- [AttachFindingsDto](docs/AttachFindingsDto.md)
- [AttachFindingsResponseDto](docs/AttachFindingsResponseDto.md)
- [AutopilotStatsDto](docs/AutopilotStatsDto.md)
- [BriefMemoryEntryDto](docs/BriefMemoryEntryDto.md)
- [BriefSetupItemDto](docs/BriefSetupItemDto.md)
- [BulkIngestAssetsDto](docs/BulkIngestAssetsDto.md)
- [BulkIngestEdgesDto](docs/BulkIngestEdgesDto.md)
- [BulkIngestEdgesResponseDto](docs/BulkIngestEdgesResponseDto.md)
- [BulkUpdateFindingsDto](docs/BulkUpdateFindingsDto.md)
- [BulkUpdateFindingsResponseDto](docs/BulkUpdateFindingsResponseDto.md)
- [CaseActionRequestDto](docs/CaseActionRequestDto.md)
- [CaseActionResponseDto](docs/CaseActionResponseDto.md)
- [CaseActivityDto](docs/CaseActivityDto.md)
- [CaseEvidenceDto](docs/CaseEvidenceDto.md)
- [CaseFindingDto](docs/CaseFindingDto.md)
- [CaseLinkedInquiryDto](docs/CaseLinkedInquiryDto.md)
- [CaseListResponseDto](docs/CaseListResponseDto.md)
- [CaseResponseDto](docs/CaseResponseDto.md)
- [CaseTimelineResponseDto](docs/CaseTimelineResponseDto.md)
- [ChatBotActivityEntryDto](docs/ChatBotActivityEntryDto.md)
- [ChatBotDiagnosticsDto](docs/ChatBotDiagnosticsDto.md)
- [ChatBotResponseDto](docs/ChatBotResponseDto.md)
- [ChatBotSimulateDto](docs/ChatBotSimulateDto.md)
- [ChatBotSimulateResultDto](docs/ChatBotSimulateResultDto.md)
- [ChatBotTestCheckDto](docs/ChatBotTestCheckDto.md)
- [ChatBotTestResultDto](docs/ChatBotTestResultDto.md)
- [CliRunnerControllerUpdateRunnerStatusRequest](docs/CliRunnerControllerUpdateRunnerStatusRequest.md)
- [CloseCaseDto](docs/CloseCaseDto.md)
- [CloseCaseResponseDto](docs/CloseCaseResponseDto.md)
- [CorrelationConfigResponseDto](docs/CorrelationConfigResponseDto.md)
- [CorrelationGraphResponseDto](docs/CorrelationGraphResponseDto.md)
- [CorrelationLabelWeightDto](docs/CorrelationLabelWeightDto.md)
- [CreateAgentMemoryDto](docs/CreateAgentMemoryDto.md)
- [CreateAiProviderConfigDto](docs/CreateAiProviderConfigDto.md)
- [CreateCaseDto](docs/CreateCaseDto.md)
- [CreateChatBotDto](docs/CreateChatBotDto.md)
- [CreateCustomDetectorDto](docs/CreateCustomDetectorDto.md)
- [CreateExternalRunnerDto](docs/CreateExternalRunnerDto.md)
- [CreateFindingDto](docs/CreateFindingDto.md)
- [CreateInquiryDto](docs/CreateInquiryDto.md)
- [CreateManualEdgeDto](docs/CreateManualEdgeDto.md)
- [CreateMcpServerDto](docs/CreateMcpServerDto.md)
- [CreateMcpTokenDto](docs/CreateMcpTokenDto.md)
- [CreateSourceDto](docs/CreateSourceDto.md)
- [CreateThreadDto](docs/CreateThreadDto.md)
- [CustomDetectorExampleDto](docs/CustomDetectorExampleDto.md)
- [CustomDetectorResponseDto](docs/CustomDetectorResponseDto.md)
- [CustomDetectorResponseDtoSourcesUsingInner](docs/CustomDetectorResponseDtoSourcesUsingInner.md)
- [CustomDetectorTrainingRunDto](docs/CustomDetectorTrainingRunDto.md)
- [DeleteRunnerResponseDto](docs/DeleteRunnerResponseDto.md)
- [DiscoveryRecentRunDto](docs/DiscoveryRecentRunDto.md)
- [DiscoveryRunSourceDto](docs/DiscoveryRunSourceDto.md)
- [EdgeDetailDto](docs/EdgeDetailDto.md)
- [EvidenceEntityDto](docs/EvidenceEntityDto.md)
- [ExclusionRuleDto](docs/ExclusionRuleDto.md)
- [ExpandGraphDto](docs/ExpandGraphDto.md)
- [FinalizeIngestRunDto](docs/FinalizeIngestRunDto.md)
- [FindingEvidenceAnalysisDto](docs/FindingEvidenceAnalysisDto.md)
- [FindingHistoryEntryDto](docs/FindingHistoryEntryDto.md)
- [FindingLocationDto](docs/FindingLocationDto.md)
- [FindingRankReasonDto](docs/FindingRankReasonDto.md)
- [FindingResponseDto](docs/FindingResponseDto.md)
- [FindingSearchRankingDto](docs/FindingSearchRankingDto.md)
- [FindingsBySeverityDto](docs/FindingsBySeverityDto.md)
- [FindingsChartsTimelineBucketDto](docs/FindingsChartsTimelineBucketDto.md)
- [FindingsChartsTopAssetDto](docs/FindingsChartsTopAssetDto.md)
- [FindingsChartsTotalsDto](docs/FindingsChartsTotalsDto.md)
- [FindingsDiscoveryActivityDto](docs/FindingsDiscoveryActivityDto.md)
- [FindingsDiscoveryResponseDto](docs/FindingsDiscoveryResponseDto.md)
- [FindingsDiscoverySeverityBreakdownDto](docs/FindingsDiscoverySeverityBreakdownDto.md)
- [FindingsDiscoveryStatusBreakdownDto](docs/FindingsDiscoveryStatusBreakdownDto.md)
- [FindingsDiscoveryTopAssetDto](docs/FindingsDiscoveryTopAssetDto.md)
- [FindingsDiscoveryTotalsDto](docs/FindingsDiscoveryTotalsDto.md)
- [FindingsRankingDto](docs/FindingsRankingDto.md)
- [GraphEdgeDto](docs/GraphEdgeDto.md)
- [GraphNodeDto](docs/GraphNodeDto.md)
- [GraphResponseDto](docs/GraphResponseDto.md)
- [HarnessMissionDto](docs/HarnessMissionDto.md)
- [HarnessToolDto](docs/HarnessToolDto.md)
- [HarnessToolsResponseDto](docs/HarnessToolsResponseDto.md)
- [HealthControllerGetHealth200Response](docs/HealthControllerGetHealth200Response.md)
- [IngestEdgeDto](docs/IngestEdgeDto.md)
- [InquiryLinkedCaseDto](docs/InquiryLinkedCaseDto.md)
- [InquiryListResponseDto](docs/InquiryListResponseDto.md)
- [InquiryMatchDto](docs/InquiryMatchDto.md)
- [InquiryMatchListResponseDto](docs/InquiryMatchListResponseDto.md)
- [InquiryResponseDto](docs/InquiryResponseDto.md)
- [InstanceSettingsResponseDto](docs/InstanceSettingsResponseDto.md)
- [LatestRunnerSummaryDto](docs/LatestRunnerSummaryDto.md)
- [LinkInquiriesDto](docs/LinkInquiriesDto.md)
- [LinkThreadSupportDto](docs/LinkThreadSupportDto.md)
- [ListRunnersResponseDto](docs/ListRunnersResponseDto.md)
- [LiveQueryResponseDto](docs/LiveQueryResponseDto.md)
- [LocationDto](docs/LocationDto.md)
- [MarkAllReadDto](docs/MarkAllReadDto.md)
- [MatchOptionCustomDetectorDto](docs/MatchOptionCustomDetectorDto.md)
- [MatchOptionFindingTypeDto](docs/MatchOptionFindingTypeDto.md)
- [MatchOptionSourceDto](docs/MatchOptionSourceDto.md)
- [MatchOptionsResponseDto](docs/MatchOptionsResponseDto.md)
- [McpCapabilityGroupDto](docs/McpCapabilityGroupDto.md)
- [McpOverviewResponseDto](docs/McpOverviewResponseDto.md)
- [McpPromptSummaryDto](docs/McpPromptSummaryDto.md)
- [McpServerResponseDto](docs/McpServerResponseDto.md)
- [McpServerTestResultDto](docs/McpServerTestResultDto.md)
- [McpTokenCreatedResponseDto](docs/McpTokenCreatedResponseDto.md)
- [McpTokenResponseDto](docs/McpTokenResponseDto.md)
- [McpToolParameterDto](docs/McpToolParameterDto.md)
- [McpToolSummaryDto](docs/McpToolSummaryDto.md)
- [NotificationListResponseDto](docs/NotificationListResponseDto.md)
- [NotificationResponseDto](docs/NotificationResponseDto.md)
- [NotificationsControllerDeleteNotification200Response](docs/NotificationsControllerDeleteNotification200Response.md)
- [NotificationsControllerMarkAllRead200Response](docs/NotificationsControllerMarkAllRead200Response.md)
- [ParseTrainingExamplesResponseDto](docs/ParseTrainingExamplesResponseDto.md)
- [ParseTrainingExamplesSkippedReasonsDto](docs/ParseTrainingExamplesSkippedReasonsDto.md)
- [ParsedTrainingExampleDto](docs/ParsedTrainingExampleDto.md)
- [PivotGraphDto](docs/PivotGraphDto.md)
- [PreviewInquiryDto](docs/PreviewInquiryDto.md)
- [PreviewResponseDto](docs/PreviewResponseDto.md)
- [PullFromInquiryDto](docs/PullFromInquiryDto.md)
- [PullFromInquiryResponseDto](docs/PullFromInquiryResponseDto.md)
- [PutAssetChunksDto](docs/PutAssetChunksDto.md)
- [RebuildEdgesResponseDto](docs/RebuildEdgesResponseDto.md)
- [RecomputeCorrelationResponseDto](docs/RecomputeCorrelationResponseDto.md)
- [RegisterDiscoveredAssetsDto](docs/RegisterDiscoveredAssetsDto.md)
- [RegisterDiscoveredAssetsResponseDto](docs/RegisterDiscoveredAssetsResponseDto.md)
- [RelationTypesResponseDto](docs/RelationTypesResponseDto.md)
- [RematchResponseDto](docs/RematchResponseDto.md)
- [RerunSandboxRunDto](docs/RerunSandboxRunDto.md)
- [RunnerAssetItemDto](docs/RunnerAssetItemDto.md)
- [RunnerAssetProgressDto](docs/RunnerAssetProgressDto.md)
- [RunnerAssetStatusUpdateItem](docs/RunnerAssetStatusUpdateItem.md)
- [RunnerDto](docs/RunnerDto.md)
- [RunnerLogEntryDto](docs/RunnerLogEntryDto.md)
- [RunnerLogsResponseDto](docs/RunnerLogsResponseDto.md)
- [RunnersChartsTimelineBucketDto](docs/RunnersChartsTimelineBucketDto.md)
- [RunnersChartsTopSourceDto](docs/RunnersChartsTopSourceDto.md)
- [RunnersChartsTotalsDto](docs/RunnersChartsTotalsDto.md)
- [SandboxRunDto](docs/SandboxRunDto.md)
- [SandboxRunListResponseDto](docs/SandboxRunListResponseDto.md)
- [SaveTrainingExamplesDto](docs/SaveTrainingExamplesDto.md)
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
- [SearchFindingsRankingMetadataDto](docs/SearchFindingsRankingMetadataDto.md)
- [SearchFindingsRequestDto](docs/SearchFindingsRequestDto.md)
- [SearchFindingsResponseDto](docs/SearchFindingsResponseDto.md)
- [SearchRunnerItemDto](docs/SearchRunnerItemDto.md)
- [SearchRunnerLogsBodyDto](docs/SearchRunnerLogsBodyDto.md)
- [SearchRunnersAssetsFiltersInputDto](docs/SearchRunnersAssetsFiltersInputDto.md)
- [SearchRunnersAssetsPageDto](docs/SearchRunnersAssetsPageDto.md)
- [SearchRunnersAssetsRequestDto](docs/SearchRunnersAssetsRequestDto.md)
- [SearchRunnersAssetsResponseDto](docs/SearchRunnersAssetsResponseDto.md)
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
- [SemanticFindingsSearchDto](docs/SemanticFindingsSearchDto.md)
- [SourceAssetsControllerBulkIngest201Response](docs/SourceAssetsControllerBulkIngest201Response.md)
- [SourceInfoDto](docs/SourceInfoDto.md)
- [SourceResponseDto](docs/SourceResponseDto.md)
- [SourcesControllerGetSchedule200Response](docs/SourcesControllerGetSchedule200Response.md)
- [SourcesControllerUpdateStatusRequest](docs/SourcesControllerUpdateStatusRequest.md)
- [StartRunnerDto](docs/StartRunnerDto.md)
- [StopRunnerResponseDto](docs/StopRunnerResponseDto.md)
- [TestConnectionResponseDto](docs/TestConnectionResponseDto.md)
- [TextCoverageDto](docs/TextCoverageDto.md)
- [ThreadEntriesResponseDto](docs/ThreadEntriesResponseDto.md)
- [ThreadEntryDto](docs/ThreadEntryDto.md)
- [ThreadResponseDto](docs/ThreadResponseDto.md)
- [ThreadSupportLinkDto](docs/ThreadSupportLinkDto.md)
- [TrainCustomDetectorDto](docs/TrainCustomDetectorDto.md)
- [TrainingExampleDto](docs/TrainingExampleDto.md)
- [TrainingExampleItemDto](docs/TrainingExampleItemDto.md)
- [TrainingExamplesStatsDto](docs/TrainingExamplesStatsDto.md)
- [TrainingExamplesStatsDtoByLabelValue](docs/TrainingExamplesStatsDtoByLabelValue.md)
- [TriggerAutopilotDto](docs/TriggerAutopilotDto.md)
- [TriggerAutopilotResponseDto](docs/TriggerAutopilotResponseDto.md)
- [UpdateAgentConfigDto](docs/UpdateAgentConfigDto.md)
- [UpdateAgentMemoryDto](docs/UpdateAgentMemoryDto.md)
- [UpdateAiProviderConfigDto](docs/UpdateAiProviderConfigDto.md)
- [UpdateCaseDto](docs/UpdateCaseDto.md)
- [UpdateCaseFindingNoteDto](docs/UpdateCaseFindingNoteDto.md)
- [UpdateChatBotDto](docs/UpdateChatBotDto.md)
- [UpdateCorrelationConfigDto](docs/UpdateCorrelationConfigDto.md)
- [UpdateCustomDetectorDto](docs/UpdateCustomDetectorDto.md)
- [UpdateEdgeDto](docs/UpdateEdgeDto.md)
- [UpdateEvidenceNoteDto](docs/UpdateEvidenceNoteDto.md)
- [UpdateFindingDto](docs/UpdateFindingDto.md)
- [UpdateInquiryDto](docs/UpdateInquiryDto.md)
- [UpdateInstanceSettingsDto](docs/UpdateInstanceSettingsDto.md)
- [UpdateMcpServerDto](docs/UpdateMcpServerDto.md)
- [UpdateMcpTokenDto](docs/UpdateMcpTokenDto.md)
- [UpdateNotificationImportanceDto](docs/UpdateNotificationImportanceDto.md)
- [UpdateRunnerAssetStatusDto](docs/UpdateRunnerAssetStatusDto.md)
- [UpdateSourceDto](docs/UpdateSourceDto.md)
- [UpdateSystemBriefDto](docs/UpdateSystemBriefDto.md)
- [UpdateThreadDto](docs/UpdateThreadDto.md)
- [ValueOccurrenceAssetDto](docs/ValueOccurrenceAssetDto.md)
- [ValueOccurrencesResponseDto](docs/ValueOccurrencesResponseDto.md)

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
