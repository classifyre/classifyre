import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MatchingModule } from '../matching/matching.module';
import { GraphService } from '../graph.service';
import { CaseActivityService } from '../case-activity.service';
import { CasesService } from '../cases.service';
import { AgentMemoryService } from '../autopilot/memory/agent-memory.service';
import { AgentAuditService } from '../autopilot/audit/agent-audit.service';
import { AgentLoggerService } from '../autopilot/audit/agent-logger.service';
import { CorrelationService } from './correlation.service';
import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';
import { CorrelationWorker } from './correlation.worker';
import { CorrelationController } from './correlation.controller';

/**
 * Deterministic asset correlation / duplicate detection. Derives evidence
 * fingerprints from findings, maintains a reverse index + identity clusters,
 * runs the DUPLICATES FINDER AGENT after each scan, and powers the fingerprints
 * graph (tuning, filtering, case actions). CasesService is reused so case
 * mutations keep their normal CaseActivity audit trail. PgBossModule is global.
 */
@Module({
  imports: [MatchingModule],
  controllers: [CorrelationController],
  providers: [
    PrismaService,
    GraphService,
    CaseActivityService,
    AgentMemoryService,
    CasesService,
    AgentAuditService,
    AgentLoggerService,
    CorrelationService,
    DuplicatesFinderAgentService,
    CorrelationWorker,
  ],
  exports: [CorrelationService],
})
export class CorrelationModule {}
