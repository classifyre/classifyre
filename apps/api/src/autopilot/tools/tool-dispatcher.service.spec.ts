import { Test, TestingModule } from '@nestjs/testing';
import { AiManagementMode } from '@prisma/client';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import type { Tool, ToolContext } from './tool.types';

describe('ToolDispatcherService', () => {
  let dispatcher: ToolDispatcherService;

  const mockAudit = { hasDecision: jest.fn(), recordDecision: jest.fn() };
  const mockLog = { technical: jest.fn(), business: jest.fn() };

  const tc = {
    ctx: { run: { id: 'run-1' } },
    audit: mockAudit,
    log: mockLog,
  } as unknown as ToolContext;

  const objSchema = {
    type: 'object',
    properties: { x: { type: 'string' } },
    additionalProperties: false,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolDispatcherService,
        { provide: AgentAuditService, useValue: mockAudit },
        { provide: AgentLoggerService, useValue: mockLog },
      ],
    }).compile();
    dispatcher = module.get(ToolDispatcherService);
    jest.clearAllMocks();
    mockAudit.hasDecision.mockResolvedValue(false);
    mockAudit.recordDecision.mockResolvedValue(true);
  });

  const readTool = (handler = jest.fn()): Tool => ({
    name: 'findings.search',
    description: 'read',
    inputSchema: objSchema,
    sideEffect: 'read',
    handler,
  });

  const mutateTool = (
    overrides: Partial<Tool> = {},
    handler = jest.fn(),
  ): Tool => ({
    name: 'inquiries.create',
    description: 'mutate',
    inputSchema: objSchema,
    sideEffect: 'mutate',
    domain: 'inquiry',
    resolveGate: jest
      .fn()
      .mockResolvedValue({ mode: AiManagementMode.MANAGED }),
    handler,
    ...overrides,
  });

  // G-032. A read used to report APPLIED — the same outcome as a real
  // mutation — so run summaries said "11 applied" for runs that persisted zero
  // decisions and changed nothing.
  it('runs read tools without recording a decision, and reports READ_OK not APPLIED', async () => {
    const handler = jest.fn().mockResolvedValue([{ a: 1 }]);
    const res = await dispatcher.dispatch(tc, readTool(handler), {}, 'k', 'r');
    expect(res.outcome).toBe('READ_OK');
    expect(handler).toHaveBeenCalled();
    expect(mockAudit.recordDecision).not.toHaveBeenCalled();
  });

  it('applies a MANAGED mutating tool and records APPLIED', async () => {
    const handler = jest.fn().mockResolvedValue({ id: 'q1', title: 'X' });
    const res = await dispatcher.dispatch(
      tc,
      mutateTool({}, handler),
      { x: 'ok' },
      'k1',
      'because',
    );
    expect(res.outcome).toBe('APPLIED');
    expect(handler).toHaveBeenCalled();
    expect(mockAudit.recordDecision).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ outcome: 'APPLIED', entityId: 'q1' }),
    );
  });

  it('skips a mutating tool when the gate is OBSERVE_ONLY', async () => {
    const handler = jest.fn();
    const tool = mutateTool({
      resolveGate: jest
        .fn()
        .mockResolvedValue({ mode: AiManagementMode.OBSERVE_ONLY }),
    });
    const res = await dispatcher.dispatch(tc, tool, {}, 'k2', 'r');
    expect(res.outcome).toBe('SKIPPED_OBSERVE_ONLY');
    expect(handler).not.toHaveBeenCalled();
    expect(mockAudit.recordDecision).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ outcome: 'SKIPPED_OBSERVE_ONLY' }),
    );
  });

  it('fails closed: a mutating tool without a gate is treated as observe-only', async () => {
    const handler = jest.fn();
    const tool = mutateTool({ resolveGate: undefined }, handler);
    const res = await dispatcher.dispatch(tc, tool, {}, 'k3', 'r');
    expect(res.outcome).toBe('SKIPPED_OBSERVE_ONLY');
    expect(handler).not.toHaveBeenCalled();
  });

  it('dedupes a mutating call already recorded this run', async () => {
    mockAudit.hasDecision.mockResolvedValue(true);
    const handler = jest.fn();
    const res = await dispatcher.dispatch(
      tc,
      mutateTool({}, handler),
      {},
      'k4',
      'r',
    );
    expect(res.outcome).toBe('DEDUPED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('records FAILED when handler throws', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await dispatcher.dispatch(
      tc,
      mutateTool({}, handler),
      {},
      'k5',
      'r',
    );
    expect(res.outcome).toBe('FAILED');
    expect(mockAudit.recordDecision).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ outcome: 'FAILED' }),
    );
  });
});
