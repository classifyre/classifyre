import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { CliRunnerService } from '../src/cli-runner/cli-runner.service';

function resolveMySqlHostPort(): { host: string; port: number } {
  const hostPort = (process.env.MYSQL_TEST_HOST_PORT || '').trim();
  if (hostPort) {
    const [host, portRaw] = hostPort.split(':');
    return {
      host: host || 'localhost',
      port: Number(portRaw || '3306'),
    };
  }

  return {
    host: process.env.MYSQL_TEST_HOST || 'localhost',
    port: Number(process.env.MYSQL_TEST_PORT || '3306'),
  };
}

describe('Source (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const mockCliRunnerService = {
    testConnection: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CliRunnerService)
      .useValue(mockCliRunnerService)
      .compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('should create a new source and validate it', async () => {
    const createSourceDto = {
      type: 'WORDPRESS',
      name: 'Test WordPress Source',
      config: {
        type: 'WORDPRESS',
        required: {
          url: 'https://blog.example.com',
        },
        masked: {
          username: 'admin',
          application_password: 'test-application-password',
        },
        optional: {
          content: {
            fetch_posts: true,
            fetch_pages: true,
          },
        },
        sampling: {
          strategy: 'RANDOM',
          limit: 5,
        },
      },
    };

    const response = await request(app.getHttpServer())
      .post('/sources')
      .send(createSourceDto)
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.type).toBe('WORDPRESS');
    expect(response.body.name).toBe('Test WordPress Source');

    // Verify in database
    const source = await prisma.source.findUnique({
      where: { id: response.body.id },
    });
    expect(source).toBeDefined();
    expect(source?.type).toBe('WORDPRESS');
  });

  it('should fail if validation fails', async () => {
    const invalidDto = {
      type: 'WORDPRESS',
      name: 'Invalid Source',
      config: {
        type: 'WORDPRESS',
        required: {
          // missing url
        },
        masked: {
          username: 'admin',
          application_password: 'test-application-password',
        },
        sampling: {
          strategy: 'RANDOM',
          limit: 1,
        },
      },
    };

    const response = await request(app.getHttpServer())
      .post('/sources')
      .send(invalidDto)
      .expect(400);

    expect(response.body.message).toContain('must have required property');
  });

  it('should generate same ID for same source config (idempotency)', async () => {
    const createSourceDto = {
      type: 'WORDPRESS',
      name: 'Idempotent Test Source',
      config: {
        type: 'WORDPRESS',
        required: {
          url: 'https://idempotent.example.com',
        },
        masked: {
          username: 'admin',
          application_password: 'test-application-password',
        },
        sampling: {
          strategy: 'RANDOM',
          limit: 5,
        },
      },
    };

    const response1 = await request(app.getHttpServer())
      .post('/sources')
      .send(createSourceDto)
      .expect(201);

    const response2 = await request(app.getHttpServer())
      .post('/sources')
      .send(createSourceDto)
      .expect(201);

    expect(response1.body.id).toBe(response2.body.id);
  });

  it('should test connection for a source and use the correct id', async () => {
    const createSourceDto = {
      type: 'WORDPRESS',
      name: 'Test Connection Source',
      config: {
        type: 'WORDPRESS',
        required: {
          url: 'https://blog.example.com',
        },
        masked: {
          username: 'admin',
          application_password: 'test-application-password',
        },
        optional: {
          content: {
            fetch_posts: true,
            fetch_pages: true,
          },
        },
        sampling: {
          strategy: 'RANDOM',
          limit: 5,
        },
      },
    };

    const createResponse = await request(app.getHttpServer())
      .post('/sources')
      .send(createSourceDto)
      .expect(201);

    const sourceId = createResponse.body.id;
    const testPayload = {
      status: 'SUCCESS',
      message: 'Connected.',
      timestamp: '2026-02-04T14:22:11.123Z',
      source_type: 'WORDPRESS',
    };

    mockCliRunnerService.testConnection.mockResolvedValueOnce(testPayload);

    const response = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/test`)
      .expect(200);

    expect(mockCliRunnerService.testConnection).toHaveBeenCalledWith(sourceId);
    expect(response.body).toEqual(testPayload);
  });

  it('should create a new mysql source using credentials and validate it', async () => {
    const { host, port } = resolveMySqlHostPort();
    const database = process.env.MYSQL_TEST_DATABASE || 'app_db';
    const username = process.env.MYSQL_TEST_USER || 'root';
    const password = process.env.MYSQL_TEST_PASSWORD || 'example';

    const createSourceDto = {
      type: 'MYSQL',
      name: 'Test MySQL Source',
      config: {
        type: 'MYSQL',
        required: {
          host,
          port,
        },
        masked: {
          username,
          password,
        },
        optional: {
          scope: {
            database,
          },
        },
        sampling: {
          strategy: 'RANDOM',
          limit: 10,
        },
      },
    };

    const response = await request(app.getHttpServer())
      .post('/sources')
      .send(createSourceDto)
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.type).toBe('MYSQL');
    expect(response.body.name).toBe('Test MySQL Source');
  });

  it('should create sources from schema examples for all supported source types', async () => {
    const examplesPath = path.resolve(
      __dirname,
      '../../../packages/schemas/src/schemas/all_input_examples.json',
    );
    const rawExamples = JSON.parse(
      readFileSync(examplesPath, 'utf8'),
    ) as Record<string, Array<{ config: Record<string, unknown> }>>;
    const sourceTypes = [
      'WORDPRESS',
      'SLACK',
      'S3_COMPATIBLE_STORAGE',
      'AZURE_BLOB_STORAGE',
      'GOOGLE_CLOUD_STORAGE',
      'POSTGRESQL',
      'MYSQL',
      'MSSQL',
      'ORACLE',
      'HIVE',
      'DATABRICKS',
      'SNOWFLAKE',
      'MONGODB',
      'POWERBI',
      'TABLEAU',
    ] as const;

    for (const sourceType of sourceTypes) {
      const firstExample = rawExamples[sourceType]?.[0];
      expect(firstExample?.config).toBeDefined();

      const response = await request(app.getHttpServer())
        .post('/sources')
        .send({
          type: sourceType,
          name: `Example ${sourceType} Source`,
          config: firstExample.config,
        });

      if (response.status !== 201) {
        throw new Error(
          `Failed to create ${sourceType} from example: status=${response.status} body=${JSON.stringify(response.body)}`,
        );
      }

      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe(sourceType);
    }
  });
});
