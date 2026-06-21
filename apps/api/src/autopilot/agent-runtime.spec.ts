import { runPipeline, stepOutput } from './agent-runtime';
import type { AgentAuditService } from './audit/agent-audit.service';
import type { AgentContext, AgentStep } from './autopilot.types';

function makeCtx(
  stepState: Record<string, unknown> | null = null,
): AgentContext {
  return {
    run: { id: 'run-1', stepState } as never,
    settings: {} as never,
    sourceId: 's1',
    sourceName: 'Source',
    runnerId: 'r1',
    manual: false,
    instruction: null,
    state: {},
  };
}

describe('agent-runtime', () => {
  const saveStep = jest.fn();
  const isCancelled = jest.fn().mockResolvedValue(false);
  const audit = { saveStep, isCancelled } as unknown as AgentAuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    isCancelled.mockResolvedValue(false);
  });

  it('runs steps in order and persists each output', async () => {
    const ctx = makeCtx();
    const steps: AgentStep[] = [
      { name: 'a', execute: jest.fn().mockResolvedValue({ x: 1 }) },
      {
        name: 'b',
        execute: jest.fn((c) =>
          Promise.resolve({ y: stepOutput<{ x: number }>(c, 'a').x + 1 }),
        ),
      },
    ];
    await runPipeline(ctx, steps, audit);
    expect(stepOutput(ctx, 'b')).toEqual({ y: 2 });
    expect(saveStep).toHaveBeenCalledTimes(2);
  });

  it('resumes from persisted stepState without re-running completed steps', async () => {
    const llmStep = jest.fn().mockResolvedValue({ decisions: [] });
    const ctx = makeCtx({
      gather: { groups: [] },
      decide: { decisions: ['cached'] },
    });
    const apply = jest.fn((c: AgentContext) =>
      Promise.resolve(stepOutput(c, 'decide')),
    );
    await runPipeline(
      ctx,
      [
        { name: 'gather', execute: jest.fn() },
        { name: 'decide', execute: llmStep },
        { name: 'apply', execute: apply },
      ],
      audit,
    );
    // The expensive LLM step must NOT be re-executed on resume.
    expect(llmStep).not.toHaveBeenCalled();
    expect(stepOutput(ctx, 'apply')).toEqual({ decisions: ['cached'] });
  });

  it('stepOutput throws on missing step (ordering bug guard)', () => {
    expect(() => stepOutput(makeCtx(), 'nope')).toThrow(/missing/);
  });
});
