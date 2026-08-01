import { ScheduleToolset } from './schedule.toolset';
import {
  MIN_AGENT_INTERVAL_SECONDS,
  STEADY_MIN_SECONDS,
} from '../../../scheduler/auto-schedule.constants';
import type { PrismaService } from '../../../prisma.service';
import type { AutoScheduleService } from '../../../scheduler/auto-schedule.service';
import type { NotificationsService } from '../../../notifications.service';
import type { DecisionApplierService } from '../../decision-applier.service';
import type { Tool, ToolContext } from '../tool.types';

describe('ScheduleToolset', () => {
  const prisma = { source: { findMany: jest.fn(), findUnique: jest.fn() } };
  const autoSchedule = {
    resetToCatchUp: jest.fn(),
    setSteadyInterval: jest.fn(),
  };
  const applier = { sourceGate: jest.fn() };
  const notifications = { create: jest.fn() };

  const toolset = new ScheduleToolset(
    prisma as unknown as PrismaService,
    autoSchedule as unknown as AutoScheduleService,
    applier as unknown as DecisionApplierService,
    notifications as unknown as NotificationsService,
  );
  const list = toolset.list().find((t) => t.name === 'schedule.list') as Tool;
  const tune = toolset.list().find((t) => t.name === 'schedule.tune') as Tool;
  const tc = { ctx: { run: { id: 'r1' } } } as unknown as ToolContext;

  beforeEach(() => jest.clearAllMocks());

  it('reports sweep state only for sources it actually applies to', async () => {
    prisma.source.findMany.mockResolvedValue([
      {
        id: 'a',
        name: 'Auto',
        scheduleMode: 'AUTO',
        scheduleCron: null,
        autoPhase: 'CATCH_UP',
        autoIntervalSeconds: STEADY_MIN_SECONDS,
        autoReason: 'sweeping',
        scheduleNextAt: new Date(),
        lastRunAt: new Date(),
        consecutiveFailures: 0,
      },
      {
        id: 'c',
        name: 'Cron',
        scheduleMode: 'CRON',
        scheduleCron: '0 2 * * *',
        autoPhase: 'CATCH_UP',
        autoIntervalSeconds: null,
        autoReason: null,
        scheduleNextAt: null,
        lastRunAt: null,
        consecutiveFailures: 0,
      },
    ]);

    const rows = (await list.handler({}, tc)) as Array<Record<string, unknown>>;

    expect(rows[0]).toMatchObject({ phase: 'CATCH_UP', sweepConverged: false });
    // A cron source has no sweep, so it must not report a phase the agent
    // could reason from — "CATCH_UP" there would be a lie about ingest state.
    expect(rows[1]).toMatchObject({
      mode: 'CRON',
      cron: '0 2 * * *',
      phase: null,
      sweepConverged: null,
    });
  });

  it('refuses to touch a source an operator put on a cron schedule', async () => {
    prisma.source.findUnique.mockResolvedValue({
      name: 'Nightly export',
      scheduleMode: 'CRON',
      autoPhase: 'CATCH_UP',
    });

    const res = (await tune.handler(
      {
        sourceId: 's1',
        action: 'slow_down',
        intervalSeconds: 3600,
        rationale: 'quiet',
      },
      tc,
    )) as { skipped?: string };

    expect(res.skipped).toMatch(/operator controls/i);
    expect(autoSchedule.setSteadyInterval).not.toHaveBeenCalled();
  });

  it('refuses to reschedule a paused source', async () => {
    prisma.source.findUnique.mockResolvedValue({
      name: 'Broken',
      scheduleMode: 'AUTO',
      autoPhase: 'PAUSED',
    });

    const res = (await tune.handler(
      { sourceId: 's1', action: 'resweep', rationale: 'retuned' },
      tc,
    )) as { skipped?: string };

    expect(res.skipped).toMatch(/paused/i);
    expect(autoSchedule.resetToCatchUp).not.toHaveBeenCalled();
  });

  it('slows a converged source down and reports the clamped value', async () => {
    prisma.source.findUnique.mockResolvedValue({
      name: 'Quiet share',
      scheduleMode: 'AUTO',
      autoPhase: 'STEADY',
    });
    autoSchedule.setSteadyInterval.mockResolvedValue(
      MIN_AGENT_INTERVAL_SECONDS,
    );

    const res = (await tune.handler(
      {
        sourceId: 's1',
        action: 'slow_down',
        intervalSeconds: 5,
        rationale: 'nothing new in 6 scans',
      },
      tc,
    )) as { intervalSeconds?: number; clamped?: boolean };

    expect(res.intervalSeconds).toBe(MIN_AGENT_INTERVAL_SECONDS);
    expect(res.clamped).toBe(true);
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('requires an interval for slow_down', async () => {
    prisma.source.findUnique.mockResolvedValue({
      name: 'Quiet share',
      scheduleMode: 'AUTO',
      autoPhase: 'STEADY',
    });

    await expect(
      tune.handler({ sourceId: 's1', action: 'slow_down', rationale: 'x' }, tc),
    ).rejects.toThrow(/intervalSeconds/);
  });

  it('restarts a sweep on resweep', async () => {
    prisma.source.findUnique.mockResolvedValue({
      name: 'Retuned',
      scheduleMode: 'AUTO',
      autoPhase: 'STEADY',
    });

    const res = (await tune.handler(
      { sourceId: 's1', action: 'resweep', rationale: 'new detector wired in' },
      tc,
    )) as { phase?: string };

    expect(autoSchedule.resetToCatchUp).toHaveBeenCalledWith(
      's1',
      expect.stringContaining('new detector wired in'),
    );
    expect(res.phase).toBe('CATCH_UP');
  });

  it('is gated: the write declares a source gate so observe-only is enforced', () => {
    expect(tune.sideEffect).toBe('mutate');
    expect(typeof tune.resolveGate).toBe('function');
    expect(list.sideEffect).toBe('read');
  });
});
