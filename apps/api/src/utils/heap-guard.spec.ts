import {
  HEAP_GUARD_FRACTION,
  resolveHeapGuard,
  v8HeapLimitBytes,
} from './heap-guard';

const MB = 1024 * 1024;

describe('resolveHeapGuard', () => {
  it('derives the threshold from the ceiling V8 actually enforces', () => {
    const guard = resolveHeapGuard({}, 4192 * MB);

    expect(guard.source).toBe('derived');
    expect(guard.limitBytes).toBe(4192 * MB);
    expect(guard.thresholdBytes).toBe(
      Math.floor(4192 * MB * HEAP_GUARD_FRACTION),
    );
  });

  it('honours an explicit override below the ceiling (the Helm chart case)', () => {
    // values.yaml: api.maxOldSpaceSizeMb=1536, guard at 85% of it.
    const configured = Math.floor(1536 * MB * 0.85);
    const guard = resolveHeapGuard(
      { UNDER_PRESSURE_MAX_HEAP_USED_BYTES: String(configured) },
      1632 * MB,
    );

    expect(guard.source).toBe('env');
    expect(guard.thresholdBytes).toBe(configured);
  });

  it('clamps an override that sits at or above the real ceiling', () => {
    // The shipped desktop bug: 85% of a *requested* 6144 MB heap, against the
    // 4192 MB ceiling Electron actually granted. Nothing could ever exceed it,
    // so the API aborted instead of shedding.
    const guard = resolveHeapGuard(
      { UNDER_PRESSURE_MAX_HEAP_USED_BYTES: String(5222 * MB) },
      4192 * MB,
    );

    expect(guard.source).toBe('env-clamped');
    expect(guard.thresholdBytes).toBeLessThan(guard.limitBytes);
    expect(guard.thresholdBytes).toBe(
      Math.floor(4192 * MB * HEAP_GUARD_FRACTION),
    );
  });

  it('leaves usable headroom below the ceiling on any heap size', () => {
    // Machine-independent invariant: whatever the host, the container limit or
    // the launcher flag, there is always room to shed before V8 gives up.
    for (const limitMb of [512, 1024, 1536, 2048, 4192, 16_384]) {
      const guard = resolveHeapGuard({}, limitMb * MB);
      expect(guard.thresholdBytes).toBeGreaterThan(0);
      expect(guard.thresholdBytes).toBeLessThan(limitMb * MB);
    }
  });

  it.each([
    ['unset', undefined],
    ['empty', '   '],
    ['not a number', 'lots'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('falls back to the derived value when the override is %s', (_, raw) => {
    const guard = resolveHeapGuard(
      raw === undefined ? {} : { UNDER_PRESSURE_MAX_HEAP_USED_BYTES: raw },
      2048 * MB,
    );

    expect(guard.source).toBe('derived');
    expect(guard.thresholdBytes).toBe(
      Math.floor(2048 * MB * HEAP_GUARD_FRACTION),
    );
  });

  it('reads a plausible ceiling from the running V8', () => {
    const limit = v8HeapLimitBytes();
    expect(limit).toBeGreaterThan(64 * MB);
    // Default: the guard is live rather than opt-in, so a deployment that
    // configures nothing still sheds instead of aborting.
    expect(resolveHeapGuard({}).thresholdBytes).toBeLessThan(limit);
  });
});
