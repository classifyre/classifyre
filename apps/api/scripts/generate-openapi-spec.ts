#!/usr/bin/env bun
/**
 * Generate OpenAPI spec from NestJS application
 * Run with: bun run scripts/generate-openapi-spec.ts
 *
 * Builds the whole Nest DI graph but never opens a connection to anything: the
 * spec is derived from decorators alone. Several providers nonetheless parse
 * DATABASE_URL in a *field initialiser* (the registry pool, the correlation
 * lock, the scheduler pools), which runs while Nest is instantiating them — so
 * a checkout with no `.env` used to die here with a bare `exit 1`. See the
 * placeholder below and the error-visibility notes on `NestFactory.create`.
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { writeFileSync } from 'fs';
import { join } from 'path';

/**
 * A syntactically valid connection URL for providers that build a pg Pool at
 * construction time. `new Pool(...)` is lazy — it connects on first query, and
 * this script never issues one — so a placeholder is enough and is strictly
 * better than requiring CI to provision a database to generate a spec.
 */
const PLACEHOLDER_DATABASE_URL =
  'postgresql://openapi:openapi@127.0.0.1:5432/openapi';

async function generateSpec() {
  console.log('🚀 Generating OpenAPI specification...\n');

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
    console.log(
      'ℹ️  DATABASE_URL is unset — using an in-memory placeholder. ' +
        'No connection is opened while generating the spec.\n',
    );
  }

  // `abortOnError: false` makes Nest reject the promise instead of logging
  // through its own logger and calling process.exit(1). With `logger: false`
  // that exit printed nothing whatsoever, which is how a real initialisation
  // failure reached CI as an unexplained "exited with code 1".
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  const config = new DocumentBuilder()
    .setTitle('Classifyre API')
    .setDescription(
      'Metadata ingestion and detection API for unstructured data sources. ' +
        'Supports WordPress, Slack, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, Service Desk, Notion, Email, and YouTube sources. ' +
        'Built-in detectors for secrets, PII, toxic content, image classification, broken links, and security threats.',
    )
    .setVersion('1.0.0')
    .addTag('Health', 'Health check and API status endpoints')
    .addTag('Sources', 'Data source management and configuration')
    .addTag('Assets', 'Ingested asset retrieval and management')
    .addTag('Detectors', 'Content detection and analysis')
    .addTag('Notifications', 'Notification feed and alert management')
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

  const document = SwaggerModule.createDocument(app, config);

  // Write OpenAPI spec to file
  const outputPath = join(__dirname, '../openapi.json');
  const rootOutputPath = join(__dirname, '../../../openapi.json');
  const serialized = JSON.stringify(document, null, 2);
  writeFileSync(outputPath, serialized);
  writeFileSync(rootOutputPath, serialized);

  console.log('✅ OpenAPI spec generated successfully!');
  console.log(`📄 File: ${outputPath}`);
  console.log(`📄 Root mirror: ${rootOutputPath}`);
  console.log(`📊 Endpoints: ${Object.keys(document.paths).length}`);
  console.log(`🏷️  Tags: ${document.tags?.length || 0}`);

  await app.close();
}

generateSpec().catch((error) => {
  console.error('❌ Failed to generate OpenAPI spec:', error);
  process.exit(1);
});
