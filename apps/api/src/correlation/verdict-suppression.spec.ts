import { CorrelationService } from './correlation.service';
import type { PrismaService } from '../prisma.service';

/**
 * A reviewer's decision has to outlive the next scan.
 *
 * Cluster membership is rebuilt by union-find over the scorer's edges, and the
 * scorer deletes and rewrites those edges every recompute. Without a check
 * against recorded verdicts the sequence is: reviewer splits a cluster, the
 * next scan re-scores the same pair above threshold, union-find joins it back,
 * and the decision disappears with no trace and no error. The queue would then
 * be asking people to make the same judgement over and over.
 */
describe('verdicts suppress cluster union', () => {
  const prisma = {
    assetCluster: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    assetClusterMember: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    assetCorrelationValue: { findMany: jest.fn() },
    correlationPairVerdict: { findMany: jest.fn() },
    edge: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const service = new CorrelationService(
    prisma as unknown as PrismaService,
    { runExclusive: (fn: () => Promise<unknown>) => fn() } as never,
    {} as never,
    { refresh: async () => undefined } as never,
  );

  const cfg = {
    weightOf: () => 1,
    rawWeights: {},
    defaultWeight: 1,
    relatedMin: 0.3,
    duplicateMin: 0.6,
    isExcluded: () => false,
  };

  /** a—b—c chained by duplicate edges: one component of three. */
  const chain = [
    { id: 'e1', fromId: 'a', toId: 'b' },
    { id: 'e2', fromId: 'b', toId: 'c' },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.assetCluster.deleteMany.mockResolvedValue({ count: 0 });
    prisma.assetClusterMember.createMany.mockResolvedValue({ count: 0 });
    prisma.assetClusterMember.deleteMany.mockResolvedValue({ count: 0 });
    // refreshClusterStats reads the members back; these tests only assert what
    // was written, so a stable empty read is enough.
    prisma.assetClusterMember.findMany.mockResolvedValue([]);
    prisma.assetCluster.delete.mockResolvedValue({});
    prisma.assetCluster.update.mockResolvedValue({});
    prisma.assetCorrelationValue.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    let n = 0;
    prisma.assetCluster.create.mockImplementation(() =>
      Promise.resolve({ id: `cluster-${++n}` }),
    );
  });

  /** Cluster ids and their members, as rebuildAllClusters wrote them. */
  const createdClusters = (): string[][] =>
    prisma.assetClusterMember.createMany.mock.calls.map((call) =>
      (call[0] as { data: Array<{ assetId: string }> }).data.map(
        (m) => m.assetId,
      ),
    );

  const rebuild = () =>
    (service as never as {
      rebuildAllClusters: (c: unknown) => Promise<number>;
    }).rebuildAllClusters(cfg);

  it('joins the whole chain when nothing has been ruled out', () => {
    prisma.edge.findMany.mockResolvedValueOnce(chain).mockResolvedValue([]);
    prisma.correlationPairVerdict.findMany.mockResolvedValue([]);

    return rebuild().then(() => {
      const clusters = createdClusters();
      expect(clusters).toHaveLength(1);
      expect(clusters[0].sort()).toEqual(['a', 'b', 'c']);
    });
  });

  it('splits the chain where a reviewer cut it', async () => {
    prisma.edge.findMany.mockResolvedValueOnce(chain).mockResolvedValue([]);
    prisma.correlationPairVerdict.findMany.mockResolvedValue([
      { aId: 'b', bId: 'c' },
    ]);

    await rebuild();

    // b—c was cut, so only a—b survives: one cluster of two, and c alone.
    const clusters = createdClusters();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(['a', 'b']);
    expect(clusters[0]).not.toContain('c');
  });

  it('suppresses regardless of which way round the verdict was recorded', async () => {
    // The scorer writes edges in canonical order, but a verdict can arrive
    // from either side of the pair. Matching only one direction would make
    // suppression silently depend on id sort order.
    prisma.edge.findMany.mockResolvedValueOnce(chain).mockResolvedValue([]);
    prisma.correlationPairVerdict.findMany.mockResolvedValue([
      { aId: 'c', bId: 'b' },
    ]);

    await rebuild();

    const clusters = createdClusters();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual(['a', 'b']);
  });

  it('only asks for the verdicts that actually suppress', async () => {
    prisma.edge.findMany.mockResolvedValueOnce(chain).mockResolvedValue([]);
    prisma.correlationPairVerdict.findMany.mockResolvedValue([]);

    await rebuild();

    // CONFIRMED agrees with the engine and UNSURE is explicitly not a
    // decision; treating either as a cut would be wrong.
    expect(prisma.correlationPairVerdict.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { verdict: { in: ['REJECTED', 'SPLIT'] } },
      }),
    );
  });
});
