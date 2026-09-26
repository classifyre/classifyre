import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MatchingModule } from '../matching/matching.module';
import { GraphService } from '../graph.service';
import { CaseActivityService } from '../case-activity.service';
import { InquiryActivityService } from '../inquiry-activity.service';
import { CasesService } from '../cases.service';
import { CaseBoardReadService } from '../case-board/case-board-read.service';
import { InquiriesService } from '../inquiries.service';
import { AgentMemoryService } from '../autopilot/memory/agent-memory.service';
import { AgentAuditService } from '../autopilot/audit/agent-audit.service';
import { AgentLoggerService } from '../autopilot/audit/agent-logger.service';
import { CorrelationService } from './correlation.service';
import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';
import { CorrelationWorker } from './correlation.worker';
import { CorrelationController } from './correlation.controller';
import { CorrelationJobScheduler } from './correlation-job-scheduler.service';
import { CorrelationLockService } from './correlation-lock.service';
import { CorrelationSwitchService } from './correlation-switch.service';
import { CorrelationReviewIndexService } from './review/correlation-review-index.service';
import { CorrelationReviewService } from './review/correlation-review.service';
import { CorrelationReviewController } from './review/correlation-review.controller';
import { SourceGraphModule } from '../stats/source-graph.module';

/**
 * Deterministic asset correlation / duplicate detection. Derives evidence
 * fingerprints from findings, maintains a reverse index + identity clusters,
 * runs the DUPLICATES FINDER AGENT after each scan, and powers the fingerprints
 * graph (tuning, filtering, case actions). CasesService is reused so case
 * mutations keep their normal CaseActivity audit trail. PgBossModule is global.
 */
@Module({
  imports: [MatchingModule, SourceGraphModule],
  controllers: [CorrelationController, CorrelationReviewController],
  providers: [
    PrismaService,
    GraphService,
    CaseActivityService,
    InquiryActivityService,
    AgentMemoryService,
    // A case closed by an agent is snapshotted like one closed by a person.
    CaseBoardReadService,
    CasesService,
    InquiriesService,
    AgentAuditService,
    AgentLoggerService,
    CorrelationLockService,
    CorrelationSwitchService,
    CorrelationJobScheduler,
    CorrelationReviewIndexService,
    CorrelationService,
    CorrelationReviewService,
    DuplicatesFinderAgentService,
    CorrelationWorker,
  ],
  exports: [
    CorrelationService,
    // The feature switch and the lock are what storage maintenance needs to
    // turn duplicate detection off and wipe its results without racing a
    // recompute.
    CorrelationSwitchService,
    CorrelationLockService,
    CorrelationReviewIndexService,
    CorrelationReviewService,
    CorrelationJobScheduler,
    DuplicatesFinderAgentService,
    CorrelationWorker,
  ],
})
export class CorrelationModule {}
