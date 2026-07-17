import { AgentMemoryService } from './agent-memory.service';

describe('AgentMemoryService', () => {
  const prisma = {
    $executeRaw: jest.fn(),
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
});
