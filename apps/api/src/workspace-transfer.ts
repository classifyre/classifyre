import { randomUUID } from 'node:crypto';
import { Client, type Pool } from 'pg';
import { prepareOpenDatabase } from './database-migrations';
import { LOCAL_TENANT_ID } from './identity/tenancy.sql';
import {
  pgBossSchemaForId,
  schemaForId,
} from './namespace/namespace.constants';
import { DEFAULT_CATEGORY_ID } from './registry/namespace-registry.sql';
import {
  provisionTenantDatabase,
  rememberWorkspace,
  tenantDatabaseUrl,
} from './tenant-databases';
import { copyWorkspaceSchema } from './workspace-copy';

/**
 * Moving workspaces between the open database and tenant databases
 * (docs/prd/TEN §4.9), for the operator command and the Platform page.
 * Every move is a copy: the registry row is written as `provisioning`, the
 * schema is copied, then the row goes live. Copies into a tenant keep the
 * source, so an operator deletes it once satisfied; `tenants split` removes
 * what it copied.
 */
export class TransferError extends Error {}

export interface TransferredWorkspace {
  id: string;
  slug: string;
  rows: number;
}

type Log = (message: string) => void;

interface Databases {
  /** The control database (sign-in), as the configured user. */
  control: Pool;
  /** The open database, as the configured user. */
  open: Pool;
  openUrl: string;
  log?: Log;
}

async function columnsOf(pool: Pool, table: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

function sqlValue(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Inserts rows read from one database into the same table of another,
 * with the columns both have, skipping rows that are already there.
 */
async function insertRows(
  target: Pool,
  table: string,
  rows: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  if (!rows.length) return;
  const columns = [...(await columnsOf(target, table))];
  for (const row of rows) {
    const merged = { ...row, ...overrides };
    const present = columns.filter((column) => column in merged);
    await target.query(
      `INSERT INTO public.${table} (${present.map((c) => `"${c}"`).join(', ')})
       VALUES (${present.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT DO NOTHING`,
      present.map((column) => sqlValue(merged[column])),
    );
  }
}

async function tenantByAlias(control: Pool, alias: string) {
  const { rows } = await control.query<{ id: string; alias: string }>(
    'SELECT id, alias FROM iam_tenants WHERE alias = $1 AND deleted_at IS NULL',
    [alias],
  );
  if (!rows[0] || rows[0].id === LOCAL_TENANT_ID) {
    throw new TransferError(
      `No tenant '${alias}'. A tenant appears the first time one of its members signs in, or when an operator creates it.`,
    );
  }
  return rows[0];
}

/**
 * The group a copied workspace is owned by: the one asked for, else the
 * tenant's `admins` group as long as it still holds the Tenant admin the
 * bootstrap gave it, else none (tenant-wide roles still reach it).
 */
async function ownerFor(
  control: Pool,
  tenantId: string,
  requested: string | undefined,
): Promise<string | null> {
  if (requested) return requested;
  const { rows } = await control.query<{ subject_id: string }>(
    `SELECT subject_id FROM iam_grants
      WHERE tenant_id = $1 AND subject_type = 'group' AND role_key = 'tenant-admin'
        AND scope_type = 'tenant' AND created_by = 'system:bootstrap'
      LIMIT 1`,
    [tenantId],
  );
  return rows[0]?.subject_id ?? null;
}

async function recordEvent(
  control: Pool,
  tenantId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await control.query(
    `INSERT INTO iam_audit_events (id, tenant_id, actor, action, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), tenantId, actor, action, JSON.stringify(detail)],
  );
}

async function selectRows(
  pool: Pool,
  where: string,
  params: unknown[],
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT * FROM public.namespaces WHERE ${where} ORDER BY slug`,
    params,
  );
  return rows;
}

function missingSlugs(
  rows: Array<Record<string, unknown>>,
  slugs: string[] | 'all',
): string[] {
  if (slugs === 'all') return [];
  const found = new Set(rows.map((row) => row.slug as string));
  return slugs.filter((slug) => !found.has(slug));
}

/**
 * Writes the registry row as `provisioning`, copies the schema, then sets
 * the row's final status. On failure the row and the copied schema go.
 */
async function copyOne(options: {
  row: Record<string, unknown>;
  /**
   * A copy between the open database and a tenant is a new workspace with a
   * new id (the original may still be in the target's registry, after a copy
   * out and back); the split keeps ids, so grants and activity still match.
   */
  newId: boolean;
  from: { url: string };
  to: { pool: Pool; url: string };
  overrides: Record<string, unknown>;
  status: string;
  log: Log;
}): Promise<TransferredWorkspace> {
  const { row, from, to, overrides, status, log } = options;
  const id = options.newId ? randomUUID() : (row.id as string);
  const slug = row.slug as string;
  const schema = row.schema_name as string;
  // Kept with the id: older workspaces have schemas not named after it.
  const targetSchema = options.newId ? schemaForId(id) : schema;
  if (typeof overrides.tenant_id === 'string') {
    rememberWorkspace(targetSchema, overrides.tenant_id);
  }
  await insertRows(to.pool, 'namespaces', [row], {
    ...overrides,
    id,
    schema_name: targetSchema,
    status: 'provisioning',
  });
  const written = await to.pool.query(
    `SELECT 1 FROM namespaces WHERE id = $1 AND status = 'provisioning'`,
    [id],
  );
  if (!written.rowCount) {
    throw new TransferError(
      `Workspace ${slug} (or its address) already exists in the target; nothing was copied.`,
    );
  }
  await to.pool.query(
    `INSERT INTO namespace_category_members (namespace_id, category_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, DEFAULT_CATEGORY_ID],
  );
  try {
    log(`Copying ${slug} (${schema})`);
    const result = await copyWorkspaceSchema({
      schema,
      targetSchema,
      sourceUrl: from.url,
      targetUrl: to.url,
      log,
    });
    await to.pool.query(
      'UPDATE namespaces SET status = $2, updated_at = now() WHERE id = $1',
      [id, status],
    );
    return { id, slug, rows: result.rows };
  } catch (error) {
    await to.pool
      .query('DELETE FROM namespaces WHERE id = $1', [id])
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Copies workspaces made without sign-in into a tenant's database. The open
 * database keeps them. Workspace grants and categories are not copied: the
 * copy starts with the tenant's own roles, filed under the default category.
 */
export async function copyLocalWorkspacesToTenant(
  db: Databases,
  request: {
    alias: string;
    slugs: string[] | 'all';
    ownerGroupId?: string;
    actor: string;
  },
): Promise<TransferredWorkspace[]> {
  const log = db.log ?? (() => undefined);
  await prepareOpenDatabase(db.open);
  const tenant = await tenantByAlias(db.control, request.alias);
  const rows = await selectRows(
    db.open,
    `tenant_id = $1 AND status = 'active' AND ($2::text[] IS NULL OR slug = ANY($2))`,
    [LOCAL_TENANT_ID, request.slugs === 'all' ? null : request.slugs],
  );
  const missing = missingSlugs(rows, request.slugs);
  if (missing.length) {
    throw new TransferError(
      `No workspace ${missing.join(', ')} in the open database.`,
    );
  }
  await provisionTenantDatabase(db.control, tenant.id);
  const owner = await ownerFor(db.control, tenant.id, request.ownerGroupId);
  const copied: TransferredWorkspace[] = [];
  for (const row of rows) {
    const result = await copyOne({
      row,
      from: { url: db.openUrl },
      to: { pool: db.control, url: tenantDatabaseUrl(tenant.id) },
      overrides: { tenant_id: tenant.id, owner_group_id: owner },
      newId: true,
      status: 'active',
      log,
    });
    await recordEvent(
      db.control,
      tenant.id,
      request.actor,
      'workspace.copied_in',
      {
        namespaceId: result.id,
        slug: result.slug,
        from: 'local',
        to: tenant.alias,
        ownerGroupId: owner,
      },
    );
    copied.push(result);
  }
  return copied;
}

/**
 * Copies a tenant's workspaces into the open database, so they can be opened
 * without sign-in. The tenant keeps them.
 */
export async function copyTenantWorkspacesToLocal(
  db: Databases,
  request: { slugs: string[]; actor: string },
): Promise<TransferredWorkspace[]> {
  const log = db.log ?? (() => undefined);
  await prepareOpenDatabase(db.open);
  const rows = await selectRows(
    db.control,
    `tenant_id <> $1 AND status = 'active' AND slug = ANY($2)`,
    [LOCAL_TENANT_ID, request.slugs],
  );
  const missing = missingSlugs(rows, request.slugs);
  if (missing.length) {
    throw new TransferError(`No tenant workspace ${missing.join(', ')}.`);
  }
  const copied: TransferredWorkspace[] = [];
  for (const row of rows) {
    const tenantId = row.tenant_id as string;
    const result = await copyOne({
      row,
      from: { url: tenantDatabaseUrl(tenantId) },
      to: { pool: db.open, url: db.openUrl },
      overrides: { tenant_id: LOCAL_TENANT_ID, owner_group_id: null },
      newId: true,
      status: 'active',
      log,
    });
    await recordEvent(
      db.control,
      tenantId,
      request.actor,
      'workspace.copied_out',
      {
        namespaceId: result.id,
        slug: result.slug,
        to: 'local',
      },
    );
    copied.push(result);
  }
  return copied;
}

/** Tables that hold one tenant's rows, copied with the tenant. */
const TENANT_TABLES = [
  'iam_grants',
  'iam_audit_events',
  'namespace_categories',
] as const;

/**
 * The one-off move of installations that turned sign-in on before tenants had
 * their own databases (docs/prd/TEN §4.9): their tenants, grants, people and
 * activity go to the control database, each tenant workspace (soft-deleted
 * ones too) to its tenant's database. Workspaces made without sign-in stay,
 * and the database becomes the open one. Safe to run again after a failure:
 * what was copied is skipped, a half-copied workspace is copied again.
 */
export async function splitTenants(
  db: Databases,
  options: { keepSource: boolean },
): Promise<TransferredWorkspace[]> {
  const log = db.log ?? (() => undefined);
  await prepareOpenDatabase(db.open);
  const { rows: tenants } = await db.open.query<Record<string, unknown>>(
    `SELECT * FROM iam_tenants WHERE id <> $1 ORDER BY created_at`,
    [LOCAL_TENANT_ID],
  );
  for (const tenant of tenants) {
    const id = tenant.id as string;
    const { rows: clash } = await db.control.query<{ id: string }>(
      `SELECT id FROM iam_tenants
        WHERE id <> $1 AND (alias = $2 OR org_id = $3)`,
      [id, tenant.alias, tenant.org_id],
    );
    for (const other of clash) {
      // Made in the control database when a member signed in before the split.
      const used = await db.control.query(
        'SELECT 1 FROM namespaces WHERE tenant_id = $1 LIMIT 1',
        [other.id],
      );
      if (used.rowCount) {
        throw new TransferError(
          `Tenant ${String(tenant.alias)} already has workspaces in the control database under another id; split it by hand.`,
        );
      }
      await db.control.query('DELETE FROM iam_tenants WHERE id = $1', [
        other.id,
      ]);
    }
    await insertRows(db.control, 'iam_tenants', [tenant], {
      database_name: null,
      database_ready_at: null,
      migrated_at: null,
      migration_error: null,
    });
    for (const table of TENANT_TABLES) {
      const { rows } = await db.open.query<Record<string, unknown>>(
        `SELECT * FROM public.${table} WHERE tenant_id = $1`,
        [id],
      );
      await insertRows(db.control, table, rows);
    }
  }
  const { rows: principals } = await db.open.query<Record<string, unknown>>(
    'SELECT * FROM iam_principals',
  );
  await insertRows(db.control, 'iam_principals', principals);

  const workspaces = await selectRows(
    db.open,
    `tenant_id <> $1 AND status IN ('active', 'deleted', 'provisioning')`,
    [LOCAL_TENANT_ID],
  );
  const moved: TransferredWorkspace[] = [];
  for (const row of workspaces) {
    const id = row.id as string;
    const tenantId = row.tenant_id as string;
    const schema = row.schema_name as string;
    const { rows: there } = await db.control.query<{ status: string }>(
      'SELECT status FROM namespaces WHERE id = $1',
      [id],
    );
    rememberWorkspace(schema, tenantId);
    await provisionTenantDatabase(db.control, tenantId);
    const tenantUrl = tenantDatabaseUrl(tenantId);
    if (there[0]?.status === 'provisioning') {
      // A copy that did not finish: start it over.
      const target = new Client({ connectionString: tenantUrl });
      await target.connect();
      await target
        .query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        .finally(() => target.end());
      await db.control.query('DELETE FROM namespaces WHERE id = $1', [id]);
    }
    if (!there[0] || there[0].status === 'provisioning') {
      const result = await copyOne({
        row,
        from: { url: db.openUrl },
        to: { pool: db.control, url: tenantUrl },
        overrides: {},
        newId: false,
        status:
          row.status === 'provisioning' ? 'active' : (row.status as string),
        log,
      });
      const { rows: members } = await db.open.query<Record<string, unknown>>(
        'SELECT * FROM namespace_category_members WHERE namespace_id = $1',
        [id],
      );
      await insertRows(db.control, 'namespace_category_members', members);
      moved.push(result);
    } else {
      log(`Already copied: ${String(row.slug)}`);
    }
    if (!options.keepSource) {
      await db.open.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.open.query(
        `DROP SCHEMA IF EXISTS "${pgBossSchemaForId(id)}" CASCADE`,
      );
      await db.open.query('DELETE FROM namespaces WHERE id = $1', [id]);
    }
  }

  if (!options.keepSource) {
    const ids = tenants.map((tenant) => tenant.id as string);
    for (const table of TENANT_TABLES) {
      await db.open.query(
        `DELETE FROM public.${table} WHERE tenant_id = ANY($1::uuid[])`,
        [ids],
      );
    }
    await db.open.query('DELETE FROM iam_tenants WHERE id = ANY($1::uuid[])', [
      ids,
    ]);
    await db.open.query('DELETE FROM iam_principals');
  }
  return moved;
}
