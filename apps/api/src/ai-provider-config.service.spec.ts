import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiProviderConfigService } from './ai-provider-config.service';

function createService() {
  const prisma = {
    aiProviderConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    customDetector: {
      count: jest.fn(),
    },
  };
  const crypto = {
    encryptString: jest.fn((s: string) => `enc:${s}`),
    decryptString: jest.fn((s: string) => s.replace(/^enc:/, '')),
  };
  const service = new AiProviderConfigService(prisma as any, crypto as any);
  return { service, prisma };
}

describe('AiProviderConfigService.remove', () => {
  it('throws ConflictException when detectors still reference the provider', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      id: 'ai-1',
      name: 'Prod',
    });
    prisma.customDetector.count.mockResolvedValue(2);

    await expect(service.remove('ai-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.aiProviderConfig.delete).not.toHaveBeenCalled();
  });

  it('deletes when no detectors reference the provider', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      id: 'ai-1',
      name: 'Prod',
    });
    prisma.customDetector.count.mockResolvedValue(0);

    await service.remove('ai-1');
    expect(prisma.aiProviderConfig.delete).toHaveBeenCalledWith({
      where: { id: 'ai-1' },
    });
  });

  it('throws NotFoundException for an unknown id', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AiProviderConfigService supportsVision', () => {
  const baseRow = {
    id: 'ai-1',
    name: 'Vision Claude',
    provider: 'CLAUDE',
    model: 'claude-sonnet-4-5',
    apiKeyEnc: 'enc:sk-test',
    baseUrl: null,
    contextSize: null,
    supportsVision: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('persists supportsVision on create and returns it', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.create.mockResolvedValue(baseRow);

    const result = await service.create({
      name: 'Vision Claude',
      provider: 'CLAUDE',
      supportsVision: true,
    } as any);

    expect(prisma.aiProviderConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supportsVision: true }),
      }),
    );
    expect(result.supportsVision).toBe(true);
  });

  it('defaults supportsVision to false on create when omitted', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.create.mockResolvedValue({
      ...baseRow,
      supportsVision: false,
    });

    await service.create({ name: 'Text Claude', provider: 'CLAUDE' } as any);

    expect(prisma.aiProviderConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supportsVision: false }),
      }),
    );
  });

  it('updates supportsVision when provided', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(baseRow);
    prisma.aiProviderConfig.update.mockResolvedValue({
      ...baseRow,
      supportsVision: false,
    });

    await service.update('ai-1', { supportsVision: false } as any);

    expect(prisma.aiProviderConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supportsVision: false }),
      }),
    );
  });

  it('includes supportsVision in the resolved runtime config', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(baseRow);

    const runtime = await service.getRuntimeConfig('ai-1');

    expect(runtime.supportsVision).toBe(true);
  });
});
