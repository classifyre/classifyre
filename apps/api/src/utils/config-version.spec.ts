import { configVersion } from './config-version';

/**
 * The concurrency token config.tune_source hands the agent.
 *
 * It used to be `Source.updatedAt`, which is `@updatedAt` — so the adaptive
 * scheduler writing `scheduleNextAt` on every scan claim, or `autoPhase` after
 * every run, expired the agent's token while it was still deciding what to
 * change. Four of seven tool failures in one live afternoon were valid patches
 * refused for that reason, the read and the write barely 30 seconds apart.
 */
describe('configVersion', () => {
  const config = {
    required: { host: 'h' },
    detectors: [{ type: 'PII', enabled: true }],
  };

  it('is stable across reads of an unchanged config', () => {
    expect(configVersion(config)).toBe(configVersion({ ...config }));
  });

  // The property the whole fix turns on.
  it('ignores everything that is not the configuration', () => {
    // Same config object; the row around it may have been rewritten a dozen
    // times by the scheduler in between.
    const before = configVersion(config);
    const after = configVersion(JSON.parse(JSON.stringify(config)));
    expect(after).toBe(before);
  });

  it('is independent of key order', () => {
    expect(configVersion({ b: 1, a: { d: 2, c: 3 } })).toBe(
      configVersion({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('changes when a detector is disabled', () => {
    expect(
      configVersion({
        ...config,
        detectors: [{ type: 'PII', enabled: false }],
      }),
    ).not.toBe(configVersion(config));
  });

  it('changes when a pattern list is narrowed', () => {
    expect(
      configVersion({
        ...config,
        detectors: [
          { type: 'PII', enabled: true, config: { enabled_patterns: ['URL'] } },
        ],
      }),
    ).not.toBe(configVersion(config));
  });

  it('treats null and empty config alike', () => {
    expect(configVersion(null)).toBe(configVersion({}));
  });
});
