import { Test, TestingModule } from '@nestjs/testing';
import { SourceGraphService } from './source-graph.service';
import { PrismaService } from '../prisma.service';

/**
 * The connection-map rebuild, at the level that has actually broken things.
 *
 * These assert on the SQL rather than on a database, because the two failure
 * modes worth guarding are both statement-shaped: a cast that Postgres may
 * evaluate before the filter that makes it safe, and an `OR` join that cannot
 * use either edge index.
 */
describe('SourceGraphService rebuild', () => {
  let service: SourceGraphService;
  let executed: string[];

  beforeEach(async () => {
    executed = [];
    const mockPrisma = {
      // Prisma passes tagged-template parts; joining them is enough to assert
      // on the shape of the statement.
      $executeRaw: jest.fn((strings: TemplateStringsArray) => {
        executed.push(Array.from(strings).join(' ? '));
        return Promise.resolve(0);
      }),
      $queryRaw: jest.fn(() =>
        Promise.resolve([{ sources: BigInt(3), links: BigInt(4) }]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourceGraphService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SourceGraphService);
  });

  const sql = () => executed.join('\n');

  it('casts the asset id to text, never the edge endpoint to uuid', async () => {
    await service.rebuild();

    // `edges.from_id` holds a URN, not a UUID, whenever from_type is
    // 'external'. Postgres is free to evaluate a cast before the from_type
    // filter that would have excluded those rows, so `e.from_id::uuid` turns
    // the whole rebuild into "invalid input syntax for type uuid" on any
    // workspace that has ever ingested an unresolved endpoint.
    expect(sql()).toContain('a.id::text = e.from_id');
    expect(sql()).not.toMatch(/from_id::uuid/);
    expect(sql()).not.toMatch(/to_id::uuid/);
  });

  it('unions the two edge endpoint columns instead of OR-ing them', async () => {
    await service.rebuild();

    // An OR across (from_type, from_id) and (to_type, to_id) cannot use either
    // of the edge indexes, which turns the connected-asset count into a full
    // scan of `edges` on every rebuild.
    expect(sql()).toMatch(
      /FROM edges WHERE from_type = 'asset'\s+UNION\s+SELECT to_id/,
    );
  });

  it('counts a source as connected via Asset.links, not only typed edges', async () => {
    await service.rebuild();

    // Those hash references are the same connections the source-detail canvas
    // draws. Leaving them out makes a source whose only links come from them
    // look completely isolated.
    expect(sql()).toContain('jsonb_array_elements_text');
    expect(sql()).toContain('b.hash = l.hash');
  });

  it('truncates each rollup table before repopulating it', async () => {
    await service.rebuild();

    for (const table of [
      'source_graph_links',
      'source_graph_boundary_assets',
      'source_graph_nodes',
    ]) {
      expect(sql()).toContain(`TRUNCATE TABLE ${table}`);
    }
  });

  it('counts each participating asset once, not once per side', async () => {
    await service.rebuild();

    // The older correlation source-pair rollup sums two separate DISTINCTs,
    // which double-counts every asset appearing on both sides of a pairing —
    // and on an intra-source pairing that is most of them.
    expect(sql()).toContain('LATERAL (VALUES (a_id), (b_id))');
    expect(sql()).not.toContain('COUNT(DISTINCT a_id) + COUNT(DISTINCT b_id)');
  });

  it('builds links before nodes, which read them back', async () => {
    await service.rebuild();

    // internal_edge_count is derived from source_graph_links, so a node pass
    // that ran first would report every source as having no internal edges.
    const links = executed.findIndex((s) =>
      s.includes('INSERT INTO source_graph_links'),
    );
    const nodes = executed.findIndex((s) =>
      s.includes('INSERT INTO source_graph_nodes'),
    );
    expect(links).toBeGreaterThanOrEqual(0);
    expect(nodes).toBeGreaterThan(links);
  });
});

/**
 * The read path's job is to stay small on a corpus where "assets that cross a
 * source boundary" is not a small set. Measured on a real workspace: 44,452 of
 * 69,350 assets touch something outside their own source.
 */
describe('SourceGraphService readMap', () => {
  const nodeRows: unknown[] = [];
  const linkRows: unknown[] = [];

  const build = (
    pairSummary: Array<{
      source_id: string;
      peer_source_id: string;
      asset_count: bigint;
      edge_count: bigint;
    }>,
  ) => {
    const queries: string[] = [];
    const mockPrisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const text = Array.from(strings).join(' ? ');
        queries.push(text);
        if (text.includes('FROM source_graph_nodes')) return Promise.resolve(nodeRows);
        if (text.includes('FROM source_graph_links')) return Promise.resolve(linkRows);
        if (text.includes('COUNT(DISTINCT asset_id)'))
          return Promise.resolve(pairSummary);
        return Promise.resolve([]);
      }),
      $executeRaw: jest.fn(() => Promise.resolve(0)),
    };
    return {
      service: new SourceGraphService(mockPrisma as never),
      queries,
      mockPrisma,
    };
  };

  it('bundles a pairing rather than fetching its assets, above the threshold', async () => {
    const { service, queries } = build([
      { source_id: 'a', peer_source_id: 'b', asset_count: BigInt(44452), edge_count: BigInt(90000) },
    ]);

    const map = await service.readMap(12);

    expect(map.bundles).toEqual([
      { sourceId: 'a', peerSourceId: 'b', assetCount: 44452, edgeCount: 90000 },
    ]);
    expect(map.boundary).toEqual([]);
    // The whole point: no statement went looking for those 44,452 rows.
    expect(
      queries.some((q) => q.includes('SELECT asset_id, source_id, peer_source_id')),
    ).toBe(false);
  });

  it('fetches the assets of a pairing small enough to draw', async () => {
    const { service, queries } = build([
      { source_id: 'a', peer_source_id: 'b', asset_count: BigInt(3), edge_count: BigInt(5) },
    ]);

    const map = await service.readMap(12);

    expect(map.bundles).toEqual([]);
    expect(
      queries.some((q) => q.includes('SELECT asset_id, source_id, peer_source_id')),
    ).toBe(true);
  });
});
