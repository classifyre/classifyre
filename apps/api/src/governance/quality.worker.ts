import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { previousCronOccurrence } from '../scheduler/cron-window';
import { QualityService } from './quality.service';

export const QUALITY_TICK_QUEUE = 'governance-quality-tick';
const TICK_CRON = '*/5 * * * *';
/** How far back a due time still counts: a tick missed by a restart catches up. */
const LOOKBACK_MINUTES = 70;

/**
 * Runs quality rules on their own schedule (GOV §5.4, G-4), for one
 * namespace: every five minutes, the rules whose cron came due since they
 * last ran are evaluated, grouped by asset. Rules without a schedule run
 * after each scan of their asset instead.
 */
@Injectable()
export class QualityWorker {
  private readonly logger = new Logger(QualityWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly prisma: PrismaService,
    private readonly quality: QualityService,
  ) {}

  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(QUALITY_TICK_QUEUE);
    await this.pgBoss.work(QUALITY_TICK_QUEUE, { localConcurrency: 1 }, () =>
      this.tick(),
    );
    await boss.schedule(QUALITY_TICK_QUEUE, TICK_CRON, {}, { tz: 'UTC' });
  }

  /** Evaluate the rules that came due; returns how many. */
  async tick(now: Date = new Date()): Promise<number> {
    await this.quality
      .closeStale(now)
      .catch((error: unknown) =>
        this.logger.warn(`Closing stale quality runs: ${String(error)}`),
      );
    const rules = await this.prisma.qualityRule.findMany({
      where: { enabled: true, schedule: { not: null } },
      select: {
        id: true,
        assetId: true,
        schedule: true,
        lastScheduledAt: true,
      },
    });
    const due = dueRules(rules, now);
    if (!due.length) return 0;
    for (const rule of due) {
      await this.prisma.qualityRule.update({
        where: { id: rule.id },
        data: { lastScheduledAt: rule.at },
      });
    }
    const assetIds = [...new Set(due.map((rule) => rule.assetId))];
    await this.quality
      .evaluate(assetIds, 'schedule', { ruleIds: due.map((r) => r.id) })
      .catch((error: unknown) =>
        this.logger.warn(`Scheduled quality rules: ${String(error)}`),
      );
    return due.length;
  }
}

/** The rules whose cron matched since they last ran, with that time. */
export function dueRules<
  T extends { schedule: string | null; lastScheduledAt: Date | null },
>(rules: readonly T[], now: Date): (T & { at: Date })[] {
  const out: (T & { at: Date })[] = [];
  for (const rule of rules) {
    if (!rule.schedule) continue;
    const at = previousCronOccurrence(
      rule.schedule,
      'UTC',
      now,
      LOOKBACK_MINUTES,
    );
    if (!at) continue;
    if (rule.lastScheduledAt && rule.lastScheduledAt >= at) continue;
    out.push({ ...rule, at });
  }
  return out;
}
