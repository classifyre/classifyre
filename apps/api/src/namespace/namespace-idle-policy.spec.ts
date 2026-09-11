import {
  coldModeConfigFromEnv,
  decideNamespaceIdle,
  type NamespaceActivitySnapshot,
} from './namespace-idle-policy';

const IDLE_AFTER_DAYS = 7;
const NOW = new Date('2026-09-11T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const quiet: NamespaceActivitySnapshot = {
  inFlightRunners: 0,
  inFlightSources: 0,
  dirtySources: 0,
  plannedSources: 0,
  latestRunnerAt: null,
};

describe('decideNamespaceIdle', () => {
  it('sleeps a namespace that never scanned and has no planned work', () => {
    expect(decideNamespaceIdle(quiet, NOW, IDLE_AFTER_DAYS)).toEqual({
      idle: true,
      reason: 'never scanned',
    });
  });

  it('sleeps a namespace whose last scan is older than the window', () => {
    expect(
      decideNamespaceIdle(
        { ...quiet, latestRunnerAt: daysAgo(30) },
        NOW,
        IDLE_AFTER_DAYS,
      ),
    ).toEqual({ idle: true, reason: 'last scan 30d ago' });
  });

  it('keeps a namespace with a recent scan awake', () => {
    expect(
      decideNamespaceIdle(
        { ...quiet, latestRunnerAt: daysAgo(2) },
        NOW,
        IDLE_AFTER_DAYS,
      ),
    ).toEqual({ idle: false, reason: 'last scan 2d ago' });
  });

  it('never sleeps with scans in flight, however stale the last one', () => {
    expect(
      decideNamespaceIdle(
        { ...quiet, inFlightRunners: 1, latestRunnerAt: daysAgo(90) },
        NOW,
        IDLE_AFTER_DAYS,
      ).idle,
    ).toBe(false);
    expect(
      decideNamespaceIdle(
        { ...quiet, inFlightSources: 2, latestRunnerAt: daysAgo(90) },
        NOW,
        IDLE_AFTER_DAYS,
      ),
    ).toEqual({ idle: false, reason: 'scans in flight' });
  });

  it('never sleeps with autopilot work pending', () => {
    expect(
      decideNamespaceIdle(
        { ...quiet, dirtySources: 3, latestRunnerAt: daysAgo(90) },
        NOW,
        IDLE_AFTER_DAYS,
      ),
    ).toEqual({ idle: false, reason: 'autopilot work pending' });
  });

  it('never sleeps a namespace with planned schedules, even with no scans yet', () => {
    // Sleeping here would silently cancel the schedules themselves.
    expect(
      decideNamespaceIdle(
        { ...quiet, plannedSources: 1 },
        NOW,
        IDLE_AFTER_DAYS,
      ),
    ).toEqual({ idle: false, reason: 'scheduled scans planned' });
  });

  it('fails closed when the latest scan timestamp is in the future', () => {
    expect(
      decideNamespaceIdle(
        {
          ...quiet,
          latestRunnerAt: new Date(NOW.getTime() + 60_000),
        },
        NOW,
        IDLE_AFTER_DAYS,
      ).idle,
    ).toBe(false);
  });
});

describe('coldModeConfigFromEnv', () => {
  it('defaults to enabled with a 7-day window and a 60s check', () => {
    expect(coldModeConfigFromEnv({})).toEqual({
      enabled: true,
      idleAfterDays: 7,
      checkMs: 60_000,
    });
  });

  it('accepts fractional days for testing and floors the check interval', () => {
    expect(
      coldModeConfigFromEnv({
        NAMESPACE_IDLE_AFTER_DAYS: '0.002',
        NAMESPACE_IDLE_CHECK_MS: '50',
      }),
    ).toEqual({ enabled: true, idleAfterDays: 0.002, checkMs: 1000 });
  });

  it('disables cold mode via the master switch or a non-positive window', () => {
    expect(
      coldModeConfigFromEnv({ NAMESPACE_COLD_MODE_ENABLED: 'false' }).enabled,
    ).toBe(false);
    expect(
      coldModeConfigFromEnv({ NAMESPACE_IDLE_AFTER_DAYS: '0' }).enabled,
    ).toBe(false);
    expect(
      coldModeConfigFromEnv({ NAMESPACE_IDLE_AFTER_DAYS: '-3' }).enabled,
    ).toBe(false);
  });

  it('falls back to defaults on garbage input rather than disabling itself', () => {
    expect(
      coldModeConfigFromEnv({ NAMESPACE_IDLE_AFTER_DAYS: 'soon' }),
    ).toEqual({ enabled: true, idleAfterDays: 7, checkMs: 60_000 });
  });
});
