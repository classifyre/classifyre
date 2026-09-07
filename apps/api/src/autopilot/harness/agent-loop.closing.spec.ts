import { runAgentLoop } from './agent-loop';
import type { Mission } from './missions';
import { AgentKind } from '@prisma/client';

/**
 * A supervisor wake that does not write its journal has no memory, and one that
 * does not schedule the next wake has no future.
 *
 * Both failures are silent in the worst way: the run completes, its summary
 * reads perfectly well, and the agent simply never runs again. Nothing errors,
 * nothing warns. This system has produced that exact shape of failure before —
 * an agent that used to do things, quietly stopping — from four compounding
 * causes at once, and it took a fortnight to notice.
 *
 * So the contract is enforced in code rather than asked for in prose. Once,
 * because a model that ignores the reminder will not be talked round by a
 * second one, and spending a bounded iteration budget asking would turn a
 * missing journal entry into a run that achieves nothing.
 */
describe('agent loop closing contract', () => {
  const mission: Mission = {
    kind: AgentKind.SUPERVISOR,
    goal: 'test',
    allowedTools: [
      'journal.write',
      'supervisor.schedule_wake',
      'findings.ranked',
    ],
    maxIterations: 6,
    requiredBeforeFinish: ['journal.write', 'supervisor.schedule_wake'],
  };

  const tool = (name: string) => ({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    sideEffect: 'mutate' as const,
    handler: jest.fn().mockResolvedValue({ ok: true }),
  });

  const deps = (turns: Array<Record<string, unknown>>) => {
    let i = 0;
    return {
      ai: {
        completeJson: () =>
          Promise.resolve({
            content: turns[Math.min(i++, turns.length - 1)],
            raw: '{}',
            usage: undefined,
          }),
      },
      registry: { catalog: () => '', get: (n: string) => tool(n) },
      dispatcher: {
        dispatch: jest
          .fn()
          .mockImplementation((_tc, t) =>
            Promise.resolve({ tool: t.name, outcome: 'APPLIED', result: {} }),
          ),
      },
      audit: {
        isCancelled: jest.fn().mockResolvedValue(false),
        saveStep: jest.fn(),
        saveUsage: jest.fn(),
      },
      log: { business: jest.fn(), error: jest.fn(), technical: jest.fn() },
    };
  };

  const ctx = () =>
    ({
      run: { id: 'run-1', agentKind: AgentKind.SUPERVISOR, stepState: {} },
      settings: {},
      sourceId: null,
      sourceName: 'all sources',
      runnerId: null,
      manual: false,
      instruction: null,
      state: {},
    }) as never;

  const finish = {
    thought: 'done',
    toolCalls: [],
    finish: { summary: 'done' },
  };
  const call = (tool: string) => ({
    thought: 'working',
    toolCalls: [{ tool, input: {}, rationale: 'r' }],
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses a finish that skipped the journal and the next wake', async () => {
    const d = deps([
      finish,
      call('journal.write'),
      call('supervisor.schedule_wake'),
      finish,
    ]);

    const result = await runAgentLoop(ctx(), mission, d as never, {});

    const called = d.dispatcher.dispatch.mock.calls.map((c) => c[1].name);
    expect(called).toEqual(['journal.write', 'supervisor.schedule_wake']);
    expect(result.summary.finishSummary).toBe('done');
  });

  it('names only what is still owed', async () => {
    const d = deps([
      call('journal.write'),
      finish,
      call('supervisor.schedule_wake'),
      finish,
    ]);

    await runAgentLoop(ctx(), mission, d as never, {});

    // journal.write was already satisfied, so the reminder must ask only for
    // the wake — and the run must not redo the call it had already made.
    const called = d.dispatcher.dispatch.mock.calls.map((c) => c[1].name);
    expect(called).toEqual(['journal.write', 'supervisor.schedule_wake']);
  });

  it('nudges once, then lets the run end rather than burning the budget', async () => {
    // A model that ignores the reminder entirely.
    const d = deps([finish]);

    const result = await runAgentLoop(ctx(), mission, d as never, {});

    expect(d.dispatcher.dispatch).not.toHaveBeenCalled();
    expect(result.summary.finishSummary).toBe('done');
  });

  it('leaves missions without a closing contract alone', async () => {
    const plain: Mission = { ...mission, requiredBeforeFinish: undefined };
    const d = deps([finish]);

    const result = await runAgentLoop(ctx(), plain, d as never, {});

    expect(result.summary.finishSummary).toBe('done');
    expect(d.dispatcher.dispatch).not.toHaveBeenCalled();
  });
});
