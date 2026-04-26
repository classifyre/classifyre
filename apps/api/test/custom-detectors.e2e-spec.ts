import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

const PIPELINE_SCHEMA_SUPPORT_TICKET = {
  model: { name: 'fastino/gliner2-base-v1', path: null },
  entities: {
    order_id: { description: 'Order ID like ORD-123', required: true },
    amount: { description: 'Monetary value like 50€', required: false },
  },
  classification: {
    intent: { labels: ['refund', 'bug', 'question'], multi_label: false },
  },
  validation: { confidence_threshold: 0.8, rules: [] },
};

const PIPELINE_SCHEMA_ENTITY_ONLY = {
  model: { name: 'fastino/gliner2-base-v1', path: null },
  entities: {
    contract_clause: {
      description: 'Legal risk clause like "Haftung ausgeschlossen"',
      required: true,
    },
  },
  classification: {},
  validation: { confidence_threshold: 0.7, rules: [] },
};

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

  it('creates, lists, trains, and returns history for a GLiNER2 pipeline detector', async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `cust_e2e_support_${suffix}`;
    const name = `E2E Support Ticket Extractor ${suffix}`;

    const createResponse = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name,
        key,
        pipelineSchema: PIPELINE_SCHEMA_SUPPORT_TICKET,
      })
      .expect(201);

    expect(createResponse.body).toHaveProperty('id');
    expect(createResponse.body.key).toBe(key);
    expect(createResponse.body).toHaveProperty('pipelineSchema');
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
    expect(trainResponse.body.strategy).toBe('GLINER2_PIPELINE');

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
        pipelineSchema: PIPELINE_SCHEMA_ENTITY_ONLY,
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

  it('rejects a pipeline schema with no entities and no classification', async () => {
    const suffix = randomUUID().slice(0, 8);
    await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E Empty Pipeline ${suffix}`,
        pipelineSchema: {
          model: { name: 'fastino/gliner2-base-v1' },
          entities: {},
          classification: {},
        },
      })
      .expect(400);
  });
});
