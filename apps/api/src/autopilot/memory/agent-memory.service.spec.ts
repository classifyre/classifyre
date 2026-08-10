import { AgentMemoryService } from './agent-memory.service';

describe('AgentMemoryService', () => {
  const prisma = {
    $executeRaw: jest.fn(),
    case: { findUnique: jest.fn() },
    inquiry: { findUnique: jest.fn() },
  };
  const service = new AgentMemoryService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not report an agent write when an operator row rejects the conflict', async () => {
    prisma.$executeRaw.mockResolvedValue(0);

    const written = await service.writeMany([
      { kind: 'DECISION_PRECEDENT', key: 'directive', content: 'agent text' },
    ]);

    expect(written).toBe(0);
    const queryText = prisma.$executeRaw.mock.calls[0][0].join(' ');
    expect(queryText).toContain("EXCLUDED.origin = 'OPERATOR'");
    expect(queryText).toContain("agent_memories.origin <> 'OPERATOR'");
  });

  it('synchronizes a live case into verified entity-map memory', async () => {
    prisma.case.findUnique.mockResolvedValue({
      id: 'case-1',
      title: 'Exposure review',
      description: 'Investigate recurring external addresses.',
      status: 'OPEN',
      severity: 'HIGH',
      inquiryLinks: [
        {
          inquiry: {
            id: 'inquiry-1',
            title: 'External mail',
            status: 'ACTIVE',
          },
        },
      ],
    });
    prisma.$executeRaw.mockResolvedValue(1);

    await service.syncEntityMap('case', 'case-1');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const values = prisma.$executeRaw.mock.calls[0].slice(1);
    expect(values).toContain('ENTITY_MAP');
    expect(values).toContain('case:case-1');
    expect(values).toContain('case');
    expect(values).toContain('case-1');
    expect(values).toContain(true);
  });

  it('synchronizes a live inquiry with its linked cases', async () => {
    prisma.inquiry.findUnique.mockResolvedValue({
      id: 'inquiry-1',
      title: 'External mail',
      description: null,
      status: 'ACTIVE',
      matchCount: 4,
      caseLinks: [
        {
          case: {
            id: 'case-1',
            title: 'Exposure review',
            status: 'OPEN',
            severity: 'HIGH',
          },
        },
      ],
    });
    prisma.$executeRaw.mockResolvedValue(1);

    await service.syncEntityMap('inquiry', 'inquiry-1');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const values = prisma.$executeRaw.mock.calls[0].slice(1);
    expect(values).toContain('ENTITY_MAP');
    expect(values).toContain('inquiry:inquiry-1');
    expect(values).toContain('inquiry');
    expect(values).toContain('inquiry-1');
  });
});
