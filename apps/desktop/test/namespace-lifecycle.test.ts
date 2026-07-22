/**
 * Integration test for the desktop namespace lifecycle.
 * Verifies: PG start → schema creation → migrations → NestJS spawn → health check.
 *
 * Run with Node 22:
 *   PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" npx tsx test/namespace-lifecycle.test.ts
 */

import { execFileSync, spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import net from 'net';
import { createRequire } from 'module';

const MONOREPO_ROOT = path.resolve(__dirname, '../../..');
const API_DIR = path.join(MONOREPO_ROOT, 'apps/api');
const PRISMA_SCHEMA = path.join(API_DIR, 'prisma/schema.prisma');
const TEST_DATA_DIR = path.join(os.tmpdir(), `classifyre-desktop-test-${Date.now()}`);

let pgInstance: { stop: () => Promise<void>; getPgClient: () => any } | null = null;
let apiProcess: ChildProcess | null = null;
let pgPort = 0;

function getShellPath(): string {
  try {
    return execFileSync('/bin/zsh', ['-lc', 'echo $PATH'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    const home = os.homedir();
    return [
      `${home}/.bun/bin`,
      `${home}/.local/bin`,
      `${home}/.nvm/versions/node/v22.22.3/bin`,
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ].join(':');
  }
}

function findBun(): string {
  const candidates = [
    path.join(os.homedir(), '.bun/bin/bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('bun not found');
}

function embeddedPostgresNativeRoot(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const packageName = `${platform}-${process.arch}`;
  const require = createRequire(__filename);
  const embeddedPostgresEntry = require.resolve('embedded-postgres');
  const nativeRoot = path.resolve(
    path.dirname(embeddedPostgresEntry),
    '..',
    '..',
    '@embedded-postgres',
    packageName,
    'native',
  );
  assert(
    fs.existsSync(nativeRoot),
    `Embedded PostgreSQL native runtime not found at ${nativeRoot}`,
  );
  return nativeRoot;
}

function ensurePgvectorRuntime(env: Record<string, string>): void {
  const nativeRoot = embeddedPostgresNativeRoot();
  const controlFile = path.join(
    nativeRoot,
    'share',
    'postgresql',
    'extension',
    'vector.control',
  );
  if (fs.existsSync(controlFile)) return;

  console.log('[test] Staging pgvector into embedded PostgreSQL...');
  execFileSync(
    'bash',
    [path.join(__dirname, '../scripts/stage-pgvector.sh'), nativeRoot],
    {
      cwd: MONOREPO_ROOT,
      env,
      stdio: 'inherit',
    },
  );
  assert(fs.existsSync(controlFile), `pgvector was not staged at ${controlFile}`);
}

async function getAvailablePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(preferred ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('no port')));
        return;
      }
      server.close(() => resolve(addr.port));
    });
    server.on('error', () => {
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address();
        if (!addr || typeof addr === 'string') {
          fallback.close(() => reject(new Error('no port')));
          return;
        }
        fallback.close(() => resolve(addr.port));
      });
    });
  });
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Port ${port} not ready after ${timeoutMs}ms`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else setTimeout(check, 500);
      });
      req.on('error', () => setTimeout(check, 500));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };
    check();
  });
}

async function cleanup() {
  if (apiProcess?.pid) {
    try {
      process.kill(apiProcess.pid, 'SIGTERM');
    } catch {}
    apiProcess = null;
  }
  if (pgInstance) {
    try {
      await pgInstance.stop();
    } catch {}
    pgInstance = null;
  }
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {}
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const shellPath = getShellPath();
  const bunPath = findBun();
  const env = { ...process.env, PATH: shellPath } as Record<string, string>;

  console.log(`[test] bun: ${bunPath}`);
  console.log(`[test] data dir: ${TEST_DATA_DIR}`);
  console.log(`[test] prisma schema: ${PRISMA_SCHEMA}`);

  assert(fs.existsSync(PRISMA_SCHEMA), `Prisma schema not found at ${PRISMA_SCHEMA}`);
  assert(fs.existsSync(bunPath), `bun not found at ${bunPath}`);

  // --- Step 1: Start embedded PostgreSQL ---
  console.log('\n[test] Step 1: Starting embedded PostgreSQL...');
  ensurePgvectorRuntime(env);
  pgPort = await getAvailablePort(54321);

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  pgInstance = new EmbeddedPostgres({
    databaseDir: TEST_DATA_DIR,
    user: 'classifyre',
    password: 'classifyre',
    port: pgPort,
    persistent: false,
  }) as any;

  await pgInstance!.initialise();
  await pgInstance!.start();
  console.log(`[test] PostgreSQL started on port ${pgPort}`);

  // --- Step 2: Create database and schema ---
  console.log('\n[test] Step 2: Creating database and schema...');
  const client = pgInstance!.getPgClient();
  await client.connect();

  const dbCheck = await client.query("SELECT 1 FROM pg_database WHERE datname = 'classifyre'");
  if (dbCheck.rows.length === 0) {
    await client.query('CREATE DATABASE classifyre');
  }
  await client.end();

  const schemaName = 'ns_test_workspace';
  const dbUrl = `postgresql://classifyre:classifyre@127.0.0.1:${pgPort}/classifyre`;

  // Create schema via the embedded-postgres default client (connects to default db),
  // then create schema inside classifyre db using a second connection.
  // The embedded-postgres getPgClient() connects to `postgres` db by default.
  // We'll create classifyre db from there, then use bun to run a quick SQL via the migrate env.
  // Simplest: just spawn bun to run the CREATE SCHEMA before migration.
  // Create schema by writing a temp SQL file and executing via prisma db execute
  const tmpSql = path.join(os.tmpdir(), `create-schema-${Date.now()}.sql`);
  fs.writeFileSync(tmpSql, `CREATE SCHEMA IF NOT EXISTS "${schemaName}";\n`);

  const createSchemaResult = await new Promise<{ code: number; stderr: string }>((resolve) => {
    const bun = findBun();
    const child = spawn(bun, ['x', 'prisma', 'db', 'execute', '--file', tmpSql], {
      cwd: API_DIR,
      env: { ...env, DATABASE_URL: dbUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => resolve({ code: code ?? 1, stderr }));
    child.on('error', (err) => resolve({ code: 1, stderr: err.message }));
  });
  fs.unlinkSync(tmpSql);
  if (createSchemaResult.code !== 0) {
    console.error('[test] Schema creation stderr:', createSchemaResult.stderr);
    throw new Error(`Schema creation failed with code ${createSchemaResult.code}`);
  }
  console.log(`[test] Schema "${schemaName}" created`);

  // --- Step 3: Run Prisma migrations ---
  console.log('\n[test] Step 3: Running Prisma migrations...');
  const migrateUrl = `${dbUrl}?schema=${schemaName}&options=${encodeURIComponent(`-csearch_path=${schemaName},public`)}`;

  const migrateResult = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(
      bunPath,
      ['x', 'prisma', 'migrate', 'deploy', '--schema', PRISMA_SCHEMA],
      {
        cwd: API_DIR,
        env: { ...env, DATABASE_URL: migrateUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: err.message }));
  });

  if (migrateResult.code !== 0) {
    console.error('[test] Migration stdout:', migrateResult.stdout);
    console.error('[test] Migration stderr:', migrateResult.stderr);
    throw new Error(`Prisma migrate failed with code ${migrateResult.code}`);
  }
  console.log('[test] Migrations applied successfully');

  // --- Step 4: Start NestJS API ---
  console.log('\n[test] Step 4: Starting NestJS API...');
  const apiEntryPath = path.join(API_DIR, 'dist/src/main.js');
  assert(fs.existsSync(apiEntryPath), `API dist not found at ${apiEntryPath}. Run "bun build" in apps/api first.`);

  const apiPort = await getAvailablePort();
  apiProcess = spawn('node', [apiEntryPath], {
    env: {
      ...env,
      PORT: String(apiPort),
      DATABASE_URL: migrateUrl,
      ENVIRONMENT: 'desktop',
      CLI_PATH: path.join(MONOREPO_ROOT, 'apps/cli'),
      CORS_ORIGIN: '*',
      CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS: '0',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  apiProcess.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg) console.log(`  [api stderr] ${msg.substring(0, 200)}`);
  });

  console.log(`[test] Waiting for API on port ${apiPort}...`);
  await waitForPort(apiPort, 45_000);
  console.log(`[test] API is ready on port ${apiPort}`);

  // --- Step 5: Create the namespace through the public registry API ---
  console.log('\n[test] Step 5: Registering test namespace...');
  const namespaceSlug = 'test-workspace';
  const namespaceRes = await fetch(`http://127.0.0.1:${apiPort}/namespaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Test workspace',
      slug: namespaceSlug,
      description: 'Desktop lifecycle integration test',
    }),
  });
  assert(
    namespaceRes.ok,
    `Namespace creation failed: ${namespaceRes.status} ${await namespaceRes.text()}`,
  );
  console.log(`[test] Namespace "${namespaceSlug}" registered`);

  // --- Step 6: Verify API responds ---
  console.log('\n[test] Step 6: Verifying API health...');
  const healthRes = await fetch(`http://127.0.0.1:${apiPort}/`);
  assert(healthRes.ok, `Health check failed: ${healthRes.status}`);
  console.log(`[test] Health check: ${healthRes.status} OK`);

  // --- Step 7: Verify schema isolation through the namespaced route ---
  console.log('\n[test] Step 7: Verifying schema isolation...');
  const sourcesRes = await fetch(
    `http://127.0.0.1:${apiPort}/${namespaceSlug}/sources`,
  );
  assert(sourcesRes.ok, `Sources endpoint failed: ${sourcesRes.status}`);
  const sources = await sourcesRes.json();
  assert(Array.isArray(sources), 'Sources should be an array');
  console.log(`[test] Sources in namespace: ${sources.length} (expected 0 for fresh schema)`);

  console.log('\n=== ALL TESTS PASSED ===\n');
}

main()
  .catch((err) => {
    console.error('\n=== TEST FAILED ===');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
