import { BadRequestException } from '@nestjs/common';
import { CaseThreadEntryType, CaseThreadKind } from '@prisma/client';
import { CaseThreadsService } from './case-threads.service';

describe('CaseThreadsService', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'thread-1',
    caseId: 'case-1',
    kind: CaseThreadKind.HYPOTHESIS,
    title: 'Key reuse',
    status: 'PROPOSED',
    confidence: null,
    testablePredicate: null,
    color: null,
    createdBy: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    support: [],
    entries: [],
    ...over,
  });

  const tx = {
    caseThread: { create: jest.fn(), update: jest.fn() },
    caseThreadEntry: { create: jest.fn() },
  };
  const prisma = {
    case: { findUnique: jest.fn() },
    caseThread: { findUnique: jest.fn(), findMany: jest.fn() },
    caseEvidence: { findMany: jest.fn() },
    caseFinding: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) =>
      Promise.resolve(fn(tx)),
    ),
  };
  const activity = { record: jest.fn() };
  const service = new CaseThreadsService(prisma as never, activity as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.case.findUnique.mockResolvedValue({ id: 'case-1' });
    tx.caseThreadEntry.create.mockResolvedValue({ id: 'entry-1' });
  });

  it('persists testablePredicate when creating a hypothesis', async () => {
    tx.caseThread.create.mockResolvedValue(
      row({ testablePredicate: 'A reused key appears after rotation.' }),
    );
    prisma.caseThread.findUnique.mockResolvedValue(
      row({ testablePredicate: 'A reused key appears after rotation.' }),
    );

    await service.create('case-1', {
      kind: CaseThreadKind.HYPOTHESIS,
      title: 'Key reuse',
      testablePredicate: 'A reused key appears after rotation.',
    });

    expect(tx.caseThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          testablePredicate: 'A reused key appears after rotation.',
        }),
      }),
    );
  });

  it('updates testablePredicate and records its previous value', async () => {
    prisma.caseThread.findUnique
      .mockResolvedValueOnce({
        id: 'thread-1',
        caseId: 'case-1',
        status: 'PROPOSED',
        confidence: null,
        testablePredicate: null,
      })
      .mockResolvedValueOnce(
        row({ testablePredicate: 'Messages contain a matching token.' }),
      );

    await service.update('thread-1', {
      testablePredicate: 'Messages contain a matching token.',
    });

    expect(tx.caseThread.update).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
      data: { testablePredicate: 'Messages contain a matching token.' },
    });
    expect(tx.caseThreadEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            previousTestablePredicate: null,
            testablePredicate: 'Messages contain a matching token.',
          },
        }),
      }),
    );
  });

  it('persists entry metadata', async () => {
    prisma.caseThread.findUnique
      .mockResolvedValueOnce({ id: 'thread-1', caseId: 'case-1', title: 'H' })
      .mockResolvedValueOnce(row());
    const metadata = {
      probe: { customDetectorKey: 'cust_probe', detectorId: 'det-1' },
    };

    await service.addEntry('thread-1', {
      entryType: CaseThreadEntryType.NOTE,
      body: 'Probe linked.',
      metadata,
    });

    expect(tx.caseThreadEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata }),
      }),
    );
  });

  it('passes undefined rather than null when entry metadata is absent', async () => {
    prisma.caseThread.findUnique
      .mockResolvedValueOnce({ id: 'thread-1', caseId: 'case-1', title: 'H' })
      .mockResolvedValueOnce(row());

    await service.addEntry('thread-1', {
      entryType: CaseThreadEntryType.NOTE,
      body: 'No metadata.',
    });

    expect(tx.caseThreadEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: undefined }),
      }),
    );
  });

  it('rejects oversized metadata before opening a transaction', async () => {
    prisma.caseThread.findUnique.mockResolvedValue({
      id: 'thread-1',
      caseId: 'case-1',
      title: 'H',
    });

    await expect(
      service.addEntry('thread-1', {
        entryType: CaseThreadEntryType.NOTE,
        metadata: { value: 'x'.repeat(8_001) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
