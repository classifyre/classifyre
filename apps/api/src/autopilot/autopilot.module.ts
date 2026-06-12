import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import { AiProviderConfigService } from '../ai-provider-config.service';
import { AiClientService } from '../ai';
import { MatchingModule } from '../matching/matching.module';
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
import { InquiryAgentService } from './inquiry-agent.service';
import { CaseAgentService } from './case-agent.service';
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
  imports: [MatchingModule],
  controllers: [AutopilotController],
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
    InquiryAgentService,
    CaseAgentService,
    AutopilotWorker,
    AutopilotService,
  ],
  exports: [AutopilotService],
})
export class AutopilotModule {}
