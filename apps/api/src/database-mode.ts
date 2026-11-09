import { Client } from 'pg';
import { iamEnabled } from './identity/iam-config';

/**
 * Which database a process works on (docs/prd/TEN §4.2). Without sign-in it
 * is the configured one, the open database. With sign-in it is the control
 * database next to it, so turning sign-in on or off switches databases rather
 * than reinterpreting one: the open database never shows a tenant, and a
 * tenant's data is never in the open database.
 */
export const DEFAULT_CONTROL_DATABASE = 'classifyre_control';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/** The configured database, before sign-in pointed the process elsewhere. */
let configuredUrl: string | null = null;

export function controlDatabaseName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const name =
    env.CLASSIFYRE_CONTROL_DATABASE?.trim() || DEFAULT_CONTROL_DATABASE;
  if (!IDENTIFIER.test(name)) {
    throw new Error(
      `CLASSIFYRE_CONTROL_DATABASE must be a lower-case Postgres name (got ${JSON.stringify(name)}).`,
    );
  }
  return name;
}

/** The URL with another database name, same server and credentials. */
export function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  next.searchParams.delete('schema');
  return next.toString();
}

function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/**
 * Points `DATABASE_URL` at the control database when sign-in is on. Every
 * entry point calls it before anything connects (the API, the migration init
 * container, the operator command); calling it again is a no-op.
 */
export function selectDatabaseForMode(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!iamEnabled(env) || !env.DATABASE_URL) return;
  const control = controlDatabaseName(env);
  if (databaseOf(env.DATABASE_URL) === control) return;
  configuredUrl ??= env.DATABASE_URL;
  env.DATABASE_URL = withDatabase(env.DATABASE_URL, control);
}

/**
 * The open database, as seen from a process with sign-in on, for the one
 * thing that reads it: an operator copying workspaces made without sign-in
 * into a tenant. Null when the deployment points straight at the control
 * database and names no open one.
 */
export function openDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!iamEnabled(env)) return env.DATABASE_URL ?? null;
  const named = env.CLASSIFYRE_OPEN_DATABASE?.trim();
  if (named && env.DATABASE_URL) return withDatabase(env.DATABASE_URL, named);
  return configuredUrl
    ? withDatabase(configuredUrl, databaseOf(configuredUrl))
    : null;
}

/**
 * Creates the control database on first start with sign-in. The database
 * user needs `CREATEDB` for this, and later for tenant databases (§4.5).
 */
export async function ensureControlDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!iamEnabled(env) || !env.DATABASE_URL) return;
  const url = env.DATABASE_URL;
  const name = databaseOf(url);
  const probe = new Client({ connectionString: url });
  let exists = true;
  try {
    await probe.connect();
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error;
    exists = false;
  } finally {
    await probe.end().catch(() => undefined);
  }

  const maintenance = new Client({
    connectionString: withDatabase(url, exists ? name : 'postgres'),
  });
  await maintenance.connect();
  try {
    if (!exists) {
      try {
        await maintenance.query(`CREATE DATABASE "${name}"`);
      } catch (error) {
        // Another pod created it first.
        if ((error as { code?: string }).code !== '42P04') throw error;
      }
    }
    // Tenant roles log in to their own database only (docs/prd/TEN R7):
    // not to this one, nor to the open one next to it.
    const open = openDatabaseUrl(env);
    for (const database of [name, open ? databaseOf(open) : null]) {
      if (!database) continue;
      await maintenance
        .query(
          `REVOKE CONNECT, TEMPORARY ON DATABASE "${database}" FROM PUBLIC`,
        )
        .catch(() => undefined);
    }
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}
