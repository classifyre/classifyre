import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { RunnerStatus } from '@prisma/client';
import { createWordPressSourceConfig } from './helpers/wordpress-test-helper';

describe('WordPress Runner Integration (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testSourceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    (app as any).useBodyParser?.('json', { limit: '50mb' });
    (app as any).useBodyParser?.('urlencoded', {
      limit: '50mb',
      extended: true,
    });
    prisma = app.get(PrismaService);
    await app.init();
    // Listen on a real port so CLI can connect
    await app.listen(8000);
  });

  afterAll(async () => {
    // Clean up test data
    if (testSourceId) {
      await prisma.source.delete({
        where: { id: testSourceId },
      });
    }
    await app.close();
  });

  describe('WordPress extraction without detectors', () => {
    it('should create source, run CLI, and ingest assets', async () => {
      // 1. Create source
      const config = createWordPressSourceConfig(false);

      const createResponse = await request(app.getHttpServer())
        .post('/sources')
        .send({ type: 'WORDPRESS', name: 'Test WordPress', config })
        .expect(201);

      testSourceId = createResponse.body.id;
      expect(testSourceId).toBeDefined();

      // 2. Start runner
      const runResponse = await request(app.getHttpServer())
        .post(`/sources/${testSourceId}/run`)
        .send({ triggeredBy: 'test-user', triggerType: 'MANUAL' })
        .expect(201);

      const runnerId = runResponse.body.id;
      expect(runResponse.body.status).toBe(RunnerStatus.PENDING);

      // 3. Wait for runner to complete (poll status)
      let runner;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const statusResponse = await request(app.getHttpServer())
          .get(`/runners/${runnerId}`)
          .expect(200);

        runner = statusResponse.body;

        if (runner.status === RunnerStatus.COMPLETED) {
          break;
        }

        if (runner.status === RunnerStatus.ERROR) {
          throw new Error(`Runner failed: ${runner.errorMessage}`);
        }

        attempts++;
      }

      expect(runner.status).toBe(RunnerStatus.COMPLETED);
      expect(runner.assetsCreated).toBeGreaterThan(0);

      // 4. Verify assets were ingested
      const assetsResponse = await request(app.getHttpServer())
        .get(`/sources/${testSourceId}/assets`)
        .expect(200);

      expect(assetsResponse.body.total).toBe(runner.assetsCreated);

      // 5. Verify asset structure
      const asset = assetsResponse.body.items[0];
      expect(asset.runnerId).toBe(runnerId);
      expect(asset.name).toBeDefined();
      expect(asset.externalUrl).toBeDefined();
      expect(asset.checksum).toBeDefined();
      expect(Array.isArray(asset.links)).toBe(true);
    }, 60000); // 60 second timeout
  });

  describe('WordPress extraction with detectors', () => {
    it('should run detectors and store findings', async () => {
      // 1. Create source with detectors
      const config = createWordPressSourceConfig(true);

      const createResponse = await request(app.getHttpServer())
        .post('/sources')
        .send({
          type: 'WORDPRESS',
          name: 'Test WordPress with Detectors',
          config,
        });

      if (createResponse.status !== 201) {
        console.error('Validation error:', createResponse.body);
      }
      expect(createResponse.status).toBe(201);

      const sourceId = createResponse.body.id;

      // 2. Start runner
      const runResponse = await request(app.getHttpServer())
        .post(`/sources/${sourceId}/run`)
        .send({ triggeredBy: 'test-user' })
        .expect(201);

      const runnerId = runResponse.body.id;

      // 3. Wait for completion
      let runner;
      let attempts = 0;

      while (attempts < 110) {
        // Detectors take longer
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const statusResponse = await request(app.getHttpServer())
          .get(`/runners/${runnerId}`)
          .expect(200);

        runner = statusResponse.body;

        if (
          runner.status === RunnerStatus.COMPLETED ||
          runner.status === RunnerStatus.ERROR
        ) {
          break;
        }

        attempts++;
      }

      expect(runner.status).toBe(RunnerStatus.COMPLETED);
      expect(runner.assetsCreated).toBeGreaterThan(0);

      // 4. Verify assets have detector findings
      const assetsResponse = await request(app.getHttpServer())
        .get(`/sources/${sourceId}/assets`)
        .expect(200);

      const assetsWithFindings = assetsResponse.body.items.filter(
        (a: any) => a.detectorFindings?.current?.length > 0,
      );

      // May or may not have findings depending on content
      console.log(`Total findings: ${runner.totalFindings}`);

      if (assetsWithFindings.length > 0) {
        const asset = assetsWithFindings[0];
        const finding = asset.detectorFindings.current[0];

        expect(finding.detectorType).toBeDefined();
        expect(finding.findingType).toBeDefined();
        expect(finding.severity).toBeDefined();
        expect(finding.confidence).toBeGreaterThan(0);
        expect(finding.status).toBe('open');
        expect(finding.scannedAt).toBeDefined();
      }

      // Clean up
      await prisma.source.delete({ where: { id: sourceId } });
    }, 180000); // 180 second timeout
  });

  describe('Runner management', () => {
    it('should list runners with filtering', async () => {
      const response = await request(app.getHttpServer())
        .get('/runners')
        .query({ skip: 0, take: 10 })
        .expect(200);

      expect(response.body.runners).toBeDefined();
      expect(response.body.total).toBeGreaterThanOrEqual(0);
      expect(response.body.skip).toBe(0);
      expect(response.body.take).toBe(10);
    });

    it('should filter runners by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/runners')
        .query({ status: RunnerStatus.COMPLETED })
        .expect(200);

      if (response.body.runners.length > 0) {
        expect(
          response.body.runners.every(
            (r: any) => r.status === RunnerStatus.COMPLETED,
          ),
        ).toBe(true);
      }
    });

    it('should list runners for specific source', async () => {
      if (testSourceId) {
        const response = await request(app.getHttpServer())
          .get(`/sources/${testSourceId}/runners`)
          .expect(200);

        expect(
          response.body.runners.every((r: any) => r.sourceId === testSourceId),
        ).toBe(true);
      }
    });
  });
});
