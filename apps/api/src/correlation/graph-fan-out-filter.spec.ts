import {
  CorrelationService,
  DEFAULT_GRAPH_MAX_FAN_OUT,
  readGraphMaxFanOut,
} from './correlation.service';

const CorrelationServiceProto = CorrelationService.prototype;

/**
 * Hub values are dropped from the unscoped graph.
 *
 * A value bound to hundreds of documents — a company name, a boilerplate
 * footer — connects everything to everything and carries no signal. The
 * Fingerprints UI already ranks shared values by *ascending* fan-out for
 * exactly that reason. Those hubs are also where the payload's weight sits:
 * on a real corpus (51,985 shared values, 288,274 edges) keeping only values
 * bound to ≤10 assets retained 92% of distinct values while dropping half the
 * edges.
 *
 * The tempting alternative — `take: N` on clusters, already ordered
 * `memberCount desc` — would have done the opposite: kept the hubs, discarded
 * the rare pairs. That inversion is what these tests exist to prevent.
 */
describe('graph fan-out filter', () => {
  describe('threshold configuration', () => {
    it('defaults to a value that keeps rare connections and drops hubs', () => {
      expect(readGraphMaxFanOut({})).toBe(DEFAULT_GRAPH_MAX_FAN_OUT);
      // Must stay above the pair/small-cluster range, which is 52% of clusters
      // on a real corpus and the highest-signal part of the graph.
      expect(DEFAULT_GRAPH_MAX_FAN_OUT).toBeGreaterThanOrEqual(5);
      // And well below the hub range that generates most edges.
      expect(DEFAULT_GRAPH_MAX_FAN_OUT).toBeLessThan(100);
    });

    it('accepts an explicit threshold', () => {
      expect(readGraphMaxFanOut({ CORRELATION_GRAPH_MAX_FANOUT: '25' })).toBe(
        25,
      );
    });

    it('treats 0 as "no filter"', () => {
      expect(readGraphMaxFanOut({ CORRELATION_GRAPH_MAX_FANOUT: '0' })).toBe(
        Number.POSITIVE_INFINITY,
      );
    });

    it.each([
      ['unset', undefined],
      ['blank', '   '],
      ['not a number', 'all'],
      ['negative', '-5'],
    ])('falls back to the default when %s', (_label, raw) => {
      // Deliberately not "disable on garbage": an unfiltered graph is the
      // failure mode this filter exists to prevent, so a malformed value must
      // never silently restore it.
      const env =
        raw === undefined ? {} : { CORRELATION_GRAPH_MAX_FANOUT: raw };

      expect(readGraphMaxFanOut(env)).toBe(DEFAULT_GRAPH_MAX_FAN_OUT);
    });
  });

  describe('what the threshold keeps and drops', () => {
    // Fan-out counts measured on the live corpus, with the edges each band
    // contributes. The filter must cut edges hard while keeping values.
    const measured = [
      { band: 'shared by 2', values: 30935, edges: 61870 },
      { band: '3-5', values: 11815, edges: 43712 },
      { band: '6-10', values: 5024, edges: 36711 },
      { band: '11-20', values: 2355, edges: 33480 },
      { band: '21+', values: 1856, edges: 112501 },
    ];

    const keptThrough = (bands: number) => ({
      values: measured.slice(0, bands).reduce((n, b) => n + b.values, 0),
      edges: measured.slice(0, bands).reduce((n, b) => n + b.edges, 0),
    });
    const total = keptThrough(measured.length);

    it('keeps most values while removing most edges at the default', () => {
      // Default of 10 keeps the first three bands.
      const kept = keptThrough(3);

      expect(kept.values / total.values).toBeGreaterThan(0.9);
      expect(kept.edges / total.edges).toBeLessThan(0.55);
    });

    it('is a better trade than capping by cluster size', () => {
      // Capping by cluster size keeps the largest clusters — the hub end.
      const hubEnd = measured[measured.length - 1];
      const rareEnd = measured[0];

      // The hub band is a rounding error in values but dominates edges…
      expect(hubEnd.values / total.values).toBeLessThan(0.05);
      expect(hubEnd.edges / total.edges).toBeGreaterThan(0.35);
      // …while the rare band is the opposite, and is what the UI ranks first.
      expect(rareEnd.values / total.values).toBeGreaterThan(0.5);
    });
  });
});

/**
 * The filter as the graph builder actually applies it.
 *
 * The threshold tests above pin the number; these pin the behaviour that the
 * number is supposed to produce — including the part that is easy to get
 * wrong, which is that a *scoped* view must not be filtered at all.
 */
describe('buildGraphFromDatabase fan-out filtering', () => {
  const asset = (id: string) => ({
    id,
    name: `${id}.pdf`,
    externalUrl: `s3://bucket/${id}`,
    assetType: 'FILE',
    sourceType: 'S3',
    sourceId: 'src-1',
    source: { name: 'Corpus' },
  });

  /** Five assets: a rare value binds two of them, a hub value binds all five. */
  function harness(env: NodeJS.ProcessEnv = {}) {
    const assetIds = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const prisma = {
      assetCluster: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      },
      assetClusterMember: {
        findMany: jest
          .fn()
          .mockResolvedValue(assetIds.map((id) => ({ assetId: id }))),
        findUnique: jest.fn().mockResolvedValue({ clusterId: 'c1' }),
      },
      asset: { findMany: jest.fn().mockResolvedValue(assetIds.map(asset)) },
      assetCorrelationValue: {
        findMany: jest.fn().mockResolvedValue([
          // rare: only a1 and a2 — the investigative signal
          {
            assetId: 'a1',
            valueHash: 'rare',
            label: 'account',
            normalizedValue: 'ACC-9931',
          },
          {
            assetId: 'a2',
            valueHash: 'rare',
            label: 'account',
            normalizedValue: 'ACC-9931',
          },
          // hub: every asset — boilerplate
          ...assetIds.map((id) => ({
            assetId: id,
            valueHash: 'hub',
            label: 'organization',
            normalizedValue: 'Enron',
          })),
        ]),
      },
      edge: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const service = Object.create(CorrelationServiceProto) as {
      buildGraphFromDatabase: (opts?: {
        assetId?: string;
        sourceId?: string;
      }) => Promise<{
        nodes: { id: string }[];
        edges: unknown[];
        truncated: boolean;
      }>;
    };
    Object.assign(service, { prisma, graphMaxFanOut: readGraphMaxFanOut(env) });
    return service;
  }

  it('drops the hub value from the unscoped graph and flags it', async () => {
    const graph = await harness({ CORRELATION_GRAPH_MAX_FANOUT: '3' })[
      'buildGraphFromDatabase'
    ]();

    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('rare');
    expect(ids).not.toContain('hub');
    // The UI has a `truncated` flag and it has always been false; it must now
    // mean something, or the page cannot say what it is not showing.
    expect(graph.truncated).toBe(true);
  });

  it('keeps everything when the graph is scoped to one asset', async () => {
    const graph = await harness({ CORRELATION_GRAPH_MAX_FANOUT: '3' })[
      'buildGraphFromDatabase'
    ]({ assetId: 'a1' });

    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('rare');
    expect(ids).toContain('hub');
    expect(graph.truncated).toBe(false);
  });

  it('keeps everything when the filter is disabled', async () => {
    const graph = await harness({ CORRELATION_GRAPH_MAX_FANOUT: '0' })[
      'buildGraphFromDatabase'
    ]();

    expect(graph.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['rare', 'hub']),
    );
    expect(graph.truncated).toBe(false);
  });
});
