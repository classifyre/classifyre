import { AgentKind } from '@prisma/client';
import { AutopilotService } from './autopilot.service';
import { AUTOPILOT_QUEUE } from './autopilot.constants';
import { CORRELATION_QUEUE } from '../correlation/correlation.constants';
import type { PrismaService } from '../prisma.service';
import type { PgBossService } from '../scheduler/pg-boss.service';
import type { AgentAuditService } from './audit/agent-audit.service';
import type { SystemBriefService } from './harness/system-brief.service';
import type { ToolRegistry } from './tools/tool-registry.service';
import type { AgentConfigService } from './harness/agent-config.service';
import type { McpClientService } from './mcp-client/mcp-client.service';

describe('AutopilotService.trigger — agent selection & chaining', () => {
  const send = jest.fn();
  const mockBoss = { getBossAsync: jest.fn().mockResolvedValue({ send }) };
  const mockPrisma = {
    instanceSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ aiEnabled: true, aiProviderConfigId: 'p1' }),
    },
    source: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }) },
    case: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }) },
  };

  const service = new AutopilotService(
    mockPrisma as unknown as PrismaService,
    mockBoss as unknown as PgBossService,
    {} as AgentAuditService,
    {} as SystemBriefService,
    {} as ToolRegistry,
    {} as AgentConfigService,
    {} as McpClientService,
  );

  beforeEach(() => jest.clearAllMocks());

  const queuesAndPayloads = () =>
    send.mock.calls.map((c) => ({ queue: c[0], payload: c[1] }));

  it('runs the full pipeline (one chained job) when no agentKinds given', async () => {
    await service.trigger({ instruction: 'focus on secrets' });
    const calls = queuesAndPayloads();
    expect(calls).toHaveLength(1);
    expect(calls[0].queue).toBe(AUTOPILOT_QUEUE);
    expect(calls[0].payload.agentKinds).toEqual([
      AgentKind.INQUIRY,
      AgentKind.CASE,
      AgentKind.CONFIG,
      AgentKind.DETECTOR_AUTHOR,
    ]);
    expect(calls[0].payload.instruction).toBe('focus on secrets');
  });

  it('chains a selected subset in one autopilot job', async () => {
    await service.trigger({
      agentKinds: [AgentKind.CONFIG, AgentKind.DETECTOR_AUTHOR],
      sourceId: 's1',
    });
    const calls = queuesAndPayloads();
    expect(calls).toHaveLength(1);
    expect(calls[0].queue).toBe(AUTOPILOT_QUEUE);
    expect(calls[0].payload.agentKinds).toEqual([
      AgentKind.CONFIG,
      AgentKind.DETECTOR_AUTHOR,
    ]);
    expect(calls[0].payload.sourceId).toBe('s1');
  });

  it('enqueues a steerable dream job carrying the instruction', async () => {
    await service.trigger({
      agentKinds: [AgentKind.DREAM],
      instruction: 'drop stale entity maps',
    });
    const calls = queuesAndPayloads();
    expect(calls).toHaveLength(1);
    expect(calls[0].queue).toBe(AUTOPILOT_QUEUE);
    expect(calls[0].payload).toMatchObject({
      dream: true,
      instruction: 'drop stale entity maps',
    });
  });

  it('enqueues a correlation recompute for DUPLICATES', async () => {
    await service.trigger({ agentKinds: [AgentKind.DUPLICATES] });
    const calls = queuesAndPayloads();
    expect(calls).toHaveLength(1);
    expect(calls[0].queue).toBe(CORRELATION_QUEUE);
    expect(calls[0].payload).toMatchObject({ recomputeAll: true });
  });

  it('shares one cycleKey across pipeline + dream + duplicates jobs', async () => {
    const res = await service.trigger({
      agentKinds: [AgentKind.INQUIRY, AgentKind.DREAM, AgentKind.DUPLICATES],
    });
    const calls = queuesAndPayloads();
    expect(calls).toHaveLength(3);
    const autopilotJobs = calls.filter((c) => c.queue === AUTOPILOT_QUEUE);
    for (const job of autopilotJobs) {
      expect(job.payload.cycleKey).toBe(res.cycleKey);
    }
  });

  it('forces [CASE] for a case-focused run and rejects other agents', async () => {
    await service.trigger({ caseId: 'c1', instruction: 'connect edges' });
    const calls = queuesAndPayloads();
    expect(calls[0].payload.agentKinds).toEqual([AgentKind.CASE]);
    expect(calls[0].payload.caseId).toBe('c1');

    await expect(
      service.trigger({ caseId: 'c1', agentKinds: [AgentKind.CONFIG] }),
    ).rejects.toThrow(/case-focused/i);
  });
});
