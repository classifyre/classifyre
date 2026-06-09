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
import { ExportModule } from './export/export.module';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';
import { InstanceSettingsService } from './instance-settings.service';
import { AiProviderConfigService } from './ai-provider-config.service';
import { AiClientService } from './ai';
import { McpOverviewService } from './mcp-overview.service';
import { McpTokenService } from './mcp-token.service';
import { McpServerFactoryService } from './mcp-server.factory';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { AssistantService } from './assistant.service';
import { CasesService } from './cases.service';
import { InquiriesService } from './inquiries.service';
import { HypothesesService } from './hypotheses.service';
import { GraphService } from './graph.service';

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
  HypothesesController,
  GraphController,
} from './controllers';

@Module({
  imports: [
    CliRunnerModule,
    WebSocketModule,
    SandboxModule,
    SchedulerModule,
    MatchingModule,
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
    HypothesesController,
    GraphController,
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
    AssistantService,
    CasesService,
    InquiriesService,
    HypothesesService,
    GraphService,
  ],
})
export class AppModule {}
