import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { AiProviderConfigService } from '../ai-provider-config.service';
import { AiClientService } from '../ai';
import { MatchingModule } from '../matching/matching.module';
import { CorrelationModule } from '../correlation/correlation.module';
import { InquiriesService } from '../inquiries.service';
import { CasesService } from '../cases.service';
import { CaseThreadsService } from '../case-threads.service';
import { CaseActivityService } from '../case-activity.service';
import { GraphService } from '../graph.service';
import { AgentMemoryService } from './memory/agent-memory.service';
import { AgentSearchService } from './search/agent-search.service';
import { AgentSemanticService } from './search/agent-semantic.service';
import { AgentAuditService } from './audit/agent-audit.service';
import { AgentLoggerService } from './audit/agent-logger.service';
import { DecisionApplierService } from './decision-applier.service';
import { ValidationService } from '../validation.service';
import { CustomDetectorsService } from '../custom-detectors.service';
import { CustomDetectorTestsService } from '../custom-detector-tests.service';
import { CliRunnerModule } from '../cli-runner/cli-runner.module';
import { ObserveToolset } from './tools/observe/observe.toolset';
import { InvestigationToolset } from './tools/investigation/investigation.toolset';
import { KnowledgeToolset } from './tools/knowledge/knowledge.toolset';
import { ConfigToolset } from './tools/config/config.toolset';
import { DetectorToolset } from './tools/detector/detector.toolset';
import { FingerprintsToolset } from './tools/fingerprints/fingerprints.toolset';
import { AlertToolset } from './tools/alert/alert.toolset';
import { SemanticToolset } from './tools/semantic/semantic.toolset';
import { GlossaryToolset } from './tools/glossary/glossary.toolset';
import { GlossaryService } from '../glossary/glossary.service';
import { CaseLeadsToolset } from './tools/leads/case-leads.toolset';
import { CaseLeadsService } from '../case-leads.service';
import { CaseEventsService } from '../case-events.service';
import { NotificationsService } from '../notifications.service';
import { ToolRegistry } from './tools/tool-registry.service';
import { ToolDispatcherService } from './tools/tool-dispatcher.service';
import { HarnessService } from './harness/harness.service';
import { AgentConfigService } from './harness/agent-config.service';
import { SystemBriefService } from './harness/system-brief.service';
import { McpClientService } from './mcp-client/mcp-client.service';
import { McpServersService } from './mcp-client/mcp-servers.service';
import { McpServersController } from './mcp-client/mcp-servers.controller';
import { AutopilotWorker } from './autopilot.worker';
import { AutopilotService } from './autopilot.service';
import { AutopilotController } from './autopilot.controller';

/**
 * Investigation autopilot: autonomous background agents that manage inquiries
 * and investigation cases after each source scan. Deliberately separate from
 * the chat assistant — no conversations, only structured decisions with a
 * full audit trail (AgentRun / AgentDecision) and DB-backed memory.
 */
@Module({
  imports: [
    MatchingModule,
    CorrelationModule,
    CliRunnerModule,
    EmbeddingModule,
  ],
  controllers: [AutopilotController, McpServersController],
  providers: [
    PrismaService,
    MaskedConfigCryptoService,
    AiProviderConfigService,
    AiClientService,
    CaseActivityService,
    GraphService,
    CaseThreadsService,
    InquiriesService,
    CasesService,
    AgentMemoryService,
    AgentSearchService,
    AgentSemanticService,
    AgentAuditService,
    AgentLoggerService,
    DecisionApplierService,
    ValidationService,
    CustomDetectorsService,
    CustomDetectorTestsService,
    ObserveToolset,
    InvestigationToolset,
    KnowledgeToolset,
    ConfigToolset,
    DetectorToolset,
    FingerprintsToolset,
    AlertToolset,
    SemanticToolset,
    GlossaryService,
    GlossaryToolset,
    CaseLeadsService,
    CaseEventsService,
    CaseLeadsToolset,
    NotificationsService,
    ToolRegistry,
    ToolDispatcherService,
    SystemBriefService,
    McpClientService,
    McpServersService,
    AgentConfigService,
    HarnessService,
    AutopilotWorker,
    AutopilotService,
  ],
  exports: [
    AutopilotService,
    AutopilotWorker,
    // Shared harness infrastructure consumed by the chat gateway (AppModule):
    // the same registry/dispatcher instances, so tools the gateway bridges are
    // dispatched with identical gating and audit behavior.
    ToolRegistry,
    ToolDispatcherService,
    AgentAuditService,
    AgentLoggerService,
    McpClientService,
  ],
})
export class AutopilotModule {}
