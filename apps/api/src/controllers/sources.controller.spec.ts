import { Test, TestingModule } from '@nestjs/testing';
import { SourcesController } from './sources.controller';
import { SourceService } from '../source.service';
import { ValidationService } from '../validation.service';
import { CustomDetectorsService } from '../custom-detectors.service';
import { CliRunnerService } from '../cli-runner/cli-runner.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { AutoScheduleService } from '../scheduler/auto-schedule.service';
import { SourceFilesService } from '../source-files.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RunnerStatus, SourceScheduleMode } from '@prisma/client';

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

// Mock the uuid module to avoid ESM issues
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}));

describe('SourcesController', () => {
  let controller: SourcesController;

  const mockSource = {
    id: 'test-source-id',
    name: 'Test Source',
    type: 'WORDPRESS',
    config: {},
    currentRunnerId: null,
    runnerStatus: RunnerStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSourceService = {
    source: jest.fn(),
    deleteSource: jest.fn(),
    sources: jest.fn(),
    createFromConfig: jest.fn(),
    updateFromConfig: jest.fn(),
    updateSource: jest.fn(),
    decryptSourceConfig: jest.fn(),
    startNewRun: jest.fn(),
    updateRunnerStatus: jest.fn(),
  };

  const mockValidationService = {
    validate: jest.fn(),
  };

  const mockCliRunnerService = {
    testConnection: jest.fn(),
    startRun: jest.fn(),
  };

  const mockSchedulerService = {
    upsertSchedule: jest.fn(),
    removeSchedule: jest.fn(),
    getSchedule: jest.fn(),
  };

  const mockAutoScheduleService = {
    enable: jest.fn(),
    describe: jest.fn(),
    resume: jest.fn(),
  };

  const mockCustomDetectorsService = {
    sanitizeSourceConfigDetectors: jest.fn((config: unknown) =>
      Promise.resolve(config),
    ),
  };

  const mockSourceFilesService = {
    assertHasFiles: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SourcesController],
      providers: [
        { provide: SourceService, useValue: mockSourceService },
        { provide: ValidationService, useValue: mockValidationService },
        {
          provide: CustomDetectorsService,
          useValue: mockCustomDetectorsService,
        },
        { provide: CliRunnerService, useValue: mockCliRunnerService },
        { provide: SchedulerService, useValue: mockSchedulerService },
        { provide: AutoScheduleService, useValue: mockAutoScheduleService },
        { provide: SourceFilesService, useValue: mockSourceFilesService },
      ],
    }).compile();

    controller = module.get<SourcesController>(SourcesController);

    jest.clearAllMocks();
  });

  describe('deleteSource', () => {
    it('should delete a source when it exists', async () => {
      mockSourceService.source.mockResolvedValue(mockSource);
      mockSchedulerService.removeSchedule.mockResolvedValue(undefined);
      mockSourceService.deleteSource.mockResolvedValue(mockSource);

      await controller.deleteSource('test-source-id');

      expect(mockSourceService.source).toHaveBeenCalledWith({
        id: 'test-source-id',
      });
      expect(mockSourceService.deleteSource).toHaveBeenCalledWith({
        id: 'test-source-id',
      });
      expect(mockSchedulerService.removeSchedule).toHaveBeenCalledWith(
        'test-source-id',
      );
    });

    it('should throw NotFoundException when source does not exist', async () => {
      mockSourceService.source.mockResolvedValue(null);

      await expect(controller.deleteSource('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockSourceService.source).toHaveBeenCalledWith({
        id: 'non-existent-id',
      });
      expect(mockSchedulerService.removeSchedule).not.toHaveBeenCalled();
      expect(mockSourceService.deleteSource).not.toHaveBeenCalled();
    });

    it('should verify that deleteSource is called with correct parameters', async () => {
      mockSourceService.source.mockResolvedValue(mockSource);
      mockSchedulerService.removeSchedule.mockResolvedValue(undefined);
      mockSourceService.deleteSource.mockResolvedValue(mockSource);

      await controller.deleteSource('source-id-123');

      expect(mockSourceService.deleteSource).toHaveBeenCalledTimes(1);
      expect(mockSchedulerService.removeSchedule).toHaveBeenCalledTimes(1);
      expect(mockSourceService.deleteSource).toHaveBeenCalledWith({
        id: 'source-id-123',
      });
    });
  });

  describe('testConnection', () => {
    it('should run a CLI connection test for the source', async () => {
      const response = {
        status: 'SUCCESS',
        message: 'Connected.',
        timestamp: '2026-02-04T14:22:11.123Z',
        source_type: 'WORDPRESS',
      };
      mockCliRunnerService.testConnection.mockResolvedValue(response);

      const result = await controller.testConnection('test-source-id');

      expect(mockCliRunnerService.testConnection).toHaveBeenCalledWith(
        'test-source-id',
      );
      expect(result).toEqual(response);
    });
  });

  describe('startRun', () => {
    it('should start the run via the CLI runner service and return the updated source', async () => {
      const runningSource = {
        ...mockSource,
        currentRunnerId: 'runner-123',
        runnerStatus: RunnerStatus.RUNNING,
      };

      mockSourceService.source
        .mockResolvedValueOnce(mockSource)
        .mockResolvedValueOnce(runningSource);
      mockCliRunnerService.startRun.mockResolvedValue({
        id: 'runner-123',
      });

      const result = await controller.startRun('test-source-id');

      expect(mockCliRunnerService.startRun).toHaveBeenCalledWith(
        'test-source-id',
      );
      expect(mockSourceService.source).toHaveBeenNthCalledWith(1, {
        id: 'test-source-id',
      });
      expect(mockSourceService.source).toHaveBeenNthCalledWith(2, {
        id: 'test-source-id',
      });
      expect(result).toEqual(runningSource);
    });

    it('should throw NotFoundException when the source does not exist', async () => {
      mockSourceService.source.mockResolvedValue(null);

      await expect(controller.startRun('missing-source')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockCliRunnerService.startRun).not.toHaveBeenCalled();
    });
  });

  describe('schedule cron validation', () => {
    it('should reject malformed cron expressions on create', async () => {
      mockSourceService.createFromConfig.mockResolvedValue({
        ...mockSource,
        id: 'created-source-id',
      });

      await expect(
        controller.createSource({
          type: 'WORDPRESS',
          name: 'Test Source',
          config: {},
          scheduleEnabled: true,
          scheduleCron: 'not-a-cron',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockSchedulerService.upsertSchedule).not.toHaveBeenCalled();
    });

    it('should reject malformed cron expressions on update', async () => {
      mockSourceService.source.mockResolvedValue(mockSource);
      mockSourceService.updateFromConfig.mockResolvedValue(mockSource);

      await expect(
        controller.updateSource('test-source-id', {
          scheduleEnabled: true,
          scheduleCron: '0 * * ?',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockSchedulerService.upsertSchedule).not.toHaveBeenCalled();
    });
  });

  describe('updateSource', () => {
    it('should rollback source fields when scheduler update fails', async () => {
      const sourceWithSchedule = {
        ...mockSource,
        scheduleEnabled: false,
        scheduleCron: null,
        scheduleTimezone: 'UTC',
      };
      const updatedSource = {
        ...sourceWithSchedule,
        name: 'Updated Name',
      };

      mockSourceService.source.mockResolvedValue(sourceWithSchedule);
      mockSourceService.updateFromConfig.mockResolvedValue(updatedSource);
      mockSchedulerService.upsertSchedule.mockRejectedValue(
        new Error('scheduler unavailable'),
      );
      mockSourceService.updateSource.mockResolvedValue(sourceWithSchedule);

      await expect(
        controller.updateSource('test-source-id', {
          name: 'Updated Name',
          scheduleEnabled: true,
          scheduleCron: '*/5 * * * *',
        }),
      ).rejects.toThrow('scheduler unavailable');

      expect(mockSourceService.updateSource).toHaveBeenCalledWith({
        where: { id: 'test-source-id' },
        data: {
          name: sourceWithSchedule.name,
          type: sourceWithSchedule.type,
          config: sourceWithSchedule.config,
        },
      });
    });
  });

  describe('bulkUpdateSources', () => {
    it('replaces only the sampling block and preserves the rest of each config', async () => {
      const currentConfig = {
        type: 'WORDPRESS',
        required: { url: 'https://example.com' },
        masked: { token: 'secret' },
        detectors: ['PII'],
        sampling: { strategy: 'RANDOM', rows_per_page: 25 },
      };
      mockSourceService.sources.mockResolvedValue([mockSource]);
      mockSourceService.decryptSourceConfig.mockReturnValue(currentConfig);
      mockValidationService.validate.mockImplementation(
        (_type: string, config: Record<string, unknown>) => config,
      );
      mockSourceService.updateFromConfig.mockResolvedValue(mockSource);

      const result = await controller.bulkUpdateSources({
        ids: [mockSource.id],
        sampling: { strategy: 'LATEST', rows_per_page: 100 },
      });

      expect(mockSourceService.updateFromConfig).toHaveBeenCalledWith(
        mockSource.id,
        {
          config: {
            ...currentConfig,
            sampling: { strategy: 'LATEST', rows_per_page: 100 },
          },
        },
      );
      expect(mockSchedulerService.upsertSchedule).not.toHaveBeenCalled();
      expect(mockSchedulerService.removeSchedule).not.toHaveBeenCalled();
      expect(result).toEqual({ updatedCount: 1, ids: [mockSource.id] });
    });

    it('uses the filter snapshot and leaves config untouched for schedule-only updates', async () => {
      mockSourceService.sources.mockResolvedValue([mockSource]);
      mockSchedulerService.removeSchedule.mockResolvedValue(undefined);

      await controller.bulkUpdateSources({
        filters: { search: 'test', status: [RunnerStatus.PENDING] },
        schedule: { mode: 'OFF' },
      });

      expect(mockSourceService.sources).toHaveBeenCalledWith({
        where: {
          name: { contains: 'test', mode: 'insensitive' },
          runnerStatus: { in: [RunnerStatus.PENDING] },
        },
      });
      expect(mockSourceService.updateFromConfig).not.toHaveBeenCalled();
      expect(mockSchedulerService.removeSchedule).toHaveBeenCalledWith(
        mockSource.id,
        SourceScheduleMode.OFF,
      );
    });

    it('restores the original config when the schedule update fails', async () => {
      const source = { ...mockSource, config: { encrypted: 'original' } };
      mockSourceService.sources.mockResolvedValue([source]);
      mockSourceService.decryptSourceConfig.mockReturnValue({
        type: 'WORDPRESS',
        sampling: { strategy: 'RANDOM' },
      });
      mockValidationService.validate.mockImplementation(
        (_type: string, config: Record<string, unknown>) => config,
      );
      mockSourceService.updateFromConfig.mockResolvedValue(source);
      mockSchedulerService.upsertSchedule.mockRejectedValue(
        new Error('scheduler unavailable'),
      );

      await expect(
        controller.bulkUpdateSources({
          ids: [source.id],
          sampling: { strategy: 'LATEST' },
          schedule: { mode: 'CRON', cron: '0 2 * * *', timezone: 'UTC' },
        }),
      ).rejects.toThrow('scheduler unavailable');

      expect(mockSourceService.updateSource).toHaveBeenCalledWith({
        where: { id: source.id },
        data: { config: source.config },
      });
    });

    it('reports sources that could not be started instead of failing the batch', async () => {
      const second = { ...mockSource, id: 'busy-source', name: 'Busy Source' };
      mockSourceService.sources.mockResolvedValue([mockSource, second]);
      mockCliRunnerService.startRun
        .mockResolvedValueOnce({ id: 'runner-1' })
        .mockRejectedValueOnce(
          new Error('Source busy-source already has a running scan'),
        );

      const result = await controller.bulkRunSources({
        filters: { search: 'test' },
      });

      expect(mockSourceService.sources).toHaveBeenCalledWith({
        where: { name: { contains: 'test', mode: 'insensitive' } },
      });
      expect(mockCliRunnerService.startRun).toHaveBeenCalledWith(
        mockSource.id,
        'MANUAL',
        undefined,
        false,
      );
      expect(result).toEqual({
        startedCount: 1,
        ids: [mockSource.id],
        skipped: [
          {
            id: 'busy-source',
            name: 'Busy Source',
            reason: 'Source busy-source already has a running scan',
          },
        ],
      });
    });

    it('rejects a bulk run that mixes ids and filters', async () => {
      await expect(
        controller.bulkRunSources({ ids: [mockSource.id], filters: {} }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCliRunnerService.startRun).not.toHaveBeenCalled();
    });

    it('requires exactly one selection mode and at least one update', async () => {
      await expect(
        controller.bulkUpdateSources({
          ids: [mockSource.id],
          filters: {},
          schedule: { mode: 'OFF' },
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.bulkUpdateSources({ ids: [mockSource.id] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
