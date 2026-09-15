/**
 * The next run's split across a cohort's bands, measured from what each band
 * yielded — deterministic, and explainable line by line.
 *
 * A connector declares bands (`ctx.cohort(..., bands={"newest": 60, "oldest":
 * 30, "random": 10})`) as its best guess. On the Firmenbuch register the guess
 * was 8x wrong in one direction: 2020s registrations carried an actionable
 * finding 22.2% of the time, 1990s ones 2.8%. The runtime records, per run and
 * band, how many keys were visited and how many produced a new HIGH/CRITICAL
 * finding; this turns that history into weights.
 *
 * Guards, each for a failure a feedback loop would otherwise have:
 *  - decay (0.7 per run, last 10 runs): old yield fades, so drift is followed;
 *  - Beta(1, 19) prior: a band with little evidence is treated as ~5%, not as
 *    0% or 100% from a handful of visits;
 *  - cold start: until every band has 200 visits the declared split stands;
 *  - floor (10%, or the connector's min_share if higher): no band starves, so
 *    its yield stays measurable;
 *  - shift cap (15 points per run): one lucky run cannot swing the split;
 *  - exhaustion: a directional band that finished a pass gets 0 and its share
 *    goes to the others.
 */

export const COHORT_BANDS = ['newest', 'oldest', 'random'] as const;
export type CohortBand = (typeof COHORT_BANDS)[number];

export const COHORT_WEIGHT_RULES = {
  historyRuns: 10,
  decay: 0.7,
  priorHits: 1,
  priorMisses: 19,
  coldStartVisits: 200,
  floor: 0.1,
  maxShiftPoints: 15,
} as const;

export interface BandObservation {
  visited: number;
  hits: number;
  exhausted: boolean;
}

export interface CohortWeightsInput {
  /** The connector's own split, from the most recent run. */
  declared: Partial<Record<CohortBand, number>>;
  /** Newest first; at most {@link COHORT_WEIGHT_RULES.historyRuns} are read. */
  history: Array<Partial<Record<CohortBand, BandObservation>>>;
  /** The split the most recent run actually used, for the shift cap. */
  previous?: Partial<Record<CohortBand, number>> | null;
  /** The connector's min_share, a fraction. The floor is the larger of it and 10%. */
  minShare?: number | null;
}

export interface CohortWeightsResult {
  /** Percentages summing to 100, one decimal. */
  weights: Partial<Record<CohortBand, number>>;
  reason: 'no_history' | 'cold_start' | 'measured';
  derivation: Partial<
    Record<
      CohortBand,
      {
        visited: number;
        hits: number;
        decayedVisited: number;
        decayedHits: number;
        rate: number;
        exhausted: boolean;
      }
    >
  >;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function normalizePercent(
  weights: Partial<Record<CohortBand, number>>,
): Partial<Record<CohortBand, number>> {
  const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
  if (total <= 0) return {};
  const out: Partial<Record<CohortBand, number>> = {};
  for (const band of COHORT_BANDS) {
    const weight = weights[band];
    if (weight !== undefined && weight > 0) out[band] = (weight / total) * 100;
  }
  return out;
}

/**
 * Give every band at least `floor` percent, taking it proportionally from the
 * bands above it. Iterates because raising one band can push another under.
 */
function applyFloor(
  shares: Partial<Record<CohortBand, number>>,
  floorPercent: number,
): Partial<Record<CohortBand, number>> {
  const bands = Object.keys(shares) as CohortBand[];
  if (bands.length * floorPercent >= 100) {
    return Object.fromEntries(bands.map((b) => [b, 100 / bands.length]));
  }
  let result = { ...shares };
  for (let pass = 0; pass < bands.length; pass += 1) {
    const low = bands.filter((b) => (result[b] ?? 0) < floorPercent);
    if (low.length === 0) break;
    const high = bands.filter((b) => !low.includes(b));
    const needed = low.reduce(
      (sum, b) => sum + (floorPercent - (result[b] ?? 0)),
      0,
    );
    const highTotal = high.reduce((sum, b) => sum + (result[b] ?? 0), 0);
    const next: Partial<Record<CohortBand, number>> = {};
    for (const b of low) next[b] = floorPercent;
    for (const b of high) {
      next[b] = (result[b] ?? 0) - needed * ((result[b] ?? 0) / highTotal);
    }
    result = next;
  }
  return result;
}

/** Move at most `cap` points from `previous`, keeping the total at 100. */
function capShift(
  target: Partial<Record<CohortBand, number>>,
  previous: Partial<Record<CohortBand, number>>,
  cap: number,
): Partial<Record<CohortBand, number>> {
  const bands = Object.keys(target) as CohortBand[];
  const result: Partial<Record<CohortBand, number>> = {};
  for (const band of bands) {
    const from = previous[band] ?? 0;
    const to = target[band] ?? 0;
    result[band] = Math.min(from + cap, Math.max(from - cap, to));
  }
  // Clamping moved the total off 100: hand the difference to bands that still
  // have room inside their caps, in proportion to that room.
  for (let pass = 0; pass < 3; pass += 1) {
    const total = bands.reduce((sum, b) => sum + (result[b] ?? 0), 0);
    const gap = 100 - total;
    if (Math.abs(gap) < 1e-9) break;
    const room = bands.map((b) => {
      const from = previous[b] ?? 0;
      const value = result[b] ?? 0;
      return gap > 0
        ? Math.max(0, Math.min(from + cap, 100) - value)
        : Math.max(0, value - Math.max(from - cap, 0));
    });
    const totalRoom = room.reduce((sum, r) => sum + r, 0);
    if (totalRoom <= 0) break;
    bands.forEach((b, index) => {
      const share = Math.min(
        room[index],
        Math.abs(gap) * (room[index] / totalRoom),
      );
      result[b] = (result[b] ?? 0) + Math.sign(gap) * share;
    });
  }
  return result;
}

export function computeCohortWeights(
  input: CohortWeightsInput,
): CohortWeightsResult {
  const rules = COHORT_WEIGHT_RULES;
  const declared = normalizePercent(input.declared);
  const bands = Object.keys(declared) as CohortBand[];
  const history = input.history.slice(0, rules.historyRuns);

  const derivation: CohortWeightsResult['derivation'] = {};
  for (const band of bands) {
    let visited = 0;
    let hits = 0;
    let decayedVisited = 0;
    let decayedHits = 0;
    history.forEach((run, age) => {
      const observed = run[band];
      if (!observed) return;
      const factor = rules.decay ** age;
      visited += observed.visited;
      hits += observed.hits;
      decayedVisited += observed.visited * factor;
      decayedHits += observed.hits * factor;
    });
    derivation[band] = {
      visited,
      hits,
      decayedVisited: round1(decayedVisited),
      decayedHits: round1(decayedHits),
      rate:
        Math.round(
          ((decayedHits + rules.priorHits) /
            (decayedVisited + rules.priorHits + rules.priorMisses)) *
            10_000,
        ) / 10_000,
      exhausted: history[0]?.[band]?.exhausted === true,
    };
  }

  const rounded = (shares: Partial<Record<CohortBand, number>>) =>
    Object.fromEntries(
      Object.entries(shares).map(([band, share]) => [band, round1(share ?? 0)]),
    ) as Partial<Record<CohortBand, number>>;

  if (history.length === 0) {
    return { weights: rounded(declared), reason: 'no_history', derivation };
  }
  if (
    bands.some((b) => (derivation[b]?.visited ?? 0) < rules.coldStartVisits)
  ) {
    return { weights: rounded(declared), reason: 'cold_start', derivation };
  }

  // A band that ran out gives its whole share away at once; the shift cap only
  // paces how the remaining bands trade share between themselves.
  const live = bands.filter((b) => !derivation[b]?.exhausted);
  if (live.length === 0) {
    return { weights: rounded(declared), reason: 'measured', derivation };
  }
  const byRate = normalizePercent(
    Object.fromEntries(live.map((b) => [b, derivation[b]?.rate ?? 0])),
  );
  const floorPercent = Math.max(rules.floor, input.minShare ?? 0) * 100;
  const floored = applyFloor(byRate, floorPercent);
  const before = input.previous ?? declared;
  const previous = normalizePercent(
    Object.fromEntries(live.map((b) => [b, before[b] ?? 0])),
  );
  const capped = capShift(floored, previous, rules.maxShiftPoints);
  return {
    weights: rounded(normalizePercent(capped)),
    reason: 'measured',
    derivation,
  };
}
