import { Test, TestingModule } from '@nestjs/testing';
import { AiManagementMode } from '@prisma/client';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { AgentAuditService } from '../audit/agent-audit.service';
import { AgentLoggerService } from '../audit/agent-logger.service';
import type { Tool, ToolContext } from './tool.types';

describe('ToolDispatcherService', () => {
  let dispatcher: ToolDispatcherService;

  const mockAudit = {
    hasDecision: jest.fn(),
    countFailedCalls: jest.fn().mockResolvedValue(0),
    recordDecision: jest.fn(),
  };
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
    mockAudit.countFailedCalls.mockResolvedValue(0);
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

  /**
   * An agent that reads "not found" tends to try another plausible id rather
   * than stop. One live run sent the same malformed threadId four times, each
   * attempt spending an iteration of a bounded budget.
   */
  describe('repeated identical failures', () => {
    it('refuses a call that has already failed identically twice', async () => {
      mockAudit.countFailedCalls.mockResolvedValue(2);
      const handler = jest.fn();

      const res = await dispatcher.dispatch(
        tc,
        mutateTool({}, handler),
        { threadId: 'bad' },
        'k-repeat',
        'r',
      );

      expect(res.outcome).toBe('FAILED');
      expect(handler).not.toHaveBeenCalled();
      const { error } = res.result as { error: string };
      expect(error).toMatch(/already failed 2 times/);
      expect(error).toMatch(/composed rather than/);
    });

    it('still runs a call that has failed once', async () => {
      mockAudit.countFailedCalls.mockResolvedValue(1);
      const handler = jest.fn().mockResolvedValue({ ok: true });

      const res = await dispatcher.dispatch(
        tc,
        mutateTool({}, handler),
        {},
        'k-retry',
        'r',
      );

      expect(res.outcome).toBe('APPLIED');
      expect(handler).toHaveBeenCalled();
    });

    // The count is per (tool, input): a different input is a different call,
    // however many times its sibling has failed. Computed on the NORMALIZED
    // input, so two calls differing only in a field the schema strips are
    // correctly the same call.
    it('fingerprints the tool and its input together', async () => {
      mockAudit.countFailedCalls.mockResolvedValue(0);
      const send = (x: string, key: string) =>
        dispatcher.dispatch(
          tc,
          mutateTool({}, jest.fn().mockResolvedValue({})),
          { x },
          key,
          'r',
        );
      await send('one', 'k-a');
      await send('two', 'k-b');
      await send('one', 'k-c');

      const prints = mockAudit.countFailedCalls.mock.calls.map(
        (call) => call[1],
      );
      expect(prints[0]).not.toBe(prints[1]);
      expect(prints[2]).toBe(prints[0]);
    });

    it('records the fingerprint on failure so the next attempt can count it', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('boom'));

      await dispatcher.dispatch(tc, mutateTool({}, handler), {}, 'k-fp', 'r');

      expect(mockAudit.recordDecision).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          outcome: 'FAILED',
          payload: expect.objectContaining({
            _callFingerprint: expect.any(String),
          }),
        }),
      );
    });
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
