import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAvailablePort } from './port-manager.js';

// The bundled PostgreSQL binaries link against ICU/OpenSSL shipped alongside
// them in the platform package's native/lib (e.g. libicuuc.so.60), but that
// directory isn't on the OS's default dynamic-loader path, so initdb aborts
// with "error while loading shared libraries: libicuuc.so.60: cannot open
// shared object file". macOS resolves its own libs via rpath and Windows via
// the bin dir, so this only needs fixing for Linux. Point LD_LIBRARY_PATH at
// the bundled lib dir before embedded-postgres spawns initdb (it inherits
// process.env).
//
// The @embedded-postgres/<platform> packages are declared as direct optional
// deps of this app so bun symlinks the platform-matching one into our
// node_modules (they otherwise live only inside embedded-postgres's own
// node_modules and aren't resolvable from here). The package's default export
// gives absolute binary paths; native/lib sits next to native/bin.
async function ensureBundledLibsOnLoaderPath(): Promise<void> {
  if (process.platform !== 'linux') return;
  const spec =
    process.arch === 'arm64'
      ? '@embedded-postgres/linux-arm64'
      : process.arch === 'x64'
        ? '@embedded-postgres/linux-x64'
        : null;
  if (!spec) return;
  let libDir: string;
  try {
    const mod = (await import(/* @vite-ignore */ spec)) as { initdb?: string };
    if (!mod.initdb) {
      console.warn(`Platform PG package ${spec} exposed no initdb path`);
      return;
    }
    libDir = path.join(path.dirname(mod.initdb), '..', 'lib');
  } catch (err) {
    console.warn('Could not locate bundled PG libs for LD_LIBRARY_PATH:', err);
    return;
  }
  if (!fs.existsSync(libDir)) {
    console.warn(`Bundled PG lib dir not found, skipping LD_LIBRARY_PATH: ${libDir}`);
    return;
  }

  // The bundled libs ship only their fully-versioned filename (e.g.
  // libicuuc.so.60.2); the SONAME symlink the loader actually searches for
  // (libicuuc.so.60) is dropped when npm packs the tarball, so initdb aborts
  // with "libicuuc.so.60: cannot open shared object file" even with libDir on
  // the path. Recreate the SONAME aliases in a writable shim dir (native/lib
  // may be read-only inside the packaged app) and put it first on the path.
  const dirs = [libDir];
  try {
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-pglibs-'));
    for (const entry of fs.readdirSync(libDir)) {
      const soname = entry.match(/^(.+\.so\.\d+)\.\d+$/)?.[1];
      if (!soname) continue;
      try {
        fs.symlinkSync(path.join(libDir, entry), path.join(shimDir, soname));
      } catch {
        // alias already created for this SONAME — harmless
      }
    }
    dirs.unshift(shimDir);
  } catch (err) {
    console.warn('Could not build PG lib SONAME shim (continuing):', err);
  }

  const existing = process.env['LD_LIBRARY_PATH'];
  process.env['LD_LIBRARY_PATH'] = [...dirs, existing].filter(Boolean).join(path.delimiter);
  console.log(`Set LD_LIBRARY_PATH for bundled PostgreSQL libs: ${process.env['LD_LIBRARY_PATH']}`);
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
