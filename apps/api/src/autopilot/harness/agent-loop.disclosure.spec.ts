import { runAgentLoop } from './agent-loop';
import type { Mission } from './missions';
import { AgentKind } from '@prisma/client';

/**
 * Authority and disclosure are different axes.
 *
 * An agent whose job is choosing tools is the one that can least afford to
 * carry every schema: the full registry renders to roughly 200 tools, and a
 * catalog that large costs more prompt than the goals, journal and corpus it is
 * supposed to reason about — while measurably worsening the choice itself.
 *
 * So the loop takes two lists. `allowedTools` is what gets described in the
 * system prompt; `grantedTools` is what may actually be called. Existing
 * missions pass one list and get the old behaviour, because for them the two
 * sets are identical.
 *
 * These tests pin the split, because the failure mode is silent in both
 * directions: describe too much and it merely costs money, describe too little
 * without granting the wider set and the agent is refused tools it was told to
 * use.
 */
describe('agent loop tool disclosure vs authority', () => {
  const mission: Mission = {
    kind: AgentKind.CONFIG,
    goal: 'test',
    allowedTools: [],
    maxIterations: 4,
  };

  const readTool = (name: string) => ({
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    sideEffect: 'read' as const,
    handler: jest.fn().mockResolvedValue({ ok: true }),
  });

  /**
   * One turn that calls `tool`, then a turn that finishes. Two turns rather
   * than one so the observation from the call is actually rendered.
   */
  const callsThenFinishes = (tool: string) => {
    let turn = 0;
    return () => {
      turn += 1;
      return Promise.resolve({
        content:
          turn === 1
            ? {
                thought: 'calling',
                toolCalls: [{ tool, input: {}, rationale: 'because' }],
              }
            : { thought: 'done', toolCalls: [], finish: { summary: 'done' } },
        raw: '{}',
        usage: undefined,
      });
    };
  };

  const deps = (complete: () => Promise<unknown>, tools: string[]) => {
    const registry = {
      catalog: jest.fn((names?: string[]) => (names ?? []).join(',')),
      get: jest.fn((name: string) =>
        tools.includes(name) ? readTool(name) : undefined,
      ),
    };
    return {
      ai: { completeJson: complete },
      registry,
      dispatcher: {
        dispatch: jest.fn().mockImplementation((_tc, tool) =>
          Promise.resolve({
            tool: tool.name,
            outcome: 'READ_OK',
            result: { ok: true },
          }),
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
      run: { id: 'run-1', agentKind: AgentKind.CONFIG, stepState: {} },
      settings: {},
      sourceId: null,
      sourceName: 'all sources',
      runnerId: null,
      manual: false,
      instruction: null,
      state: {},
    }) as never;

  afterEach(() => jest.restoreAllMocks());

  it('dispatches a granted tool that was never disclosed in the catalog', async () => {
    const d = deps(callsThenFinishes('findings.search'), ['findings.search']);

    await runAgentLoop(ctx(), mission, d as never, {
      allowedTools: ['tools.search'],
      grantedTools: ['tools.search', 'findings.search'],
    });

    expect(d.dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(d.dispatcher.dispatch.mock.calls[0][1].name).toBe('findings.search');
    // Disclosure is the narrow list: the catalog never saw the tool it called.
    expect(d.registry.catalog).toHaveBeenCalledWith(['tools.search']);
  });

  it('refuses a tool that is in neither list', async () => {
    const d = deps(callsThenFinishes('detector.delete'), ['detector.delete']);

    await runAgentLoop(ctx(), mission, d as never, {
      allowedTools: ['tools.search'],
      grantedTools: ['tools.search', 'findings.search'],
    });

    expect(d.dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('defaults granted to allowed, leaving existing missions unchanged', async () => {
    const d = deps(callsThenFinishes('findings.search'), ['findings.search']);

    await runAgentLoop(ctx(), mission, d as never, {
      allowedTools: ['findings.search'],
    });

    expect(d.dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(d.registry.catalog).toHaveBeenCalledWith(['findings.search']);
  });
});
