import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Client, Pool } from 'pg';
import {
  CatalogBackendDisconnectedError,
  CatalogCapacityError,
  type CatalogSession,
  type OpenCatalogSessionInput,
} from './catalog-backend';
import { computeCatalogHash, quoteIdent } from './catalog-ddl';
import {
  CATALOG_PG_CONFIG,
  type CatalogPgConfig,
  catalogPgConfigFromEnv,
  isConnectionResetError,
  pgClientConfig,
} from './catalog-pg-config';
import {
  TEMPLATE_SETUP,
  buildProvisionStatements,
  buildSchemaGrantSql,
} from './postgres-catalog-ddl';
import { PostgresCatalogSession } from './postgres-catalog-wire';
import { SqlGatewayMetrics } from './sql-gateway-metrics';

export {
  type CatalogPgConfig,
  catalogPgConfigFromEnv,
} from './catalog-pg-config';
export { PostgresCatalogSession } from './postgres-catalog-wire';

const DB_NAME_RE = /^c_[0-9a-f]{24}$/;
const ROLE_NAME_RE = /^r_[0-9a-f]{24}$/;

interface CatalogDbEntry {
  hash: string;
  dbName: string;
  roleName: string;
  password: string;
  workspaceId: string;
  connections: Set<string>;
  activeSessions: number;
  createdAt: number;
  lastUsedAt: number;
  supersededAt: number | null;
}

/**
 * Manages immutable per-`(workspace, catalogHash)` databases and locked-down
 * `r_<hash>` login roles on the pod-local native PostgreSQL catalog sidecar
 * (docs/prd/SG-sql-gateway-native-catalog.md §4).
 *
 * Lazily opens its admin pool and starts the sweeper on first use (or explicit
 * `start()`), so injecting it into `SqlGatewayModule` on non-gateway pods
 * allocates zero sockets or timers.
 */
@Injectable()
export class PostgresCatalogHost {
  private readonly logger = new Logger(PostgresCatalogHost.name);
  private readonly config: CatalogPgConfig;
  readonly metrics: SqlGatewayMetrics;
  private adminPool: Pool | null = null;
  private templateReady: Promise<void> | null = null;
  private templateInitialized = false;
  private readonly catalogs = new Map<string, CatalogDbEntry>();
  private readonly inFlight = new Map<string, Promise<CatalogDbEntry>>();
  /** Catalog hashes that have reserved a `maxCatalogDbs` slot while provisioning. */
  private readonly pendingCreates = new Set<string>();
  private readonly dropping = new Map<string, Promise<void>>();
  /** `(workspaceId:connectionId)` → latest `catalogHash` opened for it. */
  private readonly latestByConnection = new Map<string, string>();
  /** Serializes `CREATE DATABASE ... TEMPLATE` to avoid PG error 55006. */
  private createDbLock: Promise<void> = Promise.resolve();
  private sweeper: NodeJS.Timeout | null = null;
  private lastRestartAt = 0;
  private closed = false;

  constructor(
    metrics: SqlGatewayMetrics = new SqlGatewayMetrics(),
    @Optional()
    @Inject(CATALOG_PG_CONFIG)
    config: Partial<CatalogPgConfig> = {},
  ) {
    this.config = { ...catalogPgConfigFromEnv(), ...config };
    this.metrics = metrics;
  }

  /** Starts the background sweeper (idempotent). */
  start(): void {
    if (this.closed || this.sweeper || this.config.sweepIntervalMs <= 0) return;
    this.sweeper = setInterval(
      () => void this.sweepNow().catch(() => undefined),
      this.config.sweepIntervalMs,
    );
    this.sweeper.unref();
  }

  private pool(): Pool {
    if (!this.adminPool) {
      const pool = new Pool({
        ...pgClientConfig(this.config, this.config.maintenanceDb),
        max: 4,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      pool.on('error', (error) => {
        if (!this.closed) {
          this.logger.warn(
            `Catalog sidecar admin pool error: ${error.message}`,
          );
          if (isConnectionResetError(error)) this.handleSidecarRestart();
        }
      });
      this.adminPool = pool;
    }
    return this.adminPool;
  }

  /** Verifies sidecar reachability and ensures `classifyre_tpl` is ready. */
  async ping(): Promise<boolean> {
    if (this.closed) return false;
    try {
      await this.pool().query('SELECT 1');
      await this.ensureTemplate();
      return true;
    } catch (error) {
      if (isConnectionResetError(error)) this.handleSidecarRestart();
      return false;
    }
  }

  /**
   * Opens a dedicated 1:1 PG wire session to `c_<hash>` as `r_<hash>`.
   * Concurrent calls for the same hash coalesce on a single provisioning promise.
   */
  async open(input: OpenCatalogSessionInput): Promise<CatalogSession> {
    if (this.closed) {
      throw new CatalogBackendDisconnectedError('Catalog host is closed.');
    }
    this.start();
    const hash = computeCatalogHash(input.workspaceId, input.ddl.sql);
    const entry = await this.ensureCatalog(hash, input);

    entry.activeSessions += 1;
    entry.lastUsedAt = Date.now();
    this.trackConnectionLatest(input.workspaceId, input.connectionId, hash);

    try {
      return await PostgresCatalogSession.connect({
        config: this.config,
        database: entry.dbName,
        role: entry.roleName,
        password: entry.password,
        onClose: () => {
          entry.activeSessions = Math.max(0, entry.activeSessions - 1);
          entry.lastUsedAt = Date.now();
        },
        onBackendLost: () => {
          this.handleSidecarRestart();
        },
      });
    } catch (error) {
      entry.activeSessions = Math.max(0, entry.activeSessions - 1);
      entry.lastUsedAt = Date.now();
      if (isConnectionResetError(error)) {
        this.handleSidecarRestart();
      }
      throw error;
    }
  }

  /** Runs one GC sweep pass (also callable directly by tests). */
  async sweepNow(now = Date.now()): Promise<number> {
    if (this.closed) return 0;
    const toDrop = new Set<string>();

    for (const entry of this.catalogs.values()) {
      if (entry.activeSessions > 0) continue;
      if (
        entry.supersededAt !== null &&
        now - entry.supersededAt >= this.config.supersededGraceMs
      ) {
        toDrop.add(entry.hash);
      } else if (now - entry.lastUsedAt >= this.config.dbTtlMs) {
        toDrop.add(entry.hash);
      }
    }

    const remaining = this.catalogs.size - toDrop.size;
    if (remaining > this.config.maxCatalogDbs) {
      const idleByAge = [...this.catalogs.values()]
        .filter((e) => e.activeSessions === 0 && !toDrop.has(e.hash))
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      let excess = remaining - this.config.maxCatalogDbs;
      for (const entry of idleByAge) {
        if (excess <= 0) break;
        toDrop.add(entry.hash);
        excess -= 1;
      }
    }

    let dropped = 0;
    for (const hash of toDrop) {
      if (await this.dropCatalog(hash)) dropped += 1;
    }
    return dropped;
  }

  catalogCount(): number {
    return this.catalogs.size;
  }

  /** Metadata about a tracked catalog hash (for tests and diagnostics). */
  catalogInfo(hash: string): {
    dbName: string;
    roleName: string;
    password: string;
    activeSessions: number;
    supersededAt: number | null;
  } | null {
    const e = this.catalogs.get(hash);
    if (!e) return null;
    return {
      dbName: e.dbName,
      roleName: e.roleName,
      password: e.password,
      activeSessions: e.activeSessions,
      supersededAt: e.supersededAt,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
    const p = this.adminPool;
    this.adminPool = null;
    if (p) await p.end().catch(() => undefined);
  }

  // ── Internal lifecycle ────────────────────────────────────────────────────

  private trackConnectionLatest(
    workspaceId: string,
    connectionId: string,
    hash: string,
  ): void {
    const connKey = `${workspaceId}:${connectionId}`;
    const prevHash = this.latestByConnection.get(connKey);
    this.latestByConnection.set(connKey, hash);
    const current = this.catalogs.get(hash);
    if (current) {
      current.connections.add(connKey);
      current.supersededAt = null;
    }
    if (prevHash && prevHash !== hash) {
      const prev = this.catalogs.get(prevHash);
      if (prev) {
        prev.connections.delete(connKey);
        if (prev.connections.size === 0 && prev.supersededAt === null) {
          prev.supersededAt = Date.now();
        }
      }
    }
  }

  private async ensureTemplate(): Promise<void> {
    if (this.templateReady) return this.templateReady;
    const init = this.initTemplate();
    this.templateReady = init;
    try {
      await init;
      this.templateInitialized = true;
    } catch (error) {
      if (this.templateReady === init) this.templateReady = null;
      throw error;
    }
  }

  private async initTemplate(): Promise<void> {
    const p = this.pool();
    const tpl = quoteIdent(this.config.templateDb);
    const admin = quoteIdent(this.config.adminUser);

    if (this.config.reconcileOrphansOnStartup) {
      await this.reconcileOrphans();
    }

    // Lock down default databases so r_<hash> roles can CONNECT strictly to
    // their own c_<hash> database and never to postgres or template1 (SG §4.3, R5).
    if (this.config.lockdownDefaultDbs) {
      for (const db of [this.config.maintenanceDb, 'template1']) {
        const found = await p.query(
          `SELECT 1 FROM pg_database WHERE datname = $1`,
          [db],
        );
        if (found.rows.length > 0) {
          await p.query(
            `REVOKE CONNECT, TEMP ON DATABASE ${quoteIdent(db)} FROM PUBLIC`,
          );
        }
      }
    }

    const exists = await p.query<{ datistemplate: boolean }>(
      `SELECT datistemplate FROM pg_database WHERE datname = $1`,
      [this.config.templateDb],
    );
    if (exists.rows.length > 0) {
      if (exists.rows[0].datistemplate) {
        await p.query(`ALTER DATABASE ${tpl} WITH IS_TEMPLATE = false`);
      }
      await p.query(`DROP DATABASE IF EXISTS ${tpl} WITH (FORCE)`);
    }

    await p.query(`CREATE DATABASE ${tpl} OWNER ${admin}`);

    const tplClient = new Client(
      pgClientConfig(this.config, this.config.templateDb),
    );
    await tplClient.connect();
    try {
      await tplClient.query(TEMPLATE_SETUP);
    } finally {
      await tplClient.end().catch(() => undefined);
    }

    await p.query(`REVOKE ALL ON DATABASE ${tpl} FROM PUBLIC`);
    await p.query(
      `ALTER DATABASE ${tpl} WITH IS_TEMPLATE = true ALLOW_CONNECTIONS = false`,
    );
  }

  private async reconcileOrphans(): Promise<void> {
    const p = this.pool();
    const dbs = await p.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'c_%'`,
    );
    for (const row of dbs.rows) {
      if (!DB_NAME_RE.test(row.datname)) continue;
      const hash = row.datname.slice(2);
      if (this.catalogs.has(hash) || this.inFlight.has(hash)) continue;
      await p
        .query(
          `DROP DATABASE IF EXISTS ${quoteIdent(row.datname)} WITH (FORCE)`,
        )
        .catch(() => undefined);
    }
    const roles = await p.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'r_%'`,
    );
    for (const row of roles.rows) {
      if (!ROLE_NAME_RE.test(row.rolname)) continue;
      const hash = row.rolname.slice(2);
      if (this.catalogs.has(hash) || this.inFlight.has(hash)) continue;
      await p
        .query(`DROP ROLE IF EXISTS ${quoteIdent(row.rolname)}`)
        .catch(() => undefined);
    }
  }

  private async ensureCatalog(
    hash: string,
    input: OpenCatalogSessionInput,
  ): Promise<CatalogDbEntry> {
    const pendingDrop = this.dropping.get(hash);
    if (pendingDrop) await pendingDrop;

    const existing = this.catalogs.get(hash);
    if (existing) return existing;

    const flying = this.inFlight.get(hash);
    if (flying) return flying;

    const promise = this.provisionCatalog(hash, input);
    this.inFlight.set(hash, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(hash) === promise) this.inFlight.delete(hash);
    }
  }

  /** Enforces `maxCatalogDbs` synchronously before creating a new DB (SG R7). */
  private async makeRoomForNewCatalog(): Promise<void> {
    while (
      this.catalogs.size + this.pendingCreates.size >=
      this.config.maxCatalogDbs
    ) {
      const oldestIdle = [...this.catalogs.values()]
        .filter((e) => e.activeSessions === 0)
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!oldestIdle) {
        throw new CatalogCapacityError(
          `Catalog database limit (${this.config.maxCatalogDbs}) reached on this gateway pod; try again shortly.`,
        );
      }
      await this.dropCatalog(oldestIdle.hash);
    }
  }

  private async provisionCatalog(
    hash: string,
    input: OpenCatalogSessionInput,
  ): Promise<CatalogDbEntry> {
    const started = performance.now();
    await this.ensureTemplate();

    const dbName = `c_${hash}`;
    const roleName = `r_${hash}`;
    const password = randomBytes(24).toString('hex');
    const statements = buildProvisionStatements({
      dbName,
      roleName,
      password,
      templateDb: this.config.templateDb,
      adminUser: this.config.adminUser,
      roleConnectionLimit: this.config.roleConnectionLimit,
      statementTimeoutMs: this.config.statementTimeoutMs,
      workMem: this.config.workMem,
    });

    // Serialize DB cap check + slot reservation + CREATE DATABASE ... TEMPLATE
    // so concurrent sign-ins neither overshoot maxCatalogDbs nor collide on
    // template lock (55006).
    let reserved = false;
    await this.withCreateDbLock(async () => {
      await this.makeRoomForNewCatalog();
      this.pendingCreates.add(hash);
      reserved = true;
      try {
        const p = this.pool();
        for (const stmt of statements) {
          await p.query(stmt);
        }
      } catch (error) {
        this.pendingCreates.delete(hash);
        reserved = false;
        throw error;
      }
    });

    try {
      const dbClient = new Client(pgClientConfig(this.config, dbName));
      await dbClient.connect();
      try {
        if (input.ddl.sql.trim()) {
          await dbClient.query(input.ddl.sql);
        }
        const grants = buildSchemaGrantSql(input.ddl.dataSchemas, roleName);
        if (grants) {
          await dbClient.query(grants);
        }
      } catch (error) {
        await dbClient.end().catch(() => undefined);
        const p = this.pool();
        await p
          .query(`DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`)
          .catch(() => undefined);
        await p
          .query(`DROP ROLE IF EXISTS ${quoteIdent(roleName)}`)
          .catch(() => undefined);
        throw error;
      } finally {
        await dbClient.end().catch(() => undefined);
      }

      const now = Date.now();
      const entry: CatalogDbEntry = {
        hash,
        dbName,
        roleName,
        password,
        workspaceId: input.workspaceId,
        connections: new Set(),
        activeSessions: 0,
        createdAt: now,
        lastUsedAt: now,
        supersededAt: null,
      };
      this.catalogs.set(hash, entry);
      this.metrics.setCatalogDbs(this.catalogs.size);
      this.metrics.observeCatalogDbCreate((performance.now() - started) / 1000);
      return entry;
    } finally {
      if (reserved) this.pendingCreates.delete(hash);
    }
  }

  private withCreateDbLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.createDbLock.then(fn);
    this.createDbLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async dropCatalog(hash: string): Promise<boolean> {
    const entry = this.catalogs.get(hash);
    if (!entry || entry.activeSessions > 0) return false;
    this.catalogs.delete(hash);
    this.metrics.setCatalogDbs(this.catalogs.size);
    for (const [connKey, latest] of this.latestByConnection) {
      if (latest === hash) this.latestByConnection.delete(connKey);
    }

    const dropTask = (async () => {
      try {
        const p = this.pool();
        await p.query(
          `DROP DATABASE IF EXISTS ${quoteIdent(entry.dbName)} WITH (FORCE)`,
        );
        await p.query(`DROP ROLE IF EXISTS ${quoteIdent(entry.roleName)}`);
        this.metrics.recordCatalogDbDrop(1);
      } catch (error) {
        if (isConnectionResetError(error)) {
          this.handleSidecarRestart();
        } else {
          this.logger.warn(
            `Failed dropping catalog ${entry.dbName}: ${String(error)}`,
          );
        }
      }
    })();

    this.dropping.set(hash, dropTask);
    try {
      await dropTask;
    } finally {
      if (this.dropping.get(hash) === dropTask) this.dropping.delete(hash);
    }
    return true;
  }

  private handleSidecarRestart(): void {
    const now = Date.now();
    const hadState =
      this.templateInitialized ||
      this.templateReady !== null ||
      this.catalogs.size > 0;
    this.templateReady = null;
    this.templateInitialized = false;
    this.catalogs.clear();
    this.pendingCreates.clear();
    this.latestByConnection.clear();
    this.metrics.setCatalogDbs(0);

    if (hadState && now - this.lastRestartAt > 1_000) {
      this.lastRestartAt = now;
      this.metrics.recordSidecarRestart();
      this.logger.warn(
        'Catalog Postgres sidecar disconnected; cleared in-memory catalog registry for recovery.',
      );
      const oldPool = this.adminPool;
      this.adminPool = null;
      if (oldPool) void oldPool.end().catch(() => undefined);
    }
  }
}
