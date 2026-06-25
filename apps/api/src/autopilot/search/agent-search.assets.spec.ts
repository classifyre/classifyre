import { Test, TestingModule } from '@nestjs/testing';
import { AgentSearchService } from './agent-search.service';
import { PrismaService } from '../../prisma.service';
import { InquiryMatchingService } from '../../matching/inquiry-matching.service';

describe('AgentSearchService — asset observation (cold start)', () => {
  let service: AgentSearchService;

  const mockPrisma = {
    asset: { findMany: jest.fn() },
    finding: { count: jest.fn(), findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InquiryMatchingService, useValue: {} },
      ],
    }).compile();
    service = module.get(AgentSearchService);
    jest.clearAllMocks();
  });

  describe('sampleAssets', () => {
    it('returns redacted metadata keys + bounded preview', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          assetType: 'table',
          sourceType: 'POSTGRES',
          name: 'public.users',
          externalUrl: 'postgres://db/public.users',
          metadata: {
            column_names: ['email', 'ssn', 'created_at'],
            row_count: 1000,
            nested: { deep: true },
          },
        },
      ]);

      const out = await service.sampleAssets('src-1', null);
      expect(out).toHaveLength(1);
      expect(out[0].assetType).toBe('table');
      expect(out[0].metadataKeys).toEqual(
        expect.arrayContaining(['column_names', 'row_count', 'nested']),
      );
      // Arrays summarised, objects collapsed — not dumped verbatim.
      expect(out[0].metadataPreview.column_names).toContain('email');
      expect(out[0].metadataPreview.nested).toBe('{…}');
    });

    it('scopes by runner when given (scan delta)', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([]);
      await service.sampleAssets('src-1', 'runner-9');
      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { runnerId: 'runner-9' } }),
      );
    });
  });

  describe('assetMetadataProfile', () => {
    it('aggregates asset/source kinds and flags hasFindings=false on cold start', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([
        {
          assetType: 'table',
          sourceType: 'POSTGRES',
          metadata: { column_names: [] },
        },
        {
          assetType: 'table',
          sourceType: 'POSTGRES',
          metadata: { row_count: 5 },
        },
        { assetType: 'file', sourceType: 'S3', metadata: null },
      ]);
      mockPrisma.finding.count.mockResolvedValue(0);

      const profile = await service.assetMetadataProfile('src-1', null);
      expect(profile.scope).toBe('source');
      expect(profile.totalAssets).toBe(3);
      expect(profile.hasFindings).toBe(false);
      expect(profile.assetTypes[0]).toEqual({ type: 'table', count: 2 });
      expect(profile.commonMetadataKeys.map((k) => k.type)).toEqual(
        expect.arrayContaining(['column_names', 'row_count']),
      );
    });

    it('reports instance scope when neither source nor runner is given', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([]);
      mockPrisma.finding.count.mockResolvedValue(0);
      const profile = await service.assetMetadataProfile(null, null);
      expect(profile.scope).toBe('instance');
    });
  });

  describe('summarizeNewFindings', () => {
    it('applies the optional customDetectorKey filter to the query', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      await service.summarizeNewFindings('s1', null, 'my-detector');
      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceId: 's1',
            customDetectorKey: 'my-detector',
          }),
        }),
      );
    });

    it('omits the filter when no customDetectorKey is given', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);
      await service.summarizeNewFindings('s1', null);
      const where = mockPrisma.finding.findMany.mock.calls[0]![0].where;
      expect(where.customDetectorKey).toBeUndefined();
    });
  });
});
