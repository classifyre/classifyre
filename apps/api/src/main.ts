import './tracing';
import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import multipart from '@fastify/multipart';
import underPressure from '@fastify/under-pressure';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServerFactoryService } from './mcp-server.factory';
import { McpTokenService } from './mcp-token.service';
import { InstanceSettingsService } from './instance-settings.service';
import { PrismaExceptionFilter } from './filters/prisma-exception.filter';
import { DbRetryInterceptor } from './interceptors/db-retry.interceptor';
import { applyAllPendingMigrations } from './database-migrations';
import { ClsService } from 'nestjs-cls';
import { NamespaceRegistryService } from './registry/namespace-registry.service';
import {
  namespaceRewriteUrl,
  registerNamespaceHook,
  type NamespaceRawRequest,
} from './namespace/namespace-request.hook';
import {
  CLS_DATABASE_LANE,
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from './namespace/namespace.constants';
import { PrismaClientManager } from './prisma/prisma-client-manager';
import { InternalApiKeyService } from './internal-api-key.service';
import compress from '@fastify/compress';
import { constants as zlibConstants } from 'node:zlib';
import { resolveHeapGuard } from './utils/heap-guard';

// No API-side ceiling on request bodies. The CLI posts whole assets in a single
// bulk request and a single asset (large parquet/archive payloads, extracted
// text, findings) can exceed any fixed cap we would pick, so a 413 is always an
// ingestion bug rather than a useful guard. Set API_BODY_LIMIT_BYTES to a
// positive integer only if a deployment deliberately wants a ceiling back.
const BODY_LIMIT_BYTES = (() => {
  const configured = Number.parseInt(
    process.env.API_BODY_LIMIT_BYTES ?? '',
    10,
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : Number.MAX_SAFE_INTEGER;
})();

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 8000;

  await applyAllPendingMigrations();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // `rewriteUrl` runs pre-routing and strips a leading `/<namespace-slug>` so
    // the existing (namespace-blind) routes keep matching; the slug is resolved
    // to a tenant schema by the onRequest hook registered below.
    new FastifyAdapter({
      bodyLimit: BODY_LIMIT_BYTES,
      rewriteUrl: namespaceRewriteUrl,
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    // @fastify/cors (used by the Fastify adapter) defaults Access-Control-Allow-
    // Methods to only 'GET,HEAD,POST' — unlike the Express cors package. The
    // desktop web talks to the API cross-origin (app://classifyre → 127.0.0.1),
    // so without listing PUT/PATCH/DELETE every mutating request fails preflight.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Uploads follow the same rule as JSON bodies: no size ceiling. `files: 1`
  // stays because these routes accept exactly one file per request.
  await app.register(multipart, {
    limits: {
      fileSize: BODY_LIMIT_BYTES,
      fieldSize: BODY_LIMIT_BYTES,
      files: 1,
    },
  });

  // Compress responses. The correlation graph is the reason: on a real corpus
  // it is 36,378 nodes and 135,539 edges serialised to 57 MB of JSON, which
  // the browser then has to receive and parse before drawing anything.
  // Measured on that exact payload: 57.3 MB raw -> 5.9 MB gzip -> 3.7 MB
  // brotli, so this is a 10-15x reduction on the heaviest thing the API
  // serves, for one plugin registration.
  //
  // `threshold` keeps small responses uncompressed, where the CPU cost would
  // outweigh the transfer saving. Brotli is preferred when the client offers
  // it; quality is capped well below the default 11 because the top levels
  // cost far more CPU than they save bytes on JSON this repetitive.
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
    brotliOptions: {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
      },
    },
  });

  // Backpressure guard — returns 503 when the process is genuinely overloaded.
  // All thresholds are opt-in via env vars. Heap/RSS checks default to 0
  // (disabled) because NestJS+Prisma steady-state memory is deployment-specific
  // and almost always close to limits on constrained hosts; enabling them without
  // measurement causes constant false-positive 503s. Enable only after profiling.
  //
  // UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY  (default: 1000 ms)
  //   Primary signal: event loop blocked above this threshold means Node is
  //   CPU-starved and genuinely cannot schedule new work.
  // UNDER_PRESSURE_MAX_HEAP_USED_BYTES   (default: 80% of the real V8 ceiling)
  //   Derived from v8.getHeapStatistics() rather than from whatever heap size
  //   the launcher requested — see utils/heap-guard.ts. An override at or above
  //   the ceiling is clamped, because such a value can never fire.
  // UNDER_PRESSURE_MAX_RSS_BYTES         (default: 1 GB)
  //   Total process memory guard. Override lower only after measuring RSS.
  // Register under-pressure for metrics sampling and the /api/health/pressure
  // status endpoint. Auto-rejection is disabled (pressureHandler is a no-op)
  // so that normal UI/API traffic is never blocked. CliBackpressureGuard reads
  // fastify.isUnderPressure() and applies the 503 selectively on the 6 CLI
  // ingestion endpoints only.
  const heapGuard = resolveHeapGuard();
  const asMb = (bytes: number) => Math.round(bytes / 1024 / 1024);
  // Logged at every boot: the requested-versus-enforced heap gap is invisible
  // otherwise, and it is what let the desktop app run for months with a guard
  // that could not fire.
  logger.log(
    `Heap guard: shedding CLI ingestion above ${asMb(
      heapGuard.thresholdBytes,
    )} MB of a ${asMb(heapGuard.limitBytes)} MB V8 ceiling (${heapGuard.source})`,
  );
  if (heapGuard.source === 'env-clamped') {
    logger.warn(
      `UNDER_PRESSURE_MAX_HEAP_USED_BYTES (${asMb(
        Number.parseInt(process.env.UNDER_PRESSURE_MAX_HEAP_USED_BYTES!, 10),
      )} MB) is at or above the ${asMb(
        heapGuard.limitBytes,
      )} MB ceiling V8 actually enforces and could never fire — using ${asMb(
        heapGuard.thresholdBytes,
      )} MB instead.`,
    );
  }
  await app.register(underPressure, {
    maxEventLoopDelay: parseInt(
      process.env.UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY ?? '1000',
      10,
    ),
    maxHeapUsedBytes: heapGuard.thresholdBytes,
    maxRssBytes: parseInt(
      process.env.UNDER_PRESSURE_MAX_RSS_BYTES ?? String(1024 * 1024 * 1024),
      10,
    ),
    // No-op: guard handles per-route rejection, not this global hook.
    pressureHandler: () => undefined,
    exposeStatusRoute: '/api/health/pressure',
  });

  // Retry read-only handlers that hit a transient database error (pool
  // starvation, transaction start timeout, dropped connection) before the
  // client ever sees a failure. Mutations are left alone — see the interceptor.
  app.useGlobalInterceptors(new DbRetryInterceptor(app.get(Reflector)));

  // Map transient Prisma overload errors (P2028, P2034, P2024) to 503 so the
  // CLI retry policy handles them the same way as under-pressure rejections.
  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Classifyre API')
    .setDescription(
      'Metadata ingestion and detection API for unstructured data sources. ' +
        'Supports WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, and Service Desk sources. ' +
        'Built-in detectors for secrets, PII, toxic content, image classification, broken links, and security threats.\n\n' +
        '**Every path below is namespace-scoped**: the real URL is ' +
        '`/{namespace}/<path>`, where `{namespace}` is a workspace slug or its ' +
        'immutable UUID (see `GET /namespaces`). Set it in the server selector ' +
        'above so "Try it out" targets a real workspace. The only unscoped ' +
        'routes are `/namespaces`, `/ping` and `/api/health/pressure`.',
    )
    // Two servers, because the API is reachable at two different roots and a
    // relative server URL is resolved against whatever origin is serving this
    // page:
    //
    //  * Behind the ingress / the desktop shell the API only exists under
    //    `/api` (nginx routes `/api/(.*)` to the API service and strips the
    //    prefix; the web app proxies the same path). This page itself is
    //    served as `<host>/api/docs`, so `/api/{namespace}` is the default.
    //  * Talking to the API process directly (`localhost:8000/docs`, in-cluster
    //    service DNS) there is no `/api` prefix — pick the second entry.
    //
    // The `{namespace}` variable exists because `namespaceRewriteUrl` strips
    // the leading path segment as a tenant; without it every "Try it out" call
    // 404s with `Unknown namespace '<first path segment>'`.
    .addServer(
      '/api/{namespace}',
      'Through the web gateway (ingress/desktop)',
      {
        namespace: {
          default: 'your-workspace-slug',
          description: 'Workspace slug or namespace UUID',
        },
      },
    )
    .addServer('/{namespace}', 'Directly against the API service', {
      namespace: {
        default: 'your-workspace-slug',
        description: 'Workspace slug or namespace UUID',
      },
    })
    .setVersion('1.0.0')
    .addTag('Health', 'Health check and API status endpoints')
    .addTag('Sources', 'Data source management and configuration')
    .addTag('Assets', 'Ingested asset retrieval and management')
    .addTag('Detectors', 'Content detection and analysis')
    .addTag(
      'Instance Settings',
      'Global instance-wide behavior and localization settings',
    )
    .setContact(
      'Classifyre Team',
      'https://github.com/unstructured/classifyre',
      'support@example.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  // Mounted at `/docs`, NOT `/api`. The ingress routes `/api/(.*)` to this
  // service with the `/api` prefix stripped (and the web app's `/api/[...path]`
  // proxy does the same), so anything served at `/api` on the API process is
  // unreachable from a browser — the request arrives here as `/`. `/docs`
  // survives that strip, which makes the one URL `<host>/api/docs` work through
  // the ingress, through the desktop/dev proxy, and `<api>/docs` work when
  // talking to the process directly.
  //
  // `docs`, `docs-json` and `docs-yaml` are all in RESERVED_PREFIXES so
  // `namespaceRewriteUrl` does not mistake them for a tenant slug. Swagger UI's
  // own assets are requested relative to the page, so they inherit whatever
  // prefix the caller used and need no further routing.
  SwaggerModule.setup('docs', app, documentFactory);

  const fastify = app.getHttpAdapter().getInstance();
  const mcpServerFactory = app.get(McpServerFactoryService);
  const mcpTokenService = app.get(McpTokenService);
  const instanceSettingsService = app.get(InstanceSettingsService);
  const cls = app.get(ClsService);
  const namespaceRegistry = app.get(NamespaceRegistryService);
  const prismaClientManager = app.get(PrismaClientManager);
  const internalApiKey = app.get(InternalApiKeyService);

  // Resolve the leading `/<slug>` into a tenant context (404 on unknown slug)
  // before any route runs. `/<slug>/mcp` was already rewritten to `/mcp`.
  registerNamespaceHook(
    fastify,
    namespaceRegistry,
    cls,
    prismaClientManager,
    internalApiKey,
  );

  const mcpHandler = async (request: any, reply: any) => {
    // MCP requires a namespace: `/<slug>/mcp` (rewritten to `/mcp` with the
    // context set). A bare `/mcp` (no slug) has no tenant to serve.
    const ns = (request.raw as NamespaceRawRequest).classifyreNs;
    if (!ns) {
      reply.code(404).send({
        error: 'Not Found',
        message: 'MCP requires a namespace: POST /<namespace>/mcp',
      });
      return;
    }

    // Everything below (settings, token auth, tool callbacks) resolves
    // per-namespace services off CLS, so run it inside the tenant context.
    await cls.run(async () => {
      cls.set(CLS_SCHEMA, ns.schemaName);
      cls.set(CLS_NAMESPACE_ID, ns.namespaceId);
      cls.set(CLS_SLUG, ns.slug);
      // A fresh CLS store loses the lane the namespace hook resolved; re-apply
      // it so this handler uses the same pool the hook pinned and warmed.
      cls.set(
        CLS_DATABASE_LANE,
        (request.raw as NamespaceRawRequest).classifyreDatabaseLane ??
          'interactive',
      );

      const settings = await instanceSettingsService.getSettings();
      if (!settings.mcpEnabled) {
        reply.code(503).send({
          error: 'Service Unavailable',
          message: 'MCP is disabled. Enable it in Settings.',
        });
        return;
      }

      try {
        await mcpTokenService.authorizeBearerToken(
          request.headers.authorization,
        );
      } catch {
        reply
          .code(401)
          .header('WWW-Authenticate', 'Bearer realm="classifyre-mcp"')
          .send({
            error: 'Unauthorized',
            message: 'Provide a valid MCP bearer token from Settings.',
          });
        return;
      }

      reply.hijack();

      try {
        const server = mcpServerFactory.createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        logger.error(`MCP request failed: ${String(error)}`);
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.setHeader('content-type', 'application/json');
        }
        if (!reply.raw.writableEnded) {
          reply.raw.end(
            JSON.stringify({
              error: 'Internal Server Error',
              message: 'Failed to process MCP request.',
            }),
          );
        }
      }
    });
  };

  fastify.post('/mcp', mcpHandler);
  fastify.post('/api/mcp', mcpHandler);

  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(
    `Swagger documentation available at: http://localhost:${port}/api`,
  );
  logger.log(
    `MCP endpoint available at: http://localhost:${port}/mcp (also /api/mcp)`,
  );
}
void bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exitCode = 1;
});
