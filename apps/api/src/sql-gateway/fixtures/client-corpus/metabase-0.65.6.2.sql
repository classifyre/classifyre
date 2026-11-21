-- Captured by the payload proof of concept (2026-11-20, Metabase v0.65.6.2 over pgJDBC).

-- @@ session transaction-characteristics
SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED

-- @@ session read-only-transaction
BEGIN READ ONLY

-- @@ session commit
COMMIT

-- Adapted: the POC's copy passed the bare table name to has_any_column_privilege,
-- which fails on information_schema tables in PostgreSQL too; replace with the
-- statement from the next capture.
-- @@ catalog table-privileges rows>=1
with table_privileges as (select NULL as role, t.schemaname as schema, t.objectname as table, pg_catalog.has_table_privilege(current_user, '"' || t.schemaname || '"."' || t.objectname || '"', 'select') as select, pg_catalog.has_any_column_privilege(current_user, '"' || t.schemaname || '"."' || t.objectname || '"', 'update') as update from (select schemaname, tablename as objectname from pg_catalog.pg_tables union select schemaname, matviewname as objectname from pg_catalog.pg_matviews) t where t.schemaname !~ '^pg_' and pg_catalog.has_schema_privilege(current_user, t.schemaname, 'usage')) select t.* from table_privileges t where t.select

-- @@ catalog primary-keys-expandarray
SELECT result.KEY_SEQ FROM (SELECT (information_schema._pg_expandarray(con.conkey)).n AS KEY_SEQ FROM pg_catalog.pg_constraint con WHERE con.contype = 'p') result

-- @@ catalog column-types-udt-name rows>=4
SELECT column_name, data_type, udt_name, format('%s', udt_name) FROM information_schema.columns WHERE table_schema = 'shop.public' AND table_name = 'orders' ORDER BY ordinal_position

-- @@ catalog attnum-any-conkey rows>=1
SELECT count(*) FROM pg_catalog.pg_attribute a, pg_catalog.pg_constraint c WHERE a.attnum = ANY(c.conkey)

-- @@ data query-builder-fully-qualified-columns
SELECT "shop.public"."orders"."id" AS "id", "shop.public"."orders"."customer" AS "customer", "shop.public"."orders"."amount" AS "amount", "shop.public"."orders"."created" AS "created" FROM "shop.public"."orders" ORDER BY "shop.public"."orders"."id" ASC LIMIT 2000

-- @@ refused mixes-data-and-catalog
SELECT o.id, c.relname FROM "shop.public".orders o, pg_class c
