import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import {
  AssetType,
  RunnerStatus,
  Severity,
  DetectorType,
} from '@prisma/client';

/**
 * End-to-end tests for source deletion with cascading deletes
 *
 * These tests verify that when a data source is deleted:
 * 1. All related runners are deleted from the runners table
 * 2. All related assets are deleted from the assets table
 * 3. All related findings are deleted from the findings table
 */
describe('SourcesController Delete (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up tables before each test
    await prisma.finding.deleteMany({});
    await prisma.asset.deleteMany({});
    await prisma.runner.deleteMany({});
    await prisma.source.deleteMany({});
  });

  describe('DELETE /sources/:id', () => {
    it('should delete a source and all its related data', async () => {
      // 1. Create a source
      const source = await prisma.source.create({
        data: {
          id: 'test-source-id',
          name: 'Test Source',
          type: AssetType.WORDPRESS,
          config: { url: 'https://blog.example.com' },
          runnerStatus: RunnerStatus.COMPLETED,
        },
      });

      // 2. Create runners related to the source
      const runner = await prisma.runner.create({
        data: {
          id: 'test-runner-id',
          sourceId: source.id,
          status: RunnerStatus.COMPLETED,
          triggerType: 'MANUAL',
          assetsCreated: 2,
          totalFindings: 3,
        },
      });

      // 3. Create assets related to the source
      const asset1 = await prisma.asset.create({
        data: {
          id: 'test-asset-1',
          hash: 'test-asset-1',
          checksum: 'checksum1',
          name: 'Asset 1',
          externalUrl: 'urn:1',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          sourceId: source.id,
          runnerId: runner.id,
        },
      });

      const asset2 = await prisma.asset.create({
        data: {
          id: 'test-asset-2',
          hash: 'test-asset-2',
          checksum: 'checksum2',
          name: 'Asset 2',
          externalUrl: 'urn:2',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          sourceId: source.id,
          runnerId: runner.id,
        },
      });

      // 4. Create findings related to the source and assets
      await prisma.finding.create({
        data: {
          id: 'test-finding-1',
          detectionIdentity: 'detection-1',
          assetId: asset1.id,
          sourceId: source.id,
          runnerId: runner.id,
          detectorType: DetectorType.SECRETS,
          findingType: 'API_KEY',
          category: 'security',
          severity: Severity.HIGH,
          confidence: 0.95,
          matchedContent: 'api-key-123',
          detectedAt: new Date(),
        },
      });

      await prisma.finding.create({
        data: {
          id: 'test-finding-2',
          detectionIdentity: 'detection-2',
          assetId: asset1.id,
          sourceId: source.id,
          runnerId: runner.id,
          detectorType: DetectorType.PII,
          findingType: 'EMAIL',
          category: 'privacy',
          severity: Severity.MEDIUM,
          confidence: 0.88,
          matchedContent: 'test@example.com',
          detectedAt: new Date(),
        },
      });

      await prisma.finding.create({
        data: {
          id: 'test-finding-3',
          detectionIdentity: 'detection-3',
          assetId: asset2.id,
          sourceId: source.id,
          runnerId: runner.id,
          detectorType: DetectorType.SECRETS,
          findingType: 'PASSWORD',
          category: 'security',
          severity: Severity.CRITICAL,
          confidence: 0.99,
          matchedContent: 'password=secret',
          detectedAt: new Date(),
        },
      });

      // Verify data exists before deletion
      const sourceBefore = await prisma.source.findUnique({
        where: { id: source.id },
      });
      expect(sourceBefore).not.toBeNull();

      const runnersBefore = await prisma.runner.findMany({
        where: { sourceId: source.id },
      });
      expect(runnersBefore).toHaveLength(1);

      const assetsBefore = await prisma.asset.findMany({
        where: { sourceId: source.id },
      });
      expect(assetsBefore).toHaveLength(2);

      const findingsBefore = await prisma.finding.findMany({
        where: { sourceId: source.id },
      });
      expect(findingsBefore).toHaveLength(3);

      // 5. Delete the source via API
      const response = await request(app.getHttpServer())
        .delete(`/sources/${source.id}`)
        .expect(204);

      expect(response.body).toEqual({});

      // 6. Verify source is deleted
      const sourceAfter = await prisma.source.findUnique({
        where: { id: source.id },
      });
      expect(sourceAfter).toBeNull();

      // 7. Verify all related runners are deleted
      const runnersAfter = await prisma.runner.findMany({
        where: { sourceId: source.id },
      });
      expect(runnersAfter).toHaveLength(0);

      // 8. Verify all related assets are deleted
      const assetsAfter = await prisma.asset.findMany({
        where: { sourceId: source.id },
      });
      expect(assetsAfter).toHaveLength(0);

      // 9. Verify all related findings are deleted
      const findingsAfter = await prisma.finding.findMany({
        where: { sourceId: source.id },
      });
      expect(findingsAfter).toHaveLength(0);
    });

    it('should return 404 when trying to delete non-existent source', async () => {
      const response = await request(app.getHttpServer())
        .delete('/sources/non-existent-id')
        .expect(404);

      expect(response.body).toMatchObject({
        message: 'Source with ID non-existent-id not found',
        error: 'Not Found',
        statusCode: 404,
      });
    });

    it('should delete source with no related data', async () => {
      // Create a source with no runners, assets, or findings
      const source = await prisma.source.create({
        data: {
          id: 'empty-source-id',
          name: 'Empty Source',
          type: AssetType.SLACK,
          config: { workspace: 'acme' },
          runnerStatus: RunnerStatus.PENDING,
        },
      });

      // Delete the source
      await request(app.getHttpServer())
        .delete(`/sources/${source.id}`)
        .expect(204);

      // Verify source is deleted
      const sourceAfter = await prisma.source.findUnique({
        where: { id: source.id },
      });
      expect(sourceAfter).toBeNull();
    });

    it('should delete multiple related runners when source is deleted', async () => {
      // Create a source
      const source = await prisma.source.create({
        data: {
          id: 'multi-runner-source',
          name: 'Multi Runner Source',
          type: AssetType.WORDPRESS,
          config: {},
          runnerStatus: RunnerStatus.COMPLETED,
        },
      });

      // Create multiple runners
      await prisma.runner.createMany({
        data: [
          {
            id: 'runner-1',
            sourceId: source.id,
            status: RunnerStatus.COMPLETED,
            triggerType: 'MANUAL',
          },
          {
            id: 'runner-2',
            sourceId: source.id,
            status: RunnerStatus.ERROR,
            triggerType: 'SCHEDULED',
          },
          {
            id: 'runner-3',
            sourceId: source.id,
            status: RunnerStatus.RUNNING,
            triggerType: 'API',
          },
        ],
      });

      // Verify runners exist
      const runnersBefore = await prisma.runner.findMany({
        where: { sourceId: source.id },
      });
      expect(runnersBefore).toHaveLength(3);

      // Delete the source
      await request(app.getHttpServer())
        .delete(`/sources/${source.id}`)
        .expect(204);

      // Verify all runners are deleted
      const runnersAfter = await prisma.runner.findMany({
        where: { sourceId: source.id },
      });
      expect(runnersAfter).toHaveLength(0);
    });

    it('should delete assets and their related findings when source is deleted', async () => {
      // Create a source
      const source = await prisma.source.create({
        data: {
          id: 'source-with-findings',
          name: 'Source With Findings',
          type: AssetType.SLACK,
          config: {},
          runnerStatus: RunnerStatus.COMPLETED,
        },
      });

      // Create a runner
      const runner = await prisma.runner.create({
        data: {
          id: 'runner-findings',
          sourceId: source.id,
          status: RunnerStatus.COMPLETED,
          triggerType: 'MANUAL',
        },
      });

      // Create an asset with multiple findings
      const asset = await prisma.asset.create({
        data: {
          id: 'asset-with-findings',
          hash: 'asset-with-findings',
          checksum: 'checksum',
          name: 'Asset With Findings',
          externalUrl: 'urn:findings',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.SLACK,
          sourceId: source.id,
          runnerId: runner.id,
        },
      });

      // Create findings for this asset
      await prisma.finding.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          id: `finding-${i}`,
          detectionIdentity: `detection-${i}`,
          assetId: asset.id,
          sourceId: source.id,
          runnerId: runner.id,
          detectorType: DetectorType.SECRETS,
          findingType: 'API_KEY',
          category: 'security',
          severity: Severity.HIGH,
          confidence: 0.9,
          matchedContent: `secret-${i}`,
          detectedAt: new Date(),
        })),
      });

      // Verify data exists
      const findingsBefore = await prisma.finding.findMany({
        where: { sourceId: source.id },
      });
      expect(findingsBefore).toHaveLength(5);

      // Delete the source
      await request(app.getHttpServer())
        .delete(`/sources/${source.id}`)
        .expect(204);

      // Verify asset is deleted
      const assetAfter = await prisma.asset.findUnique({
        where: { id: asset.id },
      });
      expect(assetAfter).toBeNull();

      // Verify all findings are deleted
      const findingsAfter = await prisma.finding.findMany({
        where: { sourceId: source.id },
      });
      expect(findingsAfter).toHaveLength(0);
    });

    it('should only delete data related to the deleted source, not other sources', async () => {
      // Create two sources
      const source1 = await prisma.source.create({
        data: {
          id: 'source-1',
          name: 'Source 1',
          type: AssetType.WORDPRESS,
          config: {},
          runnerStatus: RunnerStatus.COMPLETED,
        },
      });

      const source2 = await prisma.source.create({
        data: {
          id: 'source-2',
          name: 'Source 2',
          type: AssetType.SLACK,
          config: {},
          runnerStatus: RunnerStatus.COMPLETED,
        },
      });

      // Create runners for both sources
      await prisma.runner.create({
        data: {
          id: 'runner-source-1',
          sourceId: source1.id,
          status: RunnerStatus.COMPLETED,
          triggerType: 'MANUAL',
        },
      });

      await prisma.runner.create({
        data: {
          id: 'runner-source-2',
          sourceId: source2.id,
          status: RunnerStatus.COMPLETED,
          triggerType: 'MANUAL',
        },
      });

      // Create assets for both sources
      await prisma.asset.create({
        data: {
          id: 'asset-source-1',
          hash: 'asset-source-1',
          checksum: 'checksum1',
          name: 'Asset Source 1',
          externalUrl: 'urn:source1',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          sourceId: source1.id,
        },
      });

      await prisma.asset.create({
        data: {
          id: 'asset-source-2',
          hash: 'asset-source-2',
          checksum: 'checksum2',
          name: 'Asset Source 2',
          externalUrl: 'urn:source2',
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.SLACK,
          sourceId: source2.id,
        },
      });

      // Create findings for both sources
      await prisma.finding.create({
        data: {
          id: 'finding-source-1',
          detectionIdentity: 'detection-source-1',
          assetId: 'asset-source-1',
          sourceId: source1.id,
          detectorType: DetectorType.SECRETS,
          findingType: 'API_KEY',
          category: 'security',
          severity: Severity.HIGH,
          confidence: 0.9,
          matchedContent: 'secret1',
          detectedAt: new Date(),
        },
      });

      await prisma.finding.create({
        data: {
          id: 'finding-source-2',
          detectionIdentity: 'detection-source-2',
          assetId: 'asset-source-2',
          sourceId: source2.id,
          detectorType: DetectorType.SECRETS,
          findingType: 'API_KEY',
          category: 'security',
          severity: Severity.HIGH,
          confidence: 0.9,
          matchedContent: 'secret2',
          detectedAt: new Date(),
        },
      });

      // Delete only source1
      await request(app.getHttpServer())
        .delete(`/sources/${source1.id}`)
        .expect(204);

      // Verify source1 is deleted
      const source1After = await prisma.source.findUnique({
        where: { id: source1.id },
      });
      expect(source1After).toBeNull();

      // Verify source2 still exists
      const source2After = await prisma.source.findUnique({
        where: { id: source2.id },
      });
      expect(source2After).not.toBeNull();

      // Verify source1's data is deleted
      const runnersSource1 = await prisma.runner.findMany({
        where: { sourceId: source1.id },
      });
      expect(runnersSource1).toHaveLength(0);

      const assetsSource1 = await prisma.asset.findMany({
        where: { sourceId: source1.id },
      });
      expect(assetsSource1).toHaveLength(0);

      const findingsSource1 = await prisma.finding.findMany({
        where: { sourceId: source1.id },
      });
      expect(findingsSource1).toHaveLength(0);

      // Verify source2's data still exists
      const runnersSource2 = await prisma.runner.findMany({
        where: { sourceId: source2.id },
      });
      expect(runnersSource2).toHaveLength(1);

      const assetsSource2 = await prisma.asset.findMany({
        where: { sourceId: source2.id },
      });
      expect(assetsSource2).toHaveLength(1);

      const findingsSource2 = await prisma.finding.findMany({
        where: { sourceId: source2.id },
      });
      expect(findingsSource2).toHaveLength(1);
    });
  });
});
