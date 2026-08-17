import { AgentKind } from '@prisma/client';
import { AutopilotWorker } from './autopilot.worker';
import {
  AUTOPILOT_CYCLE_BUDGET_MS,
  DETECTION_CHAIN,
  INVESTIGATION_CHAIN,
} from './autopilot.constants';

/**
 * Cycle throughput.
 *
 * All five agents ran in one series, each starting the instant the previous
 * finished. Measured on a live instance mid-ingestion: cycle 1 took 29 minutes,
 * cycle 2 took 69 — of which a DETECTOR_AUTHOR run spent 18 minutes before
 * failing on malformed JSON, with ESCALATION queued behind it the whole time.
 * Scans completed every two minutes throughout, so the harness managed roughly
 * one investigation cycle per thirty scans and INQUIRY got two turns in an hour
 * and three quarters.
 *
 * The ordering that mattered is kept; the ordering that did not is now
 * concurrent, and nothing may run past the cycle deadline.
 */
describe('AutopilotWorker cycle chains', () => {
  const settings = {} as never;
  const cycle = {
    sourceId: 's1',
    runnerId: null,
    cycleKey: 'k',
    trigger: 'scan',
    manual: false,
    instruction: null,
  };

  /** The private surface these tests drive. */
  interface WorkerInternals {
    agentEnabled: (kind: AgentKind, cycle: unknown) => Promise<boolean>;
    runAgent: (kind: AgentKind) => Promise<void>;
    runChain: (
      chain: readonly AgentKind[],
      settings: unknown,
      cycle: unknown,
      sourceName: string,
      scope: unknown,
      deadline: number,
      signals: unknown,
      deferred: Set<AgentKind>,
    ) => Promise<void>;
  }

  let started: AgentKind[];
  let recordSkippedRun: jest.Mock;
  let worker: WorkerInternals;

  /** Every agent enabled; each run takes `durationMs` of virtual clock. */
  const build = (durationMs = 0, enabledKinds?: AgentKind[]) => {
    started = [];
    recordSkippedRun = jest.fn().mockResolvedValue(undefined);
    worker = new AutopilotWorker(
      {} as never,
      {} as never,
      { recordSkippedRun } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        resolvePolicy: jest.fn().mockResolvedValue({
          triggerMode: 'BATCH',
          waitForMatching: false,
          waitForEvidence: false,
          waitForScans: false,
          minIntervalMinutes: 0,
          maxStalenessHours: 0,
        }),
        lastTriggeredAt: jest.fn().mockResolvedValue(null),
        markTriggered: jest.fn().mockResolvedValue(undefined),
        runBudgetMinutes: jest.fn().mockResolvedValue(null),
      } as never,
    ) as unknown as WorkerInternals;
    jest
      .spyOn(worker, 'agentEnabled')
      .mockImplementation((kind) =>
        Promise.resolve(enabledKinds ? enabledKinds.includes(kind) : true),
      );
    jest.spyOn(worker, 'runAgent').mockImplementation((kind) => {
      started.push(kind);
      if (durationMs) jest.advanceTimersByTime(durationMs);
      return Promise.resolve();
    });
  };

  /** Signals with every gate open: this suite is about ordering and budgets. */
  const OPEN_SIGNALS = {
    matchingBusy: false,
    scansActive: false,
    coverage: { open: 0, analyzed: 0 },
    evidence: { usableFindings: 2000, usableCoverage: 0.25 },
  };

  const runChains = (deadline: number, on = cycle) => {
    const deferred = new Set<AgentKind>();
    return Promise.all([
      worker.runChain(
        INVESTIGATION_CHAIN,
        settings,
        on,
        'src',
        {},
        deadline,
        OPEN_SIGNALS,
        deferred,
      ),
      worker.runChain(
        DETECTION_CHAIN,
        settings,
        on,
        'src',
        {},
        deadline,
        OPEN_SIGNALS,
        deferred,
      ),
    ]);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('covers every pipeline agent exactly once across the two chains', () => {
    const all = [...INVESTIGATION_CHAIN, ...DETECTION_CHAIN];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(
      new Set([
        AgentKind.INQUIRY,
        AgentKind.CASE,
        AgentKind.CONFIG,
        AgentKind.DETECTOR_AUTHOR,
        AgentKind.ESCALATION,
      ]),
    );
  });

  // The dependencies that are real: CASE consumes what INQUIRY produced,
  // ESCALATION alerts on the cases CASE mutated, DETECTOR_AUTHOR reacts to
  // what CONFIG left (and shares its optimistic-concurrency token).
  it('keeps the load-bearing order inside each chain', () => {
    expect(INVESTIGATION_CHAIN).toEqual([
      AgentKind.INQUIRY,
      AgentKind.CASE,
      AgentKind.ESCALATION,
    ]);
    expect(DETECTION_CHAIN).toEqual([
      AgentKind.CONFIG,
      AgentKind.DETECTOR_AUTHOR,
    ]);
  });

  it('runs both chains, in chain order', async () => {
    build();
    await runChains(Date.now() + AUTOPILOT_CYCLE_BUDGET_MS);

    expect(started).toHaveLength(5);
    expect(started.indexOf(AgentKind.INQUIRY)).toBeLessThan(
      started.indexOf(AgentKind.CASE),
    );
    expect(started.indexOf(AgentKind.CASE)).toBeLessThan(
      started.indexOf(AgentKind.ESCALATION),
    );
    expect(started.indexOf(AgentKind.CONFIG)).toBeLessThan(
      started.indexOf(AgentKind.DETECTOR_AUTHOR),
    );
  });

  // The actual throughput win: the detection chain no longer waits behind the
  // whole investigation chain. Both chains get their first agent under way
  // before either has finished — a DETECTOR_AUTHOR run burning 18 minutes can
  // no longer delay INQUIRY by 18 minutes.
  it('starts both chains without waiting for either to finish', async () => {
    build();
    started = [];
    jest.spyOn(worker, 'runAgent').mockImplementation((kind) => {
      started.push(kind);
      // Yield so the sibling chain can make progress while this one is busy.
      return Promise.resolve();
    });

    await runChains(Date.now() + AUTOPILOT_CYCLE_BUDGET_MS);

    // The heads of both chains ran before either chain's second agent.
    expect(started.slice(0, 2)).toEqual(
      expect.arrayContaining([AgentKind.INQUIRY, AgentKind.CONFIG]),
    );
  });

  // The budget is shared across the cycle, not per chain: once the wall clock
  // is gone it is gone for everything still queued.
  it('stops every chain at the shared deadline', async () => {
    build();
    started = [];
    jest.spyOn(worker, 'runAgent').mockImplementation((kind) => {
      started.push(kind);
      if (kind === AgentKind.CONFIG) {
        jest.advanceTimersByTime(AUTOPILOT_CYCLE_BUDGET_MS + 1);
      }
      return Promise.resolve();
    });

    await runChains(Date.now() + AUTOPILOT_CYCLE_BUDGET_MS);

    expect(started).toContain(AgentKind.CONFIG);
    expect(started).not.toContain(AgentKind.DETECTOR_AUTHOR);
    expect(started).not.toContain(AgentKind.ESCALATION);
  });

  it('runs nothing once the deadline has already passed', async () => {
    build();
    await runChains(Date.now() - 1);

    expect(started).toEqual([]);
  });

  // Only the two investigation agents record a SKIPPED run; the opt-in agents
  // are off by default and would otherwise emit a row per scan each.
  it('records a skipped run for a disabled investigation agent only', async () => {
    build(0, [AgentKind.ESCALATION]);
    await runChains(Date.now() + AUTOPILOT_CYCLE_BUDGET_MS);

    const skipped = recordSkippedRun.mock.calls.map((call) => call[0]);
    expect(skipped).toEqual([AgentKind.INQUIRY, AgentKind.CASE]);
  });

  it('records no skipped runs for a targeted ("only") cycle', async () => {
    build(0, [AgentKind.ESCALATION]);
    await runChains(Date.now() + AUTOPILOT_CYCLE_BUDGET_MS, {
      ...cycle,
      only: [AgentKind.ESCALATION],
    } as typeof cycle);

    expect(recordSkippedRun).not.toHaveBeenCalled();
  });
});
