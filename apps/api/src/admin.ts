/**
 * Operator commands, run inside an API pod (docs/prd/TEN §4.9, §6):
 *
 *   node dist/src/admin.js workspaces list
 *   node dist/src/admin.js workspaces copy --to-tenant <alias> (--all | <slug>...) [--owner-group <id>]
 *   node dist/src/admin.js workspaces copy --to-local <slug>...
 *   node dist/src/admin.js tenants split [--keep-source]
 *
 * Without sign-in the API works on the open database; with sign-in on the
 * control database and one database per tenant. Workspaces made without
 * sign-in reach a tenant only by being copied, never by turning sign-in on.
 * Copying and splitting need sign-in on (they read both sides); every copy is
 * in the tenant's activity.
 */
import { Pool } from 'pg';
import { ensureNamespaceRegistry } from './database-migrations';
import { openDatabaseUrl, selectDatabaseForMode } from './database-mode';
import { iamEnabled } from './identity/iam-config';
import { LOCAL_TENANT_ID } from './identity/tenancy.sql';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './registry/namespace-registry.sql';
import {
  copyLocalWorkspacesToTenant,
  copyTenantWorkspacesToLocal,
  splitTenants,
  TransferError,
} from './workspace-transfer';

const ACTOR = 'system:operator';

export class UsageError extends Error {}

export interface CopyRequest {
  to: { tenant: string } | 'local';
  /** Slugs, or every workspace made without sign-in. */
  slugs: string[] | 'all';
  ownerGroupId?: string;
}

export function parseCopy(args: string[]): CopyRequest {
  let to: CopyRequest['to'] | undefined;
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
    else if (arg === '--owner-group') ownerGroupId = value();
    else if (arg === '--all') all = true;
    else if (arg.startsWith('--'))
      throw new UsageError(`Unknown option ${arg}`);
    else slugs.push(arg.toLowerCase());
  }
  if (!to)
    throw new UsageError('Say where to: --to-tenant <alias> or --to-local');
  if (to !== 'local' && to.tenant === 'local') {
    throw new UsageError('Use --to-local for the open database');
  }
  if (all === slugs.length > 0) {
    throw new UsageError('Name the workspaces, or pass --all');
  }
  if (to === 'local' && all) {
    throw new UsageError('--to-local copies named workspaces only');
  }
  if (to === 'local' && ownerGroupId) {
    throw new UsageError('Workspaces without sign-in have no owner group');
  }
  return { to, slugs: all ? 'all' : slugs, ownerGroupId };
}

export function parseSplit(args: string[]): { keepSource: boolean } {
  let keepSource = false;
  for (const arg of args) {
    if (arg === '--keep-source') keepSource = true;
    else throw new UsageError(`Unknown option ${arg}`);
  }
  return { keepSource };
}

function pool(url: string): Pool {
  return new Pool({
    connectionString: url,
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 2,
  });
}

async function listWorkspaces(
  control: Pool | null,
  open: Pool | null,
): Promise<void> {
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
        row.tenant_id === LOCAL_TENANT_ID
          ? `${label} database, no sign-in`
          : label === 'control'
            ? `tenant ${row.alias}`
            : `tenant ${row.alias}, still in the open database (run tenants split)`;
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
  node dist/src/admin.js workspaces copy --to-local <slug>...
  node dist/src/admin.js tenants split [--keep-source]`;

async function main(argv: string[]): Promise<void> {
  const [area, command, ...rest] = argv;
  const known =
    (area === 'workspaces' && ['list', 'copy'].includes(command ?? '')) ||
    (area === 'tenants' && command === 'split');
  if (!known) throw new UsageError(USAGE);
  const copy = command === 'copy' ? parseCopy(rest) : null;
  const split = command === 'split' ? parseSplit(rest) : null;
  if ((copy || split) && !iamEnabled()) {
    throw new UsageError(
      'Copying workspaces and splitting tenants need sign-in on: run this in an API pod of a release with iam.enabled.',
    );
  }

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
  const control = iamEnabled() ? pool(publicConnectionString()) : null;
  const open = openUrl ? pool(openUrl) : null;
  try {
    if (command === 'list') return await listWorkspaces(control, open);
    if (!control || !open || !openUrl) {
      throw new UsageError(
        'The open database is not known here; set CLASSIFYRE_OPEN_DATABASE to its name.',
      );
    }
    const db = { control, open, openUrl, log: console.log };
    if (split) {
      const moved = await splitTenants(db, split);
      console.log(
        `Moved ${moved.length} workspace(s) into their tenants' databases${split.keepSource ? '; the open database keeps its copies' : ''}.`,
      );
      return;
    }
    if (!copy) return;
    const copied =
      copy.to === 'local'
        ? await copyTenantWorkspacesToLocal(db, {
            slugs: copy.slugs as string[],
            actor: ACTOR,
          })
        : await copyLocalWorkspacesToTenant(db, {
            alias: copy.to.tenant,
            slugs: copy.slugs,
            ownerGroupId: copy.ownerGroupId,
            actor: ACTOR,
          });
    const to = copy.to === 'local' ? 'the open database' : copy.to.tenant;
    if (!copied.length) console.log(`Nothing to copy to ${to}.`);
    for (const workspace of copied) {
      console.log(`Copied ${workspace.slug} to ${to} (${workspace.rows} rows)`);
    }
    if (copied.length) {
      console.log(
        'Running API pods show the copies within a minute. The originals are kept; delete them once you are satisfied.',
      );
    }
  } finally {
    await Promise.all([control?.end(), open?.end()]);
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
