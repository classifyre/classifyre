import { createHmac } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { assertDatabaseKind, databaseKindDdl } from './database-kind';
import { withDatabase } from './database-mode';
import { publicConnectionString } from './registry/namespace-registry.sql';

/**
 * With sign-in, each tenant's workspace data is in its own database
 * (docs/prd/TEN §4.1): its workspace schemas `ns_<uuid>` and their pg-boss
 * schemas. The control database keeps the tenants, their grants and the list
 * of workspaces, which is what every process reads to find a workspace.
 *
 * A tenant database and its login role share one name, made from the tenant
 * id, so renaming a tenant never renames a database. The role's password is
 * derived from `CLASSIFYRE_TENANT_DATABASE_KEY`; the open-mode API never has
 * that key. Each tenant role can connect to its own database only.
 */
export function tenantDatabaseName(tenantId: string): string {
  return `classifyre_t_${tenantId.replace(/-/g, '').toLowerCase()}`;
}

function tenantDatabaseKey(env: NodeJS.ProcessEnv): string {
  const key = env.CLASSIFYRE_TENANT_DATABASE_KEY?.trim();
  if (!key) {
    throw new Error(
      'Sign-in keeps each tenant in its own database and needs CLASSIFYRE_TENANT_DATABASE_KEY for their passwords; the chart sets it.',
    );
  }
  return key;
}

export function tenantDatabasePassword(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return createHmac('sha256', tenantDatabaseKey(env))
    .update(`tenant-database:${name}`)
    .digest('base64url');
}

/**
 * What a pooler that serves many projects needs after a role's name to know
 * which project it is for: Supavisor (Supabase's pooler) routes a login by a
 * `<role>.<project>` username, and refuses a bare role ("no tenant
 * identifier provided"). Taken from the configured user (`postgres.<project>`)
 * on Supabase's pooler hosts, or set with `CLASSIFYRE_DATABASE_USER_SUFFIX`
 * for another such pooler. Empty for a plain Postgres or PgBouncer.
 */
export function databaseUserSuffix(
  configured: URL,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.CLASSIFYRE_DATABASE_USER_SUFFIX?.trim();
  if (explicit) return explicit.startsWith('.') ? explicit : `.${explicit}`;
  if (!/\.pooler\.supabase\.com$/i.test(configured.hostname)) return '';
  const user = decodeURIComponent(configured.username);
  const dot = user.indexOf('.');
  return dot > 0 ? user.slice(dot) : '';
}

/** The tenant's database, logged in as the tenant's role. */
export function tenantDatabaseUrl(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const name = tenantDatabaseName(tenantId);
  const url = new URL(withDatabase(publicConnectionString(), name));
  url.username = `${name}${databaseUserSuffix(url, env)}`;
  url.password = tenantDatabasePassword(name, env);
  return url.toString();
}

/** The tenant's database, logged in as the provisioner (the configured user). */
function tenantDatabaseAdminUrl(tenantId: string): string {
  return withDatabase(publicConnectionString(), tenantDatabaseName(tenantId));
}

/** Tenant of each workspace schema this process has seen in the registry. */
const workspaceTenants = new Map<string, string>();

/**
 * Called for every workspace read from the registry, which is how every
 * process comes to know a workspace, so {@link workspaceDatabaseUrl} can
 * answer synchronously when a pool is built.
 */
export function rememberWorkspace(schemaName: string, tenantId: string): void {
  workspaceTenants.set(schemaName, tenantId);
}

/**
 * Connection string for a workspace schema: its tenant's database. Never falls back to the control
 * database: a workspace whose tenant is unknown here is an error.
 */
export function workspaceDatabaseUrl(schemaName: string): string {
  const tenantId = workspaceTenants.get(schemaName);
  if (!tenantId) {
    throw new Error(
      `No tenant is known for workspace schema '${schemaName}'; workspaces are opened through the registry.`,
    );
  }
  return tenantDatabaseUrl(tenantId);
}

export function forgetWorkspacesForTests(): void {
  workspaceTenants.clear();
}

/**
 * Creates the tenant's role and database, or brings an existing one in line
 * (its password follows the key, so rotating the key and restarting rotates
 * every tenant's password). Idempotent; run before a tenant's first workspace
 * and on every boot. `control` is a pool on the control database, as the
 * configured user, which needs `CREATEDB` and `CREATEROLE` and must be able
 * to create the `vector` extension (§8).
 */
export async function provisionTenantDatabase(
  control: Pick<Pool, 'query'>,
  tenantId: string,
): Promise<string> {
  const name = tenantDatabaseName(tenantId);
  const password = tenantDatabasePassword(name);
  const literal = `'${password.replace(/'/g, "''")}'`;
  const role = await control.query(
    'SELECT 1 FROM pg_roles WHERE rolname = $1',
    [name],
  );
  await control.query(
    role.rowCount
      ? `ALTER ROLE "${name}" WITH LOGIN PASSWORD ${literal}`
      : `CREATE ROLE "${name}" WITH LOGIN PASSWORD ${literal}`,
  );
  // Since PostgreSQL 16 a user that is not a superuser — every managed
  // Postgres, and the CI database — can only make a database owned by a role
  // it can SET ROLE to ("must be able to SET ROLE"). It created the role, so
  // it may grant the role to itself. A superuser needs no grant, and one that
  // cannot be given (a role made by someone else) leaves CREATE DATABASE to
  // report the real problem.
  try {
    await control.query(`GRANT "${name}" TO CURRENT_USER`);
  } catch {
    /* see above */
  }
  const database = await control.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [name],
  );
  if (!database.rowCount) {
    try {
      await control.query(`CREATE DATABASE "${name}" OWNER "${name}"`);
    } catch (error) {
      if ((error as { code?: string }).code !== '42P04') throw error;
    }
  }
  await control.query(
    `REVOKE CONNECT, TEMPORARY ON DATABASE "${name}" FROM PUBLIC`,
  );

  const admin = new Client({
    connectionString: tenantDatabaseAdminUrl(tenantId),
  });
  await admin.connect();
  try {
    // Not a trusted extension, so the tenant role could not create it.
    await admin.query(
      'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public',
    );
    await admin.query(databaseKindDdl('tenant', tenantId));
    await assertDatabaseKind(admin, 'tenant', tenantId);
  } finally {
    await admin.end().catch(() => undefined);
  }

  await control.query(
    `UPDATE iam_tenants
        SET database_name = $2, database_ready_at = COALESCE(database_ready_at, now())
      WHERE id = $1`,
    [tenantId, name],
  );
  return name;
}

/** Drops the tenant's database and role, with everything in it. */
export async function dropTenantDatabase(
  control: Pick<Pool, 'query'>,
  tenantId: string,
): Promise<void> {
  const name = tenantDatabaseName(tenantId);
  await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await control.query(`DROP ROLE IF EXISTS "${name}"`);
  await control.query(
    'UPDATE iam_tenants SET database_ready_at = NULL WHERE id = $1',
    [tenantId],
  );
}
