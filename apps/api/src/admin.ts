/**
 * Operator commands, run inside an API pod (docs/prd/TEN §6):
 *
 *   node dist/src/admin.js workspaces list
 *   node dist/src/admin.js workspaces move --to-tenant <alias> (--all | <slug>...) [--owner-group <id>]
 *   node dist/src/admin.js workspaces move --to-local (--from <alias> --all | <slug>...)
 *
 * Workspaces made without sign-in reach a tenant only through this command,
 * never by turning sign-in on, and a tenant's workspaces open without sign-in
 * only once moved back to `local`. Talks to the database directly, so it works
 * whether sign-in is on or off; every move is in the tenant's activity.
 */
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { LOCAL_TENANT_ID } from './identity/tenancy.sql';
import {
  DEFAULT_CATEGORY_ID,
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './registry/namespace-registry.sql';

const ACTOR = 'system:operator';

export class UsageError extends Error {}

interface Workspace {
  id: string;
  slug: string;
  tenantId: string;
  alias: string;
}

export interface MoveRequest {
  to: { tenant: string } | 'local';
  /** Slugs, or every workspace of the source. */
  slugs: string[] | 'all';
  /** With `--to-local --all`: the tenant to empty. */
  from?: string;
  ownerGroupId?: string;
}

export function parseMove(args: string[]): MoveRequest {
  let to: MoveRequest['to'] | undefined;
  let from: string | undefined;
  let ownerGroupId: string | undefined;
  let all = false;
  const slugs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (!next || next.startsWith('--')) {
        throw new UsageError(`${arg} needs a value`);
      }
      return next;
    };
    if (arg === '--to-tenant') to = { tenant: value() };
    else if (arg === '--to-local') to = 'local';
    else if (arg === '--from') from = value();
    else if (arg === '--owner-group') ownerGroupId = value();
    else if (arg === '--all') all = true;
    else if (arg.startsWith('--'))
      throw new UsageError(`Unknown option ${arg}`);
    else slugs.push(arg.toLowerCase());
  }
  if (!to)
    throw new UsageError('Say where to: --to-tenant <alias> or --to-local');
  if (to !== 'local' && to.tenant === 'local') {
    throw new UsageError("Use --to-local for the 'local' tenant");
  }
  if (all === slugs.length > 0) {
    throw new UsageError('Name the workspaces, or pass --all');
  }
  if (to === 'local' && all && !from) {
    throw new UsageError('--to-local --all needs --from <alias>');
  }
  if (to !== 'local' && from) {
    throw new UsageError(
      "--from is only for --to-local: workspaces reach a tenant only from 'local'",
    );
  }
  if (to === 'local' && ownerGroupId) {
    throw new UsageError("Workspaces in 'local' have no owner group");
  }
  return { to, slugs: all ? 'all' : slugs, from, ownerGroupId };
}

async function tenantByAlias(
  client: PoolClient,
  alias: string,
): Promise<{ id: string; alias: string }> {
  const { rows } = await client.query<{ id: string; alias: string }>(
    'SELECT id, alias FROM iam_tenants WHERE alias = $1',
    [alias],
  );
  if (!rows[0]) {
    throw new UsageError(
      `No tenant '${alias}'. A tenant appears the first time one of its members signs in.`,
    );
  }
  return rows[0];
}

async function selectWorkspaces(
  client: PoolClient,
  request: MoveRequest,
): Promise<Workspace[]> {
  // Workspaces reach a tenant only from `local`, never from another tenant.
  const source =
    request.to === 'local'
      ? request.from
        ? (await tenantByAlias(client, request.from)).id
        : null
      : LOCAL_TENANT_ID;
  const { rows } = await client.query<{
    id: string;
    slug: string;
    tenant_id: string;
    alias: string;
  }>(
    `SELECT n.id, n.slug, n.tenant_id, t.alias
       FROM namespaces n JOIN iam_tenants t ON t.id = n.tenant_id
      WHERE n.status <> 'deleted'
        AND ($1::text[] IS NULL OR n.slug = ANY($1))
        AND ($2::uuid IS NULL OR n.tenant_id = $2)
      ORDER BY n.slug
      FOR UPDATE OF n`,
    [request.slugs === 'all' ? null : request.slugs, source],
  );
  if (request.slugs !== 'all') {
    const found = new Set(rows.map((row) => row.slug));
    const missing = request.slugs.filter((slug) => !found.has(slug));
    if (missing.length) {
      throw new UsageError(
        request.to === 'local'
          ? `No workspace ${missing.join(', ')}`
          : `No workspace ${missing.join(', ')} without sign-in: a workspace moves from one tenant to another only through 'local'`,
      );
    }
  }
  return rows
    .filter((row) =>
      request.to === 'local' ? row.tenant_id !== LOCAL_TENANT_ID : true,
    )
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      tenantId: row.tenant_id,
      alias: row.alias,
    }));
}

/**
 * The group a moved workspace is owned by: the one asked for, else the
 * tenant's `admins` group as long as it still holds the Tenant admin the
 * bootstrap gave it, else none (tenant-wide roles still reach it).
 */
async function ownerFor(
  client: PoolClient,
  tenantId: string,
  requested: string | undefined,
): Promise<string | null> {
  if (requested) return requested;
  const { rows } = await client.query<{ subject_id: string }>(
    `SELECT subject_id FROM iam_grants
      WHERE tenant_id = $1 AND subject_type = 'group' AND role_key = 'tenant-admin'
        AND scope_type = 'tenant' AND created_by = 'system:bootstrap'
      LIMIT 1`,
    [tenantId],
  );
  return rows[0]?.subject_id ?? null;
}

export async function moveWorkspaces(
  pool: Pool,
  request: MoveRequest,
): Promise<Workspace[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target =
      request.to === 'local'
        ? { id: LOCAL_TENANT_ID, alias: 'local' }
        : await tenantByAlias(client, request.to.tenant);
    const workspaces = await selectWorkspaces(client, request);
    const owner =
      request.to === 'local'
        ? null
        : await ownerFor(client, target.id, request.ownerGroupId);
    const ids = workspaces.map((w) => w.id);
    if (ids.length) {
      await client.query(
        `UPDATE namespaces SET tenant_id = $2, owner_group_id = $3, updated_at = now()
          WHERE id = ANY($1)`,
        [ids, target.id, owner],
      );
      // Access given to one workspace was given inside its old tenant.
      await client.query(
        `DELETE FROM iam_grants WHERE scope_type = 'workspace' AND scope_id = ANY($1::text[])`,
        [ids],
      );
      // Filed only under the new tenant's categories; the rest fall back to the default.
      await client.query(
        `DELETE FROM namespace_category_members m
          USING namespace_categories c
          WHERE m.category_id = c.id AND m.namespace_id = ANY($1)
            AND c.tenant_id IS NOT NULL AND c.tenant_id <> $2`,
        [ids, target.id],
      );
      await client.query(
        `INSERT INTO namespace_category_members (namespace_id, category_id)
         SELECT id, $2 FROM unnest($1::uuid[]) AS id
         ON CONFLICT DO NOTHING`,
        [ids, DEFAULT_CATEGORY_ID],
      );
      for (const workspace of workspaces) {
        const events: [string, string][] = [];
        if (workspace.tenantId !== LOCAL_TENANT_ID) {
          events.push([workspace.tenantId, 'workspace.moved_out']);
        }
        if (target.id !== LOCAL_TENANT_ID) {
          events.push([target.id, 'workspace.moved_in']);
        }
        for (const [tenantId, action] of events) {
          await client.query(
            `INSERT INTO iam_audit_events (id, tenant_id, actor, action, detail)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              randomUUID(),
              tenantId,
              ACTOR,
              action,
              JSON.stringify({
                namespaceId: workspace.id,
                slug: workspace.slug,
                from: workspace.alias,
                to: target.alias,
                ownerGroupId: owner,
              }),
            ],
          );
        }
      }
    }
    await client.query('COMMIT');
    return workspaces;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function listWorkspaces(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{
    slug: string;
    alias: string;
    status: string;
    owner_group_id: string | null;
  }>(
    `SELECT n.slug, t.alias, n.status, n.owner_group_id
       FROM namespaces n JOIN iam_tenants t ON t.id = n.tenant_id
      WHERE n.status <> 'deleted'
      ORDER BY t.alias, n.slug`,
  );
  const width = Math.max(9, ...rows.map((row) => row.slug.length));
  console.log(`${'workspace'.padEnd(width)}  tenant`);
  for (const row of rows) {
    const extra = [
      row.status === 'active' ? '' : row.status,
      row.owner_group_id ? `owner ${row.owner_group_id}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `${row.slug.padEnd(width)}  ${row.alias}${extra ? `  (${extra})` : ''}`,
    );
  }
}

const USAGE = `Usage:
  node dist/src/admin.js workspaces list
  node dist/src/admin.js workspaces move --to-tenant <alias> (--all | <slug>...) [--owner-group <id>]
  node dist/src/admin.js workspaces move --to-local (--from <alias> --all | <slug>...)`;

async function main(argv: string[]): Promise<void> {
  const [area, command, ...rest] = argv;
  if (area !== 'workspaces' || !['list', 'move'].includes(command ?? '')) {
    throw new UsageError(USAGE);
  }
  const request = command === 'move' ? parseMove(rest) : null;
  // `kubectl exec` skips the container's start script, which is what builds
  // DATABASE_URL from the chart's DB_* variables.
  const env = process.env;
  if (!env.DATABASE_URL && env.DB_HOST) {
    const user = encodeURIComponent(env.DB_USER ?? '');
    const password = encodeURIComponent(env.DB_PASSWORD ?? '');
    env.DATABASE_URL = `postgresql://${user}:${password}@${env.DB_HOST}:${env.DB_PORT ?? '5432'}/${env.DB_NAME ?? ''}?sslmode=${env.DB_SSLMODE ?? 'prefer'}`;
  }
  const pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 1,
  });
  try {
    if (!request) return await listWorkspaces(pool);
    const moved = await moveWorkspaces(pool, request);
    const to = request.to === 'local' ? 'local' : request.to.tenant;
    if (!moved.length) console.log(`Nothing to move to ${to}.`);
    for (const workspace of moved) {
      console.log(`Moved ${workspace.slug}: ${workspace.alias} → ${to}`);
    }
    if (moved.length) {
      console.log(
        'Running API pods show the change within a minute; the workspaces keep all their data.',
      );
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof UsageError ? 2 : 1);
  });
}
