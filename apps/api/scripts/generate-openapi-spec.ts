#!/usr/bin/env bun
/**
 * Generate OpenAPI spec from NestJS application
 * Run with: bun run scripts/generate-openapi-spec.ts
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function generateSpec() {
  console.log('🚀 Generating OpenAPI specification...\n');

  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Classifyre API')
    .setDescription(
      'Metadata ingestion and detection API for unstructured data sources. ' +
        'Supports WordPress, Slack, Sitemap, S3-Compatible Storage, Azure Blob Storage, Google Cloud Storage, PostgreSQL, MySQL, MSSQL, Oracle, Hive, Databricks, Snowflake, MongoDB, PowerBI, Tableau, Confluence, Jira, and Service Desk sources. ' +
        'Built-in detectors for secrets, PII, toxic content, NSFW images, broken links, and security threats.',
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
  writeFileSync(outputPath, JSON.stringify(document, null, 2));

  console.log('✅ OpenAPI spec generated successfully!');
  console.log(`📄 File: ${outputPath}`);
  console.log(`📊 Endpoints: ${Object.keys(document.paths).length}`);
  console.log(`🏷️  Tags: ${document.tags?.length || 0}`);

  await app.close();
}

generateSpec().catch((error) => {
  console.error('❌ Failed to generate OpenAPI spec:', error);
  process.exit(1);
});
