import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from './asset.service';
import { PrismaService } from './prisma.service';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';
import {
  AssetStatus,
  AssetContentType,
  AssetType,
  FindingStatus,
  Severity,
} from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { generateDetectionIdentity } from './utils/detection-identity';
import { HistoryEventType } from './types/finding-history.types';
import {
  SearchAssetsSortBy,
  SearchAssetsSortOrder,
} from './dto/search-assets-request.dto';

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
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockCustomDetectorExtractionsService = {
    createFromIngestion: jest.fn(),
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
      ],
    }).compile();

    service = module.get<AssetService>(AssetService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('searchAssets', () => {
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

    it('should accept TABLE asset type when ingesting assets', async () => {
      const incomingAssets = [
        {
          hash: 'asset-table-1',
          checksum: 'checksum-table-1',
          name: 'Exported table',
          external_url: 'https://example.com/table.csv',
          links: [],
          asset_type: 'TABLE',
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
              assetType: AssetContentType.TABLE,
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
  });
});
