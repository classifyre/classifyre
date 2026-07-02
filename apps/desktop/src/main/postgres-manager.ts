import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { getAvailablePort } from './port-manager.js';

// The bundled PostgreSQL binaries link against ICU/OpenSSL shipped alongside
// them in the platform package's native/lib (e.g. libicuuc.so.60), but that
// directory isn't on the OS's default dynamic-loader path, so initdb aborts
// with "error while loading shared libraries: libicuuc.so.60: cannot open
// shared object file". macOS resolves its own libs via rpath and Windows via
// the bin dir, so this only needs fixing for Linux. Point LD_LIBRARY_PATH at
// the bundled lib dir before embedded-postgres spawns initdb (it inherits
// process.env).
function ensureBundledLibsOnLoaderPath(): void {
  if (process.platform !== 'linux') return;
  const pkgByPlatform: Record<string, string> = {
    'linux-x64': '@embedded-postgres/linux-x64',
    'linux-arm64': '@embedded-postgres/linux-arm64',
  };
  const pkg = pkgByPlatform[`${process.platform}-${process.arch}`];
  if (!pkg) return;
  let libDir: string;
  try {
    // Seed require resolution from the real app directory. import.meta.url is
    // rewritten by vite to a base that cannot resolve the externalized
    // embedded-postgres, whereas app.getAppPath() is a genuine runtime path.
    // Resolve embedded-postgres's main entry, then resolve the platform package
    // RELATIVE TO it — under bun's isolated store the @embedded-postgres/*
    // packages live only inside embedded-postgres's own node_modules. The
    // package's native/lib sits next to its dist/ entry.
    const reqFromApp = createRequire(path.join(app.getAppPath(), 'index.js'));
    const embeddedPgMain = reqFromApp.resolve('embedded-postgres');
    const platformMain = createRequire(embeddedPgMain).resolve(pkg);
    libDir = path.join(path.dirname(platformMain), '..', 'native', 'lib');
  } catch (err) {
    console.warn('Could not locate bundled PG libs for LD_LIBRARY_PATH:', err);
    return;
  }
  if (!fs.existsSync(libDir)) {
    console.warn(`Bundled PG lib dir not found, skipping LD_LIBRARY_PATH: ${libDir}`);
    return;
  }
  const existing = process.env['LD_LIBRARY_PATH'];
  process.env['LD_LIBRARY_PATH'] = existing ? `${libDir}${path.delimiter}${existing}` : libDir;
  console.log(`Added bundled PostgreSQL libs to LD_LIBRARY_PATH: ${libDir}`);
}

type EmbeddedPostgresInstance = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: (database?: string) => {
    connect: () => Promise<void>;
    query: (sql: string) => Promise<{ rows: unknown[] }>;
    end: () => Promise<void>;
  };
};

export class PostgresManager {
  private pg: EmbeddedPostgresInstance | null = null;
  private port = 0;
  private preferredPort = 54320;
  private running = false;
  private dataDir: string;

  constructor(preferredPort?: number) {
    const base = process.env['CLASSIFYRE_DATA_DIR'] || app.getPath('userData');
    this.dataDir = path.join(base, 'pgdata');
    if (preferredPort) this.preferredPort = preferredPort;
  }

  async start(): Promise<void> {
    if (this.running) return;

    ensureBundledLibsOnLoaderPath();

    // Prefer the configured port; if busy, fall forward to any free port so a
    // port collision never blocks startup.
    this.port = await getAvailablePort(this.preferredPort);

    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    this.pg = new EmbeddedPostgres({
      databaseDir: this.dataDir,
      user: 'classifyre',
      password: 'classifyre',
      port: this.port,
      persistent: true,
    }) as unknown as EmbeddedPostgresInstance;

    const pgVersionFile = path.join(this.dataDir, 'PG_VERSION');
    if (!fs.existsSync(pgVersionFile)) {
      await this.pg.initialise();
    }
    await this.pg.start();
    this.running = true;

    await this.ensureDatabase();
  }

  private async ensureDatabase(): Promise<void> {
    if (!this.pg) throw new Error('PostgreSQL not started');

    const client = this.pg.getPgClient();
    await client.connect();
    try {
      const result = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = 'classifyre'",
      );
      if ((result.rows as unknown[]).length === 0) {
        await client.query('CREATE DATABASE classifyre');
      }
    } finally {
      await client.end();
    }
  }

  async createSchema(schemaName: string): Promise<void> {
    if (!this.pg) throw new Error('PostgreSQL not started');
    if (!/^[a-z0-9_]+$/.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }

    // Schemas live in the app database, not the default `postgres` database.
    const client = this.pg.getPgClient('classifyre');
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    } finally {
      await client.end();
    }
  }

  async dropSchema(schemaName: string): Promise<void> {
    if (!this.pg) throw new Error('PostgreSQL not started');
    if (!/^[a-z0-9_]+$/.test(schemaName)) {
      throw new Error(`Invalid schema name: ${schemaName}`);
    }

    const client = this.pg.getPgClient('classifyre');
    await client.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await client.end();
    }
  }

  getConnectionString(schemaName?: string): string {
    const base = `postgresql://classifyre:classifyre@127.0.0.1:${this.port}/classifyre`;
    if (!schemaName) return base;
    const encodedOptions = encodeURIComponent(`-csearch_path=${schemaName}`);
    return `${base}?schema=${schemaName}&options=${encodedOptions}`;
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.running;
  }

  async stop(): Promise<void> {
    if (!this.running || !this.pg) return;
    try {
      await this.pg.stop();
    } catch {
      // Best-effort shutdown
    }
    this.running = false;
    this.pg = null;
  }
}
