/**
 * Raw-SQL primitives for the namespace registry.
 *
 * The registry is a single table in the `public` schema listing every
 * namespace (tenant). It is deliberately NOT a Prisma model: keeping it out of
 * the per-tenant `schema.prisma` avoids a `namespaces` table being created
 * inside every `ns_<slug>` schema, and avoids a second generated Prisma client.
 * The table is tiny and its DDL is idempotent, so a hand-written
 * `CREATE TABLE IF NOT EXISTS` (run by the migration orchestrator before any
 * tenant migration) is all the "migration tracking" it needs.
 */

/** Idempotent DDL that creates the registry table. Safe to run on every boot. */
export const REGISTRY_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS public.namespaces (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  schema_name    text NOT NULL,
  description    text,
  type           text NOT NULL DEFAULT 'local',
  remote_url     text,
  thumbnail      text,
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz
);
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
`;

/** libpq `options` value that pins a connection's search_path to `public`. */
export const PUBLIC_SEARCH_PATH_OPTION = '-c search_path=public';

/**
 * A `DATABASE_URL` variant with any per-tenant `?schema=` stripped, used by the
 * registry pool and the pre-boot orchestrator. Pair it with
 * {@link PUBLIC_SEARCH_PATH_OPTION} as the pg Pool `options` to guarantee
 * registry reads/writes hit `public` even if the process URL carried a schema.
 */
export function publicConnectionString(): string {
  const raw = new URL(process.env.DATABASE_URL ?? '');
  raw.searchParams.delete('schema');
  return raw.toString();
}
