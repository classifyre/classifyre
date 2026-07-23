import request from 'supertest';
import { PrismaService } from '../src/prisma.service';
import { CliRunnerService } from '../src/cli-runner/cli-runner.service';
import { createTestApp, TestApp } from './create-test-app';

describe('Bulk Ingest (e2e)', () => {
  let ctx: TestApp;
  let prisma: PrismaService;
  let sourceId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    prisma = ctx.prisma!;

    // These tests exercise runner creation and ingest endpoints, not the
    // external Python process. Keep the fire-and-forget execution inside the
    // test lifecycle so it cannot mutate the database after Jest teardown.
    const cliRunner = ctx.app!.get(CliRunnerService);
    const runnerInternals = cliRunner as unknown as {
      executeCliAsync: () => Promise<void>;
      pruneOldRunners: () => Promise<void>;
    };
    jest.spyOn(runnerInternals, 'executeCliAsync').mockResolvedValue();
    jest.spyOn(runnerInternals, 'pruneOldRunners').mockResolvedValue();
  });

  beforeEach(async () => {
    // Clear assets and sources before each test for isolation
    await prisma.asset.deleteMany({});
    await prisma.source.deleteMany({});

    // Create a WordPress source for testing
    const sourceResponse = await request(ctx.httpTarget)
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
    await ctx.close();
  });

  it('should successfully ingest assets in bulk using backend-generated runnerId', async () => {
    // 1. Get new runnerId from backend
    const runnerResponse = await request(ctx.httpTarget)
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

    await request(ctx.httpTarget)
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
    const runnerAResponse = await request(ctx.httpTarget)
      .post(`/sources/${sourceId}/run`)
      .expect(201);
    const runnerAId = runnerAResponse.body.id;

    // 2. Ingest asset for runner A
    await request(ctx.httpTarget)
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

    // The external Python execution is stubbed in this suite, so finish the
    // runner state directly before exercising creation of the next run.
    await prisma.$transaction([
      prisma.runner.update({
        where: { id: runnerAId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
      prisma.source.update({
        where: { id: sourceId },
        data: { runnerStatus: 'COMPLETED', currentRunnerId: null },
      }),
    ]);

    // 3. Start runner B
    const runnerBResponse = await request(ctx.httpTarget)
      .post(`/sources/${sourceId}/run`)
      .expect(201);
    const runnerBId = runnerBResponse.body.id;
    expect(runnerBId).not.toBe(runnerAId);

    // 4. Ingest asset for runner B - should trigger deletion of runner A assets
    await request(ctx.httpTarget)
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
    const runnerResponse = await request(ctx.httpTarget)
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
    await request(ctx.httpTarget)
      .post(`/sources/${sourceId}/assets/bulk`)
      .send({
        runnerId: runnerId,
        assets: [asset],
      })
      .expect(201);

    // Second time with same hash but different data
    const updatedAsset = { ...asset, name: 'Updated Name', checksum: 'def' };
    await request(ctx.httpTarget)
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
