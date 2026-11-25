import {
  admitSession,
  roomForSession,
  sessionMemoryConfig,
} from './memory-guard';

const MB = 1024 * 1024;

describe('room for one more SQL session', () => {
  it('opens a session only when the pod has room for it and the ones still starting', () => {
    const limits = { ceiling: 896 * MB, perSession: 32 * MB };
    expect(roomForSession(300 * MB, 0, limits)).toBe(true);
    expect(roomForSession(870 * MB, 0, limits)).toBe(false);
    expect(roomForSession(800 * MB, 3, limits)).toBe(false);
    expect(roomForSession(800 * MB, 2, limits)).toBe(true);
  });

  it('has no memory limit unless one is configured', () => {
    expect(
      roomForSession(64_000 * MB, 10, { ceiling: 0, perSession: 32 * MB }),
    ).toBe(true);
  });

  it('takes the pod ceiling from the gateway setting, else the API’s pressure limit', () => {
    expect(
      sessionMemoryConfig({
        SQL_GATEWAY_MAX_RSS_BYTES: String(900 * MB),
        UNDER_PRESSURE_MAX_RSS_BYTES: String(9000 * MB),
      }),
    ).toEqual({ ceiling: 900 * MB, perSession: 32 * MB });
    expect(
      sessionMemoryConfig({
        UNDER_PRESSURE_MAX_RSS_BYTES: String(896 * MB),
        SQL_GATEWAY_SESSION_MEMORY_MB: '64',
      }),
    ).toEqual({ ceiling: 896 * MB, perSession: 64 * MB });
    expect(sessionMemoryConfig({})).toEqual({
      ceiling: 0,
      perSession: 32 * MB,
    });
  });
});

describe('admitting a session while others are still starting', () => {
  const limits = { ceiling: 896 * MB, perSession: 32 * MB };
  const base = { live: 10, maxSessions: 64, limits };

  it('opens when there is room', () => {
    expect(admitSession({ ...base, rss: 800 * MB, starting: 2 })).toBe('open');
  });

  it('waits when only sessions still starting take the room', () => {
    expect(admitSession({ ...base, rss: 800 * MB, starting: 3 })).toBe('wait');
  });

  it('is busy when nothing is starting and there is no room', () => {
    expect(admitSession({ ...base, rss: 880 * MB, starting: 0 })).toBe('busy');
  });

  it('is busy at the session limit, whatever the memory', () => {
    expect(
      admitSession({ ...base, live: 63, rss: 100 * MB, starting: 1 }),
    ).toBe('busy');
  });

  it('opens without a memory ceiling', () => {
    expect(
      admitSession({
        ...base,
        rss: 64_000 * MB,
        starting: 9,
        limits: { ceiling: 0, perSession: 32 * MB },
      }),
    ).toBe('open');
  });
});
