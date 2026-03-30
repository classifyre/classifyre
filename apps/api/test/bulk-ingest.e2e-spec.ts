import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Bulk Ingest (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sourceId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  beforeEach(async () => {
    // Clear assets and sources before each test for isolation
    await prisma.asset.deleteMany({});
    await prisma.source.deleteMany({});

    // Create a WordPress source for testing
    const sourceResponse = await request(app.getHttpServer())
      .post('/sources')
      .send({
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
        },
      });
    sourceId = sourceResponse.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('should successfully ingest assets in bulk using backend-generated runnerId', async () => {
    // 1. Get new runnerId from backend
    const runnerResponse = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/run`)
      .expect(201);

    const runnerId = runnerResponse.body.id;
    expect(runnerId).toBeDefined();
    expect(['PENDING', 'RUNNING']).toContain(runnerResponse.body.status);

    const assets = [
      {
        hash: 'asset-1',
        checksum: 'abc',
        name: 'Asset 1',
        external_url: 'https://example.com/asset-1',
        links: [],
        asset_type: 'URL',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    await request(app.getHttpServer())
      .post(`/sources/${sourceId}/assets/bulk`)
      .send({
        runnerId: runnerId,
        assets,
      })
      .expect(201);

    const dbAssets = await prisma.asset.findMany({
      where: { sourceId },
    });
    expect(dbAssets.length).toBe(1);
    expect(dbAssets[0].runnerId).toBe(runnerId);
  });

  // Note: Runner status updates are automatic (COMPLETED/ERROR) when CLI finishes
  // Manual status updates are not supported in the current API design

  it('should replace assets when a new runner is started', async () => {
    // 1. Start runner A
    const runnerAResponse = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/run`)
      .expect(201);
    const runnerAId = runnerAResponse.body.id;

    // 2. Ingest asset for runner A
    await request(app.getHttpServer())
      .post(`/sources/${sourceId}/assets/bulk`)
      .send({
        runnerId: runnerAId,
        assets: [
          {
            hash: 'asset-A',
            checksum: 'abc',
            name: 'Asset A',
            external_url: 'https://example.com/asset-A',
            links: [],
            asset_type: 'URL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })
      .expect(201);

    // Ensure runner A is terminal before starting runner B.
    await request(app.getHttpServer())
      .patch(`/runners/${runnerAId}/status`)
      .send({ status: 'COMPLETED' })
      .expect(200);

    // 3. Start runner B
    const runnerBResponse = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/run`)
      .expect(201);
    const runnerBId = runnerBResponse.body.id;
    expect(runnerBId).not.toBe(runnerAId);

    // 4. Ingest asset for runner B - should trigger deletion of runner A assets
    await request(app.getHttpServer())
      .post(`/sources/${sourceId}/assets/bulk`)
      .send({
        runnerId: runnerBId,
        assets: [
          {
            hash: 'asset-B',
            checksum: 'def',
            name: 'Asset B',
            external_url: 'https://example.com/asset-B',
            links: [],
            asset_type: 'URL',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })
      .expect(201);

    const dbAssets = await prisma.asset.findMany({ where: { sourceId } });
    expect(dbAssets.length).toBe(2);

    const assetA = dbAssets.find((asset) => asset.hash === 'asset-A');
    const assetB = dbAssets.find((asset) => asset.hash === 'asset-B');

    expect(assetA?.status).toBe('NEW');
    expect(assetB?.runnerId).toBe(runnerBId);
  });

  it('should handle same asset hash in same runner (idempotency)', async () => {
    // Create a runner first
    const runnerResponse = await request(app.getHttpServer())
      .post(`/sources/${sourceId}/run`)
      .expect(201);
    const runnerId = runnerResponse.body.id;

    const asset = {
      hash: 'idempotent-asset',
      checksum: 'abc',
      name: 'Initial Name',
      external_url: 'https://example.com/idempotent',
      links: [],
      asset_type: 'URL',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // First time
    await request(app.getHttpServer())
      .post(`/sources/${sourceId}/assets/bulk`)
      .send({
        runnerId: runnerId,
        assets: [asset],
      })
      .expect(201);

    // Second time with same hash but different data
    const updatedAsset = { ...asset, name: 'Updated Name', checksum: 'def' };
    await request(app.getHttpServer())
      .post(`/sources/${sourceId}/assets/bulk`)
      .send({
        runnerId: runnerId,
        assets: [updatedAsset],
      })
      .expect(201);

    const dbAssets = await prisma.asset.findMany({
      where: { hash: 'idempotent-asset', sourceId },
    });
    expect(dbAssets.length).toBe(1);
    expect(dbAssets[0].name).toBe('Updated Name');
  });
});
