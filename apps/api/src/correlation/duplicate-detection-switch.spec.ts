import { RunnerStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { CorrelationWorker } from './correlation.worker';
import { CorrelationJobScheduler } from './correlation-job-scheduler.service';
import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';
import {
  CorrelationSwitchService,
  DuplicateDetectionOffException,
} from './correlation-switch.service';
import { CORRELATION_QUEUE, SCAN_HANDOFF_QUEUE } from './correlation.constants';
import { AUTOPILOT_QUEUE } from '../autopilot/autopilot.constants';
import { CliRunnerService } from '../cli-runner/cli-runner.service';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromFile() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  BatchV1Api: class {},
  CoreV1Api: class {},
}));

/**
 * Duplicate detection's switch has one trap: its queue also carries the scan's
 * hand-off to the autopilot. Holding the queue must not stop the agents from
 * hearing about scans, so off routes scans to a hand-off-only queue, and a
 * duplicate job that slipped through before the hold gets the hand-off alone.
 */
describe('duplicate detection switch', () => {
  const switchOf = (enabled: boolean) =>
    ({
      isEnabled: jest.fn().mockResolvedValue(enabled),
      assertEnabled: jest.fn(() =>
        enabled
          ? Promise.resolve()
          : Promise.reject(new DuplicateDetectionOffException()),
      ),
      state: jest.fn().mockResolvedValue({ enabled }),
    }) as unknown as CorrelationSwitchService;

  describe('CorrelationWorker', () => {
    const build = (enabled: boolean, queued: any[] = []) => {
      const sent: Array<{ queue: string; data: any; opts: any }> = [];
      const completed: string[] = [];
      let fetched = false;
      const boss = {
        send: (queue: string, data: any, opts: any) => {
          sent.push({ queue, data, opts });
          return Promise.resolve('job');
        },
        fetch: jest.fn(() => {
          if (fetched) return Promise.resolve([]);
          fetched = true;
          return Promise.resolve(queued);
        }),
        complete: jest.fn((_q: string, ids: string[]) => {
          completed.push(...ids);
          return Promise.resolve();
        }),
      };
      const prisma = {
        source: {
          update: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn().mockResolvedValue({
            name: 'src',
            consecutiveFailures: 0,
          }),
        },
        runner: {
          findUnique: jest.fn().mockResolvedValue({
            status: RunnerStatus.COMPLETED,
            assetsWithoutText: 0,
            assetsCreated: 1,
          }),
        },
        finding: { findFirst: jest.fn().mockResolvedValue(null) },
        instanceSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const finder = {
        runForScan: jest.fn().mockResolvedValue(undefined),
        runForConfigChange: jest.fn().mockResolvedValue(undefined),
      };
      const correlation = { recomputeForAssets: jest.fn() };
      const matching = {
        findNewInquiryMatchForRunner: jest.fn().mockResolvedValue(null),
      };
      const worker = new CorrelationWorker(
        { getBossAsync: () => Promise.resolve(boss) } as any,
        prisma as any,
        finder as any,
        matching as any,
        correlation as any,
        {} as any,
        undefined,
        switchOf(enabled),
      );
      return { worker, sent, completed, finder, correlation };
    };

    it('runs the duplicates finder while on', async () => {
      const h = build(true);

      await (h.worker as any).handle([
        { id: 'j1', data: { sourceId: 's1', runnerId: 'r1' } },
      ]);

      expect(h.finder.runForScan).toHaveBeenCalled();
    });

    it('while off: hands the scan to the autopilot and runs no duplicate work', async () => {
      const h = build(false);

      await (h.worker as any).handle([
        { id: 'j1', data: { sourceId: 's1', runnerId: 'r1' } },
        { id: 'j2', data: { recomputeAll: true } },
        { id: 'j3', data: { assetIds: ['a1'] } },
      ]);

      expect(h.finder.runForScan).not.toHaveBeenCalled();
      expect(h.finder.runForConfigChange).not.toHaveBeenCalled();
      expect(h.correlation.recomputeForAssets).not.toHaveBeenCalled();
      // The scan still enrolled its source in the next corpus cycle.
      expect(h.sent.some((s) => s.queue === AUTOPILOT_QUEUE)).toBe(true);
    });

    it('moves waiting scan jobs to the hand-off queue and drops recomputes', async () => {
      const h = build(false, [
        { id: 'j1', data: { sourceId: 's1', runnerId: 'r1' } },
        { id: 'j2', data: { recomputeAll: true } },
      ]);

      const out = await h.worker.drainToHandoff();

      expect(out).toEqual({ handedOff: 1, dropped: 1 });
      expect(h.sent).toEqual([
        expect.objectContaining({
          queue: SCAN_HANDOFF_QUEUE,
          data: { sourceId: 's1', runnerId: 'r1' },
          opts: expect.objectContaining({ singletonKey: 'handoff:s1' }),
        }),
      ]);
      expect(h.completed).toEqual(['j1', 'j2']);
    });

    it('the hand-off queue enrols the source without a duplicate check', async () => {
      const h = build(true);

      await (h.worker as any).handleHandoff([
        { id: 'j1', data: { sourceId: 's1', runnerId: 'r1' } },
      ]);

      expect(h.finder.runForScan).not.toHaveBeenCalled();
      expect(h.sent.some((s) => s.queue === AUTOPILOT_QUEUE)).toBe(true);
    });
  });

  describe('CorrelationJobScheduler', () => {
    it('queues nothing while off', async () => {
      const send = jest.fn();
      const scheduler = new CorrelationJobScheduler(
        { getBossAsync: () => Promise.resolve({ send }) } as any,
        switchOf(false),
      );

      await expect(scheduler.scheduleFull('test')).resolves.toBe(false);
      await expect(scheduler.scheduleAssets(['a'], 'test')).resolves.toBe(
        false,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('queues as before while on', async () => {
      const send = jest.fn().mockResolvedValue('job');
      const scheduler = new CorrelationJobScheduler(
        { getBossAsync: () => Promise.resolve({ send }) } as any,
        switchOf(true),
      );

      await expect(scheduler.scheduleFull('test')).resolves.toBe(true);
      expect(send).toHaveBeenCalledWith(
        CORRELATION_QUEUE,
        expect.objectContaining({ recomputeAll: true }),
        expect.anything(),
      );
    });
  });

  describe('DuplicatesFinderAgentService', () => {
    const build = (enabled: boolean, recompute: jest.Mock) => {
      const audit = {
        openRun: jest
          .fn()
          .mockResolvedValue({ id: 'run-1', status: 'RUNNING' }),
        complete: jest.fn(),
        skip: jest.fn(),
        fail: jest.fn(),
        recordDecision: jest.fn(),
      };
      const log = {
        business: jest.fn(),
        technical: jest.fn(),
        error: jest.fn(),
      };
      const service = new DuplicatesFinderAgentService(
        { recomputeAll: recompute, recomputeForRunner: recompute } as any,
        {} as any,
        audit as any,
        log as any,
        undefined,
        switchOf(enabled),
      );
      return { service, audit };
    };

    it('does nothing, and records nothing, while off', async () => {
      const recompute = jest.fn();
      const { service, audit } = build(false, recompute);

      await service.runForScan({
        sourceId: 's1',
        runnerId: 'r1',
        cycleKey: 'k',
        sourceName: 'src',
      });
      await service.runForConfigChange();

      expect(recompute).not.toHaveBeenCalled();
      expect(audit.openRun).not.toHaveBeenCalled();
    });

    it('ends a recompute stopped by the switch as SKIPPED, without a retry', async () => {
      const recompute = jest
        .fn()
        .mockRejectedValue(new DuplicateDetectionOffException());
      const { service, audit } = build(true, recompute);

      await expect(service.runForConfigChange()).resolves.toBeUndefined();

      expect(audit.skip).toHaveBeenCalledWith('run-1', expect.any(String));
      expect(audit.fail).not.toHaveBeenCalled();
    });
  });

  describe('CorrelationSwitchService', () => {
    const build = (row: Record<string, unknown> | null) => {
      const upserts: any[] = [];
      const prisma = {
        correlationConfig: {
          findUnique: jest.fn().mockResolvedValue(row),
          upsert: jest.fn((args: any) => {
            upserts.push(args);
            return Promise.resolve({});
          }),
        },
      };
      const service = new CorrelationSwitchService(
        prisma as any,
        { get: () => 'ns_test' } as any,
      );
      return { service, upserts, prisma };
    };

    it('reads a workspace with no config row as on', async () => {
      const { service } = build(null);
      await expect(service.isEnabled()).resolves.toBe(true);
    });

    it('answers 409 while off', async () => {
      const { service } = build({ enabled: false, disabledMode: 'kept' });
      await expect(service.assertEnabled()).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('writes the mode and when it changed', async () => {
      const { service, upserts } = build({ enabled: true });

      const state = await service.set(false, 'deleted');

      expect(state).toEqual(
        expect.objectContaining({ enabled: false, disabledMode: 'deleted' }),
      );
      expect(upserts[0].update).toEqual(
        expect.objectContaining({
          enabled: false,
          disabledMode: 'deleted',
          enabledChangedAt: expect.any(Date),
        }),
      );
      // The write is visible to this process at once, not after the cache.
      await expect(service.isEnabled()).resolves.toBe(false);
    });
  });

  describe('CliRunnerService scan completion', () => {
    const enqueue = async (enabled: boolean | 'unreadable') => {
      const send = jest.fn().mockResolvedValue('job');
      const prisma = {
        correlationConfig: {
          findUnique:
            enabled === 'unreadable'
              ? jest.fn().mockRejectedValue(new Error('no table'))
              : jest.fn().mockResolvedValue({ enabled }),
        },
      };
      const service = new CliRunnerService(
        prisma as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        undefined,
        undefined,
        { getBossAsync: jest.fn().mockResolvedValue({ send }) } as any,
        undefined,
      );
      await (service as any).enqueueQuestionMatching('source-1', 'runner-1');
      return send.mock.calls.map(([queue]) => queue as string);
    };

    it('sends the duplicate check while on', async () => {
      const queues = await enqueue(true);
      expect(queues).toContain(CORRELATION_QUEUE);
      expect(queues).not.toContain(SCAN_HANDOFF_QUEUE);
    });

    it('sends only the hand-off while off', async () => {
      const queues = await enqueue(false);
      expect(queues).toContain(SCAN_HANDOFF_QUEUE);
      expect(queues).not.toContain(CORRELATION_QUEUE);
    });

    it('behaves as before the switch existed when it cannot be read', async () => {
      const queues = await enqueue('unreadable');
      expect(queues).toContain(CORRELATION_QUEUE);
    });
  });
});
