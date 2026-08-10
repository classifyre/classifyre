import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';
import type { CorrelationService } from './correlation.service';

/**
 * A correlation pass that lost the race for a database connection.
 *
 * The recompute is long and connection-hungry, so on a busy namespace it can
 * exhaust the per-namespace pool and die on `timeout exceeded when trying to
 * connect` — four runs did exactly that while 1.9M findings were being ingested
 * alongside it. pg-boss redelivering the job does not help: the run is already
 * marked FAILED and the resume guard returns early for anything not RUNNING, so
 * the redelivery is a no-op. The retry has to happen before the run is written
 * off.
 */
describe('DuplicatesFinderAgentService transient retry', () => {
  const SUMMARY = {
    assetsFingerprinted: 1,
    valuesIndexed: 1,
    duplicatePairs: 0,
    relatedPairs: 0,
    clustersTouched: 0,
    topMatch: null,
  };

  let recomputeForRunner: jest.Mock;
  let audit: {
    openRun: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    recordDecision: jest.Mock;
  };
  let log: { business: jest.Mock; technical: jest.Mock; error: jest.Mock };
  let service: DuplicatesFinderAgentService;

  const run = () =>
    service.runForScan({
      sourceId: 's1',
      runnerId: 'r1',
      cycleKey: 'c1',
      sourceName: 'a source',
    });

  let sleep: jest.SpyInstance;

  beforeEach(() => {
    // The retry backs off with setTimeout; fire it immediately so the test
    // exercises the retry logic rather than the wall clock.
    sleep = jest.spyOn(global, 'setTimeout').mockImplementation(((
      fn: () => void,
    ) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as never);
    recomputeForRunner = jest.fn().mockResolvedValue(SUMMARY);
    audit = {
      openRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'RUNNING' }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
      recordDecision: jest.fn().mockResolvedValue(true),
    };
    log = {
      business: jest.fn().mockResolvedValue(undefined),
      technical: jest.fn().mockResolvedValue(undefined),
      error: jest.fn().mockResolvedValue(undefined),
    };
    service = new DuplicatesFinderAgentService(
      { recomputeForRunner } as unknown as CorrelationService,
      {} as never,
      audit as never,
      log as never,
    );
  });
  afterEach(() => sleep.mockRestore());

  const settle = () => run();

  it('retries the exact pool-exhaustion error seen in production', async () => {
    recomputeForRunner
      .mockRejectedValueOnce(
        new Error('timeout exceeded when trying to connect'),
      )
      .mockResolvedValue(SUMMARY);

    await settle();

    expect(recomputeForRunner).toHaveBeenCalledTimes(2);
    expect(audit.complete).toHaveBeenCalled();
    expect(audit.fail).not.toHaveBeenCalled();
  });

  it('gives up after the bounded attempts and fails the run', async () => {
    recomputeForRunner.mockRejectedValue(
      new Error('timeout exceeded when trying to connect'),
    );

    await expect(settle()).rejects.toThrow(/timeout exceeded/);

    // Initial attempt plus two retries.
    expect(recomputeForRunner).toHaveBeenCalledTimes(3);
    expect(audit.fail).toHaveBeenCalled();
  });

  // A genuine bug must surface immediately, not be retried into a slow failure.
  it('does not retry a non-transient error', async () => {
    recomputeForRunner.mockRejectedValue(new Error('column does not exist'));

    await expect(settle()).rejects.toThrow(/column does not exist/);

    expect(recomputeForRunner).toHaveBeenCalledTimes(1);
    expect(audit.fail).toHaveBeenCalled();
  });

  it('does not retry when the pass succeeds', async () => {
    await settle();

    expect(recomputeForRunner).toHaveBeenCalledTimes(1);
    expect(log.technical).not.toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('transient'),
      expect.anything(),
    );
  });
});
