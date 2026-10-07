import { BadRequestException, ConflictException } from '@nestjs/common';
import { CaseHypothesisRulesService } from './case-hypothesis-rules.service';
import { CASE_BOARD_ARRIVALS } from './case-board-arrivals.port';

const CASE = 'case-1';
const WATCH = {
  id: 'ci-1',
  inquiryId: 'inq-1',
  inquiry: { title: 'Insolvency' },
};
const INQUIRY = { id: 'inq-1', title: 'Insolvency' };

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    case: {
      findUnique: jest.fn().mockResolvedValue({ id: CASE, status: 'OPEN' }),
    },
    caseInquiry: { findUnique: jest.fn().mockResolvedValue(WATCH) },
    caseThread: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'h1',
        caseId: CASE,
        kind: 'HYPOTHESIS',
        title: 'Shell company',
      }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'h1', title: 'Shell company' }]),
    },
    caseHypothesisRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    caseFinding: { findMany: jest.fn().mockResolvedValue([]) },
    caseThreadSupport: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
  const activity = {
    record: jest.fn().mockResolvedValue(undefined),
    recordCoalesced: jest.fn().mockResolvedValue(undefined),
  };
  const matching = {
    getMatchingFindingIds: jest.fn().mockResolvedValue([]),
  };
  const board = { placeArrivals: jest.fn().mockResolvedValue({ placed: 1 }) };
  const moduleRef = {
    get: jest.fn((token: unknown) =>
      token === CASE_BOARD_ARRIVALS ? board : undefined,
    ),
  };
  const service = new CaseHypothesisRulesService(
    prisma as never,
    activity as never,
    matching as never,
    moduleRef as never,
  );
  return { service, prisma, activity, matching, board };
}

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  threadId: 'h1',
  stance: 'SUPPORTS',
  kind: null,
  pattern: null,
  createdAt: new Date(1),
  ...over,
});

describe('CaseHypothesisRulesService.onArrival', () => {
  it('does nothing without findings', async () => {
    const { service, prisma } = build();
    expect(await service.onArrival(CASE, INQUIRY, [])).toBe(0);
    expect(prisma.caseInquiry.findUnique).not.toHaveBeenCalled();
  });

  it('does nothing when the case holds no rule for the watch', async () => {
    const { service, prisma, board } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValue([]);
    expect(await service.onArrival(CASE, INQUIRY, ['f1'])).toBe(0);
    expect(prisma.caseThreadSupport.createMany).not.toHaveBeenCalled();
    expect(board.placeArrivals).not.toHaveBeenCalled();
  });

  it('links arrivals to the hypothesis, records one timeline entry and lands the evidence', async () => {
    const { service, prisma, activity, board } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValue([rule()]);
    prisma.caseFinding.findMany.mockResolvedValue([
      {
        id: 'cf1',
        caseEvidenceId: 'ev1',
        label: 'acute_insolvency_risk',
        matchedContent: 'FN 1',
      },
      {
        id: 'cf2',
        caseEvidenceId: 'ev2',
        label: 'acute_insolvency_risk',
        matchedContent: 'FN 2',
      },
    ]);
    prisma.caseThreadSupport.createMany.mockResolvedValue({ count: 2 });

    const linked = await service.onArrival(
      CASE,
      INQUIRY,
      ['f1', 'f2'],
      'inquiry-auto-pull',
    );

    expect(linked).toBe(2);
    const created = prisma.caseThreadSupport.createMany.mock.calls[0][0];
    expect(created.skipDuplicates).toBe(true);
    expect(created.data).toEqual([
      {
        threadId: 'h1',
        targetType: 'finding',
        targetId: 'cf1',
        stance: 'SUPPORTS',
        ruleId: 'r1',
      },
      {
        threadId: 'h1',
        targetType: 'finding',
        targetId: 'cf2',
        stance: 'SUPPORTS',
        ruleId: 'r1',
      },
    ]);
    expect(activity.recordCoalesced).toHaveBeenCalledTimes(1);
    expect(activity.recordCoalesced.mock.calls[0][3]).toBe('inquiry-auto-pull');
    expect(board.placeArrivals).toHaveBeenCalledWith(
      CASE,
      expect.arrayContaining(['ev1', 'ev2']),
      'inquiry-auto-pull',
    );
  });

  it('skips pairs a person already linked, and does not place anything then', async () => {
    const { service, prisma, board, activity } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValue([rule()]);
    prisma.caseFinding.findMany.mockResolvedValue([
      { id: 'cf1', caseEvidenceId: 'ev1', label: 'x', matchedContent: 'v' },
    ]);
    prisma.caseThreadSupport.findMany.mockResolvedValue([
      { targetId: 'cf1', threadId: 'h1' },
    ]);
    expect(await service.onArrival(CASE, INQUIRY, ['f1'])).toBe(0);
    expect(prisma.caseThreadSupport.createMany).not.toHaveBeenCalled();
    expect(activity.recordCoalesced).not.toHaveBeenCalled();
    expect(board.placeArrivals).not.toHaveBeenCalled();
  });

  it('applies only the rules whose matcher fits the finding', async () => {
    const { service, prisma } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValue([
      rule({ id: 'r1', kind: 'FINDING_TYPE', pattern: 'newly_registered' }),
      rule({ id: 'r2', threadId: 'h2', stance: 'CONTRADICTS' }),
    ]);
    prisma.caseFinding.findMany.mockResolvedValue([
      {
        id: 'cf1',
        caseEvidenceId: 'ev1',
        label: 'acute_insolvency_risk',
        matchedContent: 'v',
      },
    ]);
    prisma.caseThreadSupport.createMany.mockResolvedValue({ count: 1 });
    await service.onArrival(CASE, INQUIRY, ['f1']);
    expect(prisma.caseThreadSupport.createMany.mock.calls[0][0].data).toEqual([
      {
        threadId: 'h2',
        targetType: 'finding',
        targetId: 'cf1',
        stance: 'CONTRADICTS',
        ruleId: 'r2',
      },
    ]);
  });

  it('never fails the pull: a thrown error is swallowed', async () => {
    const { service, prisma } = build();
    prisma.caseHypothesisRule.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.onArrival(CASE, INQUIRY, ['f1'])).resolves.toBe(0);
  });

  it('keeps the links when the board cannot lay them out', async () => {
    const { service, prisma, board } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValue([rule()]);
    prisma.caseFinding.findMany.mockResolvedValue([
      { id: 'cf1', caseEvidenceId: 'ev1', label: 'x', matchedContent: 'v' },
    ]);
    prisma.caseThreadSupport.createMany.mockResolvedValue({ count: 1 });
    board.placeArrivals.mockRejectedValue(new Error('board busy'));
    await expect(service.onArrival(CASE, INQUIRY, ['f1'])).resolves.toBe(1);
  });
});

describe('CaseHypothesisRulesService.add', () => {
  it('creates a rule and reports the timeline entry', async () => {
    const { service, prisma, activity } = build();
    await service.add(CASE, {
      inquiryId: 'inq-1',
      threadId: 'h1',
      stance: 'CONTRADICTS',
    });
    expect(
      prisma.caseHypothesisRule.create.mock.calls[0][0].data,
    ).toMatchObject({
      caseId: CASE,
      caseInquiryId: 'ci-1',
      threadId: 'h1',
      stance: 'CONTRADICTS',
      kind: null,
      pattern: null,
    });
    expect(activity.record.mock.calls[0][1]).toBe('HYPOTHESIS_RULE_ADDED');
  });

  it('links what the case already holds when asked', async () => {
    const { service, prisma, matching, board } = build();
    prisma.caseHypothesisRule.create.mockResolvedValue({ id: 'r1' });
    prisma.caseHypothesisRule.findMany
      .mockResolvedValueOnce([]) // same-rule probe
      .mockResolvedValueOnce([rule()]) // rulesOf
      .mockResolvedValue([]); // list()
    matching.getMatchingFindingIds.mockResolvedValue(['f1']);
    prisma.caseFinding.findMany.mockResolvedValue([
      { id: 'cf1', caseEvidenceId: 'ev1', label: 'x', matchedContent: 'v' },
    ]);
    prisma.caseThreadSupport.createMany.mockResolvedValue({ count: 1 });
    const res = await service.add(CASE, {
      inquiryId: 'inq-1',
      threadId: 'h1',
      applyToExisting: true,
    });
    expect(res.linked).toBe(1);
    expect(board.placeArrivals).toHaveBeenCalled();
  });

  it('is idempotent for the same rule', async () => {
    const { service, prisma } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValueOnce([
      { id: 'r1', stance: 'SUPPORTS' },
    ]);
    await service.add(CASE, { inquiryId: 'inq-1', threadId: 'h1' });
    expect(prisma.caseHypothesisRule.create).not.toHaveBeenCalled();
  });

  it('refuses the same answers and hypothesis with another stance', async () => {
    const { service, prisma } = build();
    prisma.caseHypothesisRule.findMany.mockResolvedValueOnce([
      { id: 'r1', stance: 'CONTRADICTS' },
    ]);
    await expect(
      service.add(CASE, {
        inquiryId: 'inq-1',
        threadId: 'h1',
        stance: 'SUPPORTS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a watch that is not linked to the case', async () => {
    const { service, prisma } = build();
    prisma.caseInquiry.findUnique.mockResolvedValue(null);
    await expect(
      service.add(CASE, { inquiryId: 'nope', threadId: 'h1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a thread that is not a hypothesis of the case', async () => {
    const { service, prisma } = build();
    prisma.caseThread.findUnique.mockResolvedValue({
      id: 'd1',
      caseId: CASE,
      kind: 'DISCUSSION',
      title: 'Chat',
    });
    await expect(
      service.add(CASE, { inquiryId: 'inq-1', threadId: 'd1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.caseThread.findUnique.mockResolvedValue({
      id: 'h9',
      caseId: 'other-case',
      kind: 'HYPOTHESIS',
      title: 'Elsewhere',
    });
    await expect(
      service.add(CASE, { inquiryId: 'inq-1', threadId: 'h9' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a half-given or invalid matcher', async () => {
    const { service } = build();
    await expect(
      service.add(CASE, {
        inquiryId: 'inq-1',
        threadId: 'h1',
        kind: 'FINDING_TYPE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.add(CASE, {
        inquiryId: 'inq-1',
        threadId: 'h1',
        kind: 'VALUE_PATTERN',
        pattern: '(',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to change a closed case', async () => {
    const { service, prisma } = build();
    prisma.case.findUnique.mockResolvedValue({ id: CASE, status: 'CLOSED' });
    await expect(
      service.add(CASE, { inquiryId: 'inq-1', threadId: 'h1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CaseHypothesisRulesService.remove', () => {
  const stored = {
    id: 'r1',
    caseId: CASE,
    threadId: 'h1',
    stance: 'SUPPORTS',
    kind: null,
    pattern: null,
    watch: { inquiryId: 'inq-1', inquiry: { title: 'Insolvency' } },
    thread: { title: 'Shell company', status: 'PROPOSED' },
    _count: { links: 4 },
  };

  it('keeps the links it made by default', async () => {
    const { service, prisma, activity } = build();
    prisma.caseHypothesisRule.findUnique.mockResolvedValue(stored);
    const res = await service.remove(CASE, 'r1');
    expect(prisma.caseThreadSupport.deleteMany).not.toHaveBeenCalled();
    expect(prisma.caseHypothesisRule.delete).toHaveBeenCalledWith({
      where: { id: 'r1' },
    });
    expect(res.unlinked).toBe(0);
    expect(activity.record.mock.calls[0][2]).toMatchObject({
      kept: 4,
      unlinked: 0,
    });
  });

  it('takes the links away on request', async () => {
    const { service, prisma } = build();
    prisma.caseHypothesisRule.findUnique.mockResolvedValue(stored);
    prisma.caseThreadSupport.deleteMany.mockResolvedValue({ count: 4 });
    const res = await service.remove(CASE, 'r1', { removeLinks: true });
    expect(prisma.caseThreadSupport.deleteMany).toHaveBeenCalledWith({
      where: { ruleId: 'r1' },
    });
    expect(res.unlinked).toBe(4);
  });

  it('does not touch a rule of another case', async () => {
    const { service, prisma } = build();
    prisma.caseHypothesisRule.findUnique.mockResolvedValue({
      ...stored,
      caseId: 'other',
    });
    await expect(service.remove(CASE, 'r1')).rejects.toThrow(/not found/);
  });
});
