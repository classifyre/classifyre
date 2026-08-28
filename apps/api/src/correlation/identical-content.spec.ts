import { CorrelationService } from './correlation.service';
import type { PrismaService } from '../prisma.service';
import {
  EMPTY_CONTENT_SHA256,
  IDENTICAL_GROUP_CAP,
} from './correlation.constants';

/**
 * Exact duplicates from Asset.contentHash.
 *
 * The weighted scorer derives every token from a finding, so an asset that
 * trips no detector has an empty token set: it scores against nothing and can
 * never be anyone's duplicate. Two byte-identical documents containing nothing
 * a detector matches were invisible to duplicate detection. The content hash
 * has been stored all along and was never read.
 */
describe('exact duplicate linking from the content hash', () => {
  const prisma = {
    asset: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    finding: { findMany: jest.fn() },
    assetCorrelationValue: { deleteMany: jest.fn(), createMany: jest.fn() },
    assetSignature: { upsert: jest.fn() },
    correlationConfig: { findUnique: jest.fn() },
    edge: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const service = new CorrelationService(
    prisma as unknown as PrismaService,
    { runExclusive: (fn: () => Promise<unknown>) => fn() } as never,
    {} as never,
    // Review index: a derived read model the recompute tolerates failing, so
    // these unit tests don't need a real one.
    { refresh: async () => undefined } as never,
  );

  const link = (touched: string[], full = false) =>
    (service as any).linkIdenticalContent(touched, full) as Promise<{
      pairs: number;
      groups: number;
      affectedAssetIds: string[];
    }>;

  /** One duplicate group of `ids` sharing `hash`, as the two queries see it. */
  const oneGroup = (hash: string, ids: string[], countOverride?: number) => {
    prisma.asset.groupBy.mockResolvedValueOnce([
      { contentHash: hash, _count: { _all: countOverride ?? ids.length } },
    ]);
    prisma.asset.findMany.mockResolvedValueOnce(ids.map((id) => ({ id })));
  };

  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: these tests queue results with
    // mockResolvedValueOnce, and clearAllMocks leaves an unconsumed queue in
    // place for the next test to pick up.
    jest.resetAllMocks();
    prisma.edge.createMany.mockResolvedValue({ count: 0 });
    prisma.edge.deleteMany.mockResolvedValue({ count: 0 });
    prisma.asset.groupBy.mockResolvedValue([]);
    prisma.asset.findMany.mockResolvedValue([]);
  });

  it('links a byte-identical group as a star, not a clique', async () => {
    oneGroup('hash-a', ['a1', 'a2', 'a3', 'a4']);

    const result = await link([], true);

    // 4 members: 3 links from the lowest id, not 6 pairwise edges.
    expect(result).toMatchObject({ groups: 1, pairs: 3 });
    const written = prisma.edge.createMany.mock.calls[0][0].data;
    expect(written).toHaveLength(3);
    expect(written.every((e: any) => e.fromId === 'a1')).toBe(true);
    expect(written.map((e: any) => e.toId)).toEqual(['a2', 'a3', 'a4']);
  });

  it('states the claim as its own relation type at full confidence', async () => {
    oneGroup('hash-a', ['a1', 'a2']);

    await link([], true);

    expect(prisma.edge.createMany.mock.calls[0][0].data[0]).toMatchObject({
      relationType: 'identical_content',
      confidence: 1,
      metadata: expect.objectContaining({
        contentHash: 'hash-a',
        groupSize: 2,
        exact: true,
      }),
    });
  });

  /**
   * The scorer wipes and rewrites `related`/`likely_duplicate` on every pass.
   * If exact duplicates reused `likely_duplicate` the two passes would delete
   * each other's work, so they must not share a relation type.
   */
  it('does not reuse the scorer relation types', async () => {
    oneGroup('hash-a', ['a1', 'a2']);

    await link([], true);

    const relation = prisma.edge.createMany.mock.calls[0][0].data[0]
      .relationType as string;
    expect(['related', 'likely_duplicate']).not.toContain(relation);
  });

  it('reports every member as affected so clusters pick the group up', async () => {
    oneGroup('hash-a', ['a1', 'a2', 'a3']);

    const result = await link([], true);

    expect(result.affectedAssetIds.sort()).toEqual(['a1', 'a2', 'a3']);
  });

  /**
   * Empty payloads all hash to the same digest. Grouping every empty file in a
   * corpus into one "duplicate" set is noise — and it would be the largest
   * cluster in most instances.
   */
  it('excludes the empty-content digest', async () => {
    await link([], true);

    expect(prisma.asset.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { contentHash: EMPTY_CONTENT_SHA256 },
        }),
      }),
    );
  });

  it('skips groups too large to be discriminating', async () => {
    oneGroup('hash-big', ['a1', 'a2'], IDENTICAL_GROUP_CAP + 1);

    const result = await link([], true);

    expect(result).toMatchObject({ groups: 0, pairs: 0 });
    expect(prisma.edge.createMany).not.toHaveBeenCalled();
  });

  /**
   * The hub is the lowest id in the group, so an asset joining or leaving moves
   * it. Deleting only the edges that touch the *changed* asset would strand
   * edges pointing at the previous hub, so the whole group is replaced.
   */
  it('replaces the whole group edge set, not just the touched asset', async () => {
    oneGroup('hash-a', ['a1', 'a2', 'a3']);

    await link(['a3'], true);

    expect(prisma.edge.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          relationType: 'identical_content',
          OR: [
            { fromId: { in: ['a1', 'a2', 'a3'] } },
            { toId: { in: ['a1', 'a2', 'a3'] } },
          ],
        }),
      }),
    );
  });

  /**
   * An incremental run must relink a touched asset's whole group, including
   * partners it did not touch — so the scope is resolved to content hashes
   * first, never to the touched ids themselves.
   */
  it('scopes an incremental run by hash so untouched partners are relinked', async () => {
    prisma.asset.findMany.mockResolvedValueOnce([{ contentHash: 'hash-a' }]);
    oneGroup('hash-a', ['a1', 'a2']);

    await link(['a2']);

    expect(prisma.asset.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contentHash: expect.objectContaining({ in: ['hash-a'] }),
        }),
      }),
    );
    expect(prisma.edge.createMany.mock.calls[0][0].data[0]).toMatchObject({
      fromId: 'a1',
      toId: 'a2',
    });
  });

  it('does no work when the touched assets have no content hash', async () => {
    prisma.asset.findMany.mockResolvedValueOnce([]);

    const result = await link(['a1']);

    expect(result).toEqual({ pairs: 0, groups: 0, affectedAssetIds: [] });
    expect(prisma.asset.groupBy).not.toHaveBeenCalled();
  });

  it('ignores an incremental scope that is only empty content', async () => {
    prisma.asset.findMany.mockResolvedValueOnce([
      { contentHash: EMPTY_CONTENT_SHA256 },
    ]);

    const result = await link(['a1']);

    expect(result).toMatchObject({ groups: 0, pairs: 0 });
    expect(prisma.asset.groupBy).not.toHaveBeenCalled();
  });
});
