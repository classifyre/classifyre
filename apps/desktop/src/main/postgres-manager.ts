import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getAvailablePort } from './port-manager.js';

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
