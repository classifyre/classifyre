import { Test, TestingModule } from '@nestjs/testing';
import { AgentSearchService } from './agent-search.service';
import { PrismaService } from '../../prisma.service';
import { InquiryMatchingService } from '../../matching/inquiry-matching.service';

describe('AgentSearchService — asset observation (cold start)', () => {
  let service: AgentSearchService;

  const mockPrisma = {
    asset: { findMany: jest.fn(), count: jest.fn() },
    finding: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    customDetector: { findMany: jest.fn() },
    customDetectorFeedback: { groupBy: jest.fn() },
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
      mockPrisma.asset.count.mockResolvedValue(3);

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
      mockPrisma.asset.count.mockResolvedValue(0);
      const profile = await service.assetMetadataProfile(null, null);
      expect(profile.scope).toBe('instance');
    });

    // G-026. asset.runnerId names the LAST runner to touch an asset, so once a
    // newer run re-stamps them, a runner-scoped profile returns zero — which
    // reads exactly like an empty source. A CONFIG run reviewing a superseded
    // runner took it as one: it wrote a false "0 assets and 0 findings" memory
    // for a source holding 13 assets and 3,239 findings, and triggered a
    // pointless rescan.
    describe('a superseded runner cannot look like an empty source (G-026)', () => {
      /** The reported shape: runner 07fb… reviewed after run e2c… re-stamped every asset. */
      const arrangeSupersededRunner = () => {
        mockPrisma.asset.findMany.mockResolvedValue([]); // nothing still points at this runner
        mockPrisma.finding.count
          .mockResolvedValueOnce(0) // scoped to the stale runner
          .mockResolvedValueOnce(3239); // the source's live open findings
        mockPrisma.asset.count
          .mockResolvedValueOnce(0) // scoped to the stale runner
          .mockResolvedValueOnce(13); // the source's live active assets
      };

      it('still reports the source totals when the runner scope is empty', async () => {
        arrangeSupersededRunner();

        const profile = await service.assetMetadataProfile(
          'src-1',
          'runner-stale',
        );

        expect(profile.scope).toBe('runner');
        expect(profile.totalAssets).toBe(0);
        // The fact that makes "the source is empty" impossible to conclude.
        expect(profile.sourceTotals).toEqual({
          activeAssets: 13,
          openFindings: 3239,
        });
      });

      it('flags the runner as superseded', async () => {
        arrangeSupersededRunner();

        const profile = await service.assetMetadataProfile(
          'src-1',
          'runner-stale',
        );

        expect(profile.runnerSuperseded).toBe(true);
      });

      it('does not flag a current runner as superseded', async () => {
        mockPrisma.asset.findMany.mockResolvedValue([
          { assetType: 'file', sourceType: 'LOCAL_FOLDER', metadata: null },
        ]);
        mockPrisma.finding.count
          .mockResolvedValueOnce(3239)
          .mockResolvedValueOnce(3239);
        mockPrisma.asset.count
          .mockResolvedValueOnce(13)
          .mockResolvedValueOnce(13);

        const profile = await service.assetMetadataProfile(
          'src-1',
          'runner-current',
        );

        expect(profile.runnerSuperseded).toBe(false);
        expect(profile.totalAssets).toBe(13);
      });

      it('flags partial supersession when a later run touched only some assets', async () => {
        mockPrisma.asset.findMany.mockResolvedValue([
          { assetType: 'file', sourceType: 'LOCAL_FOLDER', metadata: null },
        ]);
        mockPrisma.finding.count
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(50);
        mockPrisma.asset.count
          .mockResolvedValueOnce(4)
          .mockResolvedValueOnce(13);

        const profile = await service.assetMetadataProfile(
          'src-1',
          'runner-partial',
        );

        expect(profile.runnerSuperseded).toBe(true);
        expect(profile.totalAssets).toBe(4);
        expect(profile.sourceTotals?.activeAssets).toBe(13);
      });

      it('reports a genuinely empty source as empty, not superseded', async () => {
        // The cold-start case the profile exists to serve must still work.
        mockPrisma.asset.findMany.mockResolvedValue([]);
        mockPrisma.finding.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0);
        mockPrisma.asset.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(0);

        const profile = await service.assetMetadataProfile('src-1', 'runner-1');

        expect(profile.totalAssets).toBe(0);
        expect(profile.sourceTotals).toEqual({
          activeAssets: 0,
          openFindings: 0,
        });
        expect(profile.runnerSuperseded).toBe(false);
      });

      it('counts the real scope, not the capped sample', async () => {
        // totalAssets was rows.length — the sample — so any scope larger than
        // ASSET_PROFILE_SCAN_LIMIT under-reported itself.
        mockPrisma.asset.findMany.mockResolvedValue(
          Array.from({ length: 3 }, () => ({
            assetType: 'file',
            sourceType: 'LOCAL_FOLDER',
            metadata: null,
          })),
        );
        mockPrisma.finding.count
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(1);
        mockPrisma.asset.count
          .mockResolvedValueOnce(3144)
          .mockResolvedValueOnce(3144);

        const profile = await service.assetMetadataProfile('src-1', null);

        expect(profile.totalAssets).toBe(3144);
      });
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

  describe('customDetectorPrecision', () => {
    it('folds operator triage into a per-detector false-positive rate + verdict', async () => {
      mockPrisma.customDetector.findMany.mockResolvedValue([
        { key: 'noisy', name: 'Noisy' },
        { key: 'clean', name: 'Clean' },
        { key: 'thin', name: 'Thin' },
        { key: 'fresh', name: 'Fresh' },
      ]);
      mockPrisma.customDetectorFeedback.groupBy.mockResolvedValue([
        // noisy: 8 dismissed (FP+IGNORED) / 10 reviewed = 0.8 → noisy
        { customDetectorKey: 'noisy', status: 'FALSE_POSITIVE', _count: 6 },
        { customDetectorKey: 'noisy', status: 'IGNORED', _count: 2 },
        { customDetectorKey: 'noisy', status: 'RESOLVED', _count: 2 },
        // clean: 1 dismissed / 10 reviewed = 0.1 → clean
        { customDetectorKey: 'clean', status: 'FALSE_POSITIVE', _count: 1 },
        { customDetectorKey: 'clean', status: 'RESOLVED', _count: 9 },
        // thin: only 2 reviews — below sample floor → unproven
        { customDetectorKey: 'thin', status: 'FALSE_POSITIVE', _count: 2 },
      ]);
      mockPrisma.finding.groupBy.mockResolvedValue([
        { customDetectorKey: 'noisy', _count: 4 },
      ]);

      const rows = await service.customDetectorPrecision();

      // Sorted noisiest-first.
      expect(rows.map((r) => r.customDetectorKey)).toEqual([
        'noisy',
        'clean',
        'thin',
        'fresh',
      ]);

      const noisy = rows.find((r) => r.customDetectorKey === 'noisy')!;
      expect(noisy).toMatchObject({
        openFindings: 4,
        dismissed: 8,
        confirmed: 2,
        reviewed: 10,
        falsePositiveRate: 0.8,
        verdict: 'noisy',
      });

      const clean = rows.find((r) => r.customDetectorKey === 'clean')!;
      expect(clean).toMatchObject({ falsePositiveRate: 0.1, verdict: 'clean' });

      const thin = rows.find((r) => r.customDetectorKey === 'thin')!;
      expect(thin.verdict).toBe('unproven');

      // No feedback at all → rate null, verdict unproven, zero open findings.
      const fresh = rows.find((r) => r.customDetectorKey === 'fresh')!;
      expect(fresh).toMatchObject({
        reviewed: 0,
        falsePositiveRate: null,
        verdict: 'unproven',
        openFindings: 0,
      });
    });

    it('scopes to one detector key and short-circuits when none exist', async () => {
      mockPrisma.customDetector.findMany.mockResolvedValue([]);
      const rows = await service.customDetectorPrecision('cust_x');
      expect(rows).toEqual([]);
      expect(mockPrisma.customDetector.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, key: 'cust_x' }),
        }),
      );
      // Nothing to aggregate — feedback/finding groupBy never runs.
      expect(mockPrisma.customDetectorFeedback.groupBy).not.toHaveBeenCalled();
    });
  });
});
