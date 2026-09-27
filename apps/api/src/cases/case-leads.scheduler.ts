import { Injectable, Logger, Optional } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
// A value import: an @Optional() injection resolves from emitted metadata.
import { DemoModeService } from '../demo-mode.service';
import {
  CASE_LEADS_COALESCE_SECONDS,
  CASE_LEADS_DELAY_SECONDS,
  CASE_LEADS_QUEUE,
  CASE_LEADS_READ_THROTTLE_SECONDS,
  type CaseLeadsJobPayload,
} from './case-leads.constants';

/**
 * A change asked again within this long is already covered: the refresh it
 * queued starts CASE_LEADS_DELAY_SECONDS after the first ask, so it will see
 * this change too. Kept below that delay, with room for a transaction to
 * commit. Saves a queue write per row when a board batch adds 50 items.
 */
const ASKED_RECENTLY_MS = 10_000;
/** Board reads re-ask every minute; the queue throttles them to ten anyway. */
const READ_ASKED_RECENTLY_MS = 60_000;

/**
 * The only place that asks for a case's leads to be refreshed.
 *
 * Leads used to appear only when someone pressed "Generate leads". Now the
 * case keeps them current by itself: whenever its evidence or its watches
 * change (CaseActivityService and the matching worker call {@link request}),
 * and when someone opens the board ({@link requestOnRead}). The refresh itself
 * runs in the worker ({@link CaseLeadsWorker}).
 *
 * Every failure is swallowed: a missed refresh leaves the leads a little
 * stale, never wrong, and must not fail the change that asked for it.
 */
@Injectable()
export class CaseLeadsScheduler {
  private readonly logger = new Logger(CaseLeadsScheduler.name);
  /** When each case last asked, per kind of ask. Only saves queue writes. */
  private readonly asked = new Map<string, number>();

  constructor(
    private readonly pgBoss: PgBossService,
    @Optional() private readonly demo?: DemoModeService,
  ) {}

  /** The case's evidence or watches changed: refresh its leads shortly. */
  async request(caseId: string, reason: string): Promise<void> {
    if (this.askedRecently(`change:${caseId}`, ASKED_RECENTLY_MS)) return;
    await this.send(
      { caseId, reason },
      {
        singletonKey: `case-leads:${caseId}`,
        singletonSeconds: CASE_LEADS_COALESCE_SECONDS,
        singletonNextSlot: true,
        startAfter: CASE_LEADS_DELAY_SECONDS,
      },
    );
  }

  /**
   * Someone opened the case: refresh unless one ran in the last few minutes.
   * Throttled, not debounced — a board that re-reads every minute must not
   * keep a refresh permanently queued. A demo instance is left as curated.
   */
  async requestOnRead(caseId: string): Promise<void> {
    if (this.demo?.isDemoMode) return;
    if (this.askedRecently(`read:${caseId}`, READ_ASKED_RECENTLY_MS)) return;
    await this.send(
      { caseId, reason: 'board opened' },
      {
        singletonKey: `case-leads-read:${caseId}`,
        singletonSeconds: CASE_LEADS_READ_THROTTLE_SECONDS,
      },
    );
  }

  private askedRecently(key: string, windowMs: number): boolean {
    const now = Date.now();
    const last = this.asked.get(key);
    if (last !== undefined && now - last < windowMs) return true;
    this.asked.set(key, now);
    if (this.asked.size > 5_000) {
      for (const [k, at] of this.asked) {
        if (now - at > READ_ASKED_RECENTLY_MS) this.asked.delete(k);
      }
    }
    return false;
  }

  private async send(
    data: CaseLeadsJobPayload,
    options: Record<string, unknown>,
  ): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(CASE_LEADS_QUEUE, data, {
        ...options,
        expireInSeconds: 600,
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
      });
    } catch (error) {
      this.logger.debug(
        `Could not queue a lead refresh for case ${data.caseId} (${data.reason ?? 'unspecified'}): ${String(error)}`,
      );
    }
  }
}
