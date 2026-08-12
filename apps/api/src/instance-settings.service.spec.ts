import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InstanceLanguage, InstanceTimeFormat } from '@prisma/client';
import { InstanceSettingsService } from './instance-settings.service';
import { PrismaService } from './prisma.service';
import { DemoModeService } from './demo-mode.service';
import { MaskedConfigCryptoService } from './masked-config-crypto.service';

describe('InstanceSettingsService', () => {
  let service: InstanceSettingsService;

  const mockPrismaService = {
    instanceSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    aiProviderConfig: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceSettingsService,
        DemoModeService,
        MaskedConfigCryptoService,
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
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.getSettings();

    expect(mockPrismaService.instanceSettings.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrismaService.instanceSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          mcpEnabled: true,
          autopilotInquiryEnabled: true,
          autopilotCaseEnabled: true,
          autopilotConfigEnabled: true,
          autopilotDetectorEnabled: true,
          autopilotEscalationEnabled: true,
          autopilotMcpEnabled: true,
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 1,
      mcpEnabled: true,
      demoMode: false,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
    });
  });

  it('updates instance settings with normalized timezone', async () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    mockPrismaService.instanceSettings.update.mockResolvedValue({
      id: 1,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'America/New_York',
      timeFormat: InstanceTimeFormat.TWENTY_FOUR_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.updateSettings({
      timezone: '  America/New_York  ',
      timeFormat: InstanceTimeFormat.TWENTY_FOUR_HOUR,
    });

    expect(mockPrismaService.instanceSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          timezone: 'America/New_York',
          timeFormat: InstanceTimeFormat.TWENTY_FOUR_HOUR,
        }),
      }),
    );

    expect(result.timezone).toBe('America/New_York');
    expect(result.timeFormat).toBe(InstanceTimeFormat.TWENTY_FOUR_HOUR);
  });

  it('updates Assistant and Harness provider assignments independently', async () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      aiProviderConfigId: null,
      harnessAiProviderConfigId: null,
      createdAt: now,
      updatedAt: now,
    });
    mockPrismaService.aiProviderConfig.findUnique.mockResolvedValue({
      id: 'shared-provider',
    });
    mockPrismaService.instanceSettings.update.mockResolvedValue({
      id: 1,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      aiProviderConfigId: 'shared-provider',
      harnessAiProviderConfigId: 'shared-provider',
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.updateSettings({
      aiProviderConfigId: 'shared-provider',
      harnessAiProviderConfigId: 'shared-provider',
    });

    expect(mockPrismaService.aiProviderConfig.findUnique).toHaveBeenCalledTimes(
      2,
    );
    expect(mockPrismaService.instanceSettings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        aiProviderConfig: { connect: { id: 'shared-provider' } },
        harnessAiProviderConfig: { connect: { id: 'shared-provider' } },
      }),
    });
    expect(result).toMatchObject({
      aiProviderConfigId: 'shared-provider',
      harnessAiProviderConfigId: 'shared-provider',
    });
  });

  it('persists AUTOMATIC language setting', async () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
      mcpEnabled: true,
      language: InstanceLanguage.ENGLISH,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    mockPrismaService.instanceSettings.update.mockResolvedValue({
      id: 1,
      mcpEnabled: true,
      language: 'AUTOMATIC' as InstanceLanguage,
      timezone: 'UTC',
      timeFormat: InstanceTimeFormat.TWELVE_HOUR,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.updateSettings({
      language: 'AUTOMATIC',
    });

    expect(mockPrismaService.instanceSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          language: 'AUTOMATIC',
        }),
      }),
    );
    expect(result.language).toBe('AUTOMATIC');
  });

  it('rejects empty timezone values', async () => {
    mockPrismaService.instanceSettings.upsert.mockResolvedValue({
      id: 1,
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
