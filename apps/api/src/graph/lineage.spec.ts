import { Test, TestingModule } from '@nestjs/testing';
import { GraphService } from '../graph.service';
import { PrismaService } from '../prisma.service';

/**
 * The behaviours that make lineage work, and that all failed silently before:
 * a re-ingest that does not refresh, an unresolvable endpoint that is dropped
 * instead of parked, a hash resolved against the wrong source, and a class
 * filter that is not applied.
 *
 * These run against a mocked Prisma and assert on the SQL that is built —
 * enough to pin the semantics; the end-to-end proof is in the plan's manual
 * verification against a real Postgres.
 */
describe('GraphService lineage ingest', () => {
  let service: GraphService;
  let executed: { sql: string; values: unknown[] }[];

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
    asset: { findMany: jest.fn(), findUnique: jest.fn() },
    finding: { findMany: jest.fn().mockResolvedValue([]) },
    edge: { createMany: jest.fn(), count: jest.fn() },
    caseEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    caseThreadSupport: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(async () => {
    executed = [];
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.$executeRaw.mockImplementation((query: any) => {
      executed.push({
        sql: String(query?.sql ?? ''),
        values: query?.values ?? [],
      });
      return Promise.resolve(1);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(GraphService);
  });

  const lastSql = () => executed[executed.length - 1]?.sql ?? '';
  const lastValues = () => executed[executed.length - 1]?.values ?? [];

  describe('refresh on re-ingest', () => {
    it('updates an existing edge instead of skipping it', async () => {
      // createMany({ skipDuplicates }) silently discarded the second write, so
      // a changed confidence, a newly discovered column mapping and a refreshed
      // last_seen_at never landed. Expiry and provenance both depend on this.
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
        { id: 'a2', hash: 'h2', updatedAt: new Date() },
      ]);

      await service.upsertEdges({
        sourceId: 'src',
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toHash: 'h2',
            relationType: 'TRANSFORM',
            confidence: 0.8,
          },
        ],
      });

      expect(lastSql()).toContain('ON CONFLICT');
      expect(lastSql()).toContain('DO UPDATE');
      expect(lastSql()).toContain('"last_seen_at"   = EXCLUDED."last_seen_at"');
    });

    it('does not overwrite the origin of a hand-drawn edge', async () => {
      // A person drew that edge. A connector later deriving the same
      // relationship should not erase who put it there.
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
        { id: 'a2', hash: 'h2', updatedAt: new Date() },
      ]);
      await service.upsertEdges({
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toHash: 'h2',
            relationType: 'TRANSFORM',
          },
        ],
      });
      expect(lastSql()).toContain(`WHEN "edges"."origin" = 'MANUAL'`);
    });
  });

  describe('unresolved endpoints', () => {
    it('parks a URN nobody has scanned yet instead of dropping it', async () => {
      // This is what makes cross-system lineage independent of scan order.
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
      ]);

      const result = await service.upsertEdges({
        sourceId: 'src',
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toUrn: 'snowflake://acme/PROD/PUBLIC/ORDERS',
            relationType: 'TRANSFORM',
          },
        ],
      });

      expect(result.external).toBe(1);
      expect(result.dropped).toBe(0);
      expect(lastValues()).toContain('external');
      expect(lastValues()).toContain('snowflake://acme/PROD/PUBLIC/ORDERS');
    });

    it('normalizes a URN before parking it', async () => {
      // A URN parked in one spelling and resolved in another never stitches.
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
      ]);
      await service.upsertEdges({
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toUrn: 'S3A://MyBucket/raw/orders.csv',
            relationType: 'COPY',
          },
        ],
      });
      expect(lastValues()).toContain('s3://mybucket/raw/orders.csv');
    });

    it('drops an edge whose hash the emitting source never produced', async () => {
      // Unlike a URN, no later scan will supply it — there is nothing to wait
      // for, so keeping it would be keeping a permanent dangling edge.
      mockPrisma.asset.findMany.mockResolvedValue([]);
      const result = await service.upsertEdges({
        sourceId: 'src',
        edges: [
          {
            fromType: 'asset',
            fromHash: 'missing',
            toType: 'asset',
            toHash: 'alsoMissing',
            relationType: 'TRANSFORM',
          },
        ],
      });
      expect(result).toEqual({ upserted: 0, external: 0, dropped: 1 });
    });
  });

  describe('hash resolution', () => {
    it('scopes hashes to the source that emitted them', async () => {
      // Asset is unique per (sourceId, hash), so a global lookup picks an
      // arbitrary winner when two sources share a hash.
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
        { id: 'a2', hash: 'h2', updatedAt: new Date() },
      ]);
      await service.upsertEdges({
        sourceId: 'src-42',
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toHash: 'h2',
            relationType: 'TRANSFORM',
          },
        ],
      });
      const call = mockPrisma.asset.findMany.mock.calls.find(
        (c: any[]) => c[0]?.where?.hash,
      );
      expect(call?.[0].where.sourceId).toBe('src-42');
    });
  });

  describe('the SQL it builds', () => {
    it('casts every column in the VALUES list', async () => {
      // Postgres types an untyped placeholder inside a VALUES list as `text`,
      // so a missing cast fails the insert outright against a real database —
      // and a mocked Prisma will happily accept it. This assertion is the only
      // thing standing between that bug and production.
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
        { id: 'a2', hash: 'h2', updatedAt: new Date() },
      ]);
      await service.upsertEdges({
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toHash: 'h2',
            relationType: 'TRANSFORM',
            confidence: 0.5,
          },
        ],
      });
      const sql = lastSql();
      for (const cast of [
        '::numeric(3,2)',
        '::timestamp(3)',
        '::"EdgeClass"',
        '::"EdgeGranularity"',
        '::"EdgeMethod"',
        '::jsonb',
      ]) {
        expect(sql).toContain(cast);
      }
    });
  });

  describe('classification', () => {
    it('derives the class when a connector did not send one', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
        { id: 'a2', hash: 'h2', updatedAt: new Date() },
      ]);
      await service.upsertEdges({
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toHash: 'h2',
            relationType: 'ATTACHED_TO',
          },
        ],
      });
      expect(lastValues()).toContain('CONTAINMENT');
    });

    it('marks an edge with column mappings as field-grained', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', hash: 'h1', updatedAt: new Date() },
        { id: 'a2', hash: 'h2', updatedAt: new Date() },
      ]);
      await service.upsertEdges({
        edges: [
          {
            fromType: 'asset',
            fromHash: 'h1',
            toType: 'asset',
            toHash: 'h2',
            relationType: 'TRANSFORM',
            fieldMappings: [
              { downstream: 'delivery_time', upstreams: ['placed_on'] },
            ],
          },
        ],
      });
      expect(lastValues()).toContain('FIELD');
    });
  });

  describe('lineage traversal', () => {
    it('answers "no lineage" without failing', async () => {
      // An asset with no flow edges is an ordinary answer, not an error.
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await expect(service.lineage({ assetId: 'a1' })).resolves.toEqual({
        nodes: [],
        edges: [],
        truncated: false,
      });
    });

    const seedRow = [{ node_type: 'asset', node_id: 'a1', depth: BigInt(0) }];

    it('walks flow edges only', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.$queryRaw.mockResolvedValue(seedRow);
      mockPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          name: 'orders',
          assetType: 'table',
          sourceType: 'POSTGRESQL',
          status: 'NEW',
        },
      ]);

      await service.lineage({ assetId: 'a1', direction: 'both' });

      const sql = mockPrisma.$queryRaw.mock.calls
        .map((c: any[]) => String(c[0]?.sql ?? ''))
        .join('\n');
      expect(sql).toContain('relation_class');
    });

    it('treats upstream as an inward walk', async () => {
      // Flow edges point the way the data moves, so "where did this come from"
      // reads the edges arriving at this node.
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.$queryRaw.mockResolvedValue(seedRow);
      mockPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          name: 'orders',
          assetType: 'table',
          sourceType: 'POSTGRESQL',
          status: 'NEW',
        },
      ]);

      await service.lineage({ assetId: 'a1', direction: 'up' });
      const sql = mockPrisma.$queryRaw.mock.calls
        .map((c: any[]) => String(c[0]?.sql ?? ''))
        .join('\n');
      expect(sql).toContain('e.to_type = t.node_type');
    });
  });
});
