import { Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { iamEnabled } from './identity/iam-config';
import { workspaceScopeSql } from './registry/workspace-scope';

/**
 * Every Classifyre database records what kind it is (docs/prd/TEN §4.1):
 * `open` holds what is made without sign-in, `control` and `tenant` are the
 * databases sign-in will use once tenants get their own. Today there is one
 * database and it is `open`, also when it carries tenants' workspaces in
 * `namespaces.tenant_id` (§6). The one-row table is the check that a process
 * is pointed at the database it expects.
 */
export const DATABASE_KIND_DDL = `
CREATE TABLE IF NOT EXISTS public.classifyre_database (
  one_row    boolean PRIMARY KEY DEFAULT true CHECK (one_row),
  kind       text NOT NULL CHECK (kind IN ('open', 'control', 'tenant')),
  tenant_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.classifyre_database (kind) VALUES ('open')
ON CONFLICT (one_row) DO NOTHING;
`;

const logger = new Logger('DatabaseKind');

/**
 * Refuses to run on a database of another kind, and says how many workspaces
 * the current sign-in mode hides, so turning sign-in off or on never makes
 * workspaces disappear without a word.
 */
export async function checkDatabaseKind(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ kind: string }>(
    'SELECT kind FROM public.classifyre_database',
  );
  const kind = rows[0]?.kind;
  if (kind !== 'open') {
    throw new Error(
      `This database is marked '${kind ?? 'unknown'}', not 'open'. This version of Classifyre runs on one open database; point DATABASE_URL at it.`,
    );
  }

  const hidden = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM public.namespaces
      WHERE status = 'active' AND NOT (${workspaceScopeSql()})`,
  );
  const count = hidden.rows[0]?.count ?? 0;
  if (count === 0) return;
  logger.warn(
    iamEnabled()
      ? `${count} workspace(s) were made without sign-in and are not shown while sign-in is on. Move them into a tenant with: node dist/src/admin.js workspaces move --to-tenant <alias> --all`
      : `${count} workspace(s) belong to sign-in tenants and are not shown while sign-in is off. Turn sign-in back on, or move them out with: node dist/src/admin.js workspaces move --to-local <slug>...`,
  );
}
