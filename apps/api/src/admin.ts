/**
 * Operator commands, run inside an API pod or the all-in-one container
 * (docs/prd/TEN §4.9):
 *
 *   node dist/src/admin.js workspaces list
 *   node dist/src/admin.js workspaces copy --to-tenant <alias> (--all | <slug>...) [--owner-group <id>]
 *   node dist/src/admin.js workspaces create --tenant <alias> --slug <slug> [--name <name>] [--owner-group <id>]
 *
 * Classifyre runs on its control database and one database per tenant.
 * Workspaces made by installs from before sign-in was always on stay in their
 * open database until copied into a tenant; every copy is in the tenant's
 * activity.
 */
import { Pool } from 'pg';
import { ensureNamespaceRegistry } from './database-migrations';
import { openDatabaseUrl, selectDatabaseForMode } from './database-mode';
import { LOCAL_TENANT_ID } from './identity/tenancy.sql';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './registry/namespace-registry.sql';
import { NamespaceRegistryService } from './registry/namespace-registry.service';
import {
  copyLocalWorkspacesToTenant,
  ownerFor,
  recordEvent,
  tenantByAlias,
  TransferError,
} from './workspace-transfer';

const ACTOR = 'system:operator';

export class UsageError extends Error {}

export interface CopyRequest {
  tenant: string;
  /** Slugs, or every workspace made without sign-in. */
  slugs: string[] | 'all';
  ownerGroupId?: string;
}

export function parseCopy(args: string[]): CopyRequest {
  let tenant: string | undefined;
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
    if (arg === '--to-tenant') tenant = value();
    else if (arg === '--owner-group') ownerGroupId = value();
    else if (arg === '--all') all = true;
    else if (arg.startsWith('--'))
      throw new UsageError(`Unknown option ${arg}`);
    else slugs.push(arg.toLowerCase());
  }
  if (!tenant) throw new UsageError('Say where to: --to-tenant <alias>');
  if (all === slugs.length > 0) {
    throw new UsageError('Name the workspaces, or pass --all');
  }
  return { tenant, slugs: all ? 'all' : slugs, ownerGroupId };
}

export interface CreateRequest {
  tenant: string;
  slug: string;
  name: string;
  ownerGroupId?: string;
}

export function parseCreate(args: string[]): CreateRequest {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--tenant', '--slug', '--name', '--owner-group'].includes(arg)) {
      throw new UsageError(`Unknown option ${arg}`);
    }
    const next = args[++i];
    if (!next || next.startsWith('--')) {
      throw new UsageError(`${arg} needs a value`);
    }
    options.set(arg, next);
  }
  const tenant = options.get('--tenant');
  const slug = options.get('--slug')?.toLowerCase();
  if (!tenant || !slug) {
    throw new UsageError('workspaces create needs --tenant and --slug');
  }
  return {
    tenant,
    slug,
    name: options.get('--name') ?? slug,
    ownerGroupId: options.get('--owner-group'),
  };
}

function pool(url: string): Pool {
  return new Pool({
    connectionString: url,
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 2,
  });
}

async function listWorkspaces(control: Pool, open: Pool | null): Promise<void> {
  const lines: Array<[string, string, string]> = [];
  for (const [db, label] of [
    [open, 'open'],
    [control, 'control'],
  ] as const) {
    if (!db) continue;
    const { rows } = await db.query<{
      slug: string;
      alias: string;
      status: string;
      tenant_id: string;
    }>(
      `SELECT n.slug, t.alias, n.status, n.tenant_id
         FROM namespaces n JOIN iam_tenants t ON t.id = n.tenant_id
        WHERE n.status <> 'deleted'
        ORDER BY t.alias, n.slug`,
    );
    for (const row of rows) {
      const where =
        label === 'control'
          ? `tenant ${row.alias}`
          : row.tenant_id === LOCAL_TENANT_ID
            ? 'open database, made without sign-in (copy it into a tenant)'
            : `tenant ${row.alias}, left in the open database`;
      lines.push([
        row.slug,
        where,
        row.status === 'active' ? '' : `  (${row.status})`,
      ]);
    }
  }
  const width = Math.max(9, ...lines.map(([slug]) => slug.length));
  console.log(`${'workspace'.padEnd(width)}  where`);
  for (const [slug, where, extra] of lines) {
    console.log(`${slug.padEnd(width)}  ${where}${extra}`);
  }
}

const USAGE = `Usage:
  node dist/src/admin.js workspaces list
  node dist/src/admin.js workspaces copy --to-tenant <alias> (--all | <slug>...) [--owner-group <id>]
  node dist/src/admin.js workspaces create --tenant <alias> --slug <slug> [--name <name>] [--owner-group <id>]`;

/** Creates an empty workspace in a tenant, owned by its admins unless told. */
async function createWorkspace(
  control: Pool,
  request: CreateRequest,
): Promise<void> {
  const tenant = await tenantByAlias(control, request.tenant);
  const existing = await control.query(
    `SELECT 1 FROM namespaces WHERE slug = $1 AND status <> 'deleted'`,
    [request.slug],
  );
  if (existing.rowCount) {
    console.log(`Workspace ${request.slug} already exists.`);
    return;
  }
  const owner = await ownerFor(control, tenant.id, request.ownerGroupId);
  if (!owner) {
    throw new UsageError(
      `Tenant ${tenant.alias} has no admins group yet; pass --owner-group <id>.`,
    );
  }
  const registry = new NamespaceRegistryService();
  try {
    const created = await registry.create(
      { name: request.name, slug: request.slug },
      { tenantId: tenant.id, ownerGroupId: owner },
    );
    await recordEvent(control, tenant.id, ACTOR, 'workspace.created', {
      namespaceId: created.id,
      slug: created.slug,
      ownerGroupId: owner,
    });
    console.log(`Created ${created.slug} in tenant ${tenant.alias}.`);
  } finally {
    await registry.onModuleDestroy();
  }
}

async function main(argv: string[]): Promise<void> {
  const [area, command, ...rest] = argv;
  const known =
    area === 'workspaces' && ['list', 'copy', 'create'].includes(command ?? '');
  if (!known) throw new UsageError(USAGE);
  const copy = command === 'copy' ? parseCopy(rest) : null;
  const create = command === 'create' ? parseCreate(rest) : null;

  // `kubectl exec` skips the container's start script, which is what builds
  // DATABASE_URL from the chart's DB_* variables.
  const env = process.env;
  if (!env.DATABASE_URL && env.DB_HOST) {
    const user = encodeURIComponent(env.DB_USER ?? '');
    const password = encodeURIComponent(env.DB_PASSWORD ?? '');
    env.DATABASE_URL = `postgresql://${user}:${password}@${env.DB_HOST}:${env.DB_PORT ?? '5432'}/${env.DB_NAME ?? ''}?sslmode=${env.DB_SSLMODE ?? 'prefer'}`;
  }
  selectDatabaseForMode();
  await ensureNamespaceRegistry();

  const openUrl = openDatabaseUrl();
  const control = pool(publicConnectionString());
  const open = openUrl ? pool(openUrl) : null;
  try {
    if (command === 'list') return await listWorkspaces(control, open);
    if (create) return await createWorkspace(control, create);
    if (!copy) return;
    if (!open || !openUrl) {
      throw new UsageError(
        'The open database is not known here; set CLASSIFYRE_OPEN_DATABASE to its name.',
      );
    }
    const copied = await copyLocalWorkspacesToTenant(
      { control, open, openUrl, log: console.log },
      {
        alias: copy.tenant,
        slugs: copy.slugs,
        ownerGroupId: copy.ownerGroupId,
        actor: ACTOR,
      },
    );
    if (!copied.length) console.log(`Nothing to copy to ${copy.tenant}.`);
    for (const workspace of copied) {
      console.log(
        `Copied ${workspace.slug} to ${copy.tenant} (${workspace.rows} rows)`,
      );
    }
    if (copied.length) {
      console.log(
        'Running API pods show the copies within a minute. The originals are kept; delete them once you are satisfied.',
      );
    }
  } finally {
    await Promise.all([control.end(), open?.end()]);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(
      error instanceof UsageError || error instanceof TransferError ? 2 : 1,
    );
  });
}
