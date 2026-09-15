import {
  COHORT_WEIGHT_RULES,
  computeCohortWeights,
  type BandObservation,
  type CohortBand,
} from './cohort-weights';

const declared = { newest: 60, oldest: 30, random: 10 };

/** One run's observations: visits per band and a hit rate per band. */
const run = (
  visited: number,
  rates: Partial<Record<CohortBand, number>>,
  exhausted: CohortBand[] = [],
): Partial<Record<CohortBand, BandObservation>> =>
  Object.fromEntries(
    (Object.keys(rates) as CohortBand[]).map((band) => [
      band,
      {
        visited,
        hits: Math.round(visited * (rates[band] ?? 0)),
        exhausted: exhausted.includes(band),
      },
    ]),
  );

const total = (weights: Partial<Record<CohortBand, number>>) =>
  Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);

describe('computeCohortWeights', () => {
  it('keeps the declared split with no history', () => {
    expect(computeCohortWeights({ declared, history: [] })).toMatchObject({
      reason: 'no_history',
      weights: { newest: 60, oldest: 30, random: 10 },
    });
  });

  it('keeps the declared split until every band has enough visits', () => {
    const result = computeCohortWeights({
      declared,
      history: [
        run(150, { newest: 0.22, oldest: 0.03, random: 0.05 }),
        run(40, { newest: 0.22, oldest: 0.03, random: 0.05 }),
      ],
    });
    expect(result.reason).toBe('cold_start');
    expect(result.weights).toEqual({ newest: 60, oldest: 30, random: 10 });
  });

  it('moves toward the productive band, by at most 15 points a run', () => {
    const history = [run(400, { newest: 0.3, oldest: 0.05, random: 0.05 })];
    const result = computeCohortWeights({
      declared: { newest: 34, oldest: 33, random: 33 },
      history,
      previous: { newest: 34, oldest: 33, random: 33 },
    });
    expect(result.reason).toBe('measured');
    expect(result.weights.newest).toBeCloseTo(49, 0);
    for (const band of ['newest', 'oldest', 'random'] as CohortBand[]) {
      expect(
        Math.abs(
          (result.weights[band] ?? 0) -
            { newest: 34, oldest: 33, random: 33 }[band],
        ),
      ).toBeLessThanOrEqual(COHORT_WEIGHT_RULES.maxShiftPoints + 0.1);
    }
    expect(total(result.weights)).toBeCloseTo(100, 0);
  });

  it('never starves a band below the floor, however badly it yields', () => {
    let previous: Partial<Record<CohortBand, number>> = declared;
    const history: Array<Partial<Record<CohortBand, BandObservation>>> = [];
    for (let i = 0; i < 12; i += 1) {
      history.unshift(run(500, { newest: 0.4, oldest: 0.0, random: 0.0 }));
      previous = computeCohortWeights({ declared, history, previous }).weights;
    }
    expect(previous.oldest).toBeGreaterThanOrEqual(10);
    expect(previous.random).toBeGreaterThanOrEqual(10);
    expect(previous.newest).toBeCloseTo(80, 0);
  });

  it('honours a min_share above the floor', () => {
    const result = computeCohortWeights({
      declared,
      history: [run(1000, { newest: 0.4, oldest: 0.0, random: 0.0 })],
      previous: { newest: 60, oldest: 25, random: 15 },
      minShare: 0.25,
    });
    expect(result.weights.oldest).toBeGreaterThanOrEqual(25);
    expect(result.weights.random).toBeGreaterThanOrEqual(15 - 0.1);
  });

  it('gives an exhausted band nothing, at once, and its share to the others', () => {
    const result = computeCohortWeights({
      declared,
      history: [
        run(500, { newest: 0.2, oldest: 0.1, random: 0.05 }, ['newest']),
      ],
      previous: declared,
    });
    expect(result.weights.newest).toBeUndefined();
    expect(total(result.weights)).toBeCloseTo(100, 0);
    expect(result.derivation.newest?.exhausted).toBe(true);
  });

  it('lets a recent run outweigh an equally strong older one', () => {
    // Same evidence, opposite bands, one run apart: the newer run wins.
    const result = computeCohortWeights({
      declared: { newest: 50, oldest: 50 },
      previous: { newest: 50, oldest: 50 },
      history: [
        run(300, { newest: 0.02, oldest: 0.3 }),
        run(300, { newest: 0.3, oldest: 0.02 }),
      ],
    });
    expect(result.derivation.oldest!.rate).toBeGreaterThan(
      result.derivation.newest!.rate,
    );
    expect(result.weights.oldest).toBeGreaterThan(50);
  });
});
