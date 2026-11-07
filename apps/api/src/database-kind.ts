import { Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { iamEnabled } from './identity/iam-config';
import { workspaceScopeSql } from './registry/workspace-scope';

export type DatabaseKind = 'open' | 'control' | 'tenant';

/**
 * Every Classifyre database records what kind it is (docs/prd/TEN §4.1):
 * `open` holds what is made without sign-in, `control` the tenants and the
 * list of their workspaces, and each `tenant` database one tenant's workspace
 * data. The one-row table is the check that a process is pointed at the
 * database it expects; a new database takes the kind it is first opened as.
 */
export function databaseKindDdl(
  kind: DatabaseKind,
  tenantId: string | null = null,
): string {
  return `
CREATE TABLE IF NOT EXISTS public.classifyre_database (
  one_row    boolean PRIMARY KEY DEFAULT true CHECK (one_row),
  kind       text NOT NULL CHECK (kind IN ('open', 'control', 'tenant')),
  tenant_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.classifyre_database (kind, tenant_id)
VALUES ('${kind}', ${tenantId ? `'${tenantId}'` : 'NULL'})
ON CONFLICT (one_row) DO NOTHING;
`;
}

/** The kind of database the API works on in the current sign-in mode. */
export function expectedDatabaseKind(
  env: NodeJS.ProcessEnv = process.env,
): 'open' | 'control' {
  return iamEnabled(env) ? 'control' : 'open';
}

/** Throws unless the connected database is of `kind` (and that tenant's). */
export async function assertDatabaseKind(
  client: Pick<PoolClient, 'query'>,
  kind: DatabaseKind,
  tenantId: string | null = null,
): Promise<void> {
  const { rows } = await client.query<{
    kind: string;
    tenant_id: string | null;
  }>('SELECT kind, tenant_id FROM public.classifyre_database');
  const found = rows[0];
  if (found?.kind === kind && (found.tenant_id ?? null) === tenantId) return;
  const what = (k: string | undefined, t: string | null | undefined) =>
    t ? `'${k}' of tenant ${t}` : `'${k ?? 'unknown'}'`;
  throw new Error(
    `This database is marked ${what(found?.kind, found?.tenant_id)}, not ${what(kind, tenantId)}. ` +
      (kind === 'open'
        ? 'Without sign-in Classifyre runs on the open database; point DATABASE_URL at it.'
        : kind === 'control'
          ? 'With sign-in Classifyre runs on its control database (CLASSIFYRE_CONTROL_DATABASE), never on the open one.'
          : 'A tenant database is opened only for its own tenant.'),
  );
}

const logger = new Logger('DatabaseKind');

/**
 * Refuses to run on a database of another kind. On the open database, says
 * how many workspaces still belong to tenants: they are left from before
 * tenants had their own databases and are not shown without sign-in.
 */
export async function checkDatabaseKind(client: PoolClient): Promise<void> {
  const kind = expectedDatabaseKind();
  await assertDatabaseKind(client, kind);
  if (kind !== 'open') return;

  const hidden = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM public.namespaces
      WHERE status = 'active' AND NOT (${workspaceScopeSql()})`,
  );
  const count = hidden.rows[0]?.count ?? 0;
  if (count === 0) return;
  logger.warn(
    `${count} workspace(s) of sign-in tenants are still in the open database and are not shown without sign-in. With sign-in on, move them into their tenants' databases with: node dist/src/admin.js tenants split`,
  );
}
