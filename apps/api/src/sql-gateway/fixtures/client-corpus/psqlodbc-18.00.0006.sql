-- Captured by the payload proof of concept (2026-11-20) and on the dev stack (2026-11-21).

-- @@ catalog sqlcolumns-with-operator-syntax rows>=4
select n.nspname, c.relname, a.attname, a.atttypid, t.typname, a.attnum, a.attlen, a.atttypmod, a.attnotnull, c.relhasrules, c.relkind, c.oid, pg_get_expr(d.adbin, d.adrelid), case t.typtype when 'd' then t.typbasetype else 0 end, t.typtypmod, 0, attidentity, c.relhassubclass from (((pg_catalog.pg_class c inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace and c.relname like 'orders' and n.nspname like 'shop.public') inner join pg_catalog.pg_attribute a on (not a.attisdropped) and a.attnum operator(pg_catalog.>) 0 and a.attrelid operator(pg_catalog.=) c.oid) inner join pg_catalog.pg_type t on t.oid operator(pg_catalog.=) a.atttypid) left outer join pg_attrdef d on a.atthasdef and d.adrelid operator(pg_catalog.=) a.attrelid and d.adnum operator(pg_catalog.=) a.attnum order by n.nspname, c.relname, attnum

-- @@ catalog large-object-type
select oid, typbasetype from pg_type where typname = 'lo'

-- @@ data select-for-declare-fetch
SELECT id, customer FROM "shop.public".orders ORDER BY id
