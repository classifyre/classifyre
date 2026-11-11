import type { PoolClient } from 'pg';

export type DatabaseKind = 'open' | 'control' | 'tenant';

/**
 * Every Classifyre database records what kind it is (docs/prd/TEN §4.1):
 * `control` holds the tenants and the list of their workspaces, each `tenant`
 * database one tenant's workspace data, and `open` is what installs from
 * before sign-in was always on ran on: only ever read, as the source of
 * `admin workspaces copy --to-tenant`. The one-row table is the check that a process is pointed at the
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
        ? 'Workspaces are copied only from the database of an install that ran without sign-in.'
        : kind === 'control'
          ? 'Classifyre runs on its control database (CLASSIFYRE_CONTROL_DATABASE), never on the open one.'
          : 'A tenant database is opened only for its own tenant.'),
  );
}

/** Refuses to run on a database that is not the control database. */
export async function checkDatabaseKind(client: PoolClient): Promise<void> {
  await assertDatabaseKind(client, 'control');
}
