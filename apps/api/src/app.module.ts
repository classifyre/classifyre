import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CliBackpressureGuard } from './guards/cli-backpressure.guard';
import { PrismaService } from './prisma.service';
import { DemoModeService } from './demo-mode.service';
import { DemoModeGuard } from './demo-mode.guard';
import { SourceService } from './source.service';
import { AssetService } from './asset.service';
import { FindingsService } from './findings.service';
import { NotificationsService } from './notifications.service';
import { ValidationService } from './validation.service';
import { CustomDetectorsService } from './custom-detectors.service';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';
import { CustomDetectorTestsService } from './custom-detector-tests.service';
import { CliRunnerModule } from './cli-runner/cli-runner.module';
import { WebSocketModule } from './websocket/websocket.module';
import { SandboxModule } from './sandbox/sandbox.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { MatchingModule } from './matching/matching.module';
import { AutopilotModule } from './autopilot/autopilot.module';
import { CorrelationModule } from './correlation/correlation.module';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';
import { ExportModule } from './export/export.module';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { InstanceSettingsService } from './instance-settings.service';
import { AiProviderConfigService } from './ai-provider-config.service';
import { AiClientService } from './ai';
import { McpOverviewService } from './mcp-overview.service';
import { McpTokenService } from './mcp-token.service';
import { McpServerFactoryService } from './mcp-server.factory';
import { McpToolsCatalogService } from './mcp-tools-catalog.service';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { AssistantService } from './assistant.service';
import { AssistantMcpService } from './assistant/assistant-mcp.service';
import { CasesService } from './cases.service';
import { InquiriesService } from './inquiries.service';
import { CaseThreadsService } from './case-threads.service';
import { CaseActivityService } from './case-activity.service';
import { GraphService } from './graph.service';
import { BuiltinMcpToolsService } from './chat-gateway/builtin-mcp-tools.service';
import { ChatAgentService } from './chat-gateway/chat-agent.service';
import { ChatBotsService } from './chat-gateway/chat-bots.service';
import { ChatGatewayService } from './chat-gateway/chat-gateway.service';
import { ChatHarnessToolset } from './chat-gateway/chat-harness.toolset';
import { ChatSessionService } from './chat-gateway/chat-session.service';
import { EmbeddingController } from './embedding/embedding.controller';
import { EmbeddingCapabilityService } from './embedding/embedding-capability.service';
import { EmbeddingAnalysisService } from './embedding/embedding-analysis.service';
import { EmbeddingService } from './embedding/embedding.service';
import { QueryEmbeddingService } from './embedding/query-embedding.service';

// Import organized controllers
import {
  HealthController,
  SourcesController,
  SearchSourcesController,
  AssetsController,
  SearchAssetsController,
  SourceAssetsController,
  CustomDetectorsController,
  FindingsController,
  NotificationsController,
  InstanceSettingsController,
  McpSettingsController,
  AiProviderConfigController,
  AiController,
  AssistantController,
  CustomDetectorExtractionsController,
  CustomDetectorTestsController,
  CasesController,
  InquiriesController,
  CaseThreadsController,
  CaseTimelineController,
  GraphController,
  ChatBotsController,
} from './controllers';

@Module({
  imports: [
    CliRunnerModule,
    WebSocketModule,
    SandboxModule,
    SchedulerModule,
    MatchingModule,
    AutopilotModule,
    CorrelationModule,
    ExportModule,
  ],
  controllers: [
    HealthController,
    SourcesController,
    SearchSourcesController,
    AssetsController,
    SearchAssetsController,
    SourceAssetsController,
    CustomDetectorsController,
    CustomDetectorExtractionsController,
    CustomDetectorTestsController,
    FindingsController,
    NotificationsController,
    InstanceSettingsController,
    McpSettingsController,
    AiProviderConfigController,
    AiController,
    AssistantController,
    CasesController,
    InquiriesController,
    CaseTimelineController,
    CaseThreadsController,
    GraphController,
    ChatBotsController,
    EmbeddingController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: DemoModeGuard },
    CliBackpressureGuard,
    DemoModeService,
    PrismaService,
    SourceService,
    AssetService,
    FindingsService,
    NotificationsService,
    ValidationService,
    CustomDetectorsService,
    CustomDetectorExtractionsService,
    CustomDetectorTestsService,
    MaskedConfigCryptoService,
    InstanceSettingsService,
    AiProviderConfigService,
    AiClientService,
    McpOverviewService,
    McpTokenService,
    McpToolExecutorService,
    McpServerFactoryService,
    McpToolsCatalogService,
    AssistantService,
    AssistantMcpService,
    CaseActivityService,
    CasesService,
    InquiriesService,
    CaseThreadsService,
    GraphService,
    AgentMemoryService,
    // Chat gateway (Telegram/Slack bots → chat agent over the harness tools).
    // Registry/dispatcher/audit instances come from AutopilotModule's exports.
    BuiltinMcpToolsService,
    ChatHarnessToolset,
    ChatSessionService,
    ChatAgentService,
    ChatGatewayService,
    ChatBotsService,
    EmbeddingCapabilityService,
    EmbeddingAnalysisService,
    EmbeddingService,
    QueryEmbeddingService,
  ],
})
export class AppModule {}
