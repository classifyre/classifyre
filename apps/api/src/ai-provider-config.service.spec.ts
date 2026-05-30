import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiProviderConfigService } from './ai-provider-config.service';

function createService() {
  const prisma = {
    aiProviderConfig: {
      findUnique: jest.fn(),
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
