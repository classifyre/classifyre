import { BadRequestException } from '@nestjs/common';
import { CaseEventsService } from './case-events.service';

describe('CaseEventsService', () => {
  const prisma = {
    case: { findUnique: jest.fn() },
    caseEvent: { create: jest.fn() },
  };
  const activity = { record: jest.fn() };
  const service = new CaseEventsService(prisma as never, activity as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.case.findUnique.mockResolvedValue({ id: 'case-1' });
    prisma.caseEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        id: 'event-1',
        verifiedAt: new Date(),
        verifiedBy: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it('converts REST timestamp strings before passing them to Prisma', async () => {
    await service.create('case-1', {
      occurredAt: '2026-07-17T12:00:00.000Z',
      title: 'Observed event',
    });

    expect(prisma.caseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ occurredAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects invalid chronology timestamps', async () => {
    await expect(
      service.create('case-1', {
        occurredAt: 'not-a-date',
        title: 'Observed event',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
