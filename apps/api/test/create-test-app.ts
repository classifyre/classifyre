import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication, Type } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { PrismaClientManager } from '../src/prisma/prisma-client-manager';
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
  /** Resolve a provider whose method calls run inside the test namespace. */
  get<T extends object>(token: Type<T>): T;
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
  listenPort = 0,
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
      get() {
        throw new Error('Nest providers are unavailable in remote test mode');
      },
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
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });
  const cls = moduleFixture.get(ClsService);
  const registry = moduleFixture.get(NamespaceRegistryService);
  const prismaManager = moduleFixture.get(PrismaClientManager);

  // The production server performs this work in Fastify's rewriteUrl/onRequest
  // hooks. E2E tests use Nest's default Express adapter, so install the same
  // namespace resolution semantics as an early middleware.
  app.use(async (request: Request, response: Response, next: NextFunction) => {
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
  });

  await app.listen(listenPort, '127.0.0.1');
  const namespace = await ensureLocalNamespace(registry);

  // Seeding gets a concrete tenant client. Namespace-bound provider proxies
  // below establish CLS for direct service calls; HTTP requests get their own
  // context in the middleware above.
  const tenantPrisma = prismaManager.get(
    namespace.schemaName,
  ) as unknown as PrismaService;

  const baseUrl = (await app.getUrl()).replace(/\/+$/, '');

  return {
    httpTarget: `${baseUrl}/${namespace.slug}`,
    prisma: tenantPrisma,
    app,
    isRemote: false,
    namespace,
    get<T extends object>(token: Type<T>): T {
      return bindToNamespace(app.get(token), cls, namespace);
    },
    async close() {
      await app.close();
    },
  };
}

function bindToNamespace<T extends object>(
  provider: T,
  cls: ClsService,
  namespace: Namespace,
): T {
  return new Proxy(provider, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) =>
        cls.run(() => {
          cls.set(CLS_SCHEMA, namespace.schemaName);
          cls.set(CLS_NAMESPACE_ID, namespace.id);
          cls.set(CLS_SLUG, namespace.slug);
          return Reflect.apply(value, target, args);
        });
    },
  });
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
