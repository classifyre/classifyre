import {
  admitSession,
  roomForSession,
  sessionMemoryConfig,
} from './memory-guard';

const MB = 1024 * 1024;

describe('room for one more SQL session', () => {
  // Each session is a PGlite of its own: about 400 MB under a BI tool's sync
  // and queries (measured 2026-11-21, BIC M5). Eight on a 3 GiB pod were
  // killed by the kernel, every session with them; refusing the ninth keeps
  // the others alive.
  it('opens a session only when the pod has room for it and the ones still starting', () => {
    const limits = { ceiling: 2800 * MB, perSession: 450 * MB };
    expect(roomForSession(1000 * MB, 0, limits)).toBe(true);
    expect(roomForSession(2400 * MB, 0, limits)).toBe(false);
    expect(roomForSession(1500 * MB, 2, limits)).toBe(false);
    expect(roomForSession(1500 * MB, 1, limits)).toBe(true);
  });

  it('has no memory limit unless one is configured', () => {
    expect(
      roomForSession(64_000 * MB, 10, { ceiling: 0, perSession: 450 * MB }),
    ).toBe(true);
  });

  it('takes the pod ceiling from the gateway setting, else the API’s pressure limit', () => {
    expect(
      sessionMemoryConfig({
        SQL_GATEWAY_MAX_RSS_BYTES: String(2000 * MB),
        UNDER_PRESSURE_MAX_RSS_BYTES: String(9000 * MB),
      }),
    ).toEqual({ ceiling: 2000 * MB, perSession: 450 * MB });
    expect(
      sessionMemoryConfig({
        UNDER_PRESSURE_MAX_RSS_BYTES: String(2800 * MB),
        SQL_GATEWAY_SESSION_MEMORY_MB: '300',
      }),
    ).toEqual({ ceiling: 2800 * MB, perSession: 300 * MB });
    expect(sessionMemoryConfig({})).toEqual({
      ceiling: 0,
      perSession: 450 * MB,
    });
  });
});

describe('admitting a session while others are still starting', () => {
  // A Metabase dashboard opens its pool's four sessions at once. Each one
  // still starting is reserved at the full 450 MB, so with 1.6 GB resident
  // the third and fourth were refused "busy" (53300), which pgJDBC under a
  // connection pool does not retry: 4 of 5 dashboard cards failed (Kestrel &
  // Finch battle test, 2026-11-23). Started, a session settles near 240 MB.
  const limits = { ceiling: 2818 * MB, perSession: 450 * MB };
  const base = { live: 2, maxSessions: 16, limits };

  it('opens when there is room', () => {
    expect(admitSession({ ...base, rss: 1600 * MB, starting: 1 })).toBe('open');
  });

  it('waits when only sessions still starting take the room', () => {
    expect(admitSession({ ...base, rss: 1600 * MB, starting: 2 })).toBe('wait');
  });

  it('is busy when nothing is starting and there is no room', () => {
    expect(admitSession({ ...base, rss: 2500 * MB, starting: 0 })).toBe('busy');
  });

  it('is busy at the session limit, whatever the memory', () => {
    expect(
      admitSession({ ...base, live: 15, rss: 100 * MB, starting: 1 }),
    ).toBe('busy');
  });

  it('opens without a memory ceiling', () => {
    expect(
      admitSession({
        ...base,
        rss: 64_000 * MB,
        starting: 9,
        limits: { ceiling: 0, perSession: 450 * MB },
      }),
    ).toBe('open');
  });
});
