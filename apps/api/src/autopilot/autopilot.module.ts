import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
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
import { ToolRegistry } from './tools/tool-registry.service';
import { ToolDispatcherService } from './tools/tool-dispatcher.service';
import { HarnessService } from './harness/harness.service';
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
  imports: [MatchingModule, CorrelationModule, CliRunnerModule],
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
    ToolRegistry,
    ToolDispatcherService,
    SystemBriefService,
    McpClientService,
    McpServersService,
    HarnessService,
    AutopilotWorker,
    AutopilotService,
  ],
  exports: [AutopilotService],
})
export class AutopilotModule {}
