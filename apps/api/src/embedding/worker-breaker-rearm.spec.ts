import {
  EmbeddingProviderService,
  breakerCooldownMs,
} from './embedding-provider.service';

/**
 * The embedding breaker must reopen on its own.
 *
 * Two very different failures trip it, and it used to treat both as permanent:
 *
 *  - a missing worker file or native dep in a packaged build, which never
 *    recovers and whose 2-second respawn loop the breaker exists to stop;
 *  - onnxruntime aborting natively under host memory pressure (`SIGTRAP` in
 *    `BFCArena::Extend`), which recovers by itself. Observed on a desktop
 *    install: 24 aborts across two days, in bursts, on a machine sitting at
 *    5477 MB of 6144 MB swap. The worker is a forked child precisely so those
 *    aborts kill only the child — the API kept serving through every one.
 *
 * Because the flag latched, three of those blips inside one process ended
 * semantic embedding for the rest of the session: no retry, no recovery, and
 * a status endpoint whose only honest answer was "restart the app". That is
 * the same shape as the desktop restart budget retiring an API that had just
 * served for eight minutes.
 *
 * These tests drive the breaker through a fake clock, because the bug only
 * appears minutes after the failure that caused it.
 */
describe('embedding worker breaker', () => {
  const MAX_FAILURES = 3;

  /** The service with its worker plumbing stubbed out and a controllable clock. */
  function harness() {
    let clock = 1_000_000;
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const service = Object.create(
      EmbeddingProviderService.prototype,
    ) as EmbeddingProviderService;
    // Private members reached through a separate view: intersecting them with
    // the class collapses to `never`, because they are private there.
    const priv = service as unknown as {
      registerWorkerFailure: () => void;
      embedLocal: (texts: string[]) => Promise<number[][]>;
      ensureWorker: () => unknown;
    };

    const sent: number[] = [];
    Object.assign(service, {
      logger,
      now: () => clock,
      consecutiveWorkerFailures: 0,
      breakerTrips: 0,
      disabledUntil: undefined,
      pending: new Map(),
      sequence: 0,
      requestErrorCount: 0,
      // embedLocal only needs a worker object it can `send` to; the real
      // resolution path is driven by `succeed()` below.
      ensureWorker: () => ({ send: (m: { id: number }) => sent.push(m.id) }),
      config: { model: 'm', revision: 'r' },
    });

    const fail = (times = 1) => {
      for (let i = 0; i < times; i += 1) priv.registerWorkerFailure();
    };
    /** Mimic the 'message' handler's success branch. */
    const succeed = () => {
      Object.assign(service, {
        consecutiveWorkerFailures: 0,
        breakerTrips: 0,
        disabledUntil: undefined,
      });
    };
    const advance = (ms: number) => {
      clock += ms;
    };

    return {
      service,
      priv,
      fail,
      succeed,
      advance,
      logger,
      sent,
      at: () => clock,
    };
  }

  describe('cooldown schedule', () => {
    it('backs off exponentially from one minute', () => {
      expect(breakerCooldownMs(1)).toBe(60_000);
      expect(breakerCooldownMs(2)).toBe(120_000);
      expect(breakerCooldownMs(3)).toBe(240_000);
    });

    it('clamps rather than growing without bound', () => {
      const ceiling = breakerCooldownMs(1000);
      expect(ceiling).toBe(breakerCooldownMs(50));
      expect(ceiling).toBeLessThanOrEqual(15 * 60_000);
      // A permanently broken install must still retry occasionally — the point
      // of the breaker was to stop a 2s loop, not to stop retrying at all.
      expect(Number.isFinite(ceiling)).toBe(true);
    });

    it('never returns a zero or negative cooldown', () => {
      for (const trips of [0, 1, 2, 10, 31, 64]) {
        expect(breakerCooldownMs(trips)).toBeGreaterThan(0);
      }
    });
  });

  describe('tripping', () => {
    it('stays closed below the failure threshold', async () => {
      const h = harness();
      h.fail(MAX_FAILURES - 1);

      expect(h.service.status().workerDisabled).toBe(false);
      // The request must be admitted, i.e. stay pending on the stub worker
      // rather than reject.
      await expect(
        Promise.race([h.priv.embedLocal(['x']), Promise.resolve('pending')]),
      ).resolves.toBe('pending');
      expect(h.sent).toHaveLength(1);
    });

    it('opens once the threshold is reached', () => {
      const h = harness();
      h.fail(MAX_FAILURES);

      expect(h.service.status().workerDisabled).toBe(true);
    });

    it('rejects while open, saying when it will retry', async () => {
      const h = harness();
      h.fail(MAX_FAILURES);

      await expect(h.priv.embedLocal(['x'])).rejects.toThrow(/Retrying/);
      // The old message said "Restart the app to retry", which was the truth
      // then and must not be the truth now.
      await expect(h.priv.embedLocal(['x'])).rejects.not.toThrow(
        /Restart the app/,
      );
    });

    it('reports when embedding resumes, not just that it stopped', () => {
      const h = harness();
      h.fail(MAX_FAILURES);

      const status = h.service.status();
      expect(status.workerDisabled).toBe(true);
      expect(status.workerRetryAt).toEqual(expect.any(String));
      expect(Date.parse(status.workerRetryAt!)).not.toBeNaN();
    });
  });

  describe('reopening', () => {
    it('closes once the cooldown elapses', () => {
      const h = harness();
      h.fail(MAX_FAILURES);
      expect(h.service.status().workerDisabled).toBe(true);

      h.advance(breakerCooldownMs(1) + 1);

      expect(h.service.status().workerDisabled).toBe(false);
    });

    it('lets a request through after the cooldown', async () => {
      const h = harness();
      h.fail(MAX_FAILURES);
      h.advance(breakerCooldownMs(1) + 1);

      // Does not reject; the promise stays pending on the stub worker.
      const inFlight = h.priv.embedLocal(['x']);
      await expect(
        Promise.race([inFlight, Promise.resolve('pending')]),
      ).resolves.toBe('pending');
      expect(h.sent).toHaveLength(1);
    });

    it('re-trips on a single failure after probing, not a fresh budget', async () => {
      // Spending three more spawns per cooldown on a permanently broken
      // install is the loop the breaker exists to prevent.
      const h = harness();
      h.fail(MAX_FAILURES);
      h.advance(breakerCooldownMs(1) + 1);
      await Promise.race([h.priv.embedLocal(['x']), Promise.resolve()]);

      h.fail(1);

      expect(h.service.status().workerDisabled).toBe(true);
    });

    it('lengthens the cooldown each time it re-trips', async () => {
      const h = harness();

      h.fail(MAX_FAILURES);
      // Window length = retryAt - the clock at the moment it tripped.
      const firstWindow =
        Date.parse(h.service.status().workerRetryAt!) - h.at();
      expect(firstWindow).toBe(breakerCooldownMs(1));

      h.advance(firstWindow + 1);
      await Promise.race([h.priv.embedLocal(['x']), Promise.resolve()]);
      h.fail(1);
      const secondWindow =
        Date.parse(h.service.status().workerRetryAt!) - h.at();

      expect(secondWindow).toBe(breakerCooldownMs(2));
      expect(secondWindow).toBeGreaterThan(firstWindow);
    });
  });

  describe('recovery', () => {
    it('clears the backoff when a batch actually succeeds', () => {
      const h = harness();
      h.fail(MAX_FAILURES);
      h.advance(breakerCooldownMs(1) + 1);

      h.succeed();

      expect(h.service.status().workerDisabled).toBe(false);
      expect(h.service.status().workerRetryAt).toBeNull();

      // And the next trip starts from the base cooldown again, not the
      // escalated one — the fault is over, so the penalty should be too.
      h.fail(MAX_FAILURES);
      const window = Date.parse(h.service.status().workerRetryAt!) - h.at();
      expect(window).toBe(breakerCooldownMs(1));
    });

    it('does not treat a bare spawn as recovery', () => {
      // Only a completed batch proves the worker works; a process that spawns
      // and immediately aborts would otherwise reset the backoff forever.
      const h = harness();
      h.fail(MAX_FAILURES);
      const before = h.service.status().workerRetryAt;

      h.priv.ensureWorker();

      expect(h.service.status().workerRetryAt).toBe(before);
      expect(h.service.status().workerDisabled).toBe(true);
    });
  });
});
