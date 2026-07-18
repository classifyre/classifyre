import { AutopilotService } from './autopilot.service';

describe('AutopilotService operator memory provenance', () => {
  const row = {
    id: 'memory-1',
    kind: 'DECISION_PRECEDENT',
    key: 'directive',
    content: 'operator text',
    tags: [],
    refType: null,
    refId: null,
    weight: 1,
    origin: 'OPERATOR',
    verifiedAt: new Date(),
    verifiedBy: 'operator',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    agentMemory: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new AutopilotService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.agentMemory.upsert.mockResolvedValue(row);
    prisma.agentMemory.findUnique.mockResolvedValue(row);
    prisma.agentMemory.update.mockResolvedValue(row);
  });

  it('marks operator-created memories authoritative and verified', async () => {
    await service.createMemory({
      kind: 'DECISION_PRECEDENT',
      key: 'Directive',
      content: 'operator text',
    } as never);

    expect(prisma.agentMemory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          origin: 'OPERATOR',
          verifiedAt: expect.any(Date),
          verifiedBy: 'operator',
        }),
        update: expect.objectContaining({ origin: 'OPERATOR' }),
      }),
    );
  });

  it('promotes operator-edited memories to authoritative and verified', async () => {
    await service.updateMemory('memory-1', { content: 'corrected' });

    expect(prisma.agentMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          origin: 'OPERATOR',
          verifiedAt: expect.any(Date),
          verifiedBy: 'operator',
        }),
      }),
    );
  });
});
