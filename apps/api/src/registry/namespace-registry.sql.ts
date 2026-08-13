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

/**
 * Idempotent DDL that creates + migrates the registry table. Safe to run on
 * every boot; this doubles as the "migration" for this hand-managed table.
 *
 * Thumbnails are stored as a binary BLOB (`thumbnail_blob bytea`) plus its MIME
 * type, not as a URL/data-URI in a text column, so uploaded workspace images
 * live in the database and are served by `GET /namespaces/:id/thumbnail`.
 */
export const REGISTRY_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS public.namespaces (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  schema_name    text NOT NULL,
  description    text,
  type           text NOT NULL DEFAULT 'local',
  remote_url     text,
  thumbnail_blob bytea,
  thumbnail_mime text,
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz
);
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS thumbnail_blob bytea;
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS thumbnail_mime text;
-- Legacy text thumbnail column (pre-blob); dropped so the model stays clean.
ALTER TABLE public.namespaces
  DROP COLUMN IF EXISTS thumbnail;
-- When the workspace was soft-deleted, which starts the retention clock before
-- its schema is dropped for good. Separate from updated_at because that moves
-- for any edit; this must only ever mean "deleted at".
ALTER TABLE public.namespaces
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- Backfill rows soft-deleted before this column existed. remove() has always
-- stamped updated_at at the moment of deletion, so for a row already marked
-- deleted that value *is* the deletion time — the honest backfill, not now(),
-- which would silently restart the clock for workspaces deleted months ago.
UPDATE public.namespaces
  SET deleted_at = updated_at
  WHERE status = 'deleted' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS namespaces_status_deleted_at_idx
  ON public.namespaces (status, deleted_at);
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
