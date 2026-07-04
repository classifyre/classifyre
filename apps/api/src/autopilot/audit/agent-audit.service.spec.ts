import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { AgentLoggerService } from './agent-logger.service';
import { AgentAuditService } from './agent-audit.service';

describe('AgentAuditService.saveUsage', () => {
  let service: AgentAuditService;

  const prisma = {
    instanceSettings: { findUnique: jest.fn() },
    agentRun: { findUnique: jest.fn(), update: jest.fn() },
  };
  const log = { business: jest.fn(), technical: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentAuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentLoggerService, useValue: log },
      ],
    }).compile();

    service = module.get(AgentAuditService);
    jest.clearAllMocks();
  });

  function mockRun(
    inputTokens: number,
    outputTokens: number,
    costUsd: string | null,
  ) {
    prisma.agentRun.findUnique.mockResolvedValue({
      inputTokens,
      outputTokens,
      costUsd,
    });
  }

  function mockPricing(
    inputCostPerMTok: number | null,
    outputCostPerMTok: number | null,
  ) {
    prisma.instanceSettings.findUnique.mockResolvedValue({
      aiProviderConfig: { inputCostPerMTok, outputCostPerMTok },
    });
  }

  it('stores absolute token totals and prices the full amount on first save', async () => {
    mockRun(0, 0, null);
    mockPricing(3, 15);

    await service.saveUsage('run-1', 1_000_000, 200_000);

    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        // 1M in × $3/MTok + 0.2M out × $15/MTok = $6
        costUsd: '6.000000',
      },
    });
  });

  it('prices only the newly added tokens, never re-pricing history', async () => {
    // 1M input already recorded and priced at an OLD rate ($1/MTok → $1).
    mockRun(1_000_000, 0, '1.000000');
    // Price has since been raised to $3/MTok.
    mockPricing(3, null);

    await service.saveUsage('run-1', 2_000_000, 0);

    // Only the added 1M tokens are priced at the new rate: $1 + $3 = $4,
    // NOT 2M × $3 = $6.
    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ costUsd: '4.000000' }),
    });
  });

  it('leaves cost null when no pricing is configured', async () => {
    mockRun(0, 0, null);
    mockPricing(null, null);

    await service.saveUsage('run-1', 500_000, 100_000);

    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        inputTokens: 500_000,
        outputTokens: 100_000,
        costUsd: null,
      },
    });
  });

  it('treats a single configured price as the only billed dimension', async () => {
    mockRun(0, 0, null);
    mockPricing(null, 10);

    await service.saveUsage('run-1', 1_000_000, 500_000);

    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ costUsd: '5.000000' }),
    });
  });

  it('preserves a previously stored cost when pricing was later removed', async () => {
    mockRun(1_000_000, 0, '3.000000');
    mockPricing(null, null);

    await service.saveUsage('run-1', 2_000_000, 0);

    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ costUsd: '3.000000' }),
    });
  });

  it('is a no-op when the run row no longer exists', async () => {
    prisma.agentRun.findUnique.mockResolvedValue(null);
    mockPricing(3, 15);

    await service.saveUsage('gone', 100, 100);

    expect(prisma.agentRun.update).not.toHaveBeenCalled();
  });

  it('never decreases totals when a resumed attempt replays smaller values', async () => {
    mockRun(1_000_000, 200_000, '6.000000');
    mockPricing(3, 15);

    // A redelivered attempt re-sends the same absolute totals — no delta.
    await service.saveUsage('run-1', 1_000_000, 200_000);

    expect(prisma.agentRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        costUsd: '6.000000',
      },
    });
  });
});
