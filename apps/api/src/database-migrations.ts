import { Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  REGISTRY_TABLE_DDL,
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './registry/namespace-registry.sql';

const logger = new Logger('DatabaseMigrations');

function firstExistingPath(candidates: Array<string | undefined>): string {
  const existing = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      fs.existsSync(candidate),
  );
  if (existing) return existing;

  throw new Error(
    `Classifyre cannot locate the Prisma schema. Checked: ${candidates
      .filter(Boolean)
      .join(', ')}`,
  );
}

function resolveSchemaPath(): string {
  return firstExistingPath([
    process.env.PRISMA_SCHEMA_PATH,
    path.join(process.cwd(), 'prisma', 'schema.prisma'),
    path.resolve(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    path.resolve(__dirname, 'prisma', 'schema.prisma'),
    '/app/api/prisma/schema.prisma',
  ]);
}

function resolvePrismaCliPath(schemaPath: string): string {
  const apiDir = path.dirname(path.dirname(schemaPath));

  let resolvedFromModule: string | undefined;
  try {
    resolvedFromModule = require.resolve('prisma/build/index.js');
  } catch {
    // Fall through to packaged/runtime paths below.
  }

  return firstExistingPath([
    resolvedFromModule,
    path.join(apiDir, 'node_modules', 'prisma', 'build', 'index.js'),
    path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    '/app/node_modules/prisma/build/index.js',
    '/app/api/node_modules/prisma/build/index.js',
  ]);
}

/**
 * Run `prisma migrate deploy` against a single Postgres schema.
 *
 * When `schema` is provided, `DATABASE_URL` is rewritten with `?schema=<schema>`
 * so Prisma tracks state in an independent `_prisma_migrations` table inside
 * that schema and creates all (unqualified) tables there via `search_path`.
 * When omitted, the process `DATABASE_URL` is used verbatim (whatever schema it
 * already targets, defaulting to `public`).
 */
export async function deployForSchema(schema?: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Classifyre cannot apply database migrations because DATABASE_URL is not set.',
    );
  }

  const schemaPath = resolveSchemaPath();
  const prismaCliPath = resolvePrismaCliPath(schemaPath);
  const apiDir = path.dirname(path.dirname(schemaPath));

  let databaseUrl = process.env.DATABASE_URL;
  if (schema) {
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    databaseUrl = url.toString();
  }

  logger.log(
    `Applying pending database migrations for schema '${schema ?? 'public'}'`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath],
      {
        cwd: apiDir,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PRISMA_CLI_TELEMETRY_INFORMATION: 'disabled',
          CHECKPOINT_DISABLE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      reject(
        new Error(
          `Classifyre could not start the automatic database migration process: ${error.message}`,
        ),
      );
    });
    child.on('exit', (code) => {
      if (code === 0) {
        logger.log(
          `Database migrations are up to date for schema '${schema ?? 'public'}'`,
        );
        resolve();
        return;
      }

      const detail = (stderr || stdout).trim();
      reject(
        new Error(
          'Classifyre could not apply required database migrations automatically. ' +
            'Verify that DATABASE_URL points to the intended database and that its user can create tables, indexes, and the pgvector extension. ' +
            `Prisma migrate deploy exited with code ${code ?? 'unknown'}${detail ? `: ${detail}` : '.'}`,
        ),
      );
    });
  });
}

/**
 * Pre-boot migration orchestrator for the multi-tenant model.
 *
 * 1. Bootstraps the `public.namespaces` registry table (idempotent DDL).
 * 2. Reads every registered namespace and runs `migrate deploy` into its
 *    `ns_<slug>` schema, sequentially (bounded, one advisory-lock holder at a
 *    time on the shared database).
 *
 * A fresh install has zero namespaces, so no tenant schema is migrated until
 * the first namespace is created (there is intentionally no default namespace).
 */
export async function applyAllPendingMigrations(): Promise<void> {
  if (process.env.CLASSIFYRE_AUTO_MIGRATE === 'false') {
    logger.warn(
      'Automatic database migrations are disabled by CLASSIFYRE_AUTO_MIGRATE=false',
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Classifyre cannot apply database migrations because DATABASE_URL is not set.',
    );
  }

  const pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
  });
  let schemas: Array<{
    id: string;
    schemaName: string;
    provisioning: boolean;
  }> = [];
  try {
    await pool.query(REGISTRY_TABLE_DDL);
    // Namespace deletion is a soft-delete (status = 'deleted'): the tenant
    // schema and its data are retained, so there is nothing to drop on boot.
    const { rows } = await pool.query<{
      id: string;
      schema_name: string;
      status: string;
    }>(
      "SELECT id, schema_name, status FROM namespaces WHERE type = 'local' AND status IN ('active', 'provisioning') ORDER BY created_at ASC",
    );
    schemas = rows.map((r) => ({
      id: r.id,
      schemaName: r.schema_name,
      provisioning: r.status === 'provisioning',
    }));
  } finally {
    await pool.end();
  }

  logger.log(
    `Namespace registry ready; migrating ${schemas.length} namespace schema(s)`,
  );
  for (const schema of schemas) {
    await deployForSchema(schema.schemaName);
    if (schema.provisioning) {
      const activationPool = new Pool({
        connectionString: publicConnectionString(),
        options: PUBLIC_SEARCH_PATH_OPTION,
      });
      try {
        await activationPool.query(
          "UPDATE namespaces SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'provisioning'",
          [schema.id],
        );
      } finally {
        await activationPool.end();
      }
    }
  }
}

/**
 * @deprecated Kept for callers that still expect the single-schema entrypoint.
 * Prefer {@link applyAllPendingMigrations}.
 */
export async function applyPendingDatabaseMigrations(): Promise<void> {
  await applyAllPendingMigrations();
}
