import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { AssetService } from '../src/asset.service';
import { CustomDetectorExtractionsService } from '../src/custom-detector-extractions.service';
import {
  AssetStatus,
  AssetType,
  RunnerStatus,
  TriggerType,
} from '@prisma/client';

type IncomingAsset = {
  hash: string;
  checksum: string;
  name: string;
  external_url: string;
  links: string[];
  asset_type: string;
  findings: any[];
};

const makeAsset = (
  hash: string,
  checksum: string,
  name: string,
  assetType: string = 'OTHER',
): IncomingAsset => ({
  hash,
  checksum,
  name,
  external_url: `https://example.com/${hash}`,
  links: [],
  asset_type: assetType,
  findings: [],
});

describe('Asset Streaming Versioning (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assetService: AssetService;
  let sourceId: string;
  const mockCustomDetectorExtractionsService = {
    createFromIngestion: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        PrismaService,
        AssetService,
        {
          provide: CustomDetectorExtractionsService,
          useValue: mockCustomDetectorExtractionsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    assetService = moduleFixture.get<AssetService>(AssetService);
  });

  afterAll(async () => {
    await prisma.finding.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.runner.deleteMany({});
    await prisma.source.deleteMany({});
    await app.close();
  });

  beforeEach(async () => {
    await prisma.finding.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.runner.deleteMany({});
    await prisma.source.deleteMany({});

    const source = await prisma.source.create({
      data: {
        name: 'Streamed WordPress Source',
        type: AssetType.WORDPRESS,
        config: { url: 'https://example.com' },
      },
    });

    sourceId = source.id;
  });

  it('should preserve first-run streamed assets as NEW (no false DELETED)', async () => {
    const runner = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const batch1 = [
      makeAsset('page-1', 'checksum-page-1', 'Page 1', 'HTML'),
      makeAsset('image-1', 'checksum-image-1', 'Image 1', 'IMAGE'),
    ];
    const batch2 = [
      makeAsset('image-2', 'checksum-image-2', 'Image 2', 'IMAGE'),
    ];

    const result1 = await assetService.bulkIngest(sourceId, runner.id, batch1, {
      finalizeRun: false,
    });
    const result2 = await assetService.bulkIngest(sourceId, runner.id, batch2, {
      finalizeRun: false,
    });
    const finalized = await assetService.finalizeIngestRun(
      sourceId,
      runner.id,
      [
        ...batch1.map((asset) => asset.hash),
        ...batch2.map((asset) => asset.hash),
      ],
      false,
    );

    expect(result1.created).toBe(2);
    expect(result1.deleted).toBe(0);
    expect(result2.created).toBe(1);
    expect(result2.deleted).toBe(0);
    expect(finalized.deleted).toBe(0);

    const dbAssets = await prisma.asset.findMany({
      where: { sourceId },
      orderBy: { hash: 'asc' },
    });

    expect(dbAssets).toHaveLength(3);
    expect(dbAssets.every((asset) => asset.status === AssetStatus.NEW)).toBe(
      true,
    );
  });

  it('should follow NEW/UNCHANGED/UPDATED semantics in streamed runs (absent assets kept as-is)', async () => {
    const runner1 = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const firstRunAssets = [
      makeAsset('asset-a', 'checksum-a-v1', 'Asset A'),
      makeAsset('asset-b', 'checksum-b-v1', 'Asset B'),
      makeAsset('asset-c', 'checksum-c-v1', 'Asset C'),
    ];

    await assetService.bulkIngest(sourceId, runner1.id, firstRunAssets);

    const runner2 = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const secondBatch1 = [makeAsset('asset-a', 'checksum-a-v1', 'Asset A')];
    const secondBatch2 = [
      makeAsset('asset-b', 'checksum-b-v2', 'Asset B Updated'),
      makeAsset('asset-d', 'checksum-d-v1', 'Asset D New'),
    ];

    const secondResult1 = await assetService.bulkIngest(
      sourceId,
      runner2.id,
      secondBatch1,
      { finalizeRun: false },
    );
    const secondResult2 = await assetService.bulkIngest(
      sourceId,
      runner2.id,
      secondBatch2,
      { finalizeRun: false },
    );
    const finalized = await assetService.finalizeIngestRun(
      sourceId,
      runner2.id,
      [...secondBatch1, ...secondBatch2].map((asset) => asset.hash),
      false,
    );

    expect(secondResult1.unchanged).toBe(1);
    expect(secondResult2.updated).toBe(1);
    expect(secondResult2.created).toBe(1);
    expect(finalized.deleted).toBe(0); // No deletion — sampling means absence ≠ gone

    const dbAssets = await prisma.asset.findMany({
      where: { sourceId },
      orderBy: { hash: 'asc' },
    });

    expect(dbAssets).toHaveLength(4);

    const byHash = new Map(dbAssets.map((asset) => [asset.hash, asset]));
    expect(byHash.get('asset-a')?.status).toBe(AssetStatus.UNCHANGED);
    expect(byHash.get('asset-b')?.status).toBe(AssetStatus.UPDATED);
    expect(byHash.get('asset-c')?.status).toBe(AssetStatus.NEW); // Absent from sample, status preserved from run 1
    expect(byHash.get('asset-d')?.status).toBe(AssetStatus.NEW);
  });
});
