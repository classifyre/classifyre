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
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServerFactoryService } from './mcp-server.factory';
import { McpTokenService } from './mcp-token.service';
import { InstanceSettingsService } from './instance-settings.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT ?? 8000;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 50 * 1024 * 1024 }), // 50 MB
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  });

  await app.register(multipart as any, {
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  });

  const config = new DocumentBuilder()
    .setTitle('Classifyre API')
    .setDescription(
      'Metadata ingestion and detection API for unstructured data sources. ' +
        'Supports WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, and Service Desk sources. ' +
        'Built-in detectors for secrets, PII, toxic content, NSFW images, broken links, and security threats.',
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
void bootstrap();
