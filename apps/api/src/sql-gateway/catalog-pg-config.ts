import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';

/** Optional NestJS DI token to override catalog Postgres config in tests. */
export const CATALOG_PG_CONFIG = Symbol('SQL_GATEWAY_CATALOG_PG_CONFIG');

const DEFAULT_TEMPLATE_DB = 'classifyre_tpl';
const DEFAULT_SWEEP_MS = 60_000;
const DEFAULT_SUPERSEDED_GRACE_MS = 120_000;
const DEFAULT_CATALOG_STATEMENT_SECONDS = 15;
const DEFAULT_CATALOG_DB_TTL_MINUTES = 30;
const DEFAULT_MAX_CATALOG_DBS = 256;
const DEFAULT_ROLE_CONNECTION_LIMIT = 64;
const DEFAULT_WORK_MEM = '4MB';
const SAFE_PG_MEMORY_RE = /^\d+(?:kB|MB|GB)$/i;

export interface CatalogPgConfig {
  /** Unix domain socket directory (preferred in Helm/Docker, e.g. `/var/run/sql-catalog-pg`). */
  socketDir?: string;
  /** TCP host fallback (used in CI service containers or local TCP Postgres). */
  host?: string;
  /** PostgreSQL port (default 5432; also selects `.s.PGSQL.<port>` on Unix sockets). */
  port: number;
  /** Internal admin user for template/DB/role management. */
  adminUser: string;
  /** Internal admin password (optional when local Unix socket uses `trust`). */
  adminPassword?: string;
  /** Maintenance database (default `postgres`). */
  maintenanceDb: string;
  /** Template database name (default `classifyre_tpl`). */
  templateDb: string;
  /** Per-role `statement_timeout` in ms (default 15_000). */
  statementTimeoutMs: number;
  /** Per-role `work_mem` setting (default `'4MB'`). */
  workMem: string;
  /** Per-role `CONNECTION LIMIT` (default 64). */
  roleConnectionLimit: number;
  /** Idle TTL before an unused catalog database is dropped (default 30 min). */
  dbTtlMs: number;
  /** Grace window before a superseded catalog database is dropped (default 2 min). */
  supersededGraceMs: number;
  /** Maximum number of live catalog databases tracked per gateway pod (default 256). */
  maxCatalogDbs: number;
  /** Sweeper interval in ms (default 60_000; 0 disables automatic timer). */
  sweepIntervalMs: number;
  /** Whether to drop orphan `c_*`/`r_*` objects on startup (default true). */
  reconcileOrphansOnStartup: boolean;
  /** Whether to revoke `CONNECT`/`TEMP` from `PUBLIC` on `postgres` and `template1` (default true). */
  lockdownDefaultDbs: boolean;
}

export function sanitizeWorkMem(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed && SAFE_PG_MEMORY_RE.test(trimmed)) return trimmed;
  return DEFAULT_WORK_MEM;
}

export function catalogPgConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): CatalogPgConfig {
  const socketDir = env.SQL_GATEWAY_CATALOG_PG_SOCKET?.trim() || undefined;
  const host =
    env.SQL_GATEWAY_CATALOG_PG_HOST?.trim() ||
    (socketDir ? undefined : '127.0.0.1');
  const maxSessions = Number(env.SQL_GATEWAY_MAX_SESSIONS) || 64;
  return {
    socketDir,
    host,
    port: Number(env.SQL_GATEWAY_CATALOG_PG_PORT) || 5432,
    adminUser: env.SQL_GATEWAY_CATALOG_PG_USER?.trim() || 'classifyre_catalog',
    adminPassword: env.SQL_GATEWAY_CATALOG_PG_PASSWORD,
    maintenanceDb: env.SQL_GATEWAY_CATALOG_PG_DATABASE?.trim() || 'postgres',
    templateDb: DEFAULT_TEMPLATE_DB,
    statementTimeoutMs:
      (Number(env.SQL_GATEWAY_CATALOG_STATEMENT_SECONDS) ||
        DEFAULT_CATALOG_STATEMENT_SECONDS) * 1000,
    workMem: sanitizeWorkMem(env.SQL_GATEWAY_CATALOG_WORK_MEM),
    roleConnectionLimit:
      Number(env.SQL_GATEWAY_CATALOG_ROLE_CONNECTION_LIMIT) ||
      Math.max(DEFAULT_ROLE_CONNECTION_LIMIT, maxSessions),
    dbTtlMs:
      (Number(env.SQL_GATEWAY_CATALOG_DB_TTL_MINUTES) ||
        DEFAULT_CATALOG_DB_TTL_MINUTES) * 60_000,
    supersededGraceMs:
      (Number(env.SQL_GATEWAY_CATALOG_SUPERSEDED_GRACE_SECONDS) || 120) *
        1000 || DEFAULT_SUPERSEDED_GRACE_MS,
    maxCatalogDbs:
      Number(env.SQL_GATEWAY_MAX_CATALOG_DBS) || DEFAULT_MAX_CATALOG_DBS,
    sweepIntervalMs: DEFAULT_SWEEP_MS,
    reconcileOrphansOnStartup: true,
    lockdownDefaultDbs: true,
  };
}

export function connectCatalogSocket(config: CatalogPgConfig): Socket {
  if (config.socketDir) {
    return createConnection(join(config.socketDir, `.s.PGSQL.${config.port}`));
  }
  return createConnection({
    host: config.host ?? '127.0.0.1',
    port: config.port,
  });
}

export function pgClientConfig(
  config: CatalogPgConfig,
  database: string,
): {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
} {
  return {
    host: config.socketDir ?? config.host ?? '127.0.0.1',
    port: config.port,
    user: config.adminUser,
    ...(config.adminPassword !== undefined
      ? { password: config.adminPassword }
      : {}),
    database,
  };
}

export function isConnectionResetError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  if (
    err.code &&
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'EPIPE',
      'ENOENT',
      '57P01',
      '57P02',
      '57P03',
    ].includes(err.code)
  ) {
    return true;
  }
  const msg = String(err.message ?? '');
  return /terminating connection|Connection terminated|socket closed|ECONNREFUSED|ECONNRESET|ENOENT/i.test(
    msg,
  );
}
