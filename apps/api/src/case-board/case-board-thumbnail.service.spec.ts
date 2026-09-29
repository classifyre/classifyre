import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { CaseBoardThumbnailService } from './case-board-thumbnail.service';
import type { PrismaService } from '../prisma.service';

describe('CaseBoardThumbnailService', () => {
  const sketch = {
    v: 1,
    w: 400,
    h: 200,
    nodes: [
      { t: 'a', x: 88, y: 30, l: 'payroll.xlsx' },
      { t: 'f', x: 200, y: 120, s: 'high' },
      { t: 'n', x: 250, y: 0, w: 150, h: 100, c: 'yellow', l: 'Ask HR' },
    ],
    edges: [{ a: 0, b: 1, t: 'c' }],
  };
  const stored = (over: Record<string, unknown> = {}) => ({
    signature: 'old',
    version: 3,
    updatedAt: new Date('2026-09-29T10:00:00Z'),
    ...over,
  });

  const prisma = {
    caseBoard: { findUnique: jest.fn() },
    caseBoardThumbnail: { upsert: jest.fn() },
  };
  const service = new CaseBoardThumbnailService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.caseBoardThumbnail.upsert.mockImplementation(
      ({ create }: { create: { signature: string; version: number } }) =>
        Promise.resolve({
          signature: create.signature,
          version: create.version,
          updatedAt: new Date('2026-09-29T11:00:00Z'),
        }),
    );
  });

  it("stores a board's first sketch", async () => {
    prisma.caseBoard.findUnique.mockResolvedValue({
      id: 'b1',
      version: 5,
      thumbnail: null,
    });
    const result = await service.save('c1', {
      sketch,
      signature: 'new',
      version: 5,
    });
    expect(result).toMatchObject({
      signature: 'new',
      version: 5,
      written: true,
    });
    expect(prisma.caseBoardThumbnail.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { boardId: 'b1' },
        create: expect.objectContaining({ boardId: 'b1', sketch, version: 5 }),
      }),
    );
  });

  it('never records a version the board has not reached', async () => {
    prisma.caseBoard.findUnique.mockResolvedValue({
      id: 'b1',
      version: 2,
      thumbnail: null,
    });
    await service.save('c1', { sketch, signature: 'new', version: 99 });
    expect(prisma.caseBoardThumbnail.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ version: 2 }),
        update: expect.objectContaining({ version: 2 }),
      }),
    );
  });

  it('does not write the same sketch again', async () => {
    prisma.caseBoard.findUnique.mockResolvedValue({
      id: 'b1',
      version: 5,
      thumbnail: stored({ signature: 'same' }),
    });
    const result = await service.save('c1', {
      sketch,
      signature: 'same',
      version: 5,
    });
    expect(result).toMatchObject({ signature: 'same', written: false });
    expect(prisma.caseBoardThumbnail.upsert).not.toHaveBeenCalled();
  });

  it('keeps a sketch drawn at a later version than the one sent', async () => {
    prisma.caseBoard.findUnique.mockResolvedValue({
      id: 'b1',
      version: 9,
      thumbnail: stored({ version: 8 }),
    });
    const result = await service.save('c1', {
      sketch,
      signature: 'from-a-stale-tab',
      version: 4,
    });
    expect(result).toMatchObject({
      signature: 'old',
      version: 8,
      written: false,
    });
    expect(prisma.caseBoardThumbnail.upsert).not.toHaveBeenCalled();
  });

  it('replaces the sketch when the board changed without a new version', async () => {
    // Evidence severities change without a board op, so the version stays put.
    prisma.caseBoard.findUnique.mockResolvedValue({
      id: 'b1',
      version: 3,
      thumbnail: stored(),
    });
    const result = await service.save('c1', {
      sketch,
      signature: 'new',
      version: 3,
    });
    expect(result.written).toBe(true);
    expect(prisma.caseBoardThumbnail.upsert).toHaveBeenCalled();
  });

  it('answers 404 for a case whose board was never read', async () => {
    prisma.caseBoard.findUnique.mockResolvedValue(null);
    await expect(
      service.save('c1', { sketch, signature: 'new', version: 0 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['an unknown shape', { ...sketch, nodes: [{ t: 'x', x: 0, y: 0 }] }],
    [
      'an edge to a node it does not have',
      { ...sketch, edges: [{ a: 0, b: 7, t: 'c' }] },
    ],
    [
      'a stray key',
      { ...sketch, nodes: [{ t: 'a', x: 0, y: 0, html: '<b>' }] },
    ],
    ['a negative coordinate', { ...sketch, nodes: [{ t: 'a', x: -4, y: 0 }] }],
  ])('refuses a sketch with %s', async (_label, bad) => {
    await expect(
      service.save('c1', { sketch: bad, signature: 'new', version: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.caseBoard.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a signature that is not a short token', async () => {
    await expect(
      service.save('c1', { sketch, signature: 'a b', version: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a sketch that serializes past the size ceiling', async () => {
    // Control characters escape to six bytes each in JSON.
    const label = '\u0001'.repeat(80);
    const nodes = Array.from({ length: 250 }, (_, i) => ({
      t: 'a',
      x: i,
      y: i,
      l: label,
    }));
    await expect(
      service.save('c1', {
        sketch: { ...sketch, nodes, edges: [] },
        signature: 'big',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
