import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { TriggerType } from '@prisma/client';
import { SchedulerService } from './scheduler.service';
import { PgBossService } from './pg-boss.service';
import { PrismaService } from '../prisma.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';


const mockBoss = {
  createQueue: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  unschedule: jest.fn().mockResolvedValue(undefined),
  getSchedules: jest.fn().mockResolvedValue([]),
};

const mockPgBossService = {
  getBoss: jest.fn().mockReturnValue(mockBoss),
};

const mockPrisma = {
  source: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  },
};

const mockCliRunnerService = {
  startRun: jest.fn().mockResolvedValue({}),
};

describe('SchedulerService', () => {
  let service: SchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PgBossService, useValue: mockPgBossService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CliRunnerService, useValue: mockCliRunnerService },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
  });

  describe('onApplicationBootstrap', () => {
    it('registers a per-source worker for each enabled source on startup', async () => {
      const sourceId = 'source-1';
      mockPrisma.source.findMany.mockResolvedValueOnce([
        { id: sourceId, scheduleCron: '0 * * * *', scheduleTimezone: 'UTC' },
      ]);

      await service.onApplicationBootstrap();

      expect(mockBoss.createQueue).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
      );
      expect(mockBoss.work).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
        { localConcurrency: 1 },
        expect.any(Function),
      );
    });

    it('does not register any worker when no sources are enabled', async () => {
      await service.onApplicationBootstrap();
      expect(mockBoss.work).not.toHaveBeenCalled();
    });

    it('registers missing DB schedules on startup sync', async () => {
      const sourceId = 'source-1';
      mockPrisma.source.findMany.mockResolvedValueOnce([
        { id: sourceId, scheduleCron: '0 * * * *', scheduleTimezone: 'UTC' },
      ]);
      mockBoss.getSchedules.mockResolvedValueOnce([]);

      await service.onApplicationBootstrap();

      expect(mockBoss.schedule).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
        '0 * * * *',
        { sourceId },
        { tz: 'UTC' },
      );
    });

    it('skips already-registered pg-boss schedules', async () => {
      const sourceId = 'source-2';
      mockPrisma.source.findMany.mockResolvedValueOnce([
        { id: sourceId, scheduleCron: '0 * * * *', scheduleTimezone: 'UTC' },
      ]);
      mockBoss.getSchedules.mockResolvedValueOnce([
        { name: `ingest-source-${sourceId}` },
      ]);

      await service.onApplicationBootstrap();

      expect(mockBoss.schedule).not.toHaveBeenCalled();
    });

    it('removes stale pg-boss schedules for disabled/deleted sources', async () => {
      const staleSourceId = 'stale-source';
      mockPrisma.source.findMany.mockResolvedValueOnce([]);
      mockBoss.getSchedules.mockResolvedValueOnce([
        { name: `ingest-source-${staleSourceId}` },
      ]);

      await service.onApplicationBootstrap();

      expect(mockBoss.unschedule).toHaveBeenCalledWith(
        `ingest-source-${staleSourceId}`,
      );
    });

    it('does not register a duplicate worker on second bootstrap call', async () => {
      const sourceId = 'source-dedup';
      mockPrisma.source.findMany.mockResolvedValue([
        { id: sourceId, scheduleCron: '0 * * * *', scheduleTimezone: 'UTC' },
      ]);

      await service.onApplicationBootstrap();
      await service.onApplicationBootstrap();

      // worker should only be registered once despite two bootstrap calls
      expect(mockBoss.work).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertSchedule', () => {
    it('creates queue, registers worker, calls boss.schedule, and prisma.source.update', async () => {
      const sourceId = 'source-3';
      const cron = '*/5 * * * *';
      const timezone = 'America/New_York';

      await service.upsertSchedule(sourceId, cron, timezone);

      expect(mockBoss.createQueue).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
      );
      expect(mockBoss.work).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
        { localConcurrency: 1 },
        expect.any(Function),
      );
      expect(mockBoss.schedule).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
        cron,
        { sourceId },
        { tz: timezone },
      );
      expect(mockPrisma.source.update).toHaveBeenCalledWith({
        where: { id: sourceId },
        data: {
          scheduleEnabled: true,
          scheduleCron: cron,
          scheduleTimezone: timezone,
        },
      });
    });
  });

  describe('removeSchedule', () => {
    it('calls boss.unschedule and clears DB fields', async () => {
      const sourceId = 'source-4';

      await service.removeSchedule(sourceId);

      expect(mockBoss.unschedule).toHaveBeenCalledWith(
        `ingest-source-${sourceId}`,
      );
      expect(mockPrisma.source.update).toHaveBeenCalledWith({
        where: { id: sourceId },
        data: {
          scheduleEnabled: false,
          scheduleCron: null,
          scheduleNextAt: null,
        },
      });
    });
  });

  describe('handleIngestJob (via upsertSchedule worker registration)', () => {
    let capturedHandler: (jobs: any[]) => Promise<void>;

    beforeEach(async () => {
      mockBoss.work.mockImplementation(
        (
          _name: string,
          _opts: object,
          handler: (jobs: any[]) => Promise<void>,
        ) => {
          capturedHandler = handler;
          return Promise.resolve(undefined);
        },
      );
      // Register a worker by calling upsertSchedule
      await service.upsertSchedule('source-5', '0 * * * *', 'UTC');
    });

    it('calls startRun with TriggerType.SCHEDULED and "Scheduler"', async () => {
      const sourceId = 'source-5';
      await capturedHandler([{ id: 'job-1', data: { sourceId } }]);

      expect(mockCliRunnerService.startRun).toHaveBeenCalledWith(
        sourceId,
        TriggerType.SCHEDULED,
        'Scheduler',
      );
    });

    it('skips jobs with missing sourceId', async () => {
      await capturedHandler([{ id: 'job-2', data: {} }]);
      expect(mockCliRunnerService.startRun).not.toHaveBeenCalled();
    });

    it('re-throws errors so pg-boss marks job as failed', async () => {
      const sourceId = 'source-6';
      mockCliRunnerService.startRun.mockRejectedValueOnce(
        new Error('CLI failed'),
      );

      await expect(
        capturedHandler([{ id: 'job-3', data: { sourceId } }]),
      ).rejects.toThrow('CLI failed');
    });

    it('swallows duplicate scheduled deliveries when the source is already running', async () => {
      const sourceId = 'source-7';
      mockCliRunnerService.startRun.mockRejectedValueOnce(
        new ConflictException('already has a running scan'),
      );

      await expect(
        capturedHandler([{ id: 'job-4', data: { sourceId } }]),
      ).resolves.toBeUndefined();
    });
  });
});
