import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Custom Detectors (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('creates, lists, trains, and returns history for a custom detector', async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `cust_e2e_dach_risk_${suffix}`;
    const name = `E2E DACH Risk Detector ${suffix}`;

    const createResponse = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name,
        key,
        method: 'CLASSIFIER',
        config: {
          custom_detector_key: key,
          name,
          method: 'CLASSIFIER',
          classifier: {
            labels: [{ id: 'risk', name: 'Risk' }],
            min_examples_per_label: 1,
            training_examples: [
              { text: 'Haftung ausgeschlossen', label: 'risk', accepted: true },
            ],
          },
        },
      })
      .expect(201);

    expect(createResponse.body).toHaveProperty('id');
    expect(createResponse.body.key).toBe(key);
    const detectorId = createResponse.body.id as string;

    const listResponse = await request(app.getHttpServer())
      .get('/custom-detectors')
      .expect(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(
      listResponse.body.some(
        (entry: { id: string }) => entry.id === detectorId,
      ),
    ).toBe(true);

    const trainResponse = await request(app.getHttpServer())
      .post(`/custom-detectors/${detectorId}/train`)
      .send({})
      .expect(201);

    expect(trainResponse.body.customDetectorId).toBe(detectorId);
    expect(trainResponse.body.status).toBe('SUCCEEDED');

    const historyResponse = await request(app.getHttpServer())
      .get(`/custom-detectors/${detectorId}/training-history`)
      .expect(200);

    expect(Array.isArray(historyResponse.body)).toBe(true);
    expect(historyResponse.body.length).toBeGreaterThan(0);
    expect(historyResponse.body[0].customDetectorId).toBe(detectorId);
  });

  it('allows selecting persisted custom detectors in source config and rejects unknown IDs', async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `cust_e2e_source_selector_${suffix}`;
    const name = `E2E Source Selector Detector ${suffix}`;

    const detector = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name,
        key,
        method: 'RULESET',
        config: {
          custom_detector_key: key,
          name,
          method: 'RULESET',
          ruleset: {
            keyword_rules: [
              {
                id: 'kw_risk',
                name: 'Risk keyword',
                keywords: ['risiko'],
              },
            ],
          },
        },
      })
      .expect(201);

    const detectorId = detector.body.id as string;

    await request(app.getHttpServer())
      .post('/sources')
      .send({
        type: 'WORDPRESS',
        name: `Source with Reused Detector ${suffix}`,
        config: {
          type: 'WORDPRESS',
          required: { url: 'https://example.com' },
          masked: {},
          sampling: { strategy: 'RANDOM' },
          custom_detectors: [detectorId],
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sources')
      .send({
        type: 'WORDPRESS',
        name: `Source with Unknown Detector ${suffix}`,
        config: {
          type: 'WORDPRESS',
          required: { url: 'https://example.org' },
          masked: {},
          sampling: { strategy: 'RANDOM' },
          custom_detectors: ['missing-detector-id'],
        },
      })
      .expect(400);
  });
});
