import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { NamespaceRegistryService } from '../src/registry/namespace-registry.service';
import type { Namespace } from '../src/registry/namespace.types';
import {
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from '../src/namespace/namespace.constants';
import {
  namespaceRewriteUrl,
  type NamespaceRawRequest,
} from '../src/namespace/namespace-request.hook';

const TEST_NAMESPACE_SLUG =
  process.env.TEST_NAMESPACE_SLUG?.trim() || 'e2e-tests';
const TEST_NAMESPACE_NAME = 'E2E tests';

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
  /** Namespace provisioned once for the API test process. */
  namespace: Namespace;
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
 * `httpTarget` includes the test namespace as its base path, so every relative
 * request is sent through the same `/<namespace>/<route>` contract as a real
 * Classifyre client.
 *
 * Tests that seed data via ctx.prisma must guard with:
 *   if (ctx.isRemote) return; // skip seeding tests against remote
 */
export async function createTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  const remoteUrl = process.env.TEST_API_URL?.trim();

  if (remoteUrl) {
    const baseUrl = remoteUrl.replace(/\/+$/, '');
    const namespace = await ensureRemoteNamespace(baseUrl);
    return {
      httpTarget: `${baseUrl}/${namespace.slug}`,
      prisma: null,
      app: null,
      isRemote: true,
      namespace,
      async close() {},
    };
  }

  console.log(
    '[createTestApp] DATABASE_URL:',
    process.env.DATABASE_URL?.substring(0, 120),
  );
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (configure) {
    builder = configure(builder);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication();
  const prisma = moduleFixture.get<PrismaService>(PrismaService);
  const cls = moduleFixture.get(ClsService);
  const registry = moduleFixture.get(NamespaceRegistryService);

  // The production server performs this work in Fastify's rewriteUrl/onRequest
  // hooks. E2E tests use Nest's default Express adapter, so install the same
  // namespace resolution semantics as an early middleware.
  app.use(
    async (request: Request, response: Response, next: NextFunction) => {
      cls.enter();
      const rewrittenUrl = namespaceRewriteUrl(request);
      const slug = (request as NamespaceRawRequest).classifyreSlug;

      if (!slug) {
        next();
        return;
      }

      const resolved = await registry.resolve(slug);
      if (!resolved) {
        response.status(404).json({
          error: 'Not Found',
          message: `Unknown namespace '${slug}'`,
        });
        return;
      }

      cls.set(CLS_SCHEMA, resolved.schemaName);
      cls.set(CLS_NAMESPACE_ID, resolved.namespaceId);
      cls.set(CLS_SLUG, resolved.slug);
      request.url = rewrittenUrl;
      next();
    },
  );

  await app.listen(0, '127.0.0.1');
  const namespace = await ensureLocalNamespace(registry);

  // Direct service calls and Prisma seeding in the existing integration tests
  // also need a tenant context. HTTP requests get their own context above.
  cls.enter();
  cls.set(CLS_SCHEMA, namespace.schemaName);
  cls.set(CLS_NAMESPACE_ID, namespace.id);
  cls.set(CLS_SLUG, namespace.slug);

  const baseUrl = (await app.getUrl()).replace(/\/+$/, '');

  return {
    httpTarget: `${baseUrl}/${namespace.slug}`,
    prisma,
    app,
    isRemote: false,
    namespace,
    async close() {
      await app.close();
    },
  };
}

async function ensureLocalNamespace(
  registry: NamespaceRegistryService,
): Promise<Namespace> {
  const existing = (await registry.list()).find(
    (namespace) => namespace.slug === TEST_NAMESPACE_SLUG,
  );
  if (existing) return existing;

  return registry.create({
    name: TEST_NAMESPACE_NAME,
    slug: TEST_NAMESPACE_SLUG,
    description: 'Shared namespace for API integration tests',
  });
}

async function ensureRemoteNamespace(baseUrl: string): Promise<Namespace> {
  const listResponse = await fetch(`${baseUrl}/namespaces`);
  if (!listResponse.ok) {
    throw new Error(
      `Could not list namespaces on remote test API (${listResponse.status})`,
    );
  }

  const namespaces = (await listResponse.json()) as Namespace[];
  const existing = namespaces.find(
    (namespace) => namespace.slug === TEST_NAMESPACE_SLUG,
  );
  if (existing) return existing;

  const createResponse = await fetch(`${baseUrl}/namespaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: TEST_NAMESPACE_NAME,
      slug: TEST_NAMESPACE_SLUG,
      description: 'Shared namespace for API integration tests',
    }),
  });
  if (!createResponse.ok) {
    throw new Error(
      `Could not create namespace on remote test API (${createResponse.status})`,
    );
  }
  return (await createResponse.json()) as Namespace;
}
