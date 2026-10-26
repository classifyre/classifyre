import { ServiceUnavailableException } from '@nestjs/common';
import { ExploreService } from './explore.service';

function harness() {
  const prisma = {
    asset: {
      findMany: jest.fn(
        ({ where }: { where: { id?: { in: string[] }; sourceId?: string } }) =>
          Promise.resolve(
            (where.id?.in ?? [`${where.sourceId}-latest`])
              .filter((id) => id !== 'missing')
              .map((id) => ({
                id,
                name: `${id}.txt`,
                assetType: 'TXT',
                sourceType: 'LOCAL_FOLDER',
                sourceId: id.startsWith('far') ? 'elsewhere' : 'src',
                source: { name: 'Shared drive' },
              })),
          ),
      ),
    },
    $queryRaw: jest.fn(() => Promise.resolve([] as unknown[])),
    // The most connected assets of a source, read in a timed transaction.
    mostConnected: [] as Array<{ id: string }>,
    $transaction: jest.fn(),
    caseEvidence: { findMany: jest.fn(() => Promise.resolve([] as unknown[])) },
    finding: { findMany: jest.fn(() => Promise.resolve([] as unknown[])) },
    inquiry: { findMany: jest.fn(() => Promise.resolve([] as unknown[])) },
  };
  prisma.$transaction.mockImplementation(
    (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: jest.fn(() => Promise.resolve(0)),
        $queryRaw: jest.fn(() => Promise.resolve(prisma.mostConnected)),
      }),
  );
  const matching = {
    watchedBy: jest.fn(() => Promise.resolve(new Map<string, string[]>())),
  };
  const graph = {
    trace: jest.fn(() =>
      Promise.resolve({ nodes: [], edges: [], truncated: false }),
    ),
  };
  const embeddings = { assetsAlike: jest.fn(() => Promise.resolve([])) };
  const semanticLayer = {
    meaningTrace: jest.fn(() =>
      Promise.resolve({
        nodes: [],
        edges: [],
        seedTerms: [],
        terms: [],
        truncated: false,
      }),
    ),
  };
  const service = new ExploreService(
    prisma as never,
    graph as never,
    embeddings as never,
    semanticLayer as never,
    matching as never,
  );
  return { service, prisma, graph, embeddings, semanticLayer, matching };
}

describe('ExploreService.neighbourhood', () => {
  it('explores a source from its most connected assets', async () => {
    const h = harness();
    h.prisma.mostConnected = [{ id: 'hub' }, { id: 'far-page' }];

    const view = await h.service.neighbourhood({ sourceId: 'src' });

    const [[first]] = h.graph.trace.mock.calls as unknown as Array<
      [{ seeds: Array<{ id: string }> }]
    >;
    expect(first.seeds.map((s) => s.id)).toEqual(['hub', 'far-page']);
    expect(view.seeds).toEqual(['hub', 'far-page']);
    expect(view.home).toEqual(['src']);
  });

  it('explores a term from the assets that carry it, from no home source', async () => {
    const h = harness();
    h.prisma.$queryRaw.mockResolvedValueOnce([
      { asset_id: 'report' },
      { asset_id: 'far-letter' },
    ]);

    const view = await h.service.neighbourhood({ termId: 'damp' });

    expect(view.seeds).toEqual(['report', 'far-letter']);
    expect(view.home).toEqual([]);
    expect(h.semanticLayer.meaningTrace).toHaveBeenCalledWith(
      ['report', 'far-letter'],
      60,
    );
  });

  it('draws duplicate pairs as they are, without walking', async () => {
    const h = harness();
    h.prisma.mostConnected = [
      {
        a_id: 'hub',
        b_id: 'x',
        family: 'IDENTICAL_CONTENT',
        weighted: 1,
        verdict: null,
      },
      {
        a_id: 'hub',
        b_id: 'y',
        family: 'NEAR_DUPLICATE_TEXT',
        weighted: 0.9,
        verdict: null,
      },
    ] as never;

    const view = await h.service.neighbourhood({
      duplicates: { family: 'IDENTICAL_CONTENT' },
    });

    expect(h.graph.trace).not.toHaveBeenCalled();
    expect(view.seeds).toEqual(['hub']);
    expect(view.edges.map((e) => e.relationType).sort()).toEqual([
      'identical_content',
      'repeated_text',
    ]);
    expect(view.counts.duplicates).toBe(2);
  });

  it('starts a source with no connections from what it scanned last', async () => {
    const h = harness();

    const view = await h.service.neighbourhood({ sourceId: 'src' });

    expect(view.seeds).toEqual(['src-latest']);
  });

  it("measures 'same source' against the starting points' own", async () => {
    const h = harness();

    const view = await h.service.neighbourhood({ assetIds: ['a', 'far-b'] });

    expect(view.home.sort()).toEqual(['elsewhere', 'src']);
  });

  it('walks each edge kind on its own, through live assets only', async () => {
    const h = harness();

    await h.service.neighbourhood({ assetIds: ['a'] });

    const calls = h.graph.trace.mock.calls as unknown as Array<
      [{ kinds: string[]; activeOnly: boolean; depth: number }]
    >;
    expect(calls.map(([c]) => c.kinds)).toEqual([
      ['lineage'],
      ['links'],
      ['duplicates'],
      ['similar'],
    ]);
    expect(calls.every(([c]) => c.activeOnly && c.depth === 1)).toBe(true);
    expect(h.semanticLayer.meaningTrace).toHaveBeenCalledWith(['a'], 60);
    expect(h.embeddings.assetsAlike).toHaveBeenCalledWith('a', 8);
  });

  it('asks only for the kinds requested', async () => {
    const h = harness();

    await h.service.neighbourhood({ assetIds: ['a'], kinds: ['alike'] });

    expect(h.graph.trace).not.toHaveBeenCalled();
    expect(h.semanticLayer.meaningTrace).not.toHaveBeenCalled();
    expect(h.embeddings.assetsAlike).toHaveBeenCalledTimes(1);
  });

  it('says so when embeddings are off instead of failing the view', async () => {
    const h = harness();
    h.embeddings.assetsAlike.mockRejectedValue(
      new ServiceUnavailableException('off'),
    );

    const view = await h.service.neighbourhood({ assetIds: ['a'] });

    expect(view.alike).toBe('off');
    expect(view.seeds).toEqual(['a']);
  });

  it('ignores seeds that no longer exist and returns nothing for none', async () => {
    const h = harness();

    const view = await h.service.neighbourhood({ assetIds: ['missing'] });

    expect(view.seeds).toEqual([]);
    expect(view.nodes).toEqual([]);
    expect(h.graph.trace).not.toHaveBeenCalled();
  });

  it('traces lineage and links as far and as one-way as asked, the rest at most two hops', async () => {
    const h = harness();

    await h.service.neighbourhood({
      assetIds: ['a'],
      depth: 6,
      direction: 'up',
    });

    const calls = h.graph.trace.mock.calls as unknown as Array<
      [{ kinds: string[]; depth: number; direction: string; limit: number }]
    >;
    const byKind = new Map(calls.map(([c]) => [c.kinds[0], c]));
    expect(byKind.get('lineage')).toMatchObject({ depth: 6, direction: 'up' });
    expect(byKind.get('links')).toMatchObject({ depth: 6, direction: 'up' });
    expect(byKind.get('duplicates')).toMatchObject({
      depth: 2,
      direction: 'both',
    });
    expect(byKind.get('lineage')!.limit).toBeGreaterThan(
      byKind.get('duplicates')!.limit,
    );
  });

  it('marks the assets a case holds and the ones a watch is answering', async () => {
    const h = harness();
    h.prisma.caseEvidence.findMany.mockResolvedValueOnce([
      {
        entityId: 'a',
        investigation: { id: 'c1', title: 'Leak at 2C', status: 'OPEN' },
      },
    ]);
    h.prisma.finding.findMany.mockResolvedValueOnce([
      { id: 'f1', assetId: 'a' },
    ]);
    h.matching.watchedBy.mockResolvedValueOnce(new Map([['f1', ['q1']]]));
    h.prisma.inquiry.findMany.mockResolvedValueOnce([
      { id: 'q1', title: 'Water damage claims', status: 'ACTIVE' },
    ]);

    const view = await h.service.neighbourhood({ assetIds: ['a'] });

    expect(view.nodes[0]).toMatchObject({
      caseIds: ['c1'],
      inquiryIds: ['q1'],
    });
    expect(view.cases).toEqual([
      { id: 'c1', title: 'Leak at 2C', status: 'OPEN' },
    ]);
    expect(view.inquiries).toEqual([
      { id: 'q1', title: 'Water damage claims', status: 'ACTIVE' },
    ]);
  });

  it('adds repeated-text pairs from duplicate review as "same as"', async () => {
    const h = harness();
    h.prisma.$queryRaw.mockResolvedValueOnce([
      { a_id: 'a', b_id: 'b', weighted: 0.92, verdict: 'CONFIRMED' },
    ]);

    const view = await h.service.neighbourhood({
      assetIds: ['a'],
      kinds: ['duplicates'],
    });

    expect(view.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(view.edges).toEqual([
      expect.objectContaining({
        id: 'px:a:b',
        kind: 'duplicates',
        relationType: 'repeated_text_confirmed',
        confidence: 0.92,
      }),
    ]);
    // Pairs ruled not the same never come back.
    const sql = (h.prisma.$queryRaw.mock.calls[0] as unknown[])[0] as {
      strings: string[];
    };
    expect(sql.strings.join('?')).toContain("NOT IN ('REJECTED', 'SPLIT')");
  });

  it('caps depth at six hops', async () => {
    const h = harness();

    await h.service.neighbourhood({ assetIds: ['a'], depth: 40 });

    const calls = h.graph.trace.mock.calls as unknown as Array<
      [{ depth: number }]
    >;
    expect(calls[0][0].depth).toBe(6);
  });
});
