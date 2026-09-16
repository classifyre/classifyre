import { Injectable, Optional, Logger } from '@nestjs/common';
import {
  AgentDecisionAction,
  AutoSchedulePhase,
  Prisma,
  Severity,
  SourceScheduleMode,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { NotificationsService } from '../../../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../../../types/notification.types';
import {
  AutoScheduleService,
  humanize,
} from '../../../scheduler/auto-schedule.service';
import {
  MIN_AGENT_INTERVAL_SECONDS,
  STEADY_MAX_SECONDS,
} from '../../../scheduler/auto-schedule.constants';
import { DecisionApplierService } from '../../decision-applier.service';
import { CohortWeightsService } from '../../../cohort/cohort-weights.service';
import { AI_ACTOR, MAX_COVERAGE_SOURCE_ROWS } from '../../autopilot.constants';
import type { Tool, ToolContext, ToolGate } from '../tool.types';

/**
 * Scheduling tools for the config-tuning agent.
 *
 * The agent already owns what a source detects; without these it could not see
 * or influence how often that detection actually runs — so a retune landing on
 * a source checked once a day silently waited a day to be tested, and a source
 * scanning back-to-back for no benefit had no one to slow it down.
 *
 * Deliberately narrow. The agent may read any source's cadence, put a converged
 * source on a longer interval, and restart a sweep. It cannot turn scheduling
 * off, cannot set an interval below {@link MIN_AGENT_INTERVAL_SECONDS}, and
 * cannot touch a cron schedule an operator wrote — a wall-clock schedule is an
 * operator's statement about when this source may be touched (a backup window,
 * a rate-limited API, a business-hours-only system), and nothing the agent
 * observes tells it whether that reason still holds.
 */
@Injectable()
export class ScheduleToolset {
  private readonly logger = new Logger(ScheduleToolset.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoSchedule: AutoScheduleService,
    private readonly applier: DecisionApplierService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly cohortWeights?: CohortWeightsService,
  ) {}

  private sourceGate = async (
    input: Record<string, unknown>,
    tc: ToolContext,
  ): Promise<ToolGate> => {
    const sourceId = typeof input.sourceId === 'string' ? input.sourceId : '';
    const mode = await this.applier.sourceGate(
      sourceId,
      tc.ctx.settings.autopilotConfigEnabled,
    );
    return { mode, entityType: 'source', entityId: sourceId };
  };

  private async notifyScheduleChanged(
    sourceId: string,
    sourceName: string,
    summary: string,
  ): Promise<void> {
    try {
      await this.notifications.create({
        type: NotificationType.SOURCE,
        event: NotificationEvent.SOURCE_SCHEDULE_CHANGED,
        severity: Severity.INFO,
        title: 'Autopilot changed a scan cadence',
        message: `${sourceName}: ${summary}`,
        sourceId,
        triggeredBy: AI_ACTOR,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to raise schedule-change notification for source ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Band split and last yield per cohort, only for sources that walk one. */
  private async cohortSummaries(
    autoSourceIds: string[],
  ): Promise<Map<string, unknown[]>> {
    const summaries = new Map<string, unknown[]>();
    if (!this.cohortWeights || autoSourceIds.length === 0) return summaries;
    const walking = await this.prisma.runner.findMany({
      where: {
        sourceId: { in: autoSourceIds },
        cohortYield: { not: Prisma.DbNull },
      },
      distinct: ['sourceId'],
      select: { sourceId: true },
    });
    for (const { sourceId } of walking) {
      const previews = await this.cohortWeights
        .preview(sourceId)
        .catch(() => []);
      summaries.set(
        sourceId,
        previews.map((preview) => ({
          name: preview.name,
          mode: preview.mode,
          nextWeights: preview.weights,
          reason: preview.reason,
          lastRun: preview.runs[0]?.bands ?? null,
        })),
      );
    }
    return summaries;
  }

  list(): Tool[] {
    return [
      {
        name: 'schedule.list',
        description:
          'How often each source is scanned, and why. `mode` is OFF (never runs automatically), ' +
          'CRON (a fixed operator-set schedule) or AUTO (adaptive). For AUTO sources, `phase` is ' +
          'CATCH_UP (the last scan ingested new data, so the sweep is still running), STEADY (the ' +
          'sweep converged — only new data is picked up now), BACKOFF (scans are failing) or ' +
          'PAUSED (stopped after repeated failures; needs an operator). A source in CATCH_UP has ' +
          'NOT finished ingesting: treat its findings as a partial view of that source and do not ' +
          'conclude anything from their absence. For an AUTO source that walks a cohort ' +
          '(ctx.cohort), `cohorts` shows the band split its next run will use, why, and what each ' +
          'band yielded last run (visited keys, hits = keys with a new HIGH/CRITICAL finding). ' +
          'Change the split only through config.tune_source (optional.cohort_weights).',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: async () => {
          const rows = await this.prisma.source.findMany({
            select: {
              id: true,
              name: true,
              scheduleMode: true,
              scheduleCron: true,
              autoPhase: true,
              autoIntervalSeconds: true,
              autoReason: true,
              scheduleNextAt: true,
              lastRunAt: true,
              consecutiveFailures: true,
            },
            orderBy: { updatedAt: 'desc' },
            take: MAX_COVERAGE_SOURCE_ROWS,
          });
          const cohorts = await this.cohortSummaries(
            rows
              .filter((r) => r.scheduleMode === SourceScheduleMode.AUTO)
              .map((r) => r.id),
          );
          return rows.map((r) => ({
            id: r.id,
            name: r.name,
            mode: String(r.scheduleMode),
            cron:
              r.scheduleMode === SourceScheduleMode.CRON
                ? r.scheduleCron
                : null,
            phase:
              r.scheduleMode === SourceScheduleMode.AUTO
                ? String(r.autoPhase)
                : null,
            intervalSeconds:
              r.scheduleMode === SourceScheduleMode.AUTO
                ? r.autoIntervalSeconds
                : null,
            sweepConverged:
              r.scheduleMode === SourceScheduleMode.AUTO
                ? r.autoPhase === AutoSchedulePhase.STEADY
                : null,
            nextRunAt: r.scheduleNextAt,
            lastRunAt: r.lastRunAt,
            consecutiveFailures: r.consecutiveFailures,
            reason: r.autoReason,
            ...(cohorts.has(r.id) ? { cohorts: cohorts.get(r.id) } : {}),
          }));
        },
      },
      {
        name: 'schedule.tune',
        description:
          'Change how often ONE source on adaptive (AUTO) scheduling is scanned. Two actions: ' +
          '`slow_down` pins a converged source to an explicit intervalSeconds (minimum ' +
          `${MIN_AGENT_INTERVAL_SECONDS}, maximum ${STEADY_MAX_SECONDS}), for a source whose ` +
          'repeated scans are producing nothing of value; `resweep` restarts the sweep from the ' +
          'top and scans immediately, for when a detection change means the existing assets must ' +
          'be looked at again. You do NOT need resweep after config.tune_source or a detector ' +
          'change — those restart the sweep for you. Refused on sources an operator put on a cron ' +
          'schedule or turned scheduling off for: those are operator decisions about when this ' +
          'system may be touched, and you cannot see the reason behind them.',
        inputSchema: {
          type: 'object',
          properties: {
            sourceId: { type: 'string' },
            action: { type: 'string', enum: ['slow_down', 'resweep'] },
            intervalSeconds: {
              type: 'number',
              description:
                'Required for slow_down. Clamped to the allowed range; the clamped value is returned.',
            },
            rationale: {
              type: 'string',
              description:
                'Why this cadence is right, citing what you observed (e.g. "6 scans in a row ingested nothing and produced no new findings").',
            },
          },
          required: ['sourceId', 'action', 'rationale'],
          additionalProperties: false,
        },
        sideEffect: 'mutate',
        domain: 'source',
        decisionAction: AgentDecisionAction.TUNE_SOURCE,
        resolveGate: this.sourceGate,
        handler: async (input) => {
          const sourceId = String(input.sourceId);
          const action = String(input.action);
          const rationale =
            typeof input.rationale === 'string' ? input.rationale.trim() : '';

          const source = await this.prisma.source.findUnique({
            where: { id: sourceId },
            select: { name: true, scheduleMode: true, autoPhase: true },
          });
          if (!source) throw new Error('Unknown sourceId');
          if (source.scheduleMode !== SourceScheduleMode.AUTO) {
            return {
              skipped:
                `"${source.name}" is on ${source.scheduleMode} scheduling, which an operator ` +
                'controls. Ask for automatic scheduling instead of changing it.',
            };
          }
          if (source.autoPhase === AutoSchedulePhase.PAUSED) {
            return {
              skipped:
                'Automatic scanning is paused for this source after repeated failures. ' +
                'An operator has to fix and resume it.',
            };
          }

          if (action === 'resweep') {
            await this.autoSchedule.resetToCatchUp(
              sourceId,
              `Autopilot restarted the sweep: ${rationale}`,
            );
            await this.notifyScheduleChanged(
              sourceId,
              source.name,
              'sweep restarted — scanning from the top',
            );
            return { ok: true, action, phase: 'CATCH_UP' };
          }

          const requested = Number(input.intervalSeconds);
          if (!Number.isFinite(requested)) {
            throw new Error('intervalSeconds is required for slow_down.');
          }
          const applied = await this.autoSchedule.setSteadyInterval(
            sourceId,
            requested,
            `Autopilot set a ${humanize(requested)} cadence: ${rationale}`,
          );
          await this.notifyScheduleChanged(
            sourceId,
            source.name,
            `scanning every ${humanize(applied)}`,
          );
          return {
            ok: true,
            action,
            intervalSeconds: applied,
            clamped: applied !== Math.round(requested),
          };
        },
      },
    ];
  }
}
