import { runAgentLoop } from './agent-loop';
import { AGENT_RUN_BUDGET_MS } from '../autopilot.constants';
import type { Mission } from './missions';
import { AgentKind } from '@prisma/client';

/**
 * A run must be bounded in WALL-CLOCK time, not just in iterations.
 *
 * The iteration budget bounds how many times the model may think; it does not
 * bound how long one of those turns takes. A provider that accepts the
 * connection and then never answers makes a single turn unbounded, and the
 * handler running the loop holds one of the instance's global job slots — so
 * an unbounded run does not fail alone, it freezes every queue in every
 * namespace behind it.
 *
 * Observed on a desktop instance: a CONFIG run sat in `reason-act` for nine and
 * a half hours against an unresponsive local model. Its last log line was a
 * single indexed read. Meanwhile auto-schedule ticks piled up 91 deep and
 * failed at their 900s handler timeout, a scan hand-off sat `active` for over
 * an hour so the autopilot was never triggered, and four namespaces did
 * nothing at all. Restarting the app was the only way out.
 */
describe('agent loop wall-clock budget', () => {
  const mission: Mission = {
    kind: AgentKind.CONFIG,
    goal: 'test',
    allowedTools: [],
    maxIterations: 14,
  };

  const deps = (complete: () => Promise<unknown>) => ({
    ai: { completeJson: complete },
    registry: { catalog: () => '', get: () => undefined },
    dispatcher: { dispatch: jest.fn() },
    audit: {
      isCancelled: jest.fn().mockResolvedValue(false),
      saveStep: jest.fn(),
      saveUsage: jest.fn(),
    },
    log: { business: jest.fn(), error: jest.fn() },
  });

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

  /** A turn that always asks for another turn, so only time can stop it. */
  const neverFinishes = () =>
    Promise.resolve({
      content: { thought: 'thinking', toolCalls: [] as unknown[] },
      raw: '{}',
      usage: undefined,
    });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stops once the wall-clock budget is spent, before the iteration budget', async () => {
    // Every turn is slow enough that the time budget bites first.
    const perTurnMs = AGENT_RUN_BUDGET_MS / 3;
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    let calls = 0;
    const d = deps(() => {
      calls += 1;
      now += perTurnMs;
      // A turn with tool calls keeps the loop going.
      return Promise.resolve({
        content: {
          thought: 'working',
          toolCalls: [{ tool: 'unknown.tool', input: {}, rationale: 'r' }],
        },
        raw: '{}',
        usage: undefined,
      });
    });

    const result = await runAgentLoop(ctx(), mission, d as never);

    // Time ran out well before the 14-iteration budget.
    expect(calls).toBeLessThan(mission.maxIterations);
    expect(result.narrative).toMatch(/not responding/i);
  });

  it('says the run was cut off for time, not that nothing was warranted', async () => {
    const perTurnMs = AGENT_RUN_BUDGET_MS;
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    const d = deps(() => {
      now += perTurnMs;
      return Promise.resolve({
        content: {
          thought: 'working',
          toolCalls: [{ tool: 'unknown.tool', input: {}, rationale: 'r' }],
        },
        raw: '{}',
        usage: undefined,
      });
    });

    const result = await runAgentLoop(ctx(), mission, d as never);

    expect(result.narrative).not.toMatch(/iteration budget/i);
    expect(result.summary.finishedDeliberately).toBe(false);
  });

  it('leaves a run that finishes in time completely untouched', async () => {
    const d = deps(() =>
      Promise.resolve({
        content: { thought: 'done', finish: { summary: 'all good' } },
        raw: '{}',
        usage: undefined,
      }),
    );

    const result = await runAgentLoop(ctx(), mission, d as never);

    expect(result.narrative).toBe('all good');
    expect(result.summary.finishedDeliberately).toBe(true);
  });

  it('still honours the iteration budget when turns are fast', async () => {
    const d = deps(neverFinishes);

    const result = await runAgentLoop(ctx(), mission, d as never);

    // No tool calls and no finish ends the loop immediately — the point here is
    // that a fast run is never blamed on the clock.
    expect(result.narrative).not.toMatch(/not responding/i);
  });
});
