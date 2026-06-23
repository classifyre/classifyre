import { AgentKind } from '@prisma/client';
import { AgentConfigService } from './agent-config.service';
import { missionFor } from './missions';
import type { PrismaService } from '../../prisma.service';
import type { ToolRegistry } from '../tools/tool-registry.service';

describe('AgentConfigService', () => {
  const agentConfig = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  };
  const instanceSettings = {
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { agentConfig, instanceSettings } as unknown as PrismaService;
  // Registry stub: only these built-in names are "known".
  const known = new Set(['findings.search', 'memory.write']);
  const registry = {
    get: jest.fn((name: string) => (known.has(name) ? {} : undefined)),
  } as unknown as ToolRegistry;

  const service = new AgentConfigService(prisma, registry);

  beforeEach(() => {
    jest.clearAllMocks();
    instanceSettings.findUnique.mockResolvedValue({
      autopilotInquiryEnabled: true,
      autopilotCaseEnabled: false,
      autopilotConfigEnabled: false,
      autopilotDetectorEnabled: false,
    });
  });

  it('resolves the factory mission when no override row exists', async () => {
    agentConfig.findUnique.mockResolvedValue(null);
    const resolved = await service.resolveMission(AgentKind.INQUIRY);
    expect(resolved).toEqual(missionFor(AgentKind.INQUIRY));
  });

  it('merges an override row over the factory default', async () => {
    agentConfig.findUnique.mockResolvedValue({
      kind: AgentKind.INQUIRY,
      goal: 'custom goal',
      maxIterations: 7,
      toolNames: ['findings.search'],
      toolsOverride: true,
    });
    const resolved = await service.resolveMission(AgentKind.INQUIRY);
    expect(resolved).toMatchObject({
      kind: AgentKind.INQUIRY,
      goal: 'custom goal',
      maxIterations: 7,
      allowedTools: ['findings.search'],
    });
  });

  it('keeps factory tools when toolsOverride is false', async () => {
    agentConfig.findUnique.mockResolvedValue({
      kind: AgentKind.INQUIRY,
      goal: null,
      maxIterations: null,
      toolNames: ['findings.search'],
      toolsOverride: false,
    });
    const resolved = await service.resolveMission(AgentKind.INQUIRY);
    expect(resolved?.allowedTools).toEqual(
      missionFor(AgentKind.INQUIRY)?.allowedTools,
    );
  });

  it('lists all factory agents with the enable flag from settings', async () => {
    agentConfig.findMany.mockResolvedValue([]);
    const list = await service.list();
    expect(list.map((a) => a.kind)).toEqual([
      AgentKind.INQUIRY,
      AgentKind.CASE,
      AgentKind.CONFIG,
      AgentKind.DETECTOR_AUTHOR,
      AgentKind.DREAM,
    ]);
    const inquiry = list.find((a) => a.kind === AgentKind.INQUIRY)!;
    expect(inquiry.enabled).toBe(true);
    expect(inquiry.enableable).toBe(true);
    expect(inquiry.customized).toBe(false);
    const dream = list.find((a) => a.kind === AgentKind.DREAM)!;
    expect(dream.enableable).toBe(false);
    expect(dream.enabled).toBe(true);
  });

  it('writes the enable flag to the matching settings column', async () => {
    agentConfig.findMany.mockResolvedValue([]);
    await service.update(AgentKind.CASE, { enabled: true });
    expect(instanceSettings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { autopilotCaseEnabled: true },
    });
  });

  it('refuses to toggle DREAM (no enable flag)', async () => {
    await expect(
      service.update(AgentKind.DREAM, { enabled: false }),
    ).rejects.toThrow(/cannot be enabled/i);
  });

  it('rejects MCP tool names in an assignment', async () => {
    await expect(
      service.update(AgentKind.INQUIRY, { toolNames: ['mcp.foo.bar'] }),
    ).rejects.toThrow(/MCP tool/i);
  });

  it('rejects unknown tool names', async () => {
    await expect(
      service.update(AgentKind.INQUIRY, { toolNames: ['does.not.exist'] }),
    ).rejects.toThrow(/Unknown tool/i);
  });

  it('persists a validated, de-duplicated tool assignment as an override', async () => {
    agentConfig.findMany.mockResolvedValue([]);
    await service.update(AgentKind.INQUIRY, {
      toolNames: ['findings.search', 'findings.search', 'memory.write'],
    });
    expect(agentConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: AgentKind.INQUIRY },
        update: expect.objectContaining({
          toolNames: ['findings.search', 'memory.write'],
          toolsOverride: true,
        }),
      }),
    );
  });

  it('resets to the factory toolset when toolNames is null', async () => {
    agentConfig.findMany.mockResolvedValue([]);
    await service.update(AgentKind.INQUIRY, { toolNames: null });
    expect(agentConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          toolNames: [],
          toolsOverride: false,
        }),
      }),
    );
  });
});
