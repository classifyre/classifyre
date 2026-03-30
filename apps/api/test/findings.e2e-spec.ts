import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import {
  AssetType,
  DetectorType,
  Severity,
  FindingStatus,
} from '@prisma/client';

describe('FindingsController (e2e)', () => {
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

  describe('POST /search/findings', () => {
    it('should return findings with proper structure', async () => {
      const response = await request(app.getHttpServer())
        .post('/search/findings')
        .send({ page: { limit: 10 } })
        .expect(200);

      expect(response.body).toHaveProperty('findings');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('skip');
      expect(response.body).toHaveProperty('limit');
      expect(Array.isArray(response.body.findings)).toBe(true);

      if (response.body.findings.length > 0) {
        const finding = response.body.findings[0];

        // Verify required fields
        expect(finding).toHaveProperty('id');
        expect(finding).toHaveProperty('assetId');
        expect(finding).toHaveProperty('sourceId');
        expect(finding).toHaveProperty('detectorType');
        expect(finding).toHaveProperty('findingType');
        expect(finding).toHaveProperty('category');
        expect(finding).toHaveProperty('severity');
        expect(finding).toHaveProperty('confidence');
        expect(finding).toHaveProperty('matchedContent');
        expect(finding).toHaveProperty('status');
        expect(finding).toHaveProperty('detectedAt');
        expect(finding).toHaveProperty('createdAt');
        expect(finding).toHaveProperty('updatedAt');

        // Verify confidence is a number (not Decimal)
        expect(typeof finding.confidence).toBe('number');

        // Verify new fields for individual detection tracking
        expect(finding).toHaveProperty('detectionIdentity');
        expect(typeof finding.detectionIdentity).toBe('string');

        // Verify included relations
        if (finding.asset) {
          expect(finding.asset).toHaveProperty('id');
          expect(finding.asset).toHaveProperty('name');
          expect(finding.asset).toHaveProperty('type');
        }

        if (finding.source) {
          expect(finding.source).toHaveProperty('id');
          expect(finding.source).toHaveProperty('name');
          expect(finding.source).toHaveProperty('type');
        }
      }
    });

    it('should filter by severity', async () => {
      const response = await request(app.getHttpServer())
        .post('/search/findings')
        .send({ filters: { severity: ['CRITICAL'] } })
        .expect(200);

      expect(Array.isArray(response.body.findings)).toBe(true);
      response.body.findings.forEach((finding: any) => {
        expect(finding.severity).toBe('CRITICAL');
      });
    });

    it('should filter by detectorType', async () => {
      const response = await request(app.getHttpServer())
        .post('/search/findings')
        .send({ filters: { detectorType: ['SECRETS'] } })
        .expect(200);

      expect(Array.isArray(response.body.findings)).toBe(true);
      response.body.findings.forEach((finding: any) => {
        expect(finding.detectorType).toBe('SECRETS');
      });
    });

    it('should filter by runnerId', async () => {
      // First get a finding to get a valid runnerId
      const allFindings = await request(app.getHttpServer())
        .post('/search/findings')
        .send({ page: { limit: 1 } })
        .expect(200);

      if (allFindings.body.findings.length > 0) {
        const runnerId = allFindings.body.findings[0].runnerId;

        const response = await request(app.getHttpServer())
          .post('/search/findings')
          .send({ filters: { runnerId } })
          .expect(200);

        expect(Array.isArray(response.body.findings)).toBe(true);
        response.body.findings.forEach((finding: any) => {
          expect(finding.runnerId).toBe(runnerId);
        });
      }
    });

    it('should respect pagination', async () => {
      const response = await request(app.getHttpServer())
        .post('/search/findings')
        .send({ page: { skip: 0, limit: 5 } })
        .expect(200);

      expect(Array.isArray(response.body.findings)).toBe(true);
      expect(response.body.findings.length).toBeLessThanOrEqual(5);
      expect(response.body.skip).toBe(0);
      expect(response.body.limit).toBe(5);
    });
  });

  describe('GET /assets/:id', () => {
    it('should return normalized asset details', async () => {
      const sourceId = randomUUID();
      const runnerId = randomUUID();
      const assetId = randomUUID();

      const source = await prisma.source.create({
        data: {
          id: sourceId,
          name: 'Asset Details Test Source',
          type: AssetType.WORDPRESS,
          config: {},
        },
      });

      const runner = await prisma.runner.create({
        data: {
          id: runnerId,
          sourceId: source.id,
          status: 'COMPLETED',
          triggerType: 'MANUAL',
        },
      });

      const asset = await prisma.asset.create({
        data: {
          id: assetId,
          hash: assetId,
          checksum: 'asset-details-checksum',
          name: 'Asset Details Test',
          externalUrl: `urn:${assetId}`,
          links: ['https://example.test/asset-details'],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          sourceId: source.id,
          runnerId: runner.id,
        },
      });

      try {
        const response = await request(app.getHttpServer())
          .get(`/assets/${asset.id}`)
          .expect(200);

        expect(response.body.id).toBe(asset.id);
        expect(response.body.sourceId).toBe(source.id);
        expect(Array.isArray(response.body.links)).toBe(true);
        expect(response.body.links).toContain(
          'https://example.test/asset-details',
        );
      } finally {
        await prisma.asset.delete({ where: { id: asset.id } });
        await prisma.runner.delete({ where: { id: runner.id } });
        await prisma.source.delete({ where: { id: source.id } });
      }
    });
  });

  describe('GET /findings/stats', () => {
    it('should return statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/findings/stats')
        .expect(200);

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('bySeverity');
      expect(response.body).toHaveProperty('byStatus');
      expect(response.body.bySeverity).toHaveProperty('critical');
      expect(response.body.bySeverity).toHaveProperty('high');
      expect(response.body.bySeverity).toHaveProperty('medium');
      expect(response.body.bySeverity).toHaveProperty('low');
    });
  });

  describe('PATCH /findings/:id', () => {
    it('should update status and severity', async () => {
      const sourceId = randomUUID();
      const runnerId = randomUUID();
      const assetId = randomUUID();
      const findingId = randomUUID();

      const source = await prisma.source.create({
        data: {
          id: sourceId,
          name: 'Findings Patch Test Source',
          type: AssetType.WORDPRESS,
          config: {},
        },
      });

      const runner = await prisma.runner.create({
        data: {
          id: runnerId,
          sourceId: source.id,
          status: 'COMPLETED',
          triggerType: 'MANUAL',
        },
      });

      const asset = await prisma.asset.create({
        data: {
          id: assetId,
          hash: assetId,
          checksum: 'patch-test-checksum',
          name: 'Patch Test Asset',
          externalUrl: `urn:${assetId}`,
          links: [],
          assetType: 'TXT',
          sourceType: AssetType.WORDPRESS,
          sourceId: source.id,
          runnerId: runner.id,
        },
      });

      const finding = await prisma.finding.create({
        data: {
          id: findingId,
          detectionIdentity: `detection-${findingId}`,
          assetId: asset.id,
          sourceId: source.id,
          runnerId: runner.id,
          detectorType: DetectorType.SECRETS,
          findingType: 'API_KEY',
          category: 'security',
          severity: Severity.LOW,
          confidence: 0.5,
          matchedContent: 'api-key-value',
          detectedAt: new Date(),
        },
      });

      try {
        const response = await request(app.getHttpServer())
          .patch(`/findings/${finding.id}`)
          .send({ status: FindingStatus.IGNORED, severity: Severity.HIGH })
          .expect(200);

        expect(response.body.status).toBe('IGNORED');
        expect(response.body.severity).toBe('HIGH');
        const responseHistory = Array.isArray(response.body.history)
          ? response.body.history
          : [];
        const responseEvents = responseHistory.map(
          (entry: any) => entry.eventType,
        );
        expect(responseEvents).toEqual(
          expect.arrayContaining(['STATUS_CHANGED', 'SEVERITY_CHANGED']),
        );

        const updated = await prisma.finding.findUnique({
          where: { id: finding.id },
        });

        expect(updated?.status).toBe(FindingStatus.IGNORED);
        expect(updated?.severity).toBe(Severity.HIGH);
        const updatedHistory = Array.isArray(updated?.history)
          ? updated?.history
          : [];
        const updatedEvents = updatedHistory.map(
          (entry: any) => entry.eventType,
        );
        expect(updatedEvents).toEqual(
          expect.arrayContaining(['STATUS_CHANGED', 'SEVERITY_CHANGED']),
        );
      } finally {
        await prisma.finding.delete({ where: { id: finding.id } });
        await prisma.asset.delete({ where: { id: asset.id } });
        await prisma.runner.delete({ where: { id: runner.id } });
        await prisma.source.delete({ where: { id: source.id } });
      }
    });
  });
});
