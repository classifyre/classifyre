import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { RunnerStatus } from '@prisma/client';
import { createSitemapSourceConfig } from './helpers/sitemap-test-helper';

describe('Sitemap Runner Integration (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sourceId: string | null = null;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    await app.init();
    await app.listen(8000);
  });

  afterAll(async () => {
    if (sourceId) {
      await prisma.source
        .delete({ where: { id: sourceId } })
        .catch(() => undefined);
    }
    await app.close();
  });

  it('creates source, runs extraction, ingests at least 10 assets', async () => {
    const config = createSitemapSourceConfig(false);

    const createResponse = await request(app.getHttpServer())
      .post('/sources')
      .send({ type: 'SITEMAP', name: 'Test Sitemap Source', config })
      .expect(201);

    sourceId = createResponse.body.id;

    const runResponse = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/run`)
      .send({ triggeredBy: 'test-user', triggerType: 'MANUAL' })
      .expect(201);

    const runnerId = runResponse.body.id;

    let runner: any = null;
    let attempts = 0;
    const maxAttempts = 180;

    while (attempts < maxAttempts) {
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

    expect(runner?.status).toBe(RunnerStatus.COMPLETED);
    expect(
      runner?.assetsCreated + runner?.assetsUpdated,
    ).toBeGreaterThanOrEqual(10);

    const assetsResponse = await request(app.getHttpServer())
      .get(`/sources/${sourceId}/assets`)
      .expect(200);

    expect(assetsResponse.body.total).toBeGreaterThanOrEqual(10);
  }, 240000);
});
