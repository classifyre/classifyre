import { Test, TestingModule } from '@nestjs/testing';
import { GraphService } from './graph.service';
import { PrismaService } from './prisma.service';

describe('GraphService', () => {
  let service: GraphService;

  const mockPrisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    asset: { findMany: jest.fn(), findUnique: jest.fn() },
    finding: { findMany: jest.fn() },
    edge: { createMany: jest.fn(), count: jest.fn() },
    caseEvidence: { findMany: jest.fn() },
    hypothesisSupport: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<GraphService>(GraphService);
    jest.clearAllMocks();
  });

  describe('expand', () => {
    it('hydrates nodes and edges and flags missing entities', async () => {
      // First $queryRaw call -> traversal nodes, second -> edges among nodes.
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          { node_type: 'asset', node_id: 'a1', depth: 0 },
          { node_type: 'finding', node_id: 'f1', depth: 1 },
          { node_type: 'asset', node_id: 'gone', depth: 2 },
        ])
        .mockResolvedValueOnce([
          {
            id: 'e1',
            from_type: 'asset',
            from_id: 'a1',
            to_type: 'finding',
            to_id: 'f1',
            relation_type: 'CONTAINS',
            confidence: '0.90',
            origin: 'INFERRED',
          },
        ]);
      mockPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          name: 'customer.csv',
          assetType: 'file',
          sourceType: 'S3_COMPATIBLE_STORAGE',
          status: 'NEW',
        },
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        {
          id: 'f1',
          findingType: 'ssn',
          severity: 'HIGH',
          detectorType: 'PII',
          status: 'OPEN',
        },
      ]);

      const result = await service.expand({
        entityType: 'asset',
        entityId: 'a1',
        depth: 2,
        direction: 'both',
      });

      expect(result.nodes).toHaveLength(3);
      const a1 = result.nodes.find((n) => n.id === 'a1');
      expect(a1?.label).toBe('customer.csv');
      const gone = result.nodes.find((n) => n.id === 'gone');
      expect(gone?.missing).toBe(true);
      expect(gone?.label).toBe('(deleted asset)');
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].confidence).toBe(0.9);
      expect(result.truncated).toBe(false);
    });

    it('marks the graph as truncated when the node cap is reached', async () => {
      const nodeRows = Array.from({ length: 200 }, (_, i) => ({
        node_type: 'asset',
        node_id: `a${i}`,
        depth: 1,
      }));
      mockPrisma.$queryRaw
        .mockResolvedValueOnce(nodeRows)
        .mockResolvedValueOnce([]);
      mockPrisma.asset.findMany.mockResolvedValue([]);
      mockPrisma.finding.findMany.mockResolvedValue([]);

      const result = await service.expand({
        entityType: 'asset',
        entityId: 'a0',
        depth: 3,
      });

      expect(result.nodes).toHaveLength(200);
      expect(result.truncated).toBe(true);
    });
  });

  describe('rebuildEdges', () => {
    it('inserts CONTAINS edges and resolves REFERENCES from links', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      // assetsWithLinks
      mockPrisma.asset.findMany
        .mockResolvedValueOnce([
          { id: 'a1', links: [{ url: 'http://x/customer' }, 'a2'] },
        ])
        // resolved matches
        .mockResolvedValueOnce([
          { id: 'a2', externalUrl: 'http://a2' },
          { id: 'a9', externalUrl: 'http://x/customer' },
        ]);
      mockPrisma.edge.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.edge.count.mockResolvedValue(5);

      const result = await service.rebuildEdges();

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      const createArg = mockPrisma.edge.createMany.mock.calls[0][0];
      const targets = createArg.data.map((r: { toId: string }) => r.toId).sort();
      expect(targets).toEqual(['a2', 'a9']);
      expect(createArg.data.every((r: { relationType: string }) => r.relationType === 'REFERENCES')).toBe(true);
      expect(result.edgeCount).toBe(5);
    });

    it('does not create self-referencing edges', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.asset.findMany
        .mockResolvedValueOnce([{ id: 'a1', links: ['a1'] }])
        .mockResolvedValueOnce([{ id: 'a1', externalUrl: 'http://a1' }]);
      mockPrisma.edge.count.mockResolvedValue(0);

      await service.rebuildEdges();

      expect(mockPrisma.edge.createMany).not.toHaveBeenCalled();
    });
  });

  describe('caseGraph', () => {
    it('returns an empty graph when the case has no evidence', async () => {
      mockPrisma.caseEvidence.findMany.mockResolvedValue([]);
      const result = await service.caseGraph('case-1', 2);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('renders sandbox evidence and its findings from snapshots (no live tables)', async () => {
      mockPrisma.caseEvidence.findMany.mockResolvedValue([
        {
          id: 'ev1',
          entityType: 'sandbox',
          entityId: 'run-1',
          label: 'leak.csv',
          assetType: 'table',
          sourceType: 'SANDBOX',
          findings: [
            {
              id: 'cf1',
              findingId: 'sandbox:run-1:0',
              label: 'email',
              severity: 'HIGH',
              detectorType: 'PII',
              matchedContent: 'a@b.com',
            },
          ],
        },
      ]);
      mockPrisma.hypothesisSupport.findMany.mockResolvedValue([]);

      const result = await service.caseGraph('case-1', 1);

      const sandbox = result.nodes.find((n) => n.type === 'sandbox');
      expect(sandbox?.label).toBe('leak.csv');
      const finding = result.nodes.find((n) => n.type === 'finding');
      expect(finding?.id).toBe('sandbox:run-1:0');
      expect(finding?.caseFindingId).toBe('cf1');
      // No recursive traversal for a sandbox-only case.
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].relationType).toBe('CONTAINS');
    });

    it('keeps deleted asset/finding nodes alive via case snapshots', async () => {
      mockPrisma.caseEvidence.findMany.mockResolvedValue([
        {
          id: 'ev1',
          entityType: 'asset',
          entityId: 'a1',
          label: 'customer.csv',
          assetType: 'file',
          sourceType: 'S3_COMPATIBLE_STORAGE',
          findings: [
            { id: 'cf1', findingId: 'f1', label: 'Contains PII', severity: 'HIGH', detectorType: 'PII', matchedContent: null },
          ],
        },
      ]);
      // inferEdgesForAsset + traverse: asset row gone, finding row gone.
      mockPrisma.$executeRaw.mockResolvedValue(1);
      mockPrisma.asset.findUnique.mockResolvedValue(null);
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          { node_type: 'asset', node_id: 'a1', depth: 0 },
          { node_type: 'finding', node_id: 'f1', depth: 1 },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.asset.findMany.mockResolvedValue([]);
      mockPrisma.finding.findMany.mockResolvedValue([]);
      mockPrisma.hypothesisSupport.findMany.mockResolvedValue([]);

      const result = await service.caseGraph('case-1', 1);

      const asset = result.nodes.find((n) => n.type === 'asset');
      expect(asset?.label).toBe('customer.csv');
      const finding = result.nodes.find((n) => n.type === 'finding');
      expect(finding?.label).toBe('Contains PII');
      expect(finding?.caseFindingId).toBe('cf1');
    });
  });
});
