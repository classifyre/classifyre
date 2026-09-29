import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CaseLeadsService } from '../case-leads.service';
import {
  CASE_LEADS_ACTOR,
  CASE_LEADS_QUEUE,
  type CaseLeadsJobPayload,
} from './case-leads.constants';

/**
 * Consumes {@link CASE_LEADS_QUEUE}: refreshes one case's leads.
 *
 * A batch may hold requests for several cases (and the same case twice when a
 * change and a board read both asked); each case is refreshed once. Two cases
 * at a time: a refresh is a dozen vector lookups and a few indexed reads, and
 * the singleton key already keeps one case from running twice.
 */
@Injectable()
export class CaseLeadsWorker {
  private readonly logger = new Logger(CaseLeadsWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly leads: CaseLeadsService,
  ) {}

  /** Registers on the CURRENT namespace's pg-boss (inside its CLS context). */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(CASE_LEADS_QUEUE);
    await this.pgBoss.work(CASE_LEADS_QUEUE, { localConcurrency: 2 }, (jobs) =>
      this.handle(jobs as Job[]),
    );
    this.logger.log(`Registered worker for queue ${CASE_LEADS_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    const reasons = new Map<string, string>();
    for (const job of jobs) {
      const payload = job.data as CaseLeadsJobPayload | null;
      if (payload?.caseId && !reasons.has(payload.caseId)) {
        reasons.set(payload.caseId, payload.reason ?? 'unspecified');
      }
    }
    for (const [caseId, reason] of reasons) {
      const result = await this.leads.generate(caseId, CASE_LEADS_ACTOR, {
        automatic: true,
      });
      if (result.proposed > 0 || result.settled > 0) {
        this.logger.log(
          `Leads of case ${caseId} refreshed (${reason}): ${result.proposed} new, ${result.settled} settled.`,
        );
      }
    }
  }
}
