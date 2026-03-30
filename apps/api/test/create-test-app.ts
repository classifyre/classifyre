import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

export type TestApp = {
  /** Pass directly to supertest's request() */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  httpTarget: string | ReturnType<INestApplication['getHttpServer']>;
  /** PrismaService for seeding — null when using TEST_API_URL (remote mode) */
  prisma: PrismaService | null;
  /** NestJS app instance — null when using TEST_API_URL (remote mode) */
  app: INestApplication | null;
  /** Tears down the local app; no-op in remote mode */
  close(): Promise<void>;
  /** True when pointing at a remote instance via TEST_API_URL */
  isRemote: boolean;
};

/**
 * Creates a test context.
 *
 * Local mode (default):  boots a full NestJS app in-process.
 * Remote mode:           set TEST_API_URL env var (e.g. in .env.test or CI)
 *                        to skip local startup and hit an existing instance.
 *
 * Usage:
 *   let ctx: TestApp;
 *   beforeAll(async () => { ctx = await createTestApp(); });
 *   afterAll(async () => { await ctx.close(); });
 *   it('...', () => request(ctx.httpTarget).get('/').expect(200));
 *
 * Tests that seed data via ctx.prisma must guard with:
 *   if (ctx.isRemote) return; // skip seeding tests against remote
 */
export async function createTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  const remoteUrl = process.env.TEST_API_URL?.trim();

  if (remoteUrl) {
    return {
      httpTarget: remoteUrl,
      prisma: null,
      app: null,
      isRemote: true,
      async close() {},
    };
  }

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (configure) {
    builder = configure(builder);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication();
  const prisma = moduleFixture.get<PrismaService>(PrismaService);
  await app.init();

  return {
    httpTarget: app.getHttpServer(),
    prisma,
    app,
    isRemote: false,
    async close() {
      await prisma.$disconnect();
      await app.close();
    },
  };
}
