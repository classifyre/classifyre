import './tracing';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
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
import { applyPendingDatabaseMigrations } from './database-migrations';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 8000;

  await applyPendingDatabaseMigrations();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 50 * 1024 * 1024 }), // 50 MB
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    // @fastify/cors (used by the Fastify adapter) defaults Access-Control-Allow-
    // Methods to only 'GET,HEAD,POST' — unlike the Express cors package. The
    // desktop web talks to the API cross-origin (app://classifyre → 127.0.0.1),
    // so without listing PUT/PATCH/DELETE every mutating request fails preflight.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
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
  // UNDER_PRESSURE_MAX_HEAP_USED_BYTES   (default: 768 MB)
  //   Only fires near OOM — set well above steady-state (~250 MB for
  //   NestJS+Prisma). Override lower only after measuring your actual heap.
  // UNDER_PRESSURE_MAX_RSS_BYTES         (default: 1 GB)
  //   Total process memory guard. Override lower only after measuring RSS.
  // Register under-pressure for metrics sampling and the /api/health/pressure
  // status endpoint. Auto-rejection is disabled (pressureHandler is a no-op)
  // so that normal UI/API traffic is never blocked. CliBackpressureGuard reads
  // fastify.isUnderPressure() and applies the 503 selectively on the 6 CLI
  // ingestion endpoints only.
  await app.register(underPressure, {
    maxEventLoopDelay: parseInt(
      process.env.UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY ?? '1000',
      10,
    ),
    maxHeapUsedBytes: parseInt(
      process.env.UNDER_PRESSURE_MAX_HEAP_USED_BYTES ??
        String(768 * 1024 * 1024),
      10,
    ),
    maxRssBytes: parseInt(
      process.env.UNDER_PRESSURE_MAX_RSS_BYTES ?? String(1024 * 1024 * 1024),
      10,
    ),
    // No-op: guard handles per-route rejection, not this global hook.
    pressureHandler: () => undefined,
    exposeStatusRoute: '/api/health/pressure',
  });

  // Map transient Prisma overload errors (P2028, P2034, P2024) to 503 so the
  // CLI retry policy handles them the same way as under-pressure rejections.
  app.useGlobalFilters(new PrismaExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Classifyre API')
    .setDescription(
      'Metadata ingestion and detection API for unstructured data sources. ' +
        'Supports WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, and Service Desk sources. ' +
        'Built-in detectors for secrets, PII, toxic content, image classification, broken links, and security threats.',
    )
    .setVersion('1.0.0')
    .addTag('Health', 'Health check and API status endpoints')
    .addTag('Sources', 'Data source management and configuration')
    .addTag('Assets', 'Ingested asset retrieval and management')
    .addTag('Detectors', 'Content detection and analysis')
    .addTag('Sandbox', 'Sandbox file scanning')
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
  SwaggerModule.setup('api', app, documentFactory);

  const fastify = app.getHttpAdapter().getInstance();
  const mcpServerFactory = app.get(McpServerFactoryService);
  const mcpTokenService = app.get(McpTokenService);
  const instanceSettingsService = app.get(InstanceSettingsService);

  const mcpHandler = async (request: any, reply: any) => {
    const settings = await instanceSettingsService.getSettings();
    if (!settings.mcpEnabled) {
      reply.code(503).send({
        error: 'Service Unavailable',
        message: 'MCP is disabled. Enable it in Settings.',
      });
      return;
    }

    try {
      await mcpTokenService.authorizeBearerToken(request.headers.authorization);
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
