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

  // ── REGEX pipeline detector tests ─────────────────────────────────────

  it('creates a REGEX pipeline detector with severity and RE2 options', async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `cust_e2e_regex_${suffix}`;
    const name = `E2E Regex Detector ${suffix}`;

    const createResponse = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name,
        key,
        pipelineSchema: {
          type: 'REGEX',
          patterns: {
            api_key: {
              pattern:
                '(?:api[_-]?key)\\s*[:=]\\s*["\']?([A-Za-z0-9_\\-]{20,})["\']?',
              description: 'Generic API key assignment',
              severity: 'critical',
              case_sensitive: false,
              group: 1,
            },
            order_id: {
              pattern: 'ORD-\\d{4,8}',
              description: 'Order ID format',
              severity: 'medium',
            },
            version_tag: {
              pattern: 'v(\\d+\\.\\d+\\.\\d+)',
              description: 'Semantic version tag',
              severity: 'info',
              group: 1,
              dot_nl: false,
            },
          },
        },
      })
      .expect(201);

    expect(createResponse.body).toHaveProperty('id');
    expect(createResponse.body.key).toBe(key);
    expect(createResponse.body).toHaveProperty('pipelineSchema');

    const schema = createResponse.body.pipelineSchema;
    expect(schema.type).toBe('REGEX');
    expect(Object.keys(schema.patterns)).toHaveLength(3);
    expect(schema.patterns.api_key.severity).toBe('critical');
    expect(schema.patterns.api_key.case_sensitive).toBe(false);
    expect(schema.patterns.api_key.group).toBe(1);
    expect(schema.patterns.order_id.severity).toBe('medium');
    expect(schema.patterns.version_tag.severity).toBe('info');

    const detectorId = createResponse.body.id as string;

    // GET by ID returns the full schema
    const getResponse = await request(app.getHttpServer())
      .get(`/custom-detectors/${detectorId}`)
      .expect(200);

    expect(getResponse.body.pipelineSchema.type).toBe('REGEX');
    expect(getResponse.body.pipelineSchema.patterns.api_key.pattern).toContain(
      'api[_-]?key',
    );
  });

  it('updates a REGEX detector — adds and removes patterns', async () => {
    const suffix = randomUUID().slice(0, 8);

    const created = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E Regex Update ${suffix}`,
        key: `cust_e2e_regex_update_${suffix}`,
        pipelineSchema: {
          type: 'REGEX',
          patterns: {
            old_pattern: {
              pattern: 'OLD-\\d+',
              severity: 'low',
            },
          },
        },
      })
      .expect(201);

    const detectorId = created.body.id as string;

    const updated = await request(app.getHttpServer())
      .patch(`/custom-detectors/${detectorId}`)
      .send({
        name: `E2E Regex Updated ${suffix}`,
        pipelineSchema: {
          type: 'REGEX',
          patterns: {
            new_pattern: {
              pattern: 'NEW-\\d+',
              severity: 'high',
              case_sensitive: false,
            },
          },
        },
      })
      .expect(200);

    expect(updated.body.pipelineSchema.patterns).toHaveProperty('new_pattern');
    expect(updated.body.pipelineSchema.patterns).not.toHaveProperty(
      'old_pattern',
    );
    expect(updated.body.pipelineSchema.patterns.new_pattern.severity).toBe(
      'high',
    );
  });

  it('rejects a REGEX pipeline schema with no patterns', async () => {
    const suffix = randomUUID().slice(0, 8);
    await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E Regex Empty ${suffix}`,
        pipelineSchema: {
          type: 'REGEX',
          patterns: {},
        },
      })
      .expect(400);
  });

  it('lists REGEX detectors alongside GLiNER2 detectors', async () => {
    const suffix = randomUUID().slice(0, 8);

    await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E Regex List ${suffix}`,
        key: `cust_e2e_regex_list_${suffix}`,
        pipelineSchema: {
          type: 'REGEX',
          patterns: {
            sku: { pattern: 'SKU-[A-Z]{3}\\d{4}', severity: 'medium' },
          },
        },
      })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get('/custom-detectors')
      .expect(200);

    const regexDetector = listResponse.body.find(
      (d: { key: string }) => d.key === `cust_e2e_regex_list_${suffix}`,
    );
    expect(regexDetector).toBeDefined();
    expect(regexDetector.pipelineSchema.type).toBe('REGEX');
  });

  it('deletes a REGEX detector', async () => {
    const suffix = randomUUID().slice(0, 8);

    const created = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E Regex Delete ${suffix}`,
        key: `cust_e2e_regex_delete_${suffix}`,
        pipelineSchema: {
          type: 'REGEX',
          patterns: {
            tmp: { pattern: 'TMP-\\d+' },
          },
        },
      })
      .expect(201);

    const detectorId = created.body.id as string;

    await request(app.getHttpServer())
      .delete(`/custom-detectors/${detectorId}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/custom-detectors/${detectorId}`)
      .expect(404);
  });
});
