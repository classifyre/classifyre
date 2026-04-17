import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';

const SHOULD_RUN = process.env.RUN_CUSTOM_DETECTOR_PG_E2E === '1';
const describeIfEnabled = SHOULD_RUN ? describe : describe.skip;

const PG_HOST = process.env.E2E_PG_HOST ?? 'localhost';
const PG_PORT = Number(process.env.E2E_PG_PORT ?? '5432');
const PG_USER = process.env.E2E_PG_USER ?? 'postgres';
const PG_PASSWORD = process.env.E2E_PG_PASSWORD ?? 'test';

async function createDatabase(dbName: string): Promise<void> {
  const admin = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(dbName: string): Promise<void> {
  const admin = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await admin.end();
  }
}

async function seedDatabase(dbName: string): Promise<void> {
  const client = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASSWORD,
    database: dbName,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE detector_samples (
        id SERIAL PRIMARY KEY,
        body TEXT NOT NULL
      );
    `);
    await client.query(
      `
      INSERT INTO detector_samples(body)
      VALUES
        ($1),
        ($2)
    `,
      [
        'URGENT legal risk RISK-12345 flagged by John Doe at Acme GmbH. Immediate review required.',
        'Routine operational note. Everything looks normal and stable.',
      ],
    );
  } finally {
    await client.end();
  }
}

type CustomDetectorBody = {
  id: string;
  key: string;
};

describeIfEnabled('Custom Detectors PostgreSQL Runtime (e2e)', () => {
  jest.setTimeout(900_000);

  let app: INestApplication<App>;
  let dbName: string;
  let sourceId: string | null = null;
  const customDetectorIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dbName = `classifyre_e2e_custom_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await createDatabase(dbName);
    await seedDatabase(dbName);
  });

  afterAll(async () => {
    if (sourceId) {
      await request(app.getHttpServer()).delete(`/sources/${sourceId}`);
    }

    for (const id of customDetectorIds) {
      await request(app.getHttpServer()).delete(`/custom-detectors/${id}`);
    }

    if (dbName) {
      await dropDatabase(dbName);
    }

    await app.close();
  });

  it('runs source extraction and matches RULESET + CLASSIFIER + ENTITY custom detectors', async () => {
    const suffix = randomUUID().slice(0, 8);

    const rulesetKey = `e2e_pg_ruleset_${suffix}`;
    const classifierKey = `e2e_pg_classifier_${suffix}`;
    const entityKey = `e2e_pg_entity_${suffix}`;

    const ruleset = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E PG Ruleset ${suffix}`,
        key: rulesetKey,
        method: 'RULESET',
        config: {
          custom_detector_key: rulesetKey,
          name: `E2E PG Ruleset ${suffix}`,
          method: 'RULESET',
          confidence_threshold: 0.1,
          max_findings: 20,
          ruleset: {
            regex_rules: [
              {
                id: 'risk_code',
                name: 'Risk Code',
                pattern: 'RISK-[0-9]{5}',
                severity: 'high',
              },
            ],
            keyword_rules: [
              {
                id: 'legal_risk_kw',
                name: 'Legal Risk Terms',
                keywords: ['legal risk', 'liability'],
                case_sensitive: false,
                severity: 'medium',
              },
            ],
          },
        },
      })
      .expect(201);

    const classifier = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E PG Classifier ${suffix}`,
        key: classifierKey,
        method: 'CLASSIFIER',
        config: {
          custom_detector_key: classifierKey,
          name: `E2E PG Classifier ${suffix}`,
          method: 'CLASSIFIER',
          confidence_threshold: 0.2,
          max_findings: 20,
          classifier: {
            labels: [
              { id: 'risk_signal', name: 'Risk Signal' },
              { id: 'neutral_signal', name: 'Neutral Signal' },
            ],
            min_examples_per_label: 1,
            hypothesis_template: 'This text contains {}.',
            zero_shot_model: 'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli',
            setfit_model: 'sentence-transformers/all-MiniLM-L6-v2',
            training_examples: [
              {
                text: 'URGENT legal risk and liability requires immediate review',
                label: 'risk_signal',
                accepted: true,
              },
              {
                text: 'This contains compliance breach and legal exposure',
                label: 'risk_signal',
                accepted: true,
              },
              {
                text: 'Routine informational update with no risk',
                label: 'neutral_signal',
                accepted: true,
              },
              {
                text: 'General operational note all systems normal',
                label: 'neutral_signal',
                accepted: true,
              },
            ],
          },
        },
      })
      .expect(201);

    const entity = await request(app.getHttpServer())
      .post('/custom-detectors')
      .send({
        name: `E2E PG Entity ${suffix}`,
        key: entityKey,
        method: 'ENTITY',
        config: {
          custom_detector_key: entityKey,
          name: `E2E PG Entity ${suffix}`,
          method: 'ENTITY',
          confidence_threshold: 0.2,
          max_findings: 20,
          entity: {
            entity_labels: ['person', 'organization', 'company name'],
            model: 'fastino/gliner2-base-v1',
          },
        },
      })
      .expect(201);

    const rulesetDetector = ruleset.body as CustomDetectorBody;
    const classifierDetector = classifier.body as CustomDetectorBody;
    const entityDetector = entity.body as CustomDetectorBody;

    customDetectorIds.push(
      rulesetDetector.id,
      classifierDetector.id,
      entityDetector.id,
    );

    const sourceResponse = await request(app.getHttpServer())
      .post('/sources')
      .send({
        type: 'POSTGRESQL',
        name: `E2E PG Source ${suffix}`,
        config: {
          type: 'POSTGRESQL',
          required: {
            host: PG_HOST,
            port: PG_PORT,
          },
          masked: {
            username: PG_USER,
            password: PG_PASSWORD,
          },
          optional: {
            connection: {
              ssl_mode: 'disable',
              connect_timeout_seconds: 10,
            },
            scope: {
              database: dbName,
              include_all_databases: false,
              include_schemas: ['public'],
              exclude_schemas: [],
              include_tables: ['public.detector_samples'],
              table_limit: 5,
            },
          },
          sampling: {
            strategy: 'RANDOM',
            limit: 100,
            max_columns: 25,
            max_cell_chars: 1024,
            max_total_chars: 100000,
            fallback_to_random: true,
            include_column_names: true,
          },
          custom_detectors: [
            rulesetDetector.id,
            classifierDetector.id,
            entityDetector.id,
          ],
        },
      })
      .expect(201);

    sourceId = sourceResponse.body.id as string;
    expect(sourceId).toBeDefined();

    const runResponse = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/run`)
      .send({})
      .expect(201);

    const runnerId = runResponse.body.id as string;
    expect(runnerId).toBeDefined();

    let finalRunner: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const runnerResponse = await request(app.getHttpServer())
        .get(`/runners/${runnerId}`)
        .expect(200);

      const status = runnerResponse.body.status as string;
      if (status === 'COMPLETED' || status === 'ERROR') {
        finalRunner = runnerResponse.body as Record<string, unknown>;
        break;
      }
    }

    expect(finalRunner).not.toBeNull();
    expect(finalRunner?.status).toBe('COMPLETED');

    const findingsResponse = await request(app.getHttpServer())
      .post('/search/findings')
      .send({
        filters: {
          sourceId: [sourceId],
          detectorType: ['CUSTOM'],
        },
        page: {
          skip: 0,
          limit: 1000,
        },
      })
      .expect(200);

    const findings = (findingsResponse.body.findings ?? []) as Array<{
      customDetectorKey?: string;
    }>;
    expect(findings.length).toBeGreaterThan(0);

    const keys = new Set(
      findings
        .map((finding) => finding.customDetectorKey)
        .filter(
          (key): key is string => typeof key === 'string' && key.length > 0,
        ),
    );

    expect(keys.has(rulesetKey)).toBe(true);
    expect(keys.has(classifierKey)).toBe(true);
    expect(keys.has(entityKey)).toBe(true);
  });
});
