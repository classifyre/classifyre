import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AssetType, RunnerStatus } from '@prisma/client';
import {
  MAX_SOURCE_FILE_BYTES,
  SourceFilesService,
} from './source-files.service';

function sandboxSource(runnerStatus: RunnerStatus = RunnerStatus.COMPLETED) {
  return { id: 'source-1', type: AssetType.SANDBOX, runnerStatus };
}

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
    source: { findUnique: jest.fn().mockResolvedValue(sandboxSource()) },
    uploadedSourceFile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'file-1', ...data })),
      count: jest.fn().mockResolvedValue(1),
    },
    ...overrides,
  };
}

describe(SourceFilesService.name, () => {
  it('lists only metadata and never selects byte data', async () => {
    const prisma = createPrisma();
    const service = new SourceFilesService(prisma as never);

    await service.list('source-1');

    const call = prisma.uploadedSourceFile.findMany.mock.calls[0][0];
    expect(call.select.data).toBeUndefined();
    expect(call.select.contentHash).toBe(true);
  });

  it('persists a SHA-256 hash and normalized filename', async () => {
    const prisma = createPrisma();
    const service = new SourceFilesService(prisma as never);

    await service.create({
      sourceId: 'source-1',
      fileName: '../customer.txt',
      declaredMimeType: 'text/plain',
      data: Buffer.from('hello'),
    });

    const data = prisma.uploadedSourceFile.create.mock.calls[0][0].data;
    expect(data.fileName).toBe('customer.txt');
    expect(data.contentHash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(Buffer.from(data.data).toString()).toBe('hello');
  });

  it('rejects duplicate content within a source', async () => {
    const prisma = createPrisma();
    prisma.uploadedSourceFile.findUnique.mockResolvedValue({ id: 'existing' });
    const service = new SourceFilesService(prisma as never);

    await expect(
      service.create({
        sourceId: 'source-1',
        fileName: 'copy.txt',
        declaredMimeType: 'text/plain',
        data: Buffer.from('same'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces the per-file byte limit before persistence', async () => {
    const prisma = createPrisma();
    const service = new SourceFilesService(prisma as never);

    await expect(
      service.create({
        sourceId: 'source-1',
        fileName: 'large.bin',
        declaredMimeType: 'application/octet-stream',
        data: Buffer.alloc(MAX_SOURCE_FILE_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(prisma.uploadedSourceFile.create).not.toHaveBeenCalled();
  });

  it('rejects non-Sandbox sources and active runners', async () => {
    const prisma = createPrisma();
    const service = new SourceFilesService(prisma as never);
    prisma.source.findUnique.mockResolvedValueOnce({
      ...sandboxSource(),
      type: AssetType.POSTGRESQL,
    });
    await expect(service.list('source-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.source.findUnique.mockResolvedValueOnce(
      sandboxSource(RunnerStatus.RUNNING),
    );
    await expect(
      service.create({
        sourceId: 'source-1',
        fileName: 'busy.txt',
        declaredMimeType: 'text/plain',
        data: Buffer.from('busy'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires at least one upload before test or run', async () => {
    const prisma = createPrisma();
    prisma.uploadedSourceFile.count.mockResolvedValue(0);
    const service = new SourceFilesService(prisma as never);

    await expect(service.assertHasFiles('source-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
