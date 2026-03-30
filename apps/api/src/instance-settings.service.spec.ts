import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InstanceLanguage, InstanceTimeFormat } from '@prisma/client';
import { InstanceSettingsService } from './instance-settings.service';
import { PrismaService } from './prisma.service';

describe('InstanceSettingsService', () => {
  let service: InstanceSettingsService;

  const mockPrismaService = {
    instanceSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceSettingsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<InstanceSettingsService>(InstanceSettingsService);
    jest.clearAllMocks();
  });

  it('returns singleton settings', async () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
      aiEnabled: true,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.getSettings();

    expect(mockPrismaService.instanceSettings.upsert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 1,
      aiEnabled: true,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
    });
  });

  it('updates instance settings with normalized timezone', async () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
      aiEnabled: true,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    mockPrismaService.instanceSettings.update.mockResolvedValue({
      id: 1,
      aiEnabled: false,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'America/New_York',
      timeFormat: InstanceTimeFormat.TWENTY_FOUR_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.updateSettings({
      aiEnabled: false,
      timezone: '  America/New_York  ',
      timeFormat: InstanceTimeFormat.TWENTY_FOUR_HOUR,
    });

    expect(mockPrismaService.instanceSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          aiEnabled: false,
          timezone: 'America/New_York',
          timeFormat: InstanceTimeFormat.TWENTY_FOUR_HOUR,
        }),
      }),
    );

    expect(result.timezone).toBe('America/New_York');
    expect(result.timeFormat).toBe(InstanceTimeFormat.TWENTY_FOUR_HOUR);
    expect(result.aiEnabled).toBe(false);
  });

  it('rejects empty timezone values', async () => {
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
      aiEnabled: true,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: new Date('2026-03-05T12:00:00.000Z'),
      updatedAt: new Date('2026-03-05T12:00:00.000Z'),
    });

    await expect(
      service.updateSettings({ timezone: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
