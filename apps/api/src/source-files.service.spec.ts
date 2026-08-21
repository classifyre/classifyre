import { BadRequestException, ConflictException } from '@nestjs/common';
import { AssetType, RunnerStatus } from '@prisma/client';
import { SourceFilesService } from './source-files.service';

function sandboxSource(runnerStatus: RunnerStatus = RunnerStatus.COMPLETED) {
  return { id: 'source-1', type: AssetType.SANDBOX, runnerStatus };
}

function customSource(runnerStatus: RunnerStatus = RunnerStatus.COMPLETED) {
  return { id: 'source-1', type: AssetType.CUSTOM, runnerStatus };
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

  it('stores oversized files instead of rejecting them', async () => {
    const prisma = createPrisma();
    const service = new SourceFilesService(prisma as never);

    const created = await service.create({
      sourceId: 'source-1',
      fileName: 'large.bin',
      declaredMimeType: 'application/octet-stream',
      data: Buffer.alloc(60 * 1024 * 1024),
    });

    expect(created).toMatchObject({ id: 'file-1' });
    expect(prisma.uploadedSourceFile.create).toHaveBeenCalled();
  });

  it('rejects a source type that has no use for uploads', async () => {
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

  describe('custom notebook sources', () => {
    function createCustomPrisma() {
      const prisma = createPrisma();
      prisma.source.findUnique.mockResolvedValue(customSource());
      return prisma;
    }

    it('accepts uploads, so a notebook can read them as ctx.files', async () => {
      const prisma = createCustomPrisma();
      const service = new SourceFilesService(prisma as never);

      await service.create({
        sourceId: 'source-1',
        fileName: 'dump.csv',
        declaredMimeType: 'text/csv',
        data: Buffer.from('a,b\n1,2\n'),
      });

      expect(
        prisma.uploadedSourceFile.create.mock.calls[0][0].data.fileName,
      ).toBe('dump.csv');
    });

    it('can run with no files at all', async () => {
      // Unlike a sandbox, a notebook is the source -- it may talk to an API and
      // never touch a file.
      const prisma = createCustomPrisma();
      prisma.uploadedSourceFile.count.mockResolvedValue(0);
      const service = new SourceFilesService(prisma as never);

      await expect(service.assertHasFiles('source-1')).resolves.toBeUndefined();
    });

    it('lets the last file be deleted', async () => {
      const prisma = createCustomPrisma();
      prisma.uploadedSourceFile.count.mockResolvedValue(1);
      const tx = {
        uploadedSourceFile: {
          findFirst: jest.fn().mockResolvedValue({ id: 'file-1' }),
          count: jest.fn().mockResolvedValue(1),
          delete: jest.fn().mockResolvedValue({}),
        },
        asset: { findMany: jest.fn(), updateMany: jest.fn() },
        finding: { findMany: jest.fn(), update: jest.fn() },
      };
      (prisma as unknown as { $transaction: unknown }).$transaction = jest
        .fn()
        .mockImplementation((callback: (t: unknown) => unknown) =>
          callback(tx),
        );
      const service = new SourceFilesService(prisma as never);

      await service.delete('source-1', 'file-1');

      expect(tx.uploadedSourceFile.delete).toHaveBeenCalled();
      // A notebook chooses its own asset ids, so nothing here can know which
      // came from this file -- the next scan reconciles that.
      expect(tx.asset.findMany).not.toHaveBeenCalled();
    });

    it('still refuses to delete the last file of a sandbox', async () => {
      const prisma = createPrisma();
      const tx = {
        uploadedSourceFile: {
          findFirst: jest.fn().mockResolvedValue({ id: 'file-1' }),
          count: jest.fn().mockResolvedValue(1),
          delete: jest.fn(),
        },
        asset: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn(),
        },
        finding: { findMany: jest.fn(), update: jest.fn() },
      };
      (prisma as unknown as { $transaction: unknown }).$transaction = jest
        .fn()
        .mockImplementation((callback: (t: unknown) => unknown) =>
          callback(tx),
        );
      const service = new SourceFilesService(prisma as never);

      await expect(service.delete('source-1', 'file-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
