import { Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

export async function applyPendingDatabaseMigrations(): Promise<void> {
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

  const schemaPath = resolveSchemaPath();
  const prismaCliPath = resolvePrismaCliPath(schemaPath);
  const apiDir = path.dirname(path.dirname(schemaPath));

  logger.log('Applying pending database migrations before API startup');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath],
      {
        cwd: apiDir,
        env: {
          ...process.env,
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
        logger.log('Database migrations are up to date');
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
