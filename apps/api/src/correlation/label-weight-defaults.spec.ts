import { CorrelationService } from './correlation.service';
import type { PrismaService } from '../prisma.service';
import { LABEL_WEIGHTS } from './correlation.constants';

/**
 * The shipped weight table has to actually apply.
 *
 * `correlation_config.label_weights` defaults to `{}` and `default_weight` to
 * 1, and the config resolver read only the stored map. So on every instance
 * that had never opened the tuning screen, LABEL_WEIGHTS was dead code: an
 * email match and a country-code match both scored 1, the weighted overlap was
 * a plain count of shared values, and every "match weight" the review queue
 * shows — the histogram, the cutoffs, the waterfall bars — was computed from
 * weights nobody chose.
 */
describe('label weights fall back to the shipped defaults', () => {
  const prisma = {
    correlationConfig: { findUnique: jest.fn(), upsert: jest.fn() },
    assetCorrelationValue: { groupBy: jest.fn() },
  };
  const jobs = { scheduleFull: jest.fn() };
  const service = new CorrelationService(
    prisma as unknown as PrismaService,
    { runExclusive: (fn: () => Promise<unknown>) => fn() } as never,
    jobs as never,
    { refresh: () => Promise.resolve(undefined) } as never,
  );

  /** loadConfig is private; getConfig is the same resolution, made public. */
  const resolve = () =>
    (
      service as unknown as {
        loadConfig: () => Promise<{
          weightOf: (label: string) => number;
          rawWeights: Record<string, number>;
        }>;
      }
    ).loadConfig();

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.assetCorrelationValue.groupBy.mockResolvedValue([]);
    prisma.correlationConfig.upsert.mockResolvedValue({});
    jobs.scheduleFull.mockResolvedValue(undefined);
  });

  it('uses the built-in weight when nothing is stored', async () => {
    prisma.correlationConfig.findUnique.mockResolvedValue(null);
    const cfg = await resolve();
    expect(cfg.weightOf('email')).toBe(LABEL_WEIGHTS.email);
    expect(cfg.weightOf('credit_card')).toBe(LABEL_WEIGHTS.credit_card);
    // A concrete identifier must outweigh a country code, or the score is a
    // count of shared values wearing the word "weighted".
    expect(cfg.weightOf('email')).toBeGreaterThan(cfg.weightOf('country'));
  });

  it('still defaults unknown and custom labels', async () => {
    prisma.correlationConfig.findUnique.mockResolvedValue(null);
    const cfg = await resolve();
    expect(cfg.weightOf('some_custom_detector')).toBe(1);
  });

  it('lets a stored weight override a built-in, including downwards', async () => {
    prisma.correlationConfig.findUnique.mockResolvedValue({
      labelWeights: { email: 1 },
      defaultWeight: 1,
      relatedMin: 0.3,
      duplicateMin: 0.6,
      exclusions: [],
    });
    const cfg = await resolve();
    expect(cfg.weightOf('email')).toBe(1);
    // Untouched built-ins survive an override of a different label.
    expect(cfg.weightOf('ssn')).toBe(LABEL_WEIGHTS.ssn);
  });

  it('ships the same table to the scoring SQL as to weightOf', async () => {
    prisma.correlationConfig.findUnique.mockResolvedValue(null);
    const cfg = await resolve();
    // rawWeights is serialised into the scoring and review-index queries. If
    // it disagreed with weightOf, the waterfall bars would not add up to the
    // score printed above them.
    for (const label of Object.keys(LABEL_WEIGHTS)) {
      expect(cfg.rawWeights[label]).toBe(cfg.weightOf(label));
    }
  });

  it('keeps a deliberate weight that matches the flat default', async () => {
    prisma.correlationConfig.findUnique.mockResolvedValue({
      labelWeights: {},
      defaultWeight: 1,
      relatedMin: 0.3,
      duplicateMin: 0.6,
      exclusions: [],
    });
    await service.saveConfig({ labelWeights: { email: 1 } });
    const written = prisma.correlationConfig.upsert.mock.calls[0][0].create
      .labelWeights as Record<string, number>;
    // Pruning against defaultWeight alone would drop this and let the built-in
    // 5 come back through the fallback — silently undoing the change.
    expect(written.email).toBe(1);
  });

  it('drops an entry that only restates the built-in', async () => {
    prisma.correlationConfig.findUnique.mockResolvedValue({
      labelWeights: {},
      defaultWeight: 1,
      relatedMin: 0.3,
      duplicateMin: 0.6,
      exclusions: [],
    });
    await service.saveConfig({
      labelWeights: { email: LABEL_WEIGHTS.email },
    });
    const written = prisma.correlationConfig.upsert.mock.calls[0][0].create
      .labelWeights as Record<string, number>;
    expect(written.email).toBeUndefined();
  });
});
