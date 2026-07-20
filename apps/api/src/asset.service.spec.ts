import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from './asset.service';
import { PrismaService } from './prisma.service';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';
import { EmbeddingService } from './embedding/embedding.service';
import { QueryEmbeddingService } from './embedding/query-embedding.service';
import {
  AssetStatus,
  AssetType,
  DetectorType,
  FindingStatus,
  Severity,
} from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { generateDetectionIdentity } from './utils/detection-identity';
import { computeScopeFingerprint } from './utils/scope-fingerprint';
import { HistoryEventType } from './types/finding-history.types';
import {
  SearchAssetsSortBy,
  SearchAssetsSortOrder,
} from './dto/search-assets-request.dto';
import { SemanticSearchMode } from './dto/search-findings-request.dto';

describe('AssetService', () => {
  let service: AssetService;

  const mockPrismaService = {
    source: {
      findUnique: jest.fn(),
    },
    runner: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    finding: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
    runnerAsset: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockCustomDetectorExtractionsService = {
    createFromIngestion: jest.fn(),
  };

  const mockEmbeddingService = {
    semanticAssetIds: jest.fn(),
  };

  const mockQueryEmbeddingService = {
    embed: jest.fn(),
    embedIfAvailable: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CustomDetectorExtractionsService,
          useValue: mockCustomDetectorExtractionsService,
        },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: QueryEmbeddingService, useValue: mockQueryEmbeddingService },
      ],
    }).compile();

    service = module.get<AssetService>(AssetService);

    jest.clearAllMocks();
    // Default: no per-detector outcomes recorded, so nothing is resolvable for
    // absence. Tests that exercise resolution opt in explicitly.
    mockPrismaService.runnerAsset.findMany.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAssetById status (R-11)', () => {
    const baseAsset = {
      id: 'asset-1',
      hash: 'hash-1',
      checksum: 'chk-1',
      name: 'memo.txt',
      runnerId: 'runner-1',
      status: AssetStatus.UNCHANGED,
      links: [],
      metadata: {},
    };

    beforeEach(() => {
      mockPrismaService.asset.findUnique.mockResolvedValue(baseAsset);
    });

    it('reports NEW for a first-seen asset whose run change_type is CREATED', async () => {
      // Stored status is a stale UNCHANGED (second ingest pass), but the run
      // recorded CREATED — get_asset must agree with the run summary.
      mockPrismaService.runnerAsset.findUnique.mockResolvedValue({
        changeType: 'CREATED',
      });

      const result = await service.getAssetById('asset-1');

      expect(result?.status).toBe(AssetStatus.NEW);
      expect(mockPrismaService.runnerAsset.findUnique).toHaveBeenCalledWith({
        where: {
          runnerId_assetHash: { runnerId: 'runner-1', assetHash: 'hash-1' },
        },
        select: { changeType: true },
      });
    });

    it('falls back to the stored status when there is no runner_asset change_type', async () => {
      mockPrismaService.runnerAsset.findUnique.mockResolvedValue(null);

      const result = await service.getAssetById('asset-1');

      expect(result?.status).toBe(AssetStatus.UNCHANGED);
    });

    it('does not query runner_assets for an asset that was never scanned', async () => {
      mockPrismaService.asset.findUnique.mockResolvedValue({
        ...baseAsset,
        runnerId: null,
        status: AssetStatus.NEW,
      });

      const result = await service.getAssetById('asset-1');

      expect(result?.status).toBe(AssetStatus.NEW);
      expect(mockPrismaService.runnerAsset.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('searchAssets', () => {
    it('ranks asset chunks semantically while preserving asset filters', async () => {
      const now = new Date();
      const asset = {
        id: 'asset-semantic',
        hash: 'hash-semantic',
        checksum: 'checksum-semantic',
        name: 'Unrelated filename.pdf',
        externalUrl: null,
        links: [],
        metadata: null,
        assetType: 'file',
        sourceType: AssetType.LOCAL_FOLDER,
        sourceId: 'source-1',
        runnerId: 'runner-1',
        status: AssetStatus.NEW,
        lastScannedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      mockQueryEmbeddingService.embed.mockResolvedValue([1, 0]);
      mockEmbeddingService.semanticAssetIds.mockResolvedValue([
        { id: asset.id, score: 0.91 },
      ]);
      mockPrismaService.asset.findMany
        .mockResolvedValueOnce([{ id: asset.id }])
        .mockResolvedValueOnce([asset]);
      mockPrismaService.finding.findMany.mockResolvedValue([]);

      const result = await service.searchAssets({
        assets: { sourceId: 'source-1', search: 'meaning not filename' },
        semantic: {
          query: 'meaning not filename',
          mode: SemanticSearchMode.VECTOR,
        },
        options: { includeAssetsWithoutFindings: true },
      });

      expect(mockEmbeddingService.semanticAssetIds).toHaveBeenCalledWith(
        [1, 0],
        200,
        'source-1',
      );
      expect(result.items[0]?.asset.id).toBe(asset.id);
      expect(result.ranking).toEqual({
        mode: SemanticSearchMode.VECTOR,
        query: 'meaning not filename',
        explained: true,
      });
    });

    it('falls back to lexical ranking when hybrid query embedding is unavailable', async () => {
      const now = new Date();
      const asset = {
        id: 'asset-lexical',
        hash: 'hash-lexical',
        checksum: 'checksum-lexical',
        name: 'docket reference.pdf',
        externalUrl: null,
        links: [],
        metadata: null,
        assetType: 'file',
        sourceType: AssetType.LOCAL_FOLDER,
        sourceId: 'source-1',
        runnerId: 'runner-1',
        status: AssetStatus.NEW,
        lastScannedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      mockQueryEmbeddingService.embedIfAvailable.mockResolvedValue(null);
      mockPrismaService.asset.findMany
        .mockResolvedValueOnce([{ id: asset.id }])
        .mockResolvedValueOnce([{ id: asset.id }])
        .mockResolvedValueOnce([asset]);
      mockPrismaService.finding.findMany.mockResolvedValue([]);

      const result = await service.searchAssets({
        assets: { sourceId: 'source-1' },
        semantic: {
          query: 'docket reference',
          mode: SemanticSearchMode.HYBRID,
        },
        options: { includeAssetsWithoutFindings: true },
      });

      expect(mockEmbeddingService.semanticAssetIds).not.toHaveBeenCalled();
      expect(result.items[0]?.asset.id).toBe(asset.id);
      expect(result.ranking?.mode).toBe('lexical-fallback');
    });

    it('should return paginated assets with matching findings', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-1',
          hash: 'hash-1',
          checksum: 'checksum-1',
          name: 'Asset One',
          externalUrl: 'https://example.com/1',
          links: ['https://example.com/1/a', 'https://example.com/1/b'],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.UPDATED,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(1);
      mockPrismaService.$transaction.mockResolvedValue([assets, 1]);
      mockPrismaService.finding.findMany.mockResolvedValue([
        {
          id: 'finding-1',
          detectionIdentity: 'detection-1',
          assetId: 'asset-1',
          sourceId: 'source-1',
          runnerId: 'runner-finding',
          detectorType: 'SECRETS',
          findingType: 'API_KEY',
          category: 'security',
          severity: 'HIGH',
          confidence: 0.91,
          matchedContent: 'secret-value',
          redactedContent: null,
          contextBefore: null,
          contextAfter: null,
          location: null,
          status: FindingStatus.OPEN,
          resolutionReason: null,
          detectedAt: now,
          firstDetectedAt: now,
          lastDetectedAt: now,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const result = await service.searchAssets({
        assets: {
          sourceId: 'source-1',
        },
        findings: {
          severity: [Severity.HIGH],
        },
      });

      expect(mockPrismaService.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceId: 'source-1',
            findings: {
              some: expect.objectContaining({
                severity: { in: ['HIGH'] },
                status: { not: FindingStatus.RESOLVED },
              }),
            },
          }),
        }),
      );

      expect(mockPrismaService.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assetId: { in: ['asset-1'] },
            severity: { in: ['HIGH'] },
            status: { not: FindingStatus.RESOLVED },
          }),
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].asset.id).toBe('asset-1');
      expect(result.items[0].findings).toHaveLength(1);
      expect(result.items[0].findings[0].confidence).toBe(0.91);
    });

    it('should skip findings query when paginated assets list is empty', async () => {
      mockPrismaService.asset.findMany.mockResolvedValue([]);
      mockPrismaService.asset.count.mockResolvedValue(0);
      mockPrismaService.$transaction.mockResolvedValue([[], 0]);

      const result = await service.searchAssets({});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockPrismaService.finding.findMany).not.toHaveBeenCalled();
    });

    it('should skip findings joins and findings query when excludeFindings is true', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-1',
          hash: 'hash-1',
          checksum: 'checksum-1',
          name: 'Asset One',
          externalUrl: 'https://example.com/1',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.UPDATED,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(1);
      mockPrismaService.$transaction.mockResolvedValue([assets, 1]);

      const result = await service.searchAssets({
        assets: {
          sourceId: 'source-1',
        },
        findings: {
          severity: [Severity.HIGH],
        },
        options: {
          excludeFindings: true,
        },
      });

      const assetFindManyCall =
        mockPrismaService.asset.findMany.mock.calls[0][0];
      expect(assetFindManyCall.where.findings).toBeUndefined();
      expect(mockPrismaService.finding.findMany).not.toHaveBeenCalled();
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].findings).toEqual([]);
    });

    it('should require asset-level finding match when findings filters are provided', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-1',
          hash: 'hash-1',
          checksum: 'checksum-1',
          name: 'Asset One',
          externalUrl: 'https://example.com/1',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.UPDATED,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(1);
      mockPrismaService.$transaction.mockResolvedValue([assets, 1]);
      mockPrismaService.finding.findMany.mockResolvedValue([
        {
          id: 'finding-1',
          detectionIdentity: 'detection-1',
          assetId: 'asset-1',
          sourceId: 'source-1',
          runnerId: 'runner-finding',
          detectorType: 'SECRETS',
          findingType: 'API_KEY',
          category: 'security',
          severity: 'HIGH',
          confidence: 0.91,
          matchedContent: 'secret-value',
          redactedContent: null,
          contextBefore: null,
          contextAfter: null,
          location: null,
          status: FindingStatus.OPEN,
          resolutionReason: null,
          detectedAt: now,
          firstDetectedAt: now,
          lastDetectedAt: now,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const result = await service.searchAssets({
        findings: {
          severity: [Severity.HIGH],
        },
        options: {
          includeAssetsWithoutFindings: true,
        },
      });

      const assetFindManyCall =
        mockPrismaService.asset.findMany.mock.calls[0][0];
      expect(assetFindManyCall.where.findings).toEqual({
        some: expect.objectContaining({
          severity: { in: ['HIGH'] },
          status: { not: FindingStatus.RESOLVED },
        }),
      });
      expect(mockPrismaService.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assetId: { in: ['asset-1'] },
            severity: { in: ['HIGH'] },
            status: { not: FindingStatus.RESOLVED },
          }),
        }),
      );

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(
        result.items.find((item) => item.asset.id === 'asset-1')?.findings,
      ).toHaveLength(1);
    });

    it('should include assets without findings when includeAssetsWithoutFindings is true and no findings filters are set', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-1',
          hash: 'hash-1',
          checksum: 'checksum-1',
          name: 'Asset One',
          externalUrl: 'https://example.com/1',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.UPDATED,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'asset-2',
          hash: 'hash-2',
          checksum: 'checksum-2',
          name: 'Asset Two',
          externalUrl: 'https://example.com/2',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.NEW,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(2);
      mockPrismaService.$transaction.mockResolvedValue([assets, 2]);
      mockPrismaService.finding.findMany.mockResolvedValue([
        {
          id: 'finding-1',
          detectionIdentity: 'detection-1',
          assetId: 'asset-1',
          sourceId: 'source-1',
          runnerId: 'runner-finding',
          detectorType: 'SECRETS',
          findingType: 'API_KEY',
          category: 'security',
          severity: 'HIGH',
          confidence: 0.91,
          matchedContent: 'secret-value',
          redactedContent: null,
          contextBefore: null,
          contextAfter: null,
          location: null,
          status: FindingStatus.OPEN,
          resolutionReason: null,
          detectedAt: now,
          firstDetectedAt: now,
          lastDetectedAt: now,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const result = await service.searchAssets({
        options: {
          includeAssetsWithoutFindings: true,
        },
      });

      const assetFindManyCall =
        mockPrismaService.asset.findMany.mock.calls[0][0];
      expect(assetFindManyCall.where.findings).toBeUndefined();
      expect(mockPrismaService.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assetId: { in: ['asset-1', 'asset-2'] },
            status: { not: FindingStatus.RESOLVED },
          }),
        }),
      );

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(
        result.items.find((item) => item.asset.id === 'asset-2')?.findings,
      ).toEqual([]);
    });

    it('should apply asset status filters in search query', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-new',
          hash: 'hash-new',
          checksum: 'checksum-new',
          name: 'New Asset',
          externalUrl: 'https://example.com/new',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.NEW,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(1);
      mockPrismaService.$transaction.mockResolvedValue([assets, 1]);

      const result = await service.searchAssets({
        assets: {
          status: [AssetStatus.NEW],
        },
        options: {
          excludeFindings: true,
        },
      });

      expect(mockPrismaService.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: [AssetStatus.NEW] },
          }),
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].asset.status).toBe(AssetStatus.NEW);
    });

    it('should apply requested server-side sort order', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-1',
          hash: 'hash-1',
          checksum: 'checksum-1',
          name: 'Asset One',
          externalUrl: 'https://example.com/1',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.UPDATED,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(1);
      mockPrismaService.$transaction.mockResolvedValue([assets, 1]);
      mockPrismaService.finding.findMany.mockResolvedValue([]);

      await service.searchAssets({
        page: {
          sortBy: SearchAssetsSortBy.NAME,
          sortOrder: SearchAssetsSortOrder.ASC,
        },
      });

      expect(mockPrismaService.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ name: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        }),
      );
    });

    it('should apply IN filters for multiple finding fields', async () => {
      const now = new Date();
      const assets = [
        {
          id: 'asset-1',
          hash: 'hash-1',
          checksum: 'checksum-1',
          name: 'Asset One',
          externalUrl: 'https://example.com/1',
          links: [],
          assetType: 'URL',
          sourceType: AssetType.WORDPRESS,
          sourceId: 'source-1',
          runnerId: 'runner-a',
          status: AssetStatus.UPDATED,
          lastScannedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(assets);
      mockPrismaService.asset.count.mockResolvedValue(1);
      mockPrismaService.$transaction.mockResolvedValue([assets, 1]);
      mockPrismaService.finding.findMany.mockResolvedValue([]);

      await service.searchAssets({
        findings: {
          detectorType: ['SECRETS', 'PII'],
          runnerId: ['r1', 'r2'],
          findingType: ['API_KEY', 'TOKEN'],
          category: ['security', 'secrets'],
          severity: [Severity.CRITICAL, Severity.HIGH],
          status: [FindingStatus.OPEN, FindingStatus.IGNORED],
          detectionIdentity: ['d1', 'd2'],
        },
      });

      expect(mockPrismaService.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            findings: {
              some: expect.objectContaining({
                detectorType: { in: ['SECRETS', 'PII'] },
                runnerId: { in: ['r1', 'r2'] },
                findingType: { in: ['API_KEY', 'TOKEN'] },
                category: { in: ['security', 'secrets'] },
                severity: { in: ['CRITICAL', 'HIGH'] },
                status: { in: ['OPEN', 'IGNORED'] },
                detectionIdentity: { in: ['d1', 'd2'] },
              }),
            },
          }),
        }),
      );

      expect(mockPrismaService.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assetId: { in: ['asset-1'] },
            detectorType: { in: ['SECRETS', 'PII'] },
            runnerId: { in: ['r1', 'r2'] },
            findingType: { in: ['API_KEY', 'TOKEN'] },
            category: { in: ['security', 'secrets'] },
            severity: { in: ['CRITICAL', 'HIGH'] },
            status: { in: ['OPEN', 'IGNORED'] },
            detectionIdentity: { in: ['d1', 'd2'] },
          }),
        }),
      );
    });
  });

  describe('searchAssetsCharts', () => {
    it('should return typed chart overview payload from a single query', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        {
          totals: {
            totalAssets: 120,
            newAssets: 12,
            updatedAssets: 34,
            unchangedAssets: 74,
          },
          topAssetsByFindings: [
            {
              assetId: 'asset-1',
              assetName: 'Asset One',
              sourceId: 'source-1',
              findingsCount: 25,
              severityScore: 5,
            },
            {
              assetId: 'asset-2',
              assetName: 'Asset Two',
              sourceId: 'source-1',
              findingsCount: 11,
              severityScore: 3,
            },
          ],
          topSourcesByAssetVolume: [
            {
              sourceId: 'source-1',
              sourceName: 'Primary Source',
              assetCount: 77,
            },
          ],
        },
      ]);

      const result = await service.searchAssetsCharts({
        options: {
          topAssetsLimit: 20,
          topSourcesLimit: 10,
        },
      });

      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result.totals.totalAssets).toBe(120);
      expect(result.totals.unchangedAssets).toBe(74);
      expect(result.topAssetsByFindings).toHaveLength(2);
      expect(result.topAssetsByFindings[0].highestSeverity).toBe('CRITICAL');
      expect(result.topAssetsByFindings[1].highestSeverity).toBe('MEDIUM');
      expect(result.topSourcesByAssetVolume[0].assetCount).toBe(77);
    });

    it('should default missing datasets to empty arrays and zero totals', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        {
          totals: null,
          topAssetsByFindings: null,
          topSourcesByAssetVolume: null,
        },
      ]);

      const result = await service.searchAssetsCharts({});

      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result.totals).toEqual({
        totalAssets: 0,
        newAssets: 0,
        updatedAssets: 0,
        unchangedAssets: 0,
      });
      expect(result.topAssetsByFindings).toEqual([]);
      expect(result.topSourcesByAssetVolume).toEqual([]);
    });
  });

  describe('bulkIngest', () => {
    const sourceId = 'source-123';
    const runnerId = 'runner-456';
    const source = {
      id: sourceId,
      name: 'Test Source',
      type: AssetType.WORDPRESS,
      config: {},
      currentRunnerId: null,
      runnerStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const runner = {
      id: runnerId,
      sourceId,
      triggeredAt: new Date(),
      triggerType: 'MANUAL' as const,
      status: 'RUNNING' as const,
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      assetsCreated: 0,
      assetsUpdated: 0,
      assetsUnchanged: 0,
      totalFindings: 0,
      errorMessage: null,
      errorDetails: null,
    };

    beforeEach(() => {
      mockPrismaService.source.findUnique.mockResolvedValue(source);
      mockPrismaService.runner.findUnique.mockResolvedValue(runner);
    });

    it('should throw NotFoundException if source does not exist', async () => {
      mockPrismaService.source.findUnique.mockResolvedValue(null);
      await expect(service.bulkIngest(sourceId, runnerId, [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if runner does not exist', async () => {
      mockPrismaService.runner.findUnique.mockResolvedValue(null);
      await expect(service.bulkIngest(sourceId, runnerId, [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if runner does not belong to source', async () => {
      mockPrismaService.runner.findUnique.mockResolvedValue({
        ...runner,
        sourceId: 'different-source',
      });
      await expect(service.bulkIngest(sourceId, runnerId, [])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create NEW assets when they do not exist', async () => {
      const incomingAssets = [
        {
          hash: 'asset-1',
          checksum: 'checksum-1',
          name: 'Asset 1',
          external_url: 'https://example.com/1',
          links: [],
          asset_type: 'TXT',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue([]);

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'db-asset-1',
                hash: 'asset-1',
              },
            ]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
      );

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should append to existing links instead of removing them on update', async () => {
      const existingAsset = {
        id: 'db-parent-1',
        hash: 'parent-1',
        checksum: 'old-checksum',
        name: 'dataset.parquet',
        externalUrl: 'https://example.com/dataset.parquet',
        links: ['child-1'],
        assetType: 'TABLE',
        sourceType: AssetType.WORDPRESS,
        status: AssetStatus.NEW,
        runnerId: 'old-runner',
        sourceId,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const incomingAssets = [
        {
          hash: 'parent-1',
          checksum: 'new-checksum',
          name: 'dataset.parquet',
          external_url: 'https://example.com/dataset.parquet',
          links: ['child-2'],
          asset_type: 'TABLE',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue([existingAsset]);

      const txUpdate = jest.fn().mockResolvedValue({});
      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: txUpdate,
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      await service.bulkIngest(sourceId, runnerId, incomingAssets);

      // Existing link preserved, new link appended (union, no removal).
      expect(txUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'db-parent-1' },
          data: expect.objectContaining({ links: ['child-1', 'child-2'] }),
        }),
      );
    });

    it('should mark assets as UPDATED when checksum changes', async () => {
      const existingAsset = {
        id: 'db-asset-1',
        hash: 'asset-1',
        checksum: 'old-checksum',
        name: 'Old Name',
        externalUrl: 'https://example.com/1',
        links: [],
        assetType: 'TXT',
        sourceType: AssetType.WORDPRESS,
        status: AssetStatus.NEW,
        runnerId: 'old-runner',
        sourceId,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const incomingAssets = [
        {
          hash: 'asset-1',
          checksum: 'new-checksum',
          name: 'Updated Name',
          external_url: 'https://example.com/1',
          links: [],
          asset_type: 'TXT',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue([existingAsset]);

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
      );

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('persists the asset kind (lowercased) as the asset type', async () => {
      const incomingAssets = [
        {
          hash: 'asset-table-1',
          checksum: 'checksum-table-1',
          name: 'Exported table',
          external_url: 'https://example.com/table.csv',
          links: [],
          asset_type: 'TABLE',
          asset_kind: 'table',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue([]);

      const txAssetCreateMany = jest.fn().mockResolvedValue({});

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: txAssetCreateMany,
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'db-asset-table-1',
                hash: 'asset-table-1',
              },
            ]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
      );

      expect(result.created).toBe(1);
      expect(txAssetCreateMany).toHaveBeenCalledTimes(1);
      expect(txAssetCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              hash: 'asset-table-1',
              assetType: 'table',
            }),
          ]),
        }),
      );
    });

    it('should respect manual status and severity overrides on subsequent runs', async () => {
      const incomingAssets = [
        {
          hash: 'asset-override-1',
          checksum: 'checksum-override',
          name: 'Override Asset',
          external_url: 'https://example.com/override',
          links: [],
          asset_type: 'TXT',
          findings: [
            {
              detector_type: 'SECRETS',
              finding_type: 'API_KEY',
              category: 'security',
              severity: 'high',
              confidence: 0.9,
              matched_content: 'api-key-value',
              detected_at: new Date().toISOString(),
            },
          ],
        },
      ];

      const existingAsset = {
        id: 'db-asset-override-1',
        hash: 'asset-override-1',
        checksum: 'checksum-override',
        name: 'Override Asset',
        externalUrl: 'https://example.com/override',
        links: [],
        assetType: 'TXT',
        sourceType: AssetType.WORDPRESS,
        status: AssetStatus.NEW,
        runnerId: 'old-runner',
        sourceId,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const detectionIdentity = generateDetectionIdentity({
        assetId: existingAsset.id,
        detectorType: 'SECRETS',
        findingType: 'API_KEY',
        matchedContent: 'api-key-value',
      });

      const existingFinding = {
        id: 'finding-override-1',
        detectionIdentity,
        assetId: existingAsset.id,
        sourceId,
        runnerId,
        detectorType: 'SECRETS',
        findingType: 'API_KEY',
        category: 'security',
        severity: 'LOW',
        confidence: 0.5,
        matchedContent: 'api-key-value',
        status: FindingStatus.RESOLVED,
        history: [
          {
            timestamp: new Date(),
            runnerId,
            eventType: HistoryEventType.STATUS_CHANGED,
            status: FindingStatus.RESOLVED,
          },
          {
            timestamp: new Date(),
            runnerId,
            eventType: HistoryEventType.SEVERITY_CHANGED,
            status: FindingStatus.RESOLVED,
            severity: 'LOW',
          },
        ],
        resolvedAt: new Date(),
        resolutionReason: 'Manual override',
      };

      mockPrismaService.asset.findMany.mockResolvedValue([existingAsset]);

      const txFindingUpdate = jest.fn().mockResolvedValue({});

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([existingFinding]),
            createMany: jest.fn().mockResolvedValue({}),
            update: txFindingUpdate,
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      await service.bulkIngest(sourceId, runnerId, incomingAssets);

      const updateCall = txFindingUpdate.mock.calls[0][0];
      expect(updateCall.data.status).toBe(FindingStatus.RESOLVED);
      expect(updateCall.data.severity).toBe('LOW');
    });

    it('should mark assets as UNCHANGED when checksum is same', async () => {
      const existingAsset = {
        id: 'db-asset-1',
        hash: 'asset-1',
        checksum: 'same-checksum',
        name: 'Asset Name',
        externalUrl: 'https://example.com/1',
        links: [],
        assetType: 'TXT',
        sourceType: AssetType.WORDPRESS,
        status: AssetStatus.NEW,
        runnerId: 'old-runner',
        sourceId,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const incomingAssets = [
        {
          hash: 'asset-1',
          checksum: 'same-checksum',
          name: 'Asset Name',
          external_url: 'https://example.com/1',
          links: [],
          asset_type: 'TXT',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue([existingAsset]);

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
      );

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.deleted).toBe(0);
    });

    it('should not mark assets as DELETED when they are missing from a sample run', async () => {
      // Assets not in the current run are left untouched (sampling means only a
      // subset of assets appear per run — absence does not mean deletion).
      const existingAssets = [
        {
          id: 'db-asset-1',
          hash: 'asset-1',
          checksum: 'checksum-1',
          name: 'Asset 1',
          externalUrl: 'https://example.com/1',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          status: AssetStatus.NEW,
          runnerId: 'old-runner',
          sourceId,
          lastScannedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'db-asset-2',
          hash: 'asset-2',
          checksum: 'checksum-2',
          name: 'Asset 2',
          externalUrl: 'https://example.com/2',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          status: AssetStatus.NEW,
          runnerId: 'old-runner',
          sourceId,
          lastScannedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const incomingAssets = [
        {
          hash: 'asset-1',
          checksum: 'checksum-1',
          name: 'Asset 1',
          external_url: 'https://example.com/1',
          links: [],
          asset_type: 'TXT',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(existingAssets);

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findMany: jest.fn().mockResolvedValue([]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
      );

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.deleted).toBe(0);
    });

    it('should not mark assets as DELETED when finalization is deferred', async () => {
      const existingAssets = [
        {
          id: 'db-asset-existing',
          hash: 'asset-existing',
          checksum: 'checksum-existing',
          name: 'Existing Asset',
          externalUrl: 'https://example.com/existing',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          status: AssetStatus.NEW,
          runnerId: 'old-runner',
          sourceId,
          lastScannedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const incomingAssets = [
        {
          hash: 'asset-new',
          checksum: 'checksum-new',
          name: 'New Asset',
          external_url: 'https://example.com/new',
          links: [],
          asset_type: 'TXT',
          findings: [],
        },
      ];

      mockPrismaService.asset.findMany.mockResolvedValue(existingAssets);

      const txRunnerUpdate = jest.fn().mockResolvedValue({});
      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'db-asset-new',
                hash: 'asset-new',
              },
            ]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: txRunnerUpdate,
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
        {
          finalizeRun: false,
        },
      );

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.deleted).toBe(0);
      expect(txRunnerUpdate).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should return zero deleted from finalizeIngestRun (no deletion logic)', async () => {
      const result = await service.finalizeIngestRun(
        sourceId,
        runnerId,
        ['asset-1'],
        false,
      );

      expect(result.deleted).toBe(0);
    });

    describe('finding resolution by sampling strategy', () => {
      const existingAsset = {
        id: 'db-asset-scan-1',
        hash: 'asset-scan-1',
        checksum: 'checksum-scan-1',
        name: 'Scanned Asset',
        externalUrl: 'https://example.com/scan',
        links: [],
        assetType: 'TXT',
        sourceType: AssetType.WORDPRESS,
        status: AssetStatus.NEW,
        runnerId: 'old-runner',
        sourceId,
        lastScannedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const existingFindingIdentity = generateDetectionIdentity({
        assetId: existingAsset.id,
        detectorType: 'PII',
        findingType: 'EMAIL',
        matchedContent: 'secret@example.com',
      });

      const existingFinding = {
        id: 'finding-to-check',
        detectionIdentity: existingFindingIdentity,
        assetId: existingAsset.id,
        sourceId,
        runnerId: 'old-runner',
        detectorType: 'PII',
        findingType: 'EMAIL',
        category: 'pii',
        severity: 'HIGH',
        confidence: 0.9,
        matchedContent: 'secret@example.com',
        status: FindingStatus.OPEN,
        history: [],
        resolvedAt: null,
        resolutionReason: null,
      };

      // Asset comes in clean (no findings)
      const incomingAssets = [
        {
          hash: 'asset-scan-1',
          checksum: 'checksum-scan-1',
          name: 'Scanned Asset',
          external_url: 'https://example.com/scan',
          links: [],
          asset_type: 'TXT',
          findings: [],
        },
      ];

      function buildMockTransaction(
        findingUpdateFn: jest.Mock,
        existingFindings: any[],
      ) {
        return (callback: any) => {
          const tx = {
            asset: {
              createMany: jest.fn().mockResolvedValue({}),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
            finding: {
              findMany: jest.fn().mockResolvedValue(existingFindings),
              createMany: jest.fn().mockResolvedValue({}),
              update: findingUpdateFn,
            },
            runner: {
              update: jest.fn().mockResolvedValue({}),
            },
            runnerAsset: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };
          return callback(tx);
        };
      }

      beforeEach(() => {
        mockPrismaService.asset.findMany.mockResolvedValue([existingAsset]);
      });

      it('should NOT resolve findings during bulkIngest (resolution moved to finalizeIngestRun)', async () => {
        const findingUpdate = jest.fn().mockResolvedValue({});
        mockPrismaService.$transaction.mockImplementation(
          buildMockTransaction(findingUpdate, [existingFinding]),
        );

        await service.bulkIngest(sourceId, runnerId, incomingAssets, {
          isFullScan: true,
        });

        const resolveCall = findingUpdate.mock.calls.find(
          ([args]: any) => args?.data?.status === FindingStatus.RESOLVED,
        );
        expect(resolveCall).toBeUndefined();
      });

      it('should still update (re-detect) a matched finding regardless of isFullScan', async () => {
        const matchedFinding = {
          ...existingFinding,
          confidence: 0.5, // Different confidence → triggers update
        };
        const incomingWithFinding = [
          {
            ...incomingAssets[0],
            findings: [
              {
                detector_type: 'PII',
                finding_type: 'EMAIL',
                category: 'pii',
                severity: 'HIGH',
                confidence: 0.9, // Changed confidence
                matched_content: 'secret@example.com',
                detected_at: new Date().toISOString(),
              },
            ],
          },
        ];

        for (const isFullScan of [true, false]) {
          const findingUpdate = jest.fn().mockResolvedValue({});
          mockPrismaService.$transaction.mockImplementation(
            buildMockTransaction(findingUpdate, [matchedFinding]),
          );

          await service.bulkIngest(sourceId, runnerId, incomingWithFinding, {
            isFullScan,
          });

          // The matched finding should be updated (re-detected), not resolved
          expect(findingUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: matchedFinding.id },
              data: expect.not.objectContaining({
                status: FindingStatus.RESOLVED,
              }),
            }),
          );
        }
      });
    });

    describe('finalizeIngestRun finding resolution', () => {
      const staleFinding = {
        id: 'stale-finding-1',
        sourceId,
        assetId: 'asset-1',
        runnerId: 'old-runner',
        status: FindingStatus.OPEN,
        history: [],
        detectorType: DetectorType.PII,
        customDetectorKey: null,
        asset: { hash: 'scanned-hash' },
      };

      /** PII completed cleanly on the scanned asset, so its silence is real. */
      const cleanPiiOutcome = [
        {
          assetHash: 'scanned-hash',
          detectorOutcomes: [
            { detector_type: 'PII', custom_detector_key: null, status: 'OK' },
          ],
        },
      ];

      // The scope the mocked source resolves to. An asset carrying this was
      // ingested under the same scope as the run, so its absence is a real
      // deletion rather than the scope having moved.
      const currentScope = computeScopeFingerprint(
        AssetType.WORDPRESS,
        undefined,
      );

      beforeEach(() => {
        mockPrismaService.source.findUnique.mockResolvedValue({
          id: sourceId,
          type: AssetType.WORDPRESS,
        });
        mockPrismaService.runner.findUnique.mockResolvedValue({
          id: runnerId,
          sourceId,
        });
        mockPrismaService.runner.update.mockResolvedValue({});
      });

      function buildFinalizeTx(opts: {
        missingAssets?: any[];
        deletedAssetFindings?: any[];
        staleFindings?: any[];
        findingUpdate?: jest.Mock;
      }) {
        const findingUpdate =
          opts.findingUpdate ?? jest.fn().mockResolvedValue({});
        let findManyCallCount = 0;

        return {
          findingUpdate,
          mockImpl: (callback: any) => {
            const tx = {
              asset: {
                updateMany: jest.fn().mockResolvedValue({}),
              },
              finding: {
                findMany: jest.fn().mockImplementation(() => {
                  findManyCallCount++;
                  if (findManyCallCount === 1) {
                    return Promise.resolve(opts.deletedAssetFindings ?? []);
                  }
                  return Promise.resolve(opts.staleFindings ?? []);
                }),
                update: findingUpdate,
              },
              runner: {
                update: jest.fn().mockResolvedValue({}),
              },
              runnerAsset: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              },
            };
            return callback(tx);
          },
        };
      }

      it('should resolve stale findings on scanned assets during finalize (isFullScan=true)', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'missing-asset',
            hash: 'missing-hash',
            scopeFingerprint: currentScope,
          },
        ]);
        mockPrismaService.runnerAsset.findMany.mockResolvedValue(
          cleanPiiOutcome,
        );

        const { findingUpdate, mockImpl } = buildFinalizeTx({
          deletedAssetFindings: [],
          staleFindings: [staleFinding],
        });
        mockPrismaService.$transaction.mockImplementation(mockImpl);

        await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['seen-hash-1'],
          true,
        );

        expect(findingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: staleFinding.id },
            data: expect.objectContaining({
              status: FindingStatus.RESOLVED,
              resolutionReason: 'Detection no longer present in scan',
            }),
          }),
        );
      });

      it('should NOT resolve findings with manual status override during finalize', async () => {
        const manuallyOverriddenFinding = {
          ...staleFinding,
          history: [
            {
              eventType: HistoryEventType.STATUS_CHANGED,
              status: FindingStatus.IGNORED,
            },
          ],
        };

        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'missing-asset',
            hash: 'missing-hash',
            scopeFingerprint: currentScope,
          },
        ]);
        mockPrismaService.runnerAsset.findMany.mockResolvedValue(
          cleanPiiOutcome,
        );

        const { findingUpdate, mockImpl } = buildFinalizeTx({
          staleFindings: [manuallyOverriddenFinding],
        });
        mockPrismaService.$transaction.mockImplementation(mockImpl);

        await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['seen-hash-1'],
          true,
        );

        const resolveCall = findingUpdate.mock.calls.find(
          ([args]: any) => args?.data?.status === FindingStatus.RESOLVED,
        );
        expect(resolveCall).toBeUndefined();
      });

      it('should NOT resolve any findings when isFullScan=false (RANDOM/LATEST)', async () => {
        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['hash-1'],
          false,
        );

        expect(result.deleted).toBe(0);
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });
    });

    // G-019. A full scan used to retire every asset absent from the run, which
    // conflated "the object was deleted from the source" with "the scope moved
    // away from the object" and with "the scan returned nothing at all".
    describe('finalizeIngestRun scope safety (G-019)', () => {
      const currentScope = computeScopeFingerprint(
        AssetType.WORDPRESS,
        undefined,
      );

      let assetUpdateMany: jest.Mock;
      let runnerTxUpdate: jest.Mock;

      beforeEach(() => {
        mockPrismaService.source.findUnique.mockResolvedValue({
          id: sourceId,
          type: AssetType.WORDPRESS,
        });
        mockPrismaService.runner.findUnique.mockResolvedValue({
          id: runnerId,
          sourceId,
        });
        mockPrismaService.runner.update.mockResolvedValue({});
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([]);

        assetUpdateMany = jest.fn().mockResolvedValue({});
        runnerTxUpdate = jest.fn().mockResolvedValue({});
        mockPrismaService.$transaction.mockImplementation((callback: any) =>
          callback({
            asset: { updateMany: assetUpdateMany },
            finding: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({}),
            },
            runner: { update: runnerTxUpdate },
            runnerAsset: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          }),
        );
      });

      it('retires nothing when a full scan reports zero assets seen', async () => {
        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          [],
          true,
        );

        expect(result).toEqual({
          deleted: 0,
          outOfScope: 0,
          resolvedForAbsence: 0,
          resolvedForRemovedDetectors: 0,
        });
        // The bug: with no seenHashes the `notIn` filter was dropped, so the
        // query matched every asset in the source. Nothing may even be queried.
        expect(mockPrismaService.asset.findMany).not.toHaveBeenCalled();
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it('retains, not retires, assets ingested under a different scope', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'out-of-scope-asset',
            hash: 'narrowed-away-hash',
            scopeFingerprint: 'fingerprint-of-a-wider-earlier-scope',
          },
        ]);

        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['still-in-scope-hash'],
          true,
        );

        expect(result).toMatchObject({ deleted: 0, outOfScope: 1 });
        // The investigative state survives a scope change: nothing is retired.
        expect(assetUpdateMany).not.toHaveBeenCalled();
        expect(runnerTxUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              assetsDeleted: 0,
              assetsOutOfScope: 1,
            }),
          }),
        );
      });

      it('retains assets predating scope fingerprinting (null fingerprint)', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          { id: 'legacy-asset', hash: 'legacy-hash', scopeFingerprint: null },
        ]);

        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['seen-hash'],
          true,
        );

        expect(result).toMatchObject({ deleted: 0, outOfScope: 1 });
        expect(assetUpdateMany).not.toHaveBeenCalled();
      });

      it('still retires an asset genuinely gone from an unchanged scope', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'genuinely-deleted',
            hash: 'deleted-hash',
            scopeFingerprint: currentScope,
          },
        ]);

        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['seen-hash'],
          true,
        );

        expect(result).toMatchObject({ deleted: 1, outOfScope: 0 });
        expect(assetUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: ['genuinely-deleted'] } },
            data: { status: AssetStatus.DELETED, runnerId },
          }),
        );
      });

      it('separates genuine deletions from scope moves in the same run', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'genuinely-deleted',
            hash: 'deleted-hash',
            scopeFingerprint: currentScope,
          },
          {
            id: 'out-of-scope-asset',
            hash: 'narrowed-away-hash',
            scopeFingerprint: 'older-scope',
          },
        ]);

        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['seen-hash'],
          true,
        );

        expect(result).toMatchObject({ deleted: 1, outOfScope: 1 });
        // Only the same-scope asset is retired; the out-of-scope one is untouched.
        expect(assetUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: ['genuinely-deleted'] } },
          }),
        );
        expect(runnerTxUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              assetsDeleted: 1,
              assetsOutOfScope: 1,
            }),
          }),
        );
      });

      it('uses the runner scope snapshot when source config changes mid-run', async () => {
        const snapshottedScope = 'a'.repeat(64);
        mockPrismaService.runner.findUnique.mockResolvedValue({
          id: runnerId,
          sourceId,
          scopeFingerprint: snapshottedScope,
        });
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'deleted-from-original-scope',
            hash: 'deleted-hash',
            scopeFingerprint: snapshottedScope,
          },
        ]);

        const result = await service.finalizeIngestRun(
          sourceId,
          runnerId,
          ['seen-hash'],
          true,
        );

        expect(result).toMatchObject({ deleted: 1, outOfScope: 0 });
        expect(mockPrismaService.runner.update).not.toHaveBeenCalled();
      });

      it('records the scope it covered on the runner', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([]);

        await service.finalizeIngestRun(sourceId, runnerId, ['seen'], true);

        expect(mockPrismaService.runner.update).toHaveBeenCalledWith({
          where: { id: runnerId },
          data: { scopeFingerprint: currentScope },
        });
      });
    });

    // G-021. Resolution used to key on runnerId staleness alone, so a detector
    // that crashed — or one that was never run — had its silence read as "the
    // finding is gone", auto-resolving live evidence.
    describe('finalizeIngestRun detector-scoped resolution (G-021)', () => {
      const currentScope = computeScopeFingerprint(
        AssetType.WORDPRESS,
        undefined,
      );

      const findingFrom = (
        overrides: Partial<Record<string, any>> = {},
      ): Record<string, any> => ({
        id: 'finding-1',
        sourceId,
        assetId: 'asset-1',
        runnerId: 'old-runner',
        status: FindingStatus.OPEN,
        history: [],
        detectorType: DetectorType.PII,
        customDetectorKey: null,
        asset: { hash: 'scanned-hash' },
        ...overrides,
      });

      let findingUpdate: jest.Mock;

      const runFinalize = (staleFindings: Record<string, any>[]) => {
        findingUpdate = jest.fn().mockResolvedValue({});
        mockPrismaService.asset.findMany.mockResolvedValue([]);
        mockPrismaService.$transaction.mockImplementation((callback: any) =>
          callback({
            asset: { updateMany: jest.fn().mockResolvedValue({}) },
            finding: {
              findMany: jest.fn().mockResolvedValue(staleFindings),
              update: findingUpdate,
            },
            runner: { update: jest.fn().mockResolvedValue({}) },
            runnerAsset: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          }),
        );
        return service.finalizeIngestRun(sourceId, runnerId, ['seen'], true);
      };

      beforeEach(() => {
        mockPrismaService.source.findUnique.mockResolvedValue({
          id: sourceId,
          type: AssetType.WORDPRESS,
        });
        mockPrismaService.runner.findUnique.mockResolvedValue({
          id: runnerId,
          sourceId,
          scopeFingerprint: currentScope,
        });
        mockPrismaService.runner.update.mockResolvedValue({});
      });

      it('resolves a finding whose detector completed cleanly', async () => {
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          {
            assetHash: 'scanned-hash',
            detectorOutcomes: [
              { detector_type: 'PII', custom_detector_key: null, status: 'OK' },
            ],
          },
        ]);

        const result = await runFinalize([findingFrom()]);

        expect(result.resolvedForAbsence).toBe(1);
        expect(findingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'finding-1' },
            data: expect.objectContaining({ status: FindingStatus.RESOLVED }),
          }),
        );
      });

      it('does NOT resolve a finding whose detector crashed', async () => {
        // The G-011 shape: PII raised on every page, emitted nothing, and its
        // prior findings were resolved as "no longer present".
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          {
            assetHash: 'scanned-hash',
            detectorOutcomes: [
              {
                detector_type: 'PII',
                custom_detector_key: null,
                status: 'ERROR',
                error: "unsupported operand type(s) for -: 'ChunkSize'",
              },
            ],
          },
        ]);

        const result = await runFinalize([findingFrom()]);

        expect(result.resolvedForAbsence).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('does NOT resolve findings of a detector that did not run at all', async () => {
        // Removing a detector from the config must not retroactively resolve
        // the evidence it already found.
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          {
            assetHash: 'scanned-hash',
            detectorOutcomes: [
              {
                detector_type: 'CUSTOM',
                custom_detector_key: 'entities_v1',
                status: 'OK',
              },
            ],
          },
        ]);

        const result = await runFinalize([findingFrom()]);

        expect(result.resolvedForAbsence).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      // The exact reported failure: adding a second custom detector resolved
      // the first one's findings. Both report detector_type CUSTOM, so only the
      // custom_detector_key can tell them apart.
      it('does NOT resolve one custom detector because another one ran', async () => {
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          {
            assetHash: 'scanned-hash',
            detectorOutcomes: [
              {
                detector_type: 'CUSTOM',
                custom_detector_key: 'entities_v1',
                status: 'OK',
              },
            ],
          },
        ]);

        const result = await runFinalize([
          findingFrom({
            id: 'identifier-finding',
            detectorType: DetectorType.CUSTOM,
            customDetectorKey: 'identifiers_v1',
          }),
        ]);

        expect(result.resolvedForAbsence).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('resolves the custom detector that did run, in the same batch', async () => {
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          {
            assetHash: 'scanned-hash',
            detectorOutcomes: [
              {
                detector_type: 'CUSTOM',
                custom_detector_key: 'entities_v1',
                status: 'OK',
              },
            ],
          },
        ]);

        const result = await runFinalize([
          findingFrom({
            id: 'entities-finding',
            detectorType: DetectorType.CUSTOM,
            customDetectorKey: 'entities_v1',
          }),
          findingFrom({
            id: 'identifier-finding',
            detectorType: DetectorType.CUSTOM,
            customDetectorKey: 'identifiers_v1',
          }),
        ]);

        expect(result.resolvedForAbsence).toBe(1);
        expect(findingUpdate).toHaveBeenCalledTimes(1);
        expect(findingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'entities-finding' } }),
        );
      });

      it('does NOT resolve when an outcome belongs to a different asset', async () => {
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          {
            assetHash: 'some-other-asset',
            detectorOutcomes: [
              { detector_type: 'PII', custom_detector_key: null, status: 'OK' },
            ],
          },
        ]);

        const result = await runFinalize([findingFrom()]);

        expect(result.resolvedForAbsence).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('does NOT resolve for assets scanned by a CLI that reports no outcomes', async () => {
        // Legacy rows carry null. Conservative until the asset is rescanned.
        mockPrismaService.runnerAsset.findMany.mockResolvedValue([
          { assetHash: 'scanned-hash', detectorOutcomes: null },
        ]);

        const result = await runFinalize([findingFrom()]);

        expect(result.resolvedForAbsence).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });
    });

    // Findings from detectors removed (or disabled) in the source config are
    // resolved on the next run, unless the source opts out via
    // cleanup_removed_detector_findings: false. Distinct from the G-021
    // manifest path above: this is driven by the configured detector set, not
    // by what ran.
    describe('finalizeIngestRun removed-detector cleanup', () => {
      const openFinding = (
        overrides: Partial<Record<string, any>> = {},
      ): Record<string, any> => ({
        id: 'finding-llm',
        sourceId,
        assetId: 'asset-1',
        runnerId: 'old-runner',
        status: FindingStatus.OPEN,
        history: [],
        detectorType: DetectorType.CUSTOM,
        customDetectorKey: 'email-conduct-screen',
        ...overrides,
      });

      let findingUpdate: jest.Mock;

      const runCleanup = (
        config: Record<string, any> | undefined,
        findings: Record<string, any>[],
      ) => {
        mockPrismaService.source.findUnique.mockResolvedValue({
          id: sourceId,
          type: AssetType.WORDPRESS,
          config,
        });
        mockPrismaService.runner.findUnique.mockResolvedValue({
          id: runnerId,
          sourceId,
        });
        mockPrismaService.finding.findMany.mockResolvedValue(findings);
        findingUpdate = jest.fn().mockResolvedValue({});
        mockPrismaService.$transaction.mockImplementation((callback: any) =>
          callback({ finding: { update: findingUpdate } }),
        );
        // isFullScan=false: only the cleanup path runs, nothing else.
        return service.finalizeIngestRun(sourceId, runnerId, [], false);
      };

      it('resolves findings from a detector that was removed from the config', async () => {
        const result = await runCleanup(
          { detectors: [{ type: 'PII', enabled: true }] },
          [openFinding()],
        );

        expect(result.resolvedForRemovedDetectors).toBe(1);
        expect(findingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'finding-llm' },
            data: expect.objectContaining({
              status: FindingStatus.RESOLVED,
              resolutionReason: 'Detector removed from source configuration',
            }),
          }),
        );
      });

      it('treats a disabled detector as removed', async () => {
        const result = await runCleanup(
          {
            detectors: [
              { type: 'PII', enabled: true },
              {
                type: 'CUSTOM',
                enabled: false,
                custom_detector_key: 'email-conduct-screen',
              },
            ],
          },
          [openFinding()],
        );

        expect(result.resolvedForRemovedDetectors).toBe(1);
      });

      it('keeps findings whose detector is still configured', async () => {
        const result = await runCleanup(
          {
            detectors: [
              {
                type: 'CUSTOM',
                enabled: true,
                custom_detector_key: 'email-conduct-screen',
              },
            ],
          },
          [openFinding()],
        );

        expect(result.resolvedForRemovedDetectors).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('does nothing when the source opts out via the flag', async () => {
        const result = await runCleanup(
          {
            cleanup_removed_detector_findings: false,
            detectors: [{ type: 'PII', enabled: true }],
          },
          [openFinding()],
        );

        expect(result.resolvedForRemovedDetectors).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('skips cleanup entirely when the config has no detector list', async () => {
        const result = await runCleanup({}, [openFinding()]);

        expect(result.resolvedForRemovedDetectors).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('preserves findings with a manual status override', async () => {
        const result = await runCleanup(
          { detectors: [{ type: 'PII', enabled: true }] },
          [
            openFinding({
              history: [
                {
                  eventType: HistoryEventType.STATUS_CHANGED,
                  status: FindingStatus.FALSE_POSITIVE,
                },
              ],
            }),
          ],
        );

        expect(result.resolvedForRemovedDetectors).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });

      it('keeps CUSTOM findings without a detector key (unknown identity)', async () => {
        const result = await runCleanup(
          { detectors: [{ type: 'PII', enabled: true }] },
          [openFinding({ customDetectorKey: null })],
        );

        expect(result.resolvedForRemovedDetectors).toBe(0);
        expect(findingUpdate).not.toHaveBeenCalled();
      });
    });

    it('should accumulate findings without deleting old ones', async () => {
      const incomingAssets = [
        {
          hash: 'asset-1',
          checksum: 'checksum-1',
          name: 'Asset 1',
          external_url: 'https://example.com/1',
          links: [],
          asset_type: 'TXT',
          findings: [
            {
              detector_type: 'PII',
              finding_type: 'EMAIL',
              category: 'pii',
              severity: 'high',
              confidence: 0.95,
              matched_content: 'test@example.com',
              detected_at: new Date().toISOString(),
            },
          ],
        },
      ];

      let findingsCreated = 0;

      mockPrismaService.asset.findMany.mockResolvedValue([]);

      const mockTransaction = (callback: any) => {
        const tx = {
          asset: {
            createMany: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'db-asset-1',
                hash: 'asset-1',
              },
            ]),
          },
          finding: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockImplementation((data) => {
              findingsCreated = data.data.length;
              return Promise.resolve({});
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          runner: {
            update: jest.fn().mockResolvedValue({}),
          },
          runnerAsset: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      };

      mockPrismaService.$transaction.mockImplementation(mockTransaction);

      const result = await service.bulkIngest(
        sourceId,
        runnerId,
        incomingAssets,
      );

      expect(result.findings).toBe(1);
      expect(findingsCreated).toBe(1);
    });

    // G-012. Counters were derived from assets.status — the asset's *current*
    // state — so assetsCreated meant "assets whose status happens to be NEW
    // right now and were last touched by this runner". The CLI also ingests
    // each asset twice (a stub pass creates it, then the pass carrying findings
    // sees the same checksum and calls it unchanged), so on a first run every
    // asset ended up UNCHANGED: "assetsCreated: 0, assetsUnchanged: 10".
    describe('per-run change type (G-012)', () => {
      const asset = (over: Record<string, unknown> = {}) => ({
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'Asset 1',
        external_url: 'https://example.com/1',
        links: [],
        asset_type: 'TXT',
        findings: [],
        ...over,
      });

      let runnerAssetUpdateMany: jest.Mock;

      const arrangeTx = () => {
        runnerAssetUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
        mockPrismaService.$transaction.mockImplementation((callback: any) =>
          callback({
            asset: {
              createMany: jest.fn().mockResolvedValue({}),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({}),
              findMany: jest
                .fn()
                .mockResolvedValue([{ id: 'db-asset-1', hash: 'asset-1' }]),
            },
            finding: {
              findMany: jest.fn().mockResolvedValue([]),
              createMany: jest.fn().mockResolvedValue({}),
              update: jest.fn().mockResolvedValue({}),
            },
            runner: { update: jest.fn().mockResolvedValue({}) },
            runnerAsset: { updateMany: runnerAssetUpdateMany },
          }),
        );
      };

      /** The changeType write for a hash, if any. */
      const changeTypeCall = (hash = 'asset-1') =>
        runnerAssetUpdateMany.mock.calls.find(
          ([args]: any) =>
            args?.where?.assetHash === hash && args?.data?.changeType,
        )?.[0];

      beforeEach(() => arrangeTx());

      it('records CREATED for a newly ingested asset', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        expect(changeTypeCall()?.data.changeType).toBe('CREATED');
      });

      it('records UPDATED when the checksum changed', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'db-asset-1',
            hash: 'asset-1',
            checksum: 'old-checksum',
            links: [],
          },
        ]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        expect(changeTypeCall()?.data.changeType).toBe('UPDATED');
      });

      it('records UNCHANGED when the checksum matches', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'db-asset-1',
            hash: 'asset-1',
            checksum: 'checksum-1',
            links: [],
          },
        ]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        expect(changeTypeCall()?.data.changeType).toBe('UNCHANGED');
      });

      it('cannot downgrade an earlier CREATED to UNCHANGED', async () => {
        // The second pass of the CLI's two-pass ingest. Its UNCHANGED write is
        // guarded so it only lands where nothing is recorded yet.
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'db-asset-1',
            hash: 'asset-1',
            checksum: 'checksum-1',
            links: [],
          },
        ]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        const where = changeTypeCall()?.where;
        expect(where.OR).toEqual([{ changeType: null }]);
      });

      it('lets UPDATED overwrite UNCHANGED but not CREATED', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'db-asset-1',
            hash: 'asset-1',
            checksum: 'old-checksum',
            links: [],
          },
        ]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        const where = changeTypeCall()?.where;
        expect(where.OR).toEqual([
          { changeType: null },
          { changeType: { in: ['UNCHANGED'] } },
        ]);
      });

      it('lets CREATED overwrite anything weaker', async () => {
        mockPrismaService.asset.findMany.mockResolvedValue([]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        const where = changeTypeCall()?.where;
        expect(where.OR).toEqual([
          { changeType: null },
          { changeType: { in: ['UNCHANGED', 'UPDATED'] } },
        ]);
      });

      it('survives the CLI two-pass ingest that caused the bug', async () => {
        // Pass 1: the stub batch. The asset does not exist yet.
        mockPrismaService.asset.findMany.mockResolvedValue([]);
        await service.bulkIngest(sourceId, runnerId, [asset({ findings: [] })]);
        const passOne = changeTypeCall();

        // Pass 2: the same asset with findings. It now exists with an identical
        // checksum, so it classifies as UNCHANGED — this is the pass that used
        // to leave every first-run asset looking unchanged.
        arrangeTx();
        mockPrismaService.asset.findMany.mockResolvedValue([
          {
            id: 'db-asset-1',
            hash: 'asset-1',
            checksum: 'checksum-1',
            links: [],
          },
        ]);
        await service.bulkIngest(sourceId, runnerId, [asset()]);
        const passTwo = changeTypeCall();

        expect(passOne?.data.changeType).toBe('CREATED');
        expect(passTwo?.data.changeType).toBe('UNCHANGED');
        // Pass 2's guard means the DB keeps CREATED: it only writes where
        // nothing is recorded yet, and pass 1 already recorded CREATED.
        expect(passTwo?.where.OR).toEqual([{ changeType: null }]);
      });

      it('matches a null change type explicitly, never via IN', async () => {
        // SQL's `IN (NULL, 'X')` never matches a NULL row, so folding null into
        // the IN list would make every first write silently no-op.
        mockPrismaService.asset.findMany.mockResolvedValue([]);

        await service.bulkIngest(sourceId, runnerId, [asset()]);

        const where = changeTypeCall()?.where;
        expect(where.OR).toContainEqual({ changeType: null });
        for (const branch of where.OR) {
          expect(branch.changeType?.in ?? []).not.toContain(null);
        }
      });
    });
  });
});
