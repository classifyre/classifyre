import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma.service';
import { AssetService } from '../src/asset.service';
import { CustomDetectorExtractionsService } from '../src/custom-detector-extractions.service';
import {
  AssetStatus,
  AssetType,
  TriggerType,
  RunnerStatus,
} from '@prisma/client';

describe('Asset Versioning (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assetService: AssetService;
  let sourceId: string;
  let runnerId1: string;
  let runnerId2: string;
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

    // Clean up test data
    await prisma.finding.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.runner.deleteMany({});
    await prisma.source.deleteMany({});
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.finding.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.runner.deleteMany({});
    await prisma.source.deleteMany({});

    await app.close();
  });

  beforeEach(async () => {
    // Create a test source
    const source = await prisma.source.create({
      data: {
        name: 'Test WordPress Source',
        type: AssetType.WORDPRESS,
        config: { url: 'https://example.com' },
      },
    });
    sourceId = source.id;

    // Create runners for two runs
    const runner1 = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });
    runnerId1 = runner1.id;

    const runner2 = await prisma.runner.create({
      data: {
        sourceId,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });
    runnerId2 = runner2.id;
  });

  afterEach(async () => {
    // Clean up after each test
    await prisma.finding.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.runner.deleteMany({});
    await prisma.source.deleteMany({});
  });

  it('should mark assets as NEW on first run', async () => {
    const assets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
      {
        hash: 'asset-2',
        checksum: 'checksum-2',
        name: 'Second Asset',
        external_url: 'https://example.com/asset-2',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    const result = await assetService.bulkIngest(sourceId, runnerId1, assets);

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.deleted).toBe(0);

    // Verify assets in database
    const dbAssets = await prisma.asset.findMany({
      where: { sourceId },
      orderBy: { id: 'asc' },
    });

    expect(dbAssets).toHaveLength(2);
    expect(dbAssets[0].status).toBe(AssetStatus.NEW);
    expect(dbAssets[1].status).toBe(AssetStatus.NEW);
    expect(dbAssets[0].runnerId).toBe(runnerId1);
    expect(dbAssets[1].runnerId).toBe(runnerId1);
  });

  it('should mark assets as UNCHANGED when checksum is same in second run', async () => {
    // First run
    const firstRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId1, firstRunAssets);

    // Second run with same checksum
    const secondRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    const result = await assetService.bulkIngest(
      sourceId,
      runnerId2,
      secondRunAssets,
    );

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(result.deleted).toBe(0);

    // Verify asset status in database
    const dbAsset = await prisma.asset.findFirst({
      where: { hash: 'asset-1', sourceId },
    });

    expect(dbAsset?.status).toBe(AssetStatus.UNCHANGED);
    expect(dbAsset?.runnerId).toBe(runnerId2); // Runner ID should be updated
    expect(dbAsset?.checksum).toBe('checksum-1');

    // Verify runner stats
    const runner2 = await prisma.runner.findUnique({
      where: { id: runnerId2 },
    });
    expect(runner2?.assetsCreated).toBe(0);
    expect(runner2?.assetsUpdated).toBe(0);
    expect(runner2?.assetsUnchanged).toBe(1);
  });

  it('should mark assets as UPDATED when checksum changes in second run', async () => {
    // First run
    const firstRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId1, firstRunAssets);

    // Second run with different checksum
    const secondRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-2',
        name: 'Updated Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    const result = await assetService.bulkIngest(
      sourceId,
      runnerId2,
      secondRunAssets,
    );

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.deleted).toBe(0);

    // Verify asset status and updated fields in database
    const dbAsset = await prisma.asset.findFirst({
      where: { hash: 'asset-1', sourceId },
    });

    expect(dbAsset?.status).toBe(AssetStatus.UPDATED);
    expect(dbAsset?.runnerId).toBe(runnerId2);
    expect(dbAsset?.checksum).toBe('checksum-2');
    expect(dbAsset?.name).toBe('Updated Asset');
  });

  it('should NOT mark assets as DELETED when they are absent from a sample run', async () => {
    // First run with two assets
    const firstRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
      {
        hash: 'asset-2',
        checksum: 'checksum-2',
        name: 'Second Asset',
        external_url: 'https://example.com/asset-2',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId1, firstRunAssets);

    // Second run (sample) with only one asset — absence does not imply deletion
    const secondRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    const result = await assetService.bulkIngest(
      sourceId,
      runnerId2,
      secondRunAssets,
    );

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(result.deleted).toBe(0);

    // Verify asset-1 is UNCHANGED
    const asset1 = await prisma.asset.findFirst({
      where: { hash: 'asset-1', sourceId },
    });
    expect(asset1?.status).toBe(AssetStatus.UNCHANGED);

    // Verify asset-2 remains NEW (not deleted — sampling)
    const asset2 = await prisma.asset.findFirst({
      where: { hash: 'asset-2', sourceId },
    });
    expect(asset2?.status).toBe(AssetStatus.NEW);
    expect(asset2?.runnerId).toBe(runnerId1); // Runner ID unchanged (not touched in run 2)
  });

  it('should retain old findings as RESOLVED when they disappear from subsequent runs', async () => {
    // First run with findings
    const firstRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [
          {
            detector_type: 'PII',
            finding_type: 'EMAIL',
            category: 'pii',
            severity: 'high',
            confidence: 0.95,
            matched_content: 'test1@example.com',
            detected_at: new Date().toISOString(),
          },
        ],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId1, firstRunAssets);

    // Verify first run findings (look up asset by hash to get UUID)
    const asset1AfterRun1 = await prisma.asset.findFirst({
      where: { hash: 'asset-1', sourceId },
    });
    let findings = await prisma.finding.findMany({
      where: { assetId: asset1AfterRun1!.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].matchedContent).toBe('test1@example.com');

    // Second run with different findings
    const secondRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'First Asset',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [
          {
            detector_type: 'PII',
            finding_type: 'PHONE',
            category: 'pii',
            severity: 'high',
            confidence: 0.9,
            matched_content: '555-1234',
            detected_at: new Date().toISOString(),
          },
        ],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId2, secondRunAssets);

    // Verify both findings exist (old one retained as RESOLVED, new one OPEN)
    findings = await prisma.finding.findMany({
      where: { assetId: asset1AfterRun1!.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(findings).toHaveLength(2);
    // EMAIL finding from run 1: no longer detected in run 2 → auto-resolved.
    // runnerId is updated to runnerId2 (the runner that discovered the absence).
    expect(findings[0].matchedContent).toBe('test1@example.com');
    expect(findings[0].status).toBe('RESOLVED');
    expect(findings[0].runnerId).toBe(runnerId2);
    // PHONE finding from run 2: new detection, OPEN.
    expect(findings[1].matchedContent).toBe('555-1234');
    expect(findings[1].status).toBe('OPEN');
    expect(findings[1].runnerId).toBe(runnerId2);
  });

  it('should handle mixed scenario: NEW, UPDATED, UNCHANGED (absent assets kept as-is)', async () => {
    // First run with 3 assets
    const firstRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'Asset 1',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
      {
        hash: 'asset-2',
        checksum: 'checksum-2',
        name: 'Asset 2',
        external_url: 'https://example.com/asset-2',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
      {
        hash: 'asset-3',
        checksum: 'checksum-3',
        name: 'Asset 3',
        external_url: 'https://example.com/asset-3',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId1, firstRunAssets);

    // Second run (sample):
    // - asset-1: unchanged (same checksum)
    // - asset-2: updated (different checksum)
    // - asset-3: absent from sample — NOT deleted
    // - asset-4: new
    const secondRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'Asset 1',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
      {
        hash: 'asset-2',
        checksum: 'checksum-2-updated',
        name: 'Asset 2 Updated',
        external_url: 'https://example.com/asset-2',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
      {
        hash: 'asset-4',
        checksum: 'checksum-4',
        name: 'Asset 4',
        external_url: 'https://example.com/asset-4',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    const result = await assetService.bulkIngest(
      sourceId,
      runnerId2,
      secondRunAssets,
    );

    expect(result.created).toBe(1); // asset-4
    expect(result.updated).toBe(1); // asset-2
    expect(result.unchanged).toBe(1); // asset-1
    expect(result.deleted).toBe(0); // asset-3 absent from sample but NOT deleted

    // Verify statuses
    const asset1 = await prisma.asset.findFirst({
      where: { hash: 'asset-1', sourceId },
    });
    expect(asset1?.status).toBe(AssetStatus.UNCHANGED);

    const asset2 = await prisma.asset.findFirst({
      where: { hash: 'asset-2', sourceId },
    });
    expect(asset2?.status).toBe(AssetStatus.UPDATED);
    expect(asset2?.checksum).toBe('checksum-2-updated');

    // asset-3 is absent from this sample run, but its status is preserved as-is
    const asset3 = await prisma.asset.findFirst({
      where: { hash: 'asset-3', sourceId },
    });
    expect(asset3?.status).toBe(AssetStatus.NEW); // Status from run 1, unchanged

    const asset4 = await prisma.asset.findFirst({
      where: { hash: 'asset-4', sourceId },
    });
    expect(asset4?.status).toBe(AssetStatus.NEW);
  });

  it('should update runner stats correctly', async () => {
    // First run
    const firstRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-1',
        name: 'Asset 1',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
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

    await assetService.bulkIngest(sourceId, runnerId1, firstRunAssets);

    const runner1 = await prisma.runner.findUnique({
      where: { id: runnerId1 },
    });

    expect(runner1?.assetsCreated).toBe(1);
    expect(runner1?.assetsUpdated).toBe(0);
    expect(runner1?.assetsUnchanged).toBe(0);
    expect(runner1?.totalFindings).toBe(1);

    // Second run
    const secondRunAssets = [
      {
        hash: 'asset-1',
        checksum: 'checksum-2',
        name: 'Asset 1 Updated',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'HTML',
        findings: [],
      },
    ];

    await assetService.bulkIngest(sourceId, runnerId2, secondRunAssets);

    const runner2 = await prisma.runner.findUnique({
      where: { id: runnerId2 },
    });

    expect(runner2?.assetsCreated).toBe(0);
    expect(runner2?.assetsUpdated).toBe(1);
    expect(runner2?.assetsUnchanged).toBe(0);
    expect(runner2?.totalFindings).toBe(0);
  });

  it('should mark absent assets as DELETED on full scan (strategy=ALL)', async () => {
    // Create source with sampling strategy ALL
    const fullScanSource = await prisma.source.create({
      data: {
        name: 'Full Scan Source',
        type: AssetType.POSTGRESQL,
        config: { sampling: { strategy: 'ALL' }, required: {} },
      },
    });
    const runner = await prisma.runner.create({
      data: {
        sourceId: fullScanSource.id,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    // Ingest two assets
    await assetService.bulkIngest(fullScanSource.id, runner.id, [
      {
        hash: 'asset-a',
        checksum: 'cs-a',
        name: 'Asset A',
        external_url: 'https://example.com/a',
        links: [],
        asset_type: 'TXT',
        findings: [],
      },
      {
        hash: 'asset-b',
        checksum: 'cs-b',
        name: 'Asset B',
        external_url: 'https://example.com/b',
        links: [],
        asset_type: 'TXT',
        findings: [],
      },
    ]);

    // Full scan second run: only asset-a seen — asset-b was deleted from source
    const runner2 = await prisma.runner.create({
      data: {
        sourceId: fullScanSource.id,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    await assetService.bulkIngest(fullScanSource.id, runner2.id, [
      {
        hash: 'asset-a',
        checksum: 'cs-a',
        name: 'Asset A',
        external_url: 'https://example.com/a',
        links: [],
        asset_type: 'TXT',
        findings: [],
      },
    ]);

    // Finalize with full scan flag (isFullScan=true)
    const result = await assetService.finalizeIngestRun(
      fullScanSource.id,
      runner2.id,
      ['asset-a'],
      true,
    );

    expect(result.deleted).toBe(1);

    const assetA = await prisma.asset.findFirst({
      where: { hash: 'asset-a', sourceId: fullScanSource.id },
    });
    expect(assetA?.status).toBe(AssetStatus.UNCHANGED);

    const assetB = await prisma.asset.findFirst({
      where: { hash: 'asset-b', sourceId: fullScanSource.id },
    });
    expect(assetB?.status).toBe(AssetStatus.DELETED);

    const runner2Updated = await prisma.runner.findUnique({
      where: { id: runner2.id },
    });
    expect(runner2Updated?.assetsDeleted).toBe(1);

    // Cleanup
    await prisma.asset.deleteMany({ where: { sourceId: fullScanSource.id } });
    await prisma.runner.deleteMany({ where: { sourceId: fullScanSource.id } });
    await prisma.source.delete({ where: { id: fullScanSource.id } });
  });

  it('should auto-resolve open findings on assets deleted by full scan', async () => {
    // Create source with sampling strategy ALL
    const fullScanSource = await prisma.source.create({
      data: {
        name: 'Full Scan Source With Findings',
        type: AssetType.POSTGRESQL,
        config: { sampling: { strategy: 'ALL' }, required: {} },
      },
    });
    const runner = await prisma.runner.create({
      data: {
        sourceId: fullScanSource.id,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    // Ingest asset with a finding
    await assetService.bulkIngest(fullScanSource.id, runner.id, [
      {
        hash: 'asset-with-finding',
        checksum: 'cs-finding',
        name: 'Asset With Finding',
        external_url: 'https://example.com/secret',
        links: [],
        asset_type: 'TXT',
        findings: [
          {
            detector_type: 'SECRETS',
            finding_type: 'AWS_KEY',
            category: 'secrets',
            severity: 'critical',
            confidence: 0.99,
            matched_content: 'AKIAIOSFODNN7EXAMPLE',
            detected_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    const finding = await prisma.finding.findFirst({
      where: { sourceId: fullScanSource.id },
    });
    expect(finding?.status).toBe('OPEN');

    // Full scan second run: asset is gone
    const runner2 = await prisma.runner.create({
      data: {
        sourceId: fullScanSource.id,
        triggerType: TriggerType.MANUAL,
        status: RunnerStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    await assetService.bulkIngest(fullScanSource.id, runner2.id, []);
    await assetService.finalizeIngestRun(
      fullScanSource.id,
      runner2.id,
      [],
      true,
    );

    const assetAfter = await prisma.asset.findFirst({
      where: { hash: 'asset-with-finding', sourceId: fullScanSource.id },
    });
    expect(assetAfter?.status).toBe(AssetStatus.DELETED);

    const findingAfter = await prisma.finding.findFirst({
      where: { sourceId: fullScanSource.id },
    });
    expect(findingAfter?.status).toBe('RESOLVED');
    expect(findingAfter?.resolutionReason).toContain('Asset deleted');

    // Cleanup
    await prisma.finding.deleteMany({ where: { sourceId: fullScanSource.id } });
    await prisma.asset.deleteMany({ where: { sourceId: fullScanSource.id } });
    await prisma.runner.deleteMany({ where: { sourceId: fullScanSource.id } });
    await prisma.source.delete({ where: { id: fullScanSource.id } });
  });

  it('should NOT mark assets as DELETED when absent from a sample run (strategy=RANDOM)', async () => {
    // Verify existing sampling behaviour is unchanged (finalizeIngestRun with
    // isFullScan=false is a no-op)
    await assetService.bulkIngest(sourceId, runnerId1, [
      {
        hash: 'sampled-asset-1',
        checksum: 'cs-s1',
        name: 'Sampled 1',
        external_url: 'https://example.com/s1',
        links: [],
        asset_type: 'TXT',
        findings: [],
      },
      {
        hash: 'sampled-asset-2',
        checksum: 'cs-s2',
        name: 'Sampled 2',
        external_url: 'https://example.com/s2',
        links: [],
        asset_type: 'TXT',
        findings: [],
      },
    ]);

    // Second run only sees one asset, but isFullScan=false → no deletion
    const result = await assetService.finalizeIngestRun(
      sourceId,
      runnerId2,
      ['sampled-asset-1'],
      false,
    );
    expect(result.deleted).toBe(0);

    const asset2 = await prisma.asset.findFirst({
      where: { hash: 'sampled-asset-2', sourceId },
    });
    expect(asset2?.status).not.toBe(AssetStatus.DELETED);
  });
});
